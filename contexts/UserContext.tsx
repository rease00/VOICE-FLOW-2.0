import React, { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import {
  ConfirmationResult,
  GoogleAuthProvider,
  RecaptchaVerifier,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  CharacterProfile,
  ClonedVoice,
  Draft,
  HistoryItem,
  UserContextType,
  UserProfile,
  UserStats,
} from '../types';
import { INITIAL_STATS, VOICES } from '../constants';
import { guessGenderFromName } from '../services/geminiService';
import { ensureStatsUsageWindows, ensureVfUsageStats } from '../services/usageMetering';
import {
  facebookProvider,
  firebaseAuth,
  firestoreDb,
  googleProvider,
  isAdminIdentity,
  resolveFirebaseLoginEmail,
} from '../services/firebaseClient';
import {
  clearLocalAdminSession,
  createLocalAdminSession,
  getLocalAdminConfigIssue,
  isLocalAdminUsername,
  readLocalAdminSession,
  verifyLocalAdminPassword,
  type LocalAdminSessionPayload,
} from '../services/localAdminAuth';
import { AccountEntitlements, fetchAccountEntitlements } from '../services/accountService';
import { warmDriveTokenFromGoogleSignIn } from '../services/driveAuthService';

interface ExtendedUserContextType extends UserContextType {
  syncCast: (cast: string[] | CharacterProfile[]) => void;
  isSyncing: boolean;
  refreshEntitlements: () => Promise<void>;
}

const UserContext = createContext<ExtendedUserContextType | undefined>(undefined);

const DEFAULT_CHARACTERS: CharacterProfile[] = [
  {
    id: 'def_narrator',
    name: 'Narrator',
    voiceId: 'v1',
    gender: 'Male',
    age: 'Adult',
    avatarColor: '#3b82f6',
    description: 'Standard storytelling voice, neutral tone.',
  },
  {
    id: 'def_host',
    name: 'Host',
    voiceId: 'v2',
    gender: 'Female',
    age: 'Young Adult',
    avatarColor: '#ec4899',
    description: 'Energetic podcast host.',
  },
];

const BLANK_USER: UserProfile = {
  name: '',
  email: '',
  googleId: '',
  role: 'user',
  isAdmin: false,
  providers: [],
};

const readSettingsBackendUrl = (): string => {
  try {
    const raw = localStorage.getItem('vf_settings');
    if (!raw) return 'http://127.0.0.1:7800';
    const parsed = JSON.parse(raw) as { mediaBackendUrl?: string } | null;
    const value = String(parsed?.mediaBackendUrl || '').trim();
    return value || 'http://127.0.0.1:7800';
  } catch {
    return 'http://127.0.0.1:7800';
  }
};

const normalizeStoredStats = (stored: any): UserStats => {
  const merged: UserStats = {
    ...INITIAL_STATS,
    ...stored,
    generationsUsed: Number.isFinite(stored?.generationsUsed) ? Math.max(0, Math.floor(stored.generationsUsed)) : INITIAL_STATS.generationsUsed,
    generationsLimit: Number.isFinite(stored?.generationsLimit) ? Math.max(0, Math.floor(stored.generationsLimit)) : INITIAL_STATS.generationsLimit,
    isPremium: Boolean(stored?.isPremium),
    planName: stored?.planName === 'Pro' || stored?.planName === 'Plus' || stored?.planName === 'Enterprise' ? stored.planName : 'Free',
    lastResetDate: typeof stored?.lastResetDate === 'string' ? stored.lastResetDate : undefined,
    vfUsage: ensureVfUsageStats(stored?.vfUsage),
  };
  return ensureStatsUsageWindows(merged);
};

const mapEntitlementsToStats = (entitlements: AccountEntitlements, prev: UserStats): UserStats => {
  const usage = ensureVfUsageStats(prev.vfUsage);
  const monthlyByEngine = entitlements.monthly?.byEngine || {};
  const dailyByEngine = entitlements.daily?.byEngine || {};

  const dailyTotalChars = Object.values(dailyByEngine).reduce((sum, item: any) => sum + Math.max(0, Number(item?.chars || 0)), 0);
  const monthlyTotalChars = Object.values(monthlyByEngine).reduce((sum, item: any) => sum + Math.max(0, Number(item?.chars || 0)), 0);

  return ensureStatsUsageWindows({
    ...prev,
    generationsUsed: Math.max(0, Number(entitlements.daily?.generationUsed || 0)),
    generationsLimit: Math.max(1, Number(entitlements.daily?.generationLimit || 30)),
    isPremium: entitlements.plan === 'Pro' || entitlements.plan === 'Plus',
    planName: entitlements.plan,
    lastResetDate: entitlements.daily?.periodKey,
    vfUsage: {
      ...usage,
      daily: {
        ...usage.daily,
        key: entitlements.daily?.periodKey || usage.daily.key,
        totalChars: dailyTotalChars,
        totalVf: Math.max(0, Number(entitlements.daily?.vfUsed || 0)),
        byEngine: {
          ...usage.daily.byEngine,
          GEM: {
            chars: Math.max(0, Number(dailyByEngine?.GEM?.chars || 0)),
            vf: Math.max(0, Number(dailyByEngine?.GEM?.vf || 0)),
          },
          KOKORO: {
            chars: Math.max(0, Number(dailyByEngine?.KOKORO?.chars || 0)),
            vf: Math.max(0, Number(dailyByEngine?.KOKORO?.vf || 0)),
          },
        },
      },
      monthly: {
        ...usage.monthly,
        key: entitlements.monthly?.periodKey || usage.monthly.key,
        totalChars: monthlyTotalChars,
        totalVf: Math.max(0, Number(entitlements.monthly?.vfUsed || 0)),
        byEngine: {
          ...usage.monthly.byEngine,
          GEM: {
            chars: Math.max(0, Number(monthlyByEngine?.GEM?.chars || 0)),
            vf: Math.max(0, Number(monthlyByEngine?.GEM?.vf || 0)),
          },
          KOKORO: {
            chars: Math.max(0, Number(monthlyByEngine?.KOKORO?.chars || 0)),
            vf: Math.max(0, Number(monthlyByEngine?.KOKORO?.vf || 0)),
          },
        },
      },
    },
  });
};

const mapFirebaseUserToProfile = async (): Promise<UserProfile> => {
  const current = firebaseAuth.currentUser;
  if (!current) return BLANK_USER;
  const tokenResult = await current.getIdTokenResult(true).catch(() => null);
  const hasAdminClaim = Boolean(tokenResult?.claims?.admin);
  const isAdmin = isAdminIdentity(current.uid, current.email, hasAdminClaim);
  const providerIds = (current.providerData || [])
    .map((provider) => String(provider?.providerId || '').trim())
    .filter(Boolean);
  return {
    uid: current.uid,
    googleId: current.uid,
    name: current.displayName || current.email || current.phoneNumber || 'VoiceFlow User',
    email: current.email || `${current.uid}@firebase.voiceflow`,
    avatarUrl: current.photoURL || undefined,
    phoneNumber: current.phoneNumber || undefined,
    role: 'user',
    isAdmin,
    providers: providerIds,
  };
};

const mapLocalAdminSessionToProfile = (session: LocalAdminSessionPayload): UserProfile => {
  const fallbackName = session.email.split('@')[0] || 'Local Admin';
  return {
    uid: session.uid,
    googleId: session.uid,
    name: fallbackName,
    email: session.email,
    role: 'user',
    isAdmin: true,
    providers: ['local_admin'],
  };
};

const mapFirebaseAuthError = (error: any): string => {
  const code = String(error?.code || '').trim().toLowerCase();
  if (code === 'auth/invalid-email') {
    return 'Use a valid email address. For local admin login, use the configured local admin username.';
  }
  if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
    return 'Invalid email or password.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many attempts. Wait a minute and retry.';
  }
  return String(error?.message || 'Authentication failed.');
};

