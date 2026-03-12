import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import {
  ConfirmationResult,
  GoogleAuthProvider,
  RecaptchaVerifier,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
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
  getDoc,
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
import { createEmptyWalletStats, ensureStatsUsageWindows, ensureVfUsageStats } from '../services/usageMetering';
import {
  facebookProvider,
  firebaseConfigIssue,
  firebaseAuth,
  firestoreDb,
  googleProvider,
  isAdminIdentity,
  isFirebaseConfigured,
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
import {
  AccountEntitlements,
  claimAdReward,
  clearGenerationHistory,
  fetchAccountProfile,
  fetchAccountEntitlements,
  fetchGenerationHistory,
  upsertAccountProfile,
} from '../services/accountService';
import { fetchAdminActor } from '../services/adminService';
import { hasActiveAdminActor } from '../src/shared/auth/adminAccess';
import { warmDriveTokenFromGoogleSignIn } from '../services/driveAuthService';
import { resolveApiBaseUrl } from '../src/shared/api/config';
import { STORAGE_KEYS } from '../src/shared/storage/keys';
import { readStorageJson, writeStorageJson, removeStorageKey, writeStorageString } from '../src/shared/storage/localStore';
import { resolveHistoryVoiceLabel } from '../src/shared/voices/historyVoiceLabel';

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

const readStoredCharacterLibrary = (): CharacterProfile[] => {
  const stored = readStorageJson<CharacterProfile[]>(STORAGE_KEYS.characterLibrary);
  if (!Array.isArray(stored) || stored.length === 0) return DEFAULT_CHARACTERS;
  const normalized = stored
    .filter((item): item is CharacterProfile => Boolean(item && item.name && item.voiceId))
    .map((item) => ({
      ...item,
      id: String(item.id || '').trim() || crypto.randomUUID(),
      name: String(item.name || '').trim(),
      voiceId: String(item.voiceId || '').trim(),
    }))
    .filter((item) => item.name && item.voiceId);
  return normalized.length > 0 ? normalized : DEFAULT_CHARACTERS;
};

const writeStoredCharacterLibrary = (characters: CharacterProfile[]): void => {
  writeStorageJson(STORAGE_KEYS.characterLibrary, characters);
};

const BLANK_USER: UserProfile = {
  name: '',
  email: '',
  googleId: '',
  role: 'user',
  isAdmin: false,
  providers: [],
  adminActor: null,
};

const readSettingsBackendUrl = (): string => {
  const parsed = readStorageJson<{ mediaBackendUrl?: string }>(STORAGE_KEYS.settings);
  return resolveApiBaseUrl(parsed?.mediaBackendUrl);
};

const isBearerTokenAuthMismatch = (error: unknown): boolean => {
  const message = String((error as { message?: string })?.message || error || '').trim().toLowerCase();
  if (!message) return false;
  return (
    message.includes('missing bearer token') ||
    message.includes('invalid auth token') ||
    message.includes('auth token did not include uid')
  );
};

const localAdminBackendAuthMismatchMessage =
  'Local admin login is enabled in frontend, but backend auth enforcement is ON. ' +
  'Set VF_AUTH_ENFORCE=0 for local admin mode, or disable local admin login and sign in with Firebase.';
const unverifiedEmailAuthMessage = 'Verify your email before signing in. Check your inbox/spam and then try again.';

interface PendingSignupProfile {
  uid: string;
  email: string;
  userId: string;
  displayName?: string;
  createdAt: number;
}

const syncUserIdSetupRequirement = (required: boolean): void => {
  if (required) {
    writeStorageString(STORAGE_KEYS.uidSetupRequired, '1');
    return;
  }
  removeStorageKey(STORAGE_KEYS.uidSetupRequired);
};

const readPendingSignupProfile = (): PendingSignupProfile | null => {
  const payload = readStorageJson<PendingSignupProfile>(STORAGE_KEYS.pendingSignupProfile);
  if (!payload || typeof payload !== 'object') return null;
  const uid = String(payload.uid || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const userId = String(payload.userId || '').trim().toLowerCase();
  if (!uid || !email || !userId) return null;
  return {
    uid,
    email,
    userId,
    ...(payload.displayName ? { displayName: String(payload.displayName).trim() } : {}),
    createdAt: Number.isFinite(payload.createdAt) ? Number(payload.createdAt) : Date.now(),
  };
};

const writePendingSignupProfile = (payload: PendingSignupProfile): void => {
  writeStorageJson(STORAGE_KEYS.pendingSignupProfile, payload);
};

const clearPendingSignupProfile = (): void => {
  removeStorageKey(STORAGE_KEYS.pendingSignupProfile);
};

const requiresEmailVerificationForUser = (user: { email?: string | null; emailVerified?: boolean | null }): boolean => {
  const email = String(user.email || '').trim();
  if (!email) return false;
  return user.emailVerified !== true;
};

const syncUserIdSetupRequirement = (required: boolean): void => {
  if (required) {
    writeStorageString(STORAGE_KEYS.uidSetupRequired, '1');
    return;
  }
  removeStorageKey(STORAGE_KEYS.uidSetupRequired);
};

const normalizePlanNameForStats = (value: unknown): UserStats['planName'] => {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'starter') return 'Starter';
  if (token === 'creator') return 'Creator';
  if (token === 'pro') return 'Pro';
  if (token === 'scale' || token === 'plus' || token === 'pro_plus' || token === 'pro-plus') return 'Scale';
  if (token === 'enterprise') return 'Enterprise';
  return 'Free';
};

const isPaidPlanName = (planName: UserStats['planName']): boolean =>
  planName === 'Starter' || planName === 'Creator' || planName === 'Pro' || planName === 'Scale' || planName === 'Enterprise';

const normalizeAllowedEngines = (input: unknown): Array<'KOKORO' | 'NEURAL2' | 'GEM'> => {
  if (!Array.isArray(input)) return ['KOKORO', 'NEURAL2'];
  const allowed = new Set<'KOKORO' | 'NEURAL2' | 'GEM'>();
  input.forEach((value) => {
    const token = String(value || '').trim().toUpperCase();
    if (token === 'KOKORO' || token === 'NEURAL2' || token === 'GEM') {
      allowed.add(token);
      return;
    }
    if (token === 'GOOD') {
      allowed.add('GEM');
    }
  });
  return allowed.size > 0 ? Array.from(allowed) : ['KOKORO', 'NEURAL2'];
};

const normalizeStoredStats = (stored: any): UserStats => {
  const walletFallback = createEmptyWalletStats();
  const planName = normalizePlanNameForStats(stored?.planName);
  const merged: UserStats = {
    ...INITIAL_STATS,
    ...stored,
    generationsUsed: Number.isFinite(stored?.generationsUsed) ? Math.max(0, Math.floor(stored.generationsUsed)) : INITIAL_STATS.generationsUsed,
    generationsLimit: Number.isFinite(stored?.generationsLimit) ? Math.max(0, Math.floor(stored.generationsLimit)) : INITIAL_STATS.generationsLimit,
    isPremium: Boolean(stored?.isPremium) || isPaidPlanName(planName),
    planName,
    lastResetDate: typeof stored?.lastResetDate === 'string' ? stored.lastResetDate : undefined,
    vfUsage: ensureVfUsageStats(stored?.vfUsage),
    wallet: {
      ...walletFallback,
      ...(stored?.wallet || {}),
      spendableNowByEngine: {
        KOKORO: Math.max(0, Number(stored?.wallet?.spendableNowByEngine?.KOKORO ?? walletFallback.spendableNowByEngine.KOKORO)),
        NEURAL2: Math.max(0, Number(stored?.wallet?.spendableNowByEngine?.NEURAL2 ?? walletFallback.spendableNowByEngine.NEURAL2)),
        GEM: Math.max(
          0,
          Number(
            stored?.wallet?.spendableNowByEngine?.GEM
            ?? stored?.wallet?.spendableNowByEngine?.GOOD
            ?? walletFallback.spendableNowByEngine.GEM
          )
        ),
      },
    },
    limits: {
      maxCharsPerGeneration: Math.max(1, Number(stored?.limits?.maxCharsPerGeneration || INITIAL_STATS.limits?.maxCharsPerGeneration || 8000)),
      allowedEngines: normalizeAllowedEngines(stored?.limits?.allowedEngines || INITIAL_STATS.limits?.allowedEngines),
    },
    features: {
      earlyAccess: Boolean(stored?.features?.earlyAccess),
    },
  };
  return ensureStatsUsageWindows(merged);
};

const mapEntitlementRatesToUsage = (
  entitlements: AccountEntitlements,
  fallback: UserStats['vfUsage']['rates']
): UserStats['vfUsage']['rates'] => {
  const vfRates = (entitlements?.limits?.vfRates || {}) as Record<string, unknown>;
  return {
    KOKORO: Number.isFinite(vfRates.KOKORO) ? Math.max(0, Number(vfRates.KOKORO)) : fallback.KOKORO,
    NEURAL2: Number.isFinite(vfRates.NEURAL2) ? Math.max(0, Number(vfRates.NEURAL2)) : fallback.NEURAL2,
    GEM: Number.isFinite(vfRates.GEM)
      ? Math.max(0, Number(vfRates.GEM))
      : Number.isFinite(vfRates.GOOD)
        ? Math.max(0, Number(vfRates.GOOD))
        : fallback.GEM,
  };
};

const readLegacyGemUsage = (
  bucket: Record<string, { chars: number; vf: number }>,
  primaryKey: 'GEM',
  legacyKey: 'GOOD'
): { chars: number; vf: number } => {
  const primary = bucket?.[primaryKey];
  const legacy = bucket?.[legacyKey];
  return {
    chars: Math.max(0, Number(primary?.chars || 0)) + Math.max(0, Number(legacy?.chars || 0)),
    vf: Math.max(0, Number(primary?.vf || 0)) + Math.max(0, Number(legacy?.vf || 0)),
  };
};

const mapEntitlementsToStats = (entitlements: AccountEntitlements, prev: UserStats): UserStats => {
  const usage = ensureVfUsageStats(prev.vfUsage);
  const monthlyByEngine = entitlements.monthly?.byEngine || {};
  const dailyByEngine = entitlements.daily?.byEngine || {};
  const walletFallback = createEmptyWalletStats();
  const wallet = entitlements.wallet || walletFallback;
  const planName = normalizePlanNameForStats(entitlements.plan);

  const dailyGemUsage = readLegacyGemUsage(dailyByEngine, 'GEM', 'GOOD');
  const monthlyGemUsage = readLegacyGemUsage(monthlyByEngine, 'GEM', 'GOOD');

  const dailyTotalChars = Object.values(dailyByEngine).reduce((sum, item: any) => sum + Math.max(0, Number(item?.chars || 0)), 0);
  const monthlyTotalChars = Object.values(monthlyByEngine).reduce((sum, item: any) => sum + Math.max(0, Number(item?.chars || 0)), 0);

  return ensureStatsUsageWindows({
    ...prev,
    generationsUsed: Math.max(0, Number(entitlements.daily?.generationUsed || 0)),
    generationsLimit: Math.max(1, Number(entitlements.daily?.generationLimit || 30)),
    isPremium: isPaidPlanName(planName),
    planName,
    lastResetDate: entitlements.daily?.periodKey,
    vfUsage: {
      ...usage,
      rates: mapEntitlementRatesToUsage(entitlements, usage.rates),
      daily: {
        ...usage.daily,
        key: entitlements.daily?.periodKey || usage.daily.key,
        totalChars: dailyTotalChars,
        totalVf: Math.max(0, Number(entitlements.daily?.vfUsed || 0)),
        byEngine: {
          ...usage.daily.byEngine,
          KOKORO: {
            chars: Math.max(0, Number(dailyByEngine?.KOKORO?.chars || 0)),
            vf: Math.max(0, Number(dailyByEngine?.KOKORO?.vf || 0)),
          },
          NEURAL2: {
            chars: Math.max(0, Number(dailyByEngine?.NEURAL2?.chars || 0)),
            vf: Math.max(0, Number(dailyByEngine?.NEURAL2?.vf || 0)),
          },
          GEM: {
            chars: dailyGemUsage.chars,
            vf: dailyGemUsage.vf,
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
          KOKORO: {
            chars: Math.max(0, Number(monthlyByEngine?.KOKORO?.chars || 0)),
            vf: Math.max(0, Number(monthlyByEngine?.KOKORO?.vf || 0)),
          },
          NEURAL2: {
            chars: Math.max(0, Number(monthlyByEngine?.NEURAL2?.chars || 0)),
            vf: Math.max(0, Number(monthlyByEngine?.NEURAL2?.vf || 0)),
          },
          GEM: {
            chars: monthlyGemUsage.chars,
            vf: monthlyGemUsage.vf,
          },
        },
      },
    },
    wallet: {
      monthlyFreeRemaining: Math.max(0, Number(wallet.monthlyFreeRemaining || 0)),
      monthlyFreeLimit: Math.max(0, Number(wallet.monthlyFreeLimit || 0)),
      vffBalance: Math.max(0, Number(wallet.vffBalance || 0)),
      paidVfBalance: Math.max(0, Number(wallet.paidVfBalance || 0)),
      spendableNowByEngine: {
        KOKORO: Math.max(0, Number(wallet.spendableNowByEngine?.KOKORO || 0)),
        NEURAL2: Math.max(0, Number(wallet.spendableNowByEngine?.NEURAL2 || 0)),
        GEM: Math.max(
          0,
          Number(wallet.spendableNowByEngine?.GEM || 0) + Number((wallet as any).spendableNowByEngine?.GOOD || 0)
        ),
      },
      adClaimsToday: Math.max(0, Number(wallet.adClaimsToday || 0)),
      adClaimsDailyLimit: Math.max(1, Number(wallet.adClaimsDailyLimit || walletFallback.adClaimsDailyLimit)),
      vffMonthKey: wallet.vffMonthKey,
    },
    limits: {
      maxCharsPerGeneration: Math.max(1, Number(entitlements?.limits?.maxCharsPerGeneration || prev.limits?.maxCharsPerGeneration || 8000)),
      allowedEngines: normalizeAllowedEngines(entitlements?.limits?.allowedEngines || prev.limits?.allowedEngines),
    },
    features: {
      earlyAccess: Boolean(entitlements?.features?.earlyAccess),
    },
  });
};

const isTruthyAdminFlag = (value: unknown): boolean => {
  if (value === true) return true;
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

const hasFirestoreAdminRole = (data: Record<string, unknown> | null | undefined): boolean => {
  if (!data) return false;
  if (isTruthyAdminFlag(data.isAdmin) || isTruthyAdminFlag(data.admin)) return true;

  const role = String(data.role ?? '').trim().toLowerCase();
  if (role === 'admin') return true;

  const rolesRaw = data.roles;
  if (Array.isArray(rolesRaw)) {
    const hasAdmin = rolesRaw.some((item) => String(item ?? '').trim().toLowerCase() === 'admin');
    if (hasAdmin) return true;
  }
  return false;
};

const readFirestoreAdminStatus = async (uid: string): Promise<boolean> => {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) return false;
  try {
    const snapshot = await getDoc(doc(firestoreDb, 'users', normalizedUid));
    if (!snapshot.exists()) return false;
    return hasFirestoreAdminRole(snapshot.data() as Record<string, unknown>);
  } catch {
    return false;
  }
};

const mapFirebaseUserToProfile = async (): Promise<UserProfile> => {
  const current = firebaseAuth.currentUser;
  if (!current) return BLANK_USER;
  const tokenResult = await current.getIdTokenResult().catch(() => null);
  const hasAdminClaim = Boolean(tokenResult?.claims?.admin);
  const envOrClaimAdmin = isAdminIdentity(current.uid, current.email, hasAdminClaim);
  const firestoreAdmin = envOrClaimAdmin ? false : await readFirestoreAdminStatus(current.uid);
  const isAdmin = envOrClaimAdmin || firestoreAdmin;
  const providerIds = (current.providerData || [])
    .map((provider) => String(provider?.providerId || '').trim())
    .filter(Boolean);
  let userId = '';
  try {
    const accountProfile = await fetchAccountProfile(readSettingsBackendUrl());
    syncUserIdSetupRequirement(Boolean(accountProfile?.requiredUserId));
    userId = String(accountProfile?.profile?.userId || '').trim().toLowerCase();
  } catch {
    // Profile setup can be completed later; auth should remain usable.
  }
  return {
    uid: current.uid,
    googleId: current.uid,
    name: current.displayName || current.email || current.phoneNumber || 'VoiceFlow User',
    email: current.email || `${current.uid}@firebase.voiceflow`,
    userId: userId || undefined,
    avatarUrl: current.photoURL || undefined,
    phoneNumber: current.phoneNumber || undefined,
    role: isAdmin ? 'admin' : 'user',
    isAdmin,
    providers: providerIds,
    adminActor: null,
  };
};

const mapLocalAdminSessionToProfile = (session: LocalAdminSessionPayload): UserProfile => {
  const fallbackName = session.email.split('@')[0] || 'Local Admin';
  return {
    uid: session.uid,
    googleId: session.uid,
    name: fallbackName,
    email: session.email,
    role: 'admin',
    isAdmin: true,
    providers: ['local_admin'],
    adminActor: null,
  };
};

const resolveFirebaseConfigIssue = (): string =>
  String(firebaseConfigIssue || '').trim() ||
  'Firebase auth is not configured. Set VITE_FIREBASE_* and restart the frontend server.';

const requireFirebaseConfigForAuth = (): string | null => {
  if (isFirebaseConfigured) return null;
  return resolveFirebaseConfigIssue();
};

const mapFirebaseAuthError = (error: any): string => {
  const code = String(error?.code || '').trim().toLowerCase();
  const rawMessage = String(error?.message || '').trim();
  const loweredMessage = rawMessage.toLowerCase();
  if (code === 'auth/api-key-not-valid' || code === 'auth/invalid-api-key') {
    return resolveFirebaseConfigIssue();
  }
  if (code === 'auth/invalid-email') {
    return 'Use a valid email address. For local admin login, use the configured local admin username.';
  }
  if (code === 'auth/network-request-failed' || loweredMessage.includes('network-request-failed')) {
    return 'Cannot reach authentication service right now. Check internet connection, then retry.';
  }
  if (
    loweredMessage.includes('cannot reach backend') ||
    loweredMessage.includes('backend gateway is unreachable') ||
    loweredMessage.includes('failed to fetch') ||
    loweredMessage.includes('fetch failed')
  ) {
    return 'Cannot connect to backend service right now. Check backend URL/network and retry.';
  }
  if (code === 'auth/email-already-in-use') {
    return 'This email is already registered. Use Login or reset password.';
  }
  if (code === 'auth/weak-password') {
    return 'Password is too weak. Use at least 6 characters.';
  }
  if (code === 'auth/operation-not-allowed') {
    return 'Email/password authentication is not enabled for this project.';
  }
  if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
    return 'Invalid email or password.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many attempts. Wait a minute and retry.';
  }
  if (
    loweredMessage.includes('service_disabled') ||
    loweredMessage.includes('firestore.googleapis.com') ||
    loweredMessage.includes('googleapis.com') ||
    loweredMessage.includes('cloud firestore api has not been used') ||
    loweredMessage.includes('profile service')
  ) {
    return 'Profile service is temporarily unavailable. Please try again in a few minutes.';
  }
  if (loweredMessage.includes('token used too early') || loweredMessage.includes('token is not yet valid')) {
    return 'System clock is out of sync. Sync your device clock and sign in again.';
  }
  return 'Authentication failed. Please retry.';
};

const normalizeHistoryItem = (item: HistoryItem): HistoryItem => {
  const textPreview = String((item as any).textPreview || item.text || '').trim();
  const voiceId = String((item as any).voiceId || (item as any).voice_id || '').trim();
  const voiceName = resolveHistoryVoiceLabel({
    voiceName: (item as any).voiceName,
    voiceId,
  });
  return {
    ...item,
    text: textPreview,
    audioUrl: typeof item.audioUrl === 'string' ? item.audioUrl : undefined,
    voiceName,
    voiceId: voiceId || undefined,
    timestamp: Number.isFinite(item.timestamp) ? item.timestamp : Date.now(),
    chars: Number.isFinite((item as any).chars) ? Math.max(0, Number((item as any).chars)) : undefined,
  };
};

const MAX_IN_MEMORY_HISTORY_ITEMS = 30;

export const UserProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [stats, setStats] = useState<UserStats>(() => {
    const stored = readStorageJson(STORAGE_KEYS.stats);
    if (!stored) return INITIAL_STATS;
    return normalizeStoredStats(stored);
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
  const isLocalAdminSessionActive = useMemo(
    () => !firebaseAuth.currentUser && Array.isArray(user.providers) && user.providers.includes('local_admin'),
    [user.providers]
  );

  useEffect(() => {
    writeStorageJson(STORAGE_KEYS.stats, stats);
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

  const refreshAdminActor = async () => {
    const firebaseUser = firebaseAuth.currentUser;
    const localAdminSession = firebaseUser ? null : await readLocalAdminSession();
    const currentUid = String(firebaseUser?.uid || localAdminSession?.uid || '').trim();
    if (!currentUid) {
      setUser((prev) => (prev.adminActor ? { ...prev, adminActor: null } : prev));
      return;
    }
    try {
      const actor = await fetchAdminActor(readSettingsBackendUrl());
      const actorPayload = {
        uid: String(actor.uid || '').trim() || currentUid,
        role: String(actor.role || 'super_admin'),
        status: String(actor.status || 'active'),
        permissions: Array.isArray(actor.permissions) ? actor.permissions.map((item) => String(item || '')) : [],
        ...(actor.userId ? { userId: actor.userId } : {}),
        ...(actor.source ? { source: actor.source } : {}),
      };
      const hasOperatorAccess = hasActiveAdminActor(actorPayload);
      setUser((prev) => {
        if (String(prev.uid || '').trim() !== currentUid) return prev;
        return {
          ...prev,
          role: prev.isAdmin || hasOperatorAccess ? 'admin' : 'user',
          adminActor: hasOperatorAccess ? actorPayload : null,
        };
      });
    } catch {
      setUser((prev) => {
        if (String(prev.uid || '').trim() !== currentUid) return prev;
        return {
          ...prev,
          adminActor: prev.adminActor || null,
        };
      });
    }
  };

  const applyPendingSignupProfile = async (uid: string, email: string): Promise<void> => {
    const pending = readPendingSignupProfile();
    if (!pending) return;
    const safeUid = String(uid || '').trim();
    const safeEmail = String(email || '').trim().toLowerCase();
    if (!safeUid || pending.uid !== safeUid) return;
    if (safeEmail && pending.email !== safeEmail) return;
    try {
      await upsertAccountProfile(
        {
          userId: pending.userId,
          ...(pending.displayName ? { displayName: pending.displayName } : {}),
        },
        readSettingsBackendUrl()
      );
      setUser((prev) => {
        if (String(prev.uid || '').trim() !== safeUid) return prev;
        return {
          ...prev,
          userId: pending.userId,
        };
      });
      removeStorageKey(STORAGE_KEYS.uidSetupRequired);
      clearPendingSignupProfile();
    } catch {
      // Keep pending payload to retry after the next successful verified sign-in.
    }
  };

  const loadHistory = async (limit = 30) => {
    const firebaseUser = firebaseAuth.currentUser;
    const localAdminSession = firebaseUser ? null : await readLocalAdminSession();
    if (!firebaseUser && !localAdminSession) {
      setHistory([]);
      return;
    }
    try {
      const rows = await fetchGenerationHistory(readSettingsBackendUrl(), limit);
      const normalized = Array.isArray(rows)
        ? rows.map((item) => normalizeHistoryItem(item)).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
        : [];
      setHistory(normalized);
    } catch {
      // Keep current in-memory history when backend is unavailable.
    }
  };

  const clearHistoryRemote = async () => {
    try {
      await clearGenerationHistory(readSettingsBackendUrl());
    } catch {
      // Keep client behavior deterministic even when backend clear fails.
    } finally {
      setHistory([]);
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
          const localCharacters = readStorageJson<CharacterProfile[]>(STORAGE_KEYS.characterLibrary);
          if (Array.isArray(localCharacters) && localCharacters.length > 0) {
            const batch = writeBatch(firestoreDb);
            localCharacters.forEach((character) => {
              const id = character.id || crypto.randomUUID();
              batch.set(doc(firestoreDb, 'users', uid, 'characters', id), { ...character, id });
            });
            await batch.commit();
            removeStorageKey(STORAGE_KEYS.characterLibrary);
            return;
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
          setCharacterLibrary(readStoredCharacterLibrary());
          await Promise.allSettled([refreshAdminActor(), refreshEntitlements(), loadHistory()]);
          return;
        }
        removeStorageKey(STORAGE_KEYS.uidSetupRequired);
        setUser(BLANK_USER);
        setCharacterLibrary(DEFAULT_CHARACTERS);
        setStats(INITIAL_STATS);
        setHistory([]);
        return;
      }
      clearLocalAdminSession();
      await firebaseUser.reload().catch(() => undefined);
      if (requiresEmailVerificationForUser(firebaseUser)) {
        if (charactersUnsubscribeRef.current) {
          charactersUnsubscribeRef.current();
          charactersUnsubscribeRef.current = null;
        }
        await signOut(firebaseAuth).catch(() => undefined);
        removeStorageKey(STORAGE_KEYS.uidSetupRequired);
        setUser(BLANK_USER);
        setCharacterLibrary(DEFAULT_CHARACTERS);
        setStats(INITIAL_STATS);
        setHistory([]);
        return;
      }
      const profile = await mapFirebaseUserToProfile();
      setUser(profile);
      bootstrapCharacterSync(firebaseUser.uid);
      await Promise.allSettled([refreshAdminActor(), refreshEntitlements(), loadHistory()]);
    });
    return () => {
      unsubscribe();
      if (charactersUnsubscribeRef.current) charactersUnsubscribeRef.current();
    };
  }, []);

  useEffect(() => {
    const safeUid = String(user.uid || '').trim();
    if (!safeUid) {
      if (user.adminActor) {
        setUser((prev) => ({ ...prev, adminActor: null }));
      }
      return;
    }
    void refreshAdminActor();
  // user.adminActor intentionally excluded to avoid a fetch loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid]);

  const signInWithEmail: UserContextType['signInWithEmail'] = async (email, password) => {
    const rawEmail = String(email || '').trim();
    if (isLocalAdminUsername(rawEmail)) {
      const configIssue = getLocalAdminConfigIssue();
      if (!configIssue) {
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
        setCharacterLibrary(readStoredCharacterLibrary());
        try {
          await fetchAccountProfile(readSettingsBackendUrl());
        } catch (error) {
          if (isBearerTokenAuthMismatch(error)) {
            clearLocalAdminSession();
            setUser(BLANK_USER);
            setStats(INITIAL_STATS);
            setHistory([]);
            return {
              ok: false,
              error: localAdminBackendAuthMismatchMessage,
            };
          }
        }
        removeStorageKey(STORAGE_KEYS.uidSetupRequired);
        void Promise.allSettled([refreshAdminActor(), refreshEntitlements(), loadHistory()]);
        return { ok: true };
      }

      const firebaseAuthConfigIssue = requireFirebaseConfigForAuth();
      if (firebaseAuthConfigIssue) {
        return {
          ok: false,
          error: `Local admin login is disabled: ${configIssue}. ${firebaseAuthConfigIssue}`,
        };
      }

      const fallbackEmail = resolveFirebaseLoginEmail(rawEmail);
      if (!fallbackEmail.includes('@')) {
        return {
          ok: false,
          error: `Local admin login is disabled: ${configIssue}. Firebase fallback requires VITE_ADMIN_LOGIN_EMAIL or a valid Firebase auth domain.`,
        };
      }
      try {
        await signInWithEmailAndPassword(firebaseAuth, fallbackEmail, String(password || ''));
        return { ok: true };
      } catch (error: any) {
        return {
          ok: false,
          error: `Local admin login is disabled: ${configIssue}. Firebase fallback failed: ${mapFirebaseAuthError(error)}`,
        };
      }
    }

    const firebaseAuthConfigIssue = requireFirebaseConfigForAuth();
    if (firebaseAuthConfigIssue) {
      return { ok: false, error: firebaseAuthConfigIssue };
    }

    try {
      const normalizedEmail = resolveFirebaseLoginEmail(rawEmail);
      if (!normalizedEmail.includes('@')) {
        return {
          ok: false,
          error: 'Use a full email address to sign in. If needed, map an admin username or admin UID using VITE_ADMIN_LOGIN_EMAIL in .env.',
        };
      }
      await signInWithEmailAndPassword(firebaseAuth, normalizedEmail, String(password || ''));
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: mapFirebaseAuthError(error) };
    }
  };

  const signUpWithEmail: UserContextType['signUpWithEmail'] = async (email, password, displayName, userId) => {
    if (isLocalAdminUsername(String(email || '').trim())) {
      return {
        ok: false,
        error: 'Local admin account cannot sign up. Use Login mode.',
      };
    }

    const firebaseAuthConfigIssue = requireFirebaseConfigForAuth();
    if (firebaseAuthConfigIssue) {
      return { ok: false, error: firebaseAuthConfigIssue };
    }

    try {
      const rawEmail = String(email || '').trim();
      if (!rawEmail.includes('@')) {
        return {
          ok: false,
          error: 'Use a full email address to create an account.',
        };
      }
      const normalizedEmail = rawEmail;
      if (!normalizedEmail.includes('@')) {
        return {
          ok: false,
          error: 'Use a full email address to create an account.',
        };
      }
      const normalizedUserId = String(userId || '').trim().toLowerCase();
      if (!normalizedUserId) {
        return { ok: false, error: 'Choose a user ID.' };
      }
      const credential = await createUserWithEmailAndPassword(firebaseAuth, normalizedEmail, String(password || ''));
      if (displayName?.trim()) {
        await updateProfile(credential.user, { displayName: displayName.trim() });
      }
      await sendEmailVerification(credential.user);
      writePendingSignupProfile({
        uid: String(credential.user.uid || '').trim(),
        email: normalizedEmail.toLowerCase(),
        userId: normalizedUserId,
        ...(displayName?.trim() ? { displayName: displayName.trim() } : {}),
        createdAt: Date.now(),
      });
      syncUserIdSetupRequirement(true);
      await signOut(firebaseAuth).catch(() => undefined);
      setUser(BLANK_USER);
      return { ok: true, requiresEmailVerification: true };
    } catch (error: any) {
      return { ok: false, error: mapFirebaseAuthError(error) };
    }
  };

  const resendEmailVerification: UserContextType['resendEmailVerification'] = async (email, password) => {
    const rawEmail = String(email || '').trim();
    if (!rawEmail) {
      return { ok: false, error: 'Enter your email first.' };
    }
    if (isLocalAdminUsername(rawEmail)) {
      return {
        ok: false,
        error: 'Local admin login does not use Firebase email verification.',
      };
    }

    const firebaseAuthConfigIssue = requireFirebaseConfigForAuth();
    if (firebaseAuthConfigIssue) {
      return { ok: false, error: firebaseAuthConfigIssue };
    }

    const normalizedEmail = resolveFirebaseLoginEmail(rawEmail);
    if (!normalizedEmail.includes('@')) {
      return { ok: false, error: 'Use a valid email address.' };
    }

    let signedInTemporarily = false;
    try {
      let currentUser = firebaseAuth.currentUser;
      const currentEmail = String(currentUser?.email || '').trim().toLowerCase();
      if (!currentUser || currentEmail !== normalizedEmail.toLowerCase()) {
        if (!String(password || '').trim()) {
          return { ok: false, error: 'Enter your password to resend verification email.' };
        }
        const credential = await signInWithEmailAndPassword(firebaseAuth, normalizedEmail, String(password || ''));
        currentUser = credential.user;
        signedInTemporarily = true;
      }

      await currentUser.reload().catch(() => undefined);
      if (!requiresEmailVerificationForUser(currentUser)) {
        return { ok: true };
      }

      await sendEmailVerification(currentUser);
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: mapFirebaseAuthError(error) };
    } finally {
      if (signedInTemporarily) {
        await signOut(firebaseAuth).catch(() => undefined);
      }
    }
  };

  const requestPasswordReset: UserContextType['requestPasswordReset'] = async (email) => {
    const rawEmail = String(email || '').trim();
    if (!rawEmail) {
      return { ok: false, error: 'Enter your email first.' };
    }
    if (isLocalAdminUsername(rawEmail)) {
      return {
        ok: false,
        error: 'Local admin password is managed via local env; use Firebase email directly if needed.',
      };
    }

    const firebaseAuthConfigIssue = requireFirebaseConfigForAuth();
    if (firebaseAuthConfigIssue) {
      return { ok: false, error: firebaseAuthConfigIssue };
    }

    const normalizedEmail = resolveFirebaseLoginEmail(rawEmail);
    if (!normalizedEmail.includes('@')) {
      return { ok: false, error: 'Use a valid email address.' };
    }
    try {
      await sendPasswordResetEmail(firebaseAuth, normalizedEmail);
      return { ok: true };
    } catch {
      // Keep response generic to avoid account enumeration hints.
      return { ok: true };
    }
  };

  const signInWithGoogle: UserContextType['signInWithGoogle'] = async () => {
    const firebaseAuthConfigIssue = requireFirebaseConfigForAuth();
    if (firebaseAuthConfigIssue) {
      return { ok: false, error: firebaseAuthConfigIssue };
    }

    try {
      const result = await signInWithPopup(firebaseAuth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      await result.user.reload().catch(() => undefined);
      if (requiresEmailVerificationForUser(result.user)) {
        await signOut(firebaseAuth).catch(() => undefined);
        return {
          ok: false,
          error: unverifiedEmailAuthMessage,
          requiresEmailVerification: true,
        };
      }
      warmDriveTokenFromGoogleSignIn(credential);
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: mapFirebaseAuthError(error) };
    }
  };

  const signInWithFacebook: UserContextType['signInWithFacebook'] = async () => {
    const firebaseAuthConfigIssue = requireFirebaseConfigForAuth();
    if (firebaseAuthConfigIssue) {
      return { ok: false, error: firebaseAuthConfigIssue };
    }

    try {
      await signInWithPopup(firebaseAuth, facebookProvider);
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: mapFirebaseAuthError(error) };
    }
  };

  const startPhoneSignIn: UserContextType['startPhoneSignIn'] = async (phoneNumber, recaptchaContainerId) => {
    const firebaseAuthConfigIssue = requireFirebaseConfigForAuth();
    if (firebaseAuthConfigIssue) {
      return { ok: false, error: firebaseAuthConfigIssue };
    }

    try {
      if (!recaptchaRef.current) {
        recaptchaRef.current = new RecaptchaVerifier(firebaseAuth, recaptchaContainerId, { size: 'normal' });
      }
      const confirmation = await signInWithPhoneNumber(firebaseAuth, phoneNumber, recaptchaRef.current);
      confirmationRef.current = confirmation;
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: mapFirebaseAuthError(error) };
    }
  };

  const confirmPhoneSignIn: UserContextType['confirmPhoneSignIn'] = async (code) => {
    const firebaseAuthConfigIssue = requireFirebaseConfigForAuth();
    if (firebaseAuthConfigIssue) {
      return { ok: false, error: firebaseAuthConfigIssue };
    }

    try {
      if (!confirmationRef.current) {
        return { ok: false, error: 'No phone verification session found.' };
      }
      await confirmationRef.current.confirm(code);
      confirmationRef.current = null;
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: mapFirebaseAuthError(error) };
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
    setHistory([]);
    setShowSubscriptionModal(false);
    removeStorageKey(STORAGE_KEYS.uidSetupRequired);
  };

  const updateCharacter = useCallback((character: CharacterProfile) => {
    const uid = firebaseAuth.currentUser?.uid;
    const id = character.id || crypto.randomUUID();
    const payload: CharacterProfile = { ...character, id };
    if (uid) {
      void setDoc(doc(firestoreDb, 'users', uid, 'characters', id), payload, { merge: true });
      return;
    }
    if (!isLocalAdminSessionActive) return;
    setCharacterLibrary((current) => {
      const next = current.some((item) => item.id === id)
        ? current.map((item) => (item.id === id ? payload : item))
        : [payload, ...current];
      writeStoredCharacterLibrary(next);
      return next;
    });
  }, [isLocalAdminSessionActive]);

  const deleteCharacter = useCallback((id: string) => {
    if (DEFAULT_CHARACTERS.some((item) => item.id === id)) return;
    const uid = firebaseAuth.currentUser?.uid;
    if (uid) {
      void deleteDoc(doc(firestoreDb, 'users', uid, 'characters', id));
      return;
    }
    if (!isLocalAdminSessionActive) return;
    setCharacterLibrary((current) => {
      const next = current.filter((item) => item.id !== id);
      const resolved = next.length > 0 ? next : DEFAULT_CHARACTERS;
      writeStoredCharacterLibrary(resolved);
      return resolved;
    });
  }, [isLocalAdminSessionActive]);

  const syncCast = (cast: string[] | CharacterProfile[]) => {
    if (!cast || cast.length === 0) return;
    const existingByName = new Map(characterLibrary.map((item) => [item.name.toLowerCase(), item]));
    const builtInVoiceIds = new Set(VOICES.map((voice) => voice.id));

    cast.forEach((item) => {
      const name = typeof item === 'string' ? item : item.name;
      const meta = typeof item === 'string' ? null : item;
      if (!name) return;
      if (existingByName.has(name.toLowerCase())) return;
      if (['scene', 'unknown', 'sfx', 'speaker', 'end', 'start'].includes(name.toLowerCase())) return;
      const explicitVoiceId = String(meta?.voiceId || '').trim();
      if (!explicitVoiceId || builtInVoiceIds.has(explicitVoiceId)) return;
      updateCharacter({
        id: crypto.randomUUID(),
        name,
        voiceId: explicitVoiceId,
        gender: (meta?.gender as any) || guessGenderFromName(name),
        age: (meta?.age as any) || 'Adult',
        avatarColor: '#6366f1',
        description: meta?.description || 'Persisted from explicit cast profile',
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
          wallet: {
            ...prev.wallet,
            ...((partial as any).wallet || {}),
            spendableNowByEngine: {
              ...prev.wallet.spendableNowByEngine,
              ...(((partial as any).wallet || {}).spendableNowByEngine || {}),
            },
          },
        })
      ),
    history,
    loadHistory,
    addToHistory: (item) => setHistory((prev) => {
      const normalizedItem = normalizeHistoryItem(item);
      const normalizedId = String(normalizedItem.id || '');
      const withoutDuplicate = normalizedId
        ? prev.filter((entry) => String(entry.id || '') !== normalizedId)
        : prev;
      return [normalizedItem, ...withoutDuplicate].slice(0, MAX_IN_MEMORY_HISTORY_ITEMS);
    }),
    clearHistory: async () => {
      await clearHistoryRemote();
    },
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
      const entitlements = await claimAdReward(readSettingsBackendUrl());
      setStats((prev) => mapEntitlementsToStats(entitlements, prev));
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
    resendEmailVerification,
    requestPasswordReset,
    signOutUser,
    signInWithGoogle,
    signInWithFacebook,
    startPhoneSignIn,
    confirmPhoneSignIn,
    loginAsGuest: () => undefined,
    isAuthenticated,
    isAdmin,
    hasUnlimitedAccess,
    refreshAdminActor,
    syncCast,
    isSyncing,
    refreshEntitlements,
  }), [
    characterLibrary,
    clonedVoices,
    deleteCharacter,
    drafts,
    hasUnlimitedAccess,
    history,
    isAdmin,
    isAuthenticated,
    isSyncing,
    refreshAdminActor,
    showSubscriptionModal,
    stats,
    updateCharacter,
    user,
  ]);

  return <UserContext.Provider value={contextValue}>{children}</UserContext.Provider>;
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) throw new Error('useUser must be used within a UserProvider');
  return context;
};