export const UserProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [stats, setStats] = useState<UserStats>(() => {
    try {
      const stored = localStorage.getItem('vf_stats');
      if (!stored) return INITIAL_STATS;
      return normalizeStoredStats(JSON.parse(stored));
    } catch {
      return INITIAL_STATS;
    }
  });
  const [user, setUser] = useState<UserProfile>(BLANK_USER);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [clonedVoices, setClonedVoices] = useState<ClonedVoice[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [characterLibrary, setCharacterLibrary] = useState<CharacterProfile[]>(DEFAULT_CHARACTERS);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
  const [isSyncing] = useState(false);
  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);
  const charactersUnsubscribeRef = useRef<(() => void) | null>(null);

  const isAdmin = Boolean(user.isAdmin);
  const isAuthenticated = Boolean(user.uid);
  const hasUnlimitedAccess = isAdmin;

  useEffect(() => {
    try {
      localStorage.setItem('vf_stats', JSON.stringify(stats));
    } catch {
      // no-op
    }
  }, [stats]);

  const refreshEntitlements = async () => {
    const firebaseUser = firebaseAuth.currentUser;
    const localAdminSession = firebaseUser ? null : await readLocalAdminSession();
    if (!firebaseUser && !localAdminSession) {
      setStats(INITIAL_STATS);
      return;
    }
    try {
      const entitlements = await fetchAccountEntitlements(readSettingsBackendUrl());
      setStats((prev) => mapEntitlementsToStats(entitlements, prev));
    } catch {
      // Keep the current stats if backend is not reachable.
    }
  };

  const bootstrapCharacterSync = (uid: string) => {
    if (charactersUnsubscribeRef.current) {
      charactersUnsubscribeRef.current();
      charactersUnsubscribeRef.current = null;
    }
    const charactersRef = collection(firestoreDb, 'users', uid, 'characters');
    charactersUnsubscribeRef.current = onSnapshot(
      charactersRef,
      async (snapshot) => {
        if (snapshot.empty) {
          const storedRaw = localStorage.getItem('vf_character_lib');
          if (storedRaw) {
            try {
              const localCharacters = JSON.parse(storedRaw) as CharacterProfile[];
              if (Array.isArray(localCharacters) && localCharacters.length > 0) {
                const batch = writeBatch(firestoreDb);
                localCharacters.forEach((character) => {
                  const id = character.id || crypto.randomUUID();
                  batch.set(doc(firestoreDb, 'users', uid, 'characters', id), { ...character, id });
                });
                await batch.commit();
                localStorage.removeItem('vf_character_lib');
                return;
              }
            } catch {
              // no-op
            }
          }
          setCharacterLibrary(DEFAULT_CHARACTERS);
          return;
        }
        const next = snapshot.docs
          .map((entry) => entry.data() as CharacterProfile)
          .filter((item) => item && item.name && item.voiceId);
        setCharacterLibrary(next.length > 0 ? next : DEFAULT_CHARACTERS);
      },
      () => {
        setCharacterLibrary(DEFAULT_CHARACTERS);
      }
    );
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      if (!firebaseUser) {
        if (charactersUnsubscribeRef.current) {
          charactersUnsubscribeRef.current();
          charactersUnsubscribeRef.current = null;
        }
        const localAdminSession = await readLocalAdminSession();
        if (localAdminSession) {
          setUser(mapLocalAdminSessionToProfile(localAdminSession));
          setCharacterLibrary(DEFAULT_CHARACTERS);
          await refreshEntitlements();
          return;
        }
        setUser(BLANK_USER);
        setCharacterLibrary(DEFAULT_CHARACTERS);
        setStats(INITIAL_STATS);
        return;
      }
      clearLocalAdminSession();
      const profile = await mapFirebaseUserToProfile();
      setUser(profile);
      bootstrapCharacterSync(firebaseUser.uid);
      await refreshEntitlements();
    });
    return () => {
      unsubscribe();
      if (charactersUnsubscribeRef.current) charactersUnsubscribeRef.current();
    };
  }, []);

  const signInWithEmail: UserContextType['signInWithEmail'] = async (email, password) => {
    const rawEmail = String(email || '').trim();
    if (isLocalAdminUsername(rawEmail)) {
      const configIssue = getLocalAdminConfigIssue();
      if (configIssue) {
        return { ok: false, error: `Local admin login is disabled: ${configIssue}` };
      }
      const valid = await verifyLocalAdminPassword(String(password || ''));
      if (!valid) {
        return { ok: false, error: 'Invalid admin credentials.' };
      }
      const session = await createLocalAdminSession();
      if (!session) {
        return { ok: false, error: 'Could not create local admin session. Check local admin env values.' };
      }
      if (charactersUnsubscribeRef.current) {
        charactersUnsubscribeRef.current();
        charactersUnsubscribeRef.current = null;
      }
      if (firebaseAuth.currentUser) {
        await signOut(firebaseAuth).catch(() => undefined);
      }
      setUser(mapLocalAdminSessionToProfile(session));
      setCharacterLibrary(DEFAULT_CHARACTERS);
      await refreshEntitlements();
      return { ok: true };
    }

    try {
      const normalizedEmail = resolveFirebaseLoginEmail(rawEmail);
      if (!normalizedEmail.includes('@')) {
        return {
          ok: false,
          error: 'Use a full email address to sign in. If needed, map "admin" using VITE_ADMIN_LOGIN_EMAIL in .env.',
        };
      }
      await signInWithEmailAndPassword(firebaseAuth, normalizedEmail, String(password || ''));
      await refreshEntitlements();
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: mapFirebaseAuthError(error) };
    }
  };

  const signUpWithEmail: UserContextType['signUpWithEmail'] = async (email, password, displayName) => {
    if (isLocalAdminUsername(String(email || '').trim())) {
      return {
        ok: false,
        error: 'Local admin account cannot sign up. Use Login mode.',
      };
    }
    try {
      const normalizedEmail = resolveFirebaseLoginEmail(String(email || '').trim());
      if (!normalizedEmail.includes('@')) {
        return {
          ok: false,
          error: 'Use a full email address to create an account.',
        };
      }
      const credential = await createUserWithEmailAndPassword(firebaseAuth, normalizedEmail, String(password || ''));
      if (displayName?.trim()) {
        await updateProfile(credential.user, { displayName: displayName.trim() });
      }
      await refreshEntitlements();
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: mapFirebaseAuthError(error) };
    }
  };

  const signInWithGoogle: UserContextType['signInWithGoogle'] = async () => {
    try {
      const result = await signInWithPopup(firebaseAuth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      warmDriveTokenFromGoogleSignIn(credential);
      await refreshEntitlements();
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error?.message || 'Google login failed.' };
    }
  };

  const signInWithFacebook: UserContextType['signInWithFacebook'] = async () => {
    try {
      await signInWithPopup(firebaseAuth, facebookProvider);
      await refreshEntitlements();
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error?.message || 'Facebook login failed.' };
    }
  };

  const startPhoneSignIn: UserContextType['startPhoneSignIn'] = async (phoneNumber, recaptchaContainerId) => {
    try {
      if (!recaptchaRef.current) {
        recaptchaRef.current = new RecaptchaVerifier(firebaseAuth, recaptchaContainerId, { size: 'normal' });
      }
      const confirmation = await signInWithPhoneNumber(firebaseAuth, phoneNumber, recaptchaRef.current);
      confirmationRef.current = confirmation;
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error?.message || 'Phone sign-in failed.' };
    }
  };

  const confirmPhoneSignIn: UserContextType['confirmPhoneSignIn'] = async (code) => {
    try {
      if (!confirmationRef.current) {
        return { ok: false, error: 'No phone verification session found.' };
      }
      await confirmationRef.current.confirm(code);
      confirmationRef.current = null;
      await refreshEntitlements();
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error?.message || 'Verification failed.' };
    }
  };

  const signOutUser: UserContextType['signOutUser'] = async () => {
    clearLocalAdminSession();
    if (charactersUnsubscribeRef.current) {
      charactersUnsubscribeRef.current();
      charactersUnsubscribeRef.current = null;
    }
    if (firebaseAuth.currentUser) {
      await signOut(firebaseAuth).catch(() => undefined);
    }
    setUser(BLANK_USER);
    setCharacterLibrary(DEFAULT_CHARACTERS);
    setStats(INITIAL_STATS);
    setShowSubscriptionModal(false);
  };

  const updateCharacter = (character: CharacterProfile) => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;
    const id = character.id || crypto.randomUUID();
    const payload: CharacterProfile = { ...character, id };
    void setDoc(doc(firestoreDb, 'users', uid, 'characters', id), payload, { merge: true });
  };

  const deleteCharacter = (id: string) => {
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;
    if (DEFAULT_CHARACTERS.some((item) => item.id === id)) return;
    void deleteDoc(doc(firestoreDb, 'users', uid, 'characters', id));
  };

  const syncCast = (cast: string[] | CharacterProfile[]) => {
    if (!cast || cast.length === 0) return;
    const existingByName = new Map(characterLibrary.map((item) => [item.name.toLowerCase(), item]));

    cast.forEach((item, idx) => {
      const name = typeof item === 'string' ? item : item.name;
      const meta = typeof item === 'string' ? null : item;
      if (!name) return;
      if (existingByName.has(name.toLowerCase())) return;
      if (['scene', 'unknown', 'sfx', 'speaker', 'end', 'start'].includes(name.toLowerCase())) return;

      const heuristicGender = guessGenderFromName(name);
      const detectedGender = (meta?.gender as any) || heuristicGender;
      const detectedAge = (meta?.age as any) || 'Adult';
      let voicePool = VOICES;
      if (detectedGender === 'Male') voicePool = VOICES.filter((voice) => voice.gender === 'Male');
      else if (detectedGender === 'Female') voicePool = VOICES.filter((voice) => voice.gender === 'Female');
      if (voicePool.length === 0) voicePool = VOICES;
      const selectedVoice = voicePool[(characterLibrary.length + idx) % voicePool.length];
      updateCharacter({
        id: crypto.randomUUID(),
        name,
        voiceId: selectedVoice.id,
        gender: detectedGender,
        age: detectedAge,
        avatarColor: '#6366f1',
        description: 'Auto-added from script',
      });
    });
  };

  const contextValue = useMemo<ExtendedUserContextType>(() => ({
    user,
    updateUser: (partial) => setUser((prev) => ({ ...prev, ...partial })),
    stats,
    updateStats: (partial) =>
      setStats((prev) =>
        ensureStatsUsageWindows({
          ...prev,
          ...partial,
          vfUsage: ensureVfUsageStats((partial as any).vfUsage ?? prev.vfUsage),
        })
      ),
    history,
    addToHistory: (item) => setHistory((prev) => [item, ...prev]),
    clearHistory: () => setHistory([]),
    deleteAccount: async () => {
      await signOutUser();
      setHistory([]);
      setClonedVoices([]);
      setDrafts([]);
      setCharacterLibrary(DEFAULT_CHARACTERS);
    },
    clonedVoices,
    addClonedVoice: (voice) => setClonedVoices((prev) => [voice, ...prev]),
    drafts,
    saveDraft: (name, text, settings) =>
      setDrafts((prev) => [{ id: Date.now().toString(), name, text, settings, lastModified: Date.now() }, ...prev]),
    deleteDraft: (id) => setDrafts((prev) => prev.filter((item) => item.id !== id)),
    showSubscriptionModal,
    setShowSubscriptionModal: (show) => setShowSubscriptionModal(show),
    watchAd: async () => {
      setStats((prev) =>
        ensureStatsUsageWindows({
          ...prev,
          generationsUsed: Math.max(0, prev.generationsUsed - 1),
        })
      );
    },
    recordTtsUsage: () => {
      void refreshEntitlements();
    },
    characterLibrary,
    updateCharacter,
    deleteCharacter,
    getVoiceForCharacter: (name) => characterLibrary.find((char) => char.name.toLowerCase() === name.toLowerCase())?.voiceId,
    signInWithEmail,
    signUpWithEmail,
    signOutUser,
    signInWithGoogle,
    signInWithFacebook,
    startPhoneSignIn,
    confirmPhoneSignIn,
    isAuthenticated,
    isAdmin,
    hasUnlimitedAccess,
    syncCast,
    isSyncing,
    refreshEntitlements,
  }), [
    characterLibrary,
    clonedVoices,
    drafts,
    hasUnlimitedAccess,
    history,
    isAdmin,
    isAuthenticated,
    isSyncing,
    showSubscriptionModal,
    stats,
    user,
  ]);

  return <UserContext.Provider value={contextValue}>{children}</UserContext.Provider>;
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) throw new Error('useUser must be used within a UserProvider');
  return context;
};
