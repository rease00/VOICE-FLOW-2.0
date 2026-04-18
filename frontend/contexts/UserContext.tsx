'use client';

/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import {
  ActionCodeSettings,
  ConfirmationResult,
  GoogleAuthProvider,
  RecaptchaVerifier,
  createUserWithEmailAndPassword,
  deleteUser,
  getAdditionalUserInfo,
  onIdTokenChanged,
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
  getDocs,
  setDoc,
  writeBatch,
} from 'firebase/firestore/lite';
import {
  CharacterProfile,
  ClonedVoice,
  HistoryItem,
  ActiveTtsEngineKey,
  GenerationSettings,
  UserContextType,
  UserProfile,
  UserStats,
} from '../types';
import { INITIAL_STATS, VOICES } from '../constants';
import { guessGenderFromName } from '../services/speakerScriptService';
import { createEmptyWalletStats, ensureStatsUsageWindows, ensureVfUsageStats } from '../services/usageMetering';
import {
  facebookProvider,
  firebaseConfigIssue,
  firebaseAuth,
  googleProvider,
  isAdminIdentity,
  isFirebaseConfigured,
} from '../services/firebaseClient';
import { firestoreDb } from '../services/firebaseFirestoreClient';
import { resolveAdminProvisioningHint } from '../src/shared/auth/adminProvisioning';
import {
  AccountEntitlements,
  ACCOUNT_DELETE_CONFIRM_PHRASE,
  deleteAccount as deleteAccountRequest,
  clearGenerationHistory,
  fetchAccountEntitlements,
  fetchGenerationHistory,
} from '../services/accountService';
import { fetchAdminActor } from '../services/adminService';
import { hasActiveAdminActor } from '../src/shared/auth/adminAccess';
import { clearDriveTokenCache, warmDriveTokenFromGoogleSignIn } from '../services/driveAuthService';
import { readEnvBoolean, readEnvValue } from '../src/shared/runtime/env';
import { shouldBootstrapAccountDataForPath } from '../src/app/navigation';
import { SIGNUP_DISABLED_API_MESSAGE, isSignupTemporarilyDisabled } from '../src/shared/auth/signupLock';
import { STORAGE_KEYS } from '../src/shared/storage/keys';
import { readStorageJson, writeStorageJson, removeStorageKey } from '../src/shared/storage/localStore';
import { resolveHistoryVoiceLabel } from '../src/shared/voices/historyVoiceLabel';
import {
  addSessionClonedVoice,
  clearSessionClonedVoices,
  getSessionClonedVoices,
  setSessionClonedVoices,
} from '../services/clonedVoiceSessionStore';
import { clearFirebaseSession, syncFirebaseSession } from '../services/authSessionService';
import { authFetch } from '../services/authHttpClient';

interface ExtendedUserContextType extends Omit<UserContextType, 'deleteAccount'> {
  syncCast: (cast: string[] | CharacterProfile[]) => void;
  isSyncing: boolean;
  sessionCookieReady: boolean;
  refreshEntitlements: () => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const UserContext = createContext<ExtendedUserContextType | undefined>(undefined);
export const USER_CONTEXT_CHARACTER_SYNC_WARNING_EVENT = 'voiceflow:user-character-sync-warning';

const FIRESTORE_PERMISSION_ERROR_TOKENS = [
  'permission-denied',
  'insufficient permissions',
  'missing or insufficient permissions',
];

const isFirestorePermissionError = (error: unknown): boolean => {
  const code = String((error as { code?: unknown } | null)?.code || '').trim().toLowerCase();
  const message = String((error as { message?: unknown } | null)?.message || '').trim().toLowerCase();
  if (!code && !message) return false;
  return FIRESTORE_PERMISSION_ERROR_TOKENS.some((token) => code.includes(token) || message.includes(token));
};

const emitCharacterSyncWarning = (message: string): void => {
  if (typeof window === 'undefined') return;
  const safeMessage = String(message || '').trim();
  if (!safeMessage) return;
  try {
    window.dispatchEvent(new CustomEvent(USER_CONTEXT_CHARACTER_SYNC_WARNING_EVENT, { detail: { message: safeMessage } }));
  } catch {
    // no-op
  }
};

const runFirestoreWriteWithTokenRefreshRetry = async (operation: () => Promise<void>): Promise<{ ok: true } | { ok: false; error: unknown }> => {
  try {
    await operation();
    return { ok: true };
  } catch (error) {
    const canRetryWithFreshToken = isFirestorePermissionError(error) && Boolean(firebaseAuth.currentUser);
    if (!canRetryWithFreshToken) {
      return { ok: false, error };
    }
    try {
      await firebaseAuth.currentUser?.getIdToken(true);
      await operation();
      return { ok: true };
    } catch (retryError) {
      return { ok: false, error: retryError };
    }
  }
};

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

const CANONICAL_API_BASE = '/api/v1';

const unverifiedEmailAuthMessage = 'Verify your email before signing in. Check your inbox/spam and then try again.';
const DEFAULT_DEV_EMAIL_VERIFY_CONTINUE_URL = 'http://localhost:3000/app/login';

const resolveEmailVerificationContinueUrl = (): string => {
  const configured = readEnvValue(process.env.NEXT_PUBLIC_AUTH_EMAIL_VERIFY_CONTINUE_URL);
  if (configured) return configured;
  const isProductionRuntime = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  if (isProductionRuntime) return '';
  if (typeof window === 'undefined' || !window.location) return DEFAULT_DEV_EMAIL_VERIFY_CONTINUE_URL;
  const url = new URL(window.location.href);
  url.pathname = '/app/login';
  url.search = '';
  return url.toString();
};

export const buildEmailVerificationActionSettings = (): ActionCodeSettings | undefined => {
  const candidate = resolveEmailVerificationContinueUrl();
  if (!candidate) return undefined;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    const isProductionRuntime = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
    if (isProductionRuntime && parsed.protocol !== 'https:') return undefined;
    return {
      url: parsed.toString(),
      handleCodeInApp: false,
    };
  } catch {
    return undefined;
  }
};

export const buildUnverifiedEmailSignInResult = (message: string = unverifiedEmailAuthMessage) => ({
  ok: false,
  error: message,
  requiresEmailVerification: true,
  canResendVerification: true,
});

const buildSignupDisabledResult = () => ({
  ok: false,
  error: SIGNUP_DISABLED_API_MESSAGE,
});

const isContinueUrlVerificationError = (error: any): boolean => {
  const code = String(error?.code || '').trim().toLowerCase();
  const message = String(error?.message || '').trim().toLowerCase();
  return (
    code === 'auth/unauthorized-continue-uri' ||
    code === 'auth/invalid-continue-uri' ||
    message.includes('continue uri') ||
    message.includes('continue_url')
  );
};

const sendVerificationEmailWithFallback = async (
  targetUser: Parameters<typeof sendEmailVerification>[0]
): Promise<void> => {
  const isProductionRuntime = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const actionSettings = buildEmailVerificationActionSettings();
  if (!actionSettings) {
    if (isProductionRuntime) {
      throw new Error('Email verification continue URL is not configured for production.');
    }
    await sendEmailVerification(targetUser);
    return;
  }
  try {
    await sendEmailVerification(targetUser, actionSettings);
  } catch (error) {
    if (!isContinueUrlVerificationError(error) || isProductionRuntime) throw error;
    // Retry without continue URL override so Firebase can still send verification mail.
    await sendEmailVerification(targetUser);
  }
};

const requiresEmailVerificationForUser = (user: { uid?: string | null; email?: string | null; emailVerified?: boolean | null }): boolean => {
  const email = String(user.email || '').trim();
  if (!email) return false;
  if (isAdminIdentity(user.uid, user.email, false)) return false;
  return user.emailVerified !== true;
};

const AUTH_USER_RELOAD_TIMEOUT_MS = 5_000;

const waitForAuthUserReload = async (
  user: { reload: () => Promise<void> },
): Promise<void> => {
  if (typeof window === 'undefined') {
    await user.reload().catch(() => undefined);
    return;
  }

  let timeoutId: number | null = null;
  await Promise.race([
    user.reload().catch(() => undefined),
    new Promise<void>((resolve) => {
      timeoutId = window.setTimeout(resolve, AUTH_USER_RELOAD_TIMEOUT_MS);
    }),
  ]);
  if (timeoutId !== null) {
    window.clearTimeout(timeoutId);
  }
};

const resolveWithTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeoutId = globalThis.setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
};

const normalizePlanNameForStats = (value: unknown): UserStats['planName'] => {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'launcher' || token === 'launch') return 'Launcher';
  if (token === 'starter') return 'Starter';
  if (token === 'creator') return 'Creator';
  if (token === 'pro') return 'Pro';
  if (token === 'scale' || token === 'plus' || token === 'pro_plus' || token === 'pro-plus') return 'Scale';
  if (token === 'enterprise') return 'Enterprise';
  return 'Free';
};

const isPaidPlanName = (planName: UserStats['planName']): boolean =>
  planName === 'Launcher' || planName === 'Starter' || planName === 'Creator' || planName === 'Pro' || planName === 'Scale' || planName === 'Enterprise';

const normalizeActiveEngine = (value: unknown): ActiveTtsEngineKey => {
  const token = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return token === 'PRIME' ? 'PRIME' : 'VECTOR';
};

const normalizeAllowedEngines = (input: unknown): ActiveTtsEngineKey[] => {
  if (!Array.isArray(input)) return ['VECTOR'];
  const allowed = new Set<ActiveTtsEngineKey>();
  for (const value of input) {
    allowed.add(normalizeActiveEngine(value));
  }
  return allowed.size > 0 ? Array.from(allowed) : ['VECTOR'];
};

const readCanonicalEngineBucket = (
  bucket: Record<string, { chars: number; vf: number }> | undefined,
  engine: ActiveTtsEngineKey
): { chars: number; vf: number } => ({
  chars: Math.max(0, Number(bucket?.[engine]?.chars || 0)),
  vf: Math.max(0, Number(bucket?.[engine]?.vf || 0)),
});

const normalizeStoredStats = (stored: any): UserStats => {
  const walletFallback = createEmptyWalletStats();
  const planName = normalizePlanNameForStats(stored?.planName);
  const merged: UserStats = {
    ...INITIAL_STATS,
    ...stored,
    generationsUsed: Number.isFinite(stored?.generationsUsed) ? Math.max(0, Math.floor(stored.generationsUsed)) : INITIAL_STATS.generationsUsed,
    isPremium: Boolean(stored?.isPremium) || isPaidPlanName(planName),
    planName,
    billingCountry: typeof stored?.billingCountry === 'string' ? stored.billingCountry : undefined,
    lastResetDate: typeof stored?.lastResetDate === 'string' ? stored.lastResetDate : undefined,
    vfUsage: ensureVfUsageStats(stored?.vfUsage),
    wallet: {
      ...walletFallback,
      ...(stored?.wallet || {}),
      vcFreeBalance: Math.max(0, Number(stored?.wallet?.vcFreeBalance ?? walletFallback.vcFreeBalance ?? 0)),
      vcGrantedBalance: Math.max(0, Number(stored?.wallet?.vcGrantedBalance ?? walletFallback.vcGrantedBalance ?? 0)),
      vcPaidBalance: Math.max(0, Number(stored?.wallet?.vcPaidBalance ?? walletFallback.vcPaidBalance ?? 0)),
      vcSpendableBalance: Math.max(0, Number(stored?.wallet?.vcSpendableBalance ?? walletFallback.vcSpendableBalance ?? 0)),
      spendableNowByEngine: {
        VECTOR: Math.max(0, Number(stored?.wallet?.spendableNowByEngine?.VECTOR ?? walletFallback.spendableNowByEngine.VECTOR)),
        PRIME: Math.max(0, Number(stored?.wallet?.spendableNowByEngine?.PRIME ?? walletFallback.spendableNowByEngine.PRIME)),
      },
      vcMonthKey: typeof stored?.wallet?.vcMonthKey === 'string' ? stored.wallet.vcMonthKey : walletFallback.vcMonthKey,
    },
    limits: {
      maxCharsPerGeneration: Math.max(1, Number(stored?.limits?.maxCharsPerGeneration || INITIAL_STATS.limits?.maxCharsPerGeneration || 8000)),
      allowedEngines: normalizeAllowedEngines(stored?.limits?.allowedEngines || INITIAL_STATS.limits?.allowedEngines),
      tokenPackDiscountPercent: Number.isFinite(stored?.limits?.tokenPackDiscountPercent)
        ? Math.max(0, Number(stored.limits.tokenPackDiscountPercent))
        : undefined,
      vcTokenPackDiscountPercent: Number.isFinite(stored?.limits?.vcTokenPackDiscountPercent)
        ? Math.max(0, Number(stored.limits.vcTokenPackDiscountPercent))
        : undefined,
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
    VECTOR: Number.isFinite(vfRates.VECTOR) ? Math.max(0, Number(vfRates.VECTOR)) : fallback.VECTOR,
    PRIME: Number.isFinite(vfRates.PRIME) ? Math.max(0, Number(vfRates.PRIME)) : fallback.PRIME,
  };
};

const mapEntitlementsToStats = (entitlements: AccountEntitlements, prev: UserStats): UserStats => {
  const usage = ensureVfUsageStats(prev.vfUsage);
  const monthlyByEngine = entitlements.monthly?.byEngine || {};
  const dailyByEngine = entitlements.daily?.byEngine || {};
  const walletFallback = createEmptyWalletStats();
  const wallet = entitlements.wallet || walletFallback;
  const planName = normalizePlanNameForStats(entitlements.plan);

  const dailyUsage = {
    VECTOR: readCanonicalEngineBucket(dailyByEngine, 'VECTOR'),
    PRIME: readCanonicalEngineBucket(dailyByEngine, 'PRIME'),
  };
  const monthlyUsage = {
    VECTOR: readCanonicalEngineBucket(monthlyByEngine, 'VECTOR'),
    PRIME: readCanonicalEngineBucket(monthlyByEngine, 'PRIME'),
  };

  const dailyTotalChars = dailyUsage.VECTOR.chars + dailyUsage.PRIME.chars;
  const monthlyTotalChars = monthlyUsage.VECTOR.chars + monthlyUsage.PRIME.chars;

  return ensureStatsUsageWindows({
    ...prev,
    generationsUsed: Math.max(0, Number(entitlements.daily?.generationUsed || 0)),
    isPremium: isPaidPlanName(planName),
    planName,
    billingCountry: String(entitlements.billing?.billingCountry || prev.billingCountry || '').trim() || undefined,
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
          VECTOR: dailyUsage.VECTOR,
          PRIME: dailyUsage.PRIME,
        },
      },
      monthly: {
        ...usage.monthly,
        key: entitlements.monthly?.periodKey || usage.monthly.key,
        totalChars: monthlyTotalChars,
        totalVf: Math.max(0, Number(entitlements.monthly?.vfUsed || 0)),
        byEngine: {
          ...usage.monthly.byEngine,
          VECTOR: monthlyUsage.VECTOR,
          PRIME: monthlyUsage.PRIME,
        },
      },
    },
    wallet: {
      monthlyFreeRemaining: Math.max(0, Number(wallet.monthlyFreeRemaining || 0)),
      monthlyFreeLimit: Math.max(0, Number(wallet.monthlyFreeLimit || 0)),
      vffBalance: Math.max(0, Number(wallet.vffBalance || 0)),
      paidVfBalance: Math.max(0, Number(wallet.paidVfBalance || 0)),
      vcFreeBalance: Math.max(0, Number(wallet.vcFreeBalance || 0)),
      vcGrantedBalance: Math.max(0, Number(wallet.vcGrantedBalance || 0)),
      vcPaidBalance: Math.max(0, Number(wallet.vcPaidBalance || 0)),
      vcSpendableBalance: Math.max(0, Number(wallet.vcSpendableBalance || 0)),
      spendableNowByEngine: {
        VECTOR: Math.max(0, Number(wallet.spendableNowByEngine?.VECTOR || 0)),
        PRIME: Math.max(0, Number(wallet.spendableNowByEngine?.PRIME || 0)),
      },
      vffMonthKey: wallet.vffMonthKey,
      vcMonthKey: wallet.vcMonthKey,
    },
    limits: {
      maxCharsPerGeneration: Math.max(1, Number(entitlements?.limits?.maxCharsPerGeneration || prev.limits?.maxCharsPerGeneration || 8000)),
      allowedEngines: normalizeAllowedEngines(entitlements?.limits?.allowedEngines || prev.limits?.allowedEngines),
      tokenPackDiscountPercent: Number.isFinite(entitlements?.limits?.tokenPackDiscountPercent)
        ? Math.max(0, Number(entitlements.limits.tokenPackDiscountPercent))
        : prev.limits?.tokenPackDiscountPercent,
      vcTokenPackDiscountPercent: Number.isFinite(entitlements?.limits?.vcTokenPackDiscountPercent)
        ? Math.max(0, Number(entitlements.limits.vcTokenPackDiscountPercent))
        : prev.limits?.vcTokenPackDiscountPercent,
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

export const shouldAllowFirestoreAdminRoleFallback = (): boolean => {
  const configured = readEnvBoolean(process.env.NEXT_PUBLIC_ALLOW_FIRESTORE_ADMIN_ROLE);
  if (configured !== undefined) return configured;
  const isProductionRuntime = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
  return !isProductionRuntime;
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

export const mapFirebaseUserToProfile = async (firebaseUserOverride?: typeof firebaseAuth.currentUser): Promise<UserProfile> => {
  const current = firebaseUserOverride || firebaseAuth.currentUser;
  if (!current) return BLANK_USER;
  const tokenResult = await current.getIdTokenResult().catch(() => null);
  const hasAdminClaim = Boolean(tokenResult?.claims?.admin);
  const envOrClaimAdmin = isAdminIdentity(current.uid, current.email, hasAdminClaim);
  let firestoreAdmin = false;
  if (!envOrClaimAdmin && shouldAllowFirestoreAdminRoleFallback()) {
    firestoreAdmin = await resolveWithTimeout(readFirestoreAdminStatus(current.uid), 750, false);
  }
  const isAdmin = envOrClaimAdmin || firestoreAdmin;
  const providerIds = (current.providerData || [])
    .map((provider) => String(provider?.providerId || '').trim())
    .filter(Boolean);
  return {
    uid: current.uid,
    googleId: current.uid,
    name: current.displayName || current.email || current.phoneNumber || 'V FLOW AI User',
    email: current.email || `${current.uid}@firebase.vflowai`,
    userId: undefined,
    avatarUrl: current.photoURL || undefined,
    phoneNumber: current.phoneNumber || undefined,
    role: isAdmin ? 'admin' : 'user',
    isAdmin,
    providers: providerIds,
    adminActor: null,
  };
};

const resolveFirebaseConfigIssue = (): string =>
  String(firebaseConfigIssue || '').trim() ||
  'Firebase auth is not configured. Set NEXT_PUBLIC_FIREBASE_* and restart the frontend server.';

const requireFirebaseConfigForAuth = (): string | null => {
  if (isFirebaseConfigured) return null;
  return resolveFirebaseConfigIssue();
};

const mapFirebaseAuthError = (error: any, context: 'signin' | 'signup' = 'signin'): string => {
  const code = String(error?.code || '').trim().toLowerCase();
  const rawMessage = String(error?.message || '').trim();
  const loweredMessage = rawMessage.toLowerCase();
  if (code === 'auth/api-key-not-valid' || code === 'auth/invalid-api-key') {
    return resolveFirebaseConfigIssue();
  }
  if (code === 'auth/invalid-email') {
    return 'Use a valid email address.';
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
  if (code === 'auth/unauthorized-domain') {
    return 'Google sign-in requires localhost in local development. Open the app at http://localhost:3000 and retry.';
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
  if (code === 'auth/unauthorized-continue-uri' || code === 'auth/invalid-continue-uri') {
    return 'Verification link domain is not authorized. In Firebase Auth settings, add your app domain (for local dev: localhost and 127.0.0.1), then retry.';
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
  return context === 'signup'
    ? 'Sign-up failed. Please check your details and try again.'
    : 'Sign-in failed. Please check your details and try again.';
};

const mapSessionSyncFailureMessage = (error: unknown): string => {
  const detail = String((error as { message?: unknown } | null)?.message || '').trim().toLowerCase();
  if (detail.includes('status 401')) {
    return 'Signed in, but the secure app session could not be started. Please try again in a few seconds.';
  }
  return 'Signed in, but the app could not finish starting your secure session. Please try again.';
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
  const pathname = usePathname();
  const [authReady, setAuthReady] = useState(false);
  const [sessionCookieReady, setSessionCookieReady] = useState(false);
  const [stats, setStats] = useState<UserStats>(INITIAL_STATS);
  const [user, setUser] = useState<UserProfile>(BLANK_USER);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [clonedVoices, setClonedVoices] = useState<ClonedVoice[]>([]);
  const [characterLibrary, setCharacterLibrary] = useState<CharacterProfile[]>(DEFAULT_CHARACTERS);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
  const [isSyncing] = useState(false);
  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);
  const charactersUnsubscribeRef = useRef<(() => void) | null>(null);
  const hasHydratedStatsRef = useRef(false);
  const lastSessionTokenRef = useRef('');
  const shouldBootstrapAccountData = useMemo(
    () => shouldBootstrapAccountDataForPath(pathname),
    [pathname]
  );

  const isAdmin = Boolean(user.isAdmin);
  const isAuthenticated = Boolean(user.uid);
  const hasUnlimitedAccess = isAdmin;

  useEffect(() => {
    const stored = readStorageJson(STORAGE_KEYS.stats);
    if (stored) {
      setStats(normalizeStoredStats(stored));
    }
    hasHydratedStatsRef.current = true;
  }, []);

  useEffect(() => {
    if (!hasHydratedStatsRef.current) return;
    writeStorageJson(STORAGE_KEYS.stats, stats);
  }, [stats]);

  useEffect(() => {
    const persistedClones = getSessionClonedVoices();
    if (persistedClones.length > 0) {
      setClonedVoices(persistedClones);
    }
  }, []);

  useEffect(() => {
    setSessionClonedVoices(clonedVoices);
  }, [clonedVoices]);

  const refreshEntitlements = useCallback(async () => {
    const firebaseUser = firebaseAuth.currentUser;
    if (!firebaseUser) {
      setStats(INITIAL_STATS);
      return;
    }
    try {
      const entitlements = await fetchAccountEntitlements();
      setStats((prev) => mapEntitlementsToStats(entitlements, prev));
    } catch {
      // Keep the current stats if backend is not reachable.
    }
  }, []);

  const refreshAdminActor = useCallback(async () => {
    const firebaseUser = firebaseAuth.currentUser;
    const currentUid = String(firebaseUser?.uid || '').trim();
    if (!currentUid) {
      setUser((prev) => (prev.adminActor ? { ...prev, adminActor: null } : prev));
      return;
    }
    try {
      const actor = await fetchAdminActor(CANONICAL_API_BASE);
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
  }, []);

  const loadHistory = useCallback(async (limit = 30) => {
    const firebaseUser = firebaseAuth.currentUser;
    if (!firebaseUser) {
      setHistory([]);
      return;
    }
    try {
      const rows = await fetchGenerationHistory(undefined, limit);
      const normalized = Array.isArray(rows)
        ? rows.map((item) => normalizeHistoryItem(item)).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
        : [];
      setHistory(normalized);
    } catch {
      // Keep current in-memory history when backend is unavailable.
    }
  }, []);

  const clearHistoryRemote = async () => {
    try {
      await clearGenerationHistory();
    } catch {
      // Keep client behavior deterministic even when backend clear fails.
    } finally {
      setHistory([]);
    }
  };

  const bootstrapCharacterSync = async (uid: string) => {
    if (charactersUnsubscribeRef.current) {
      charactersUnsubscribeRef.current();
      charactersUnsubscribeRef.current = null;
    }
    const charactersRef = collection(firestoreDb, 'users', uid, 'characters');
    try {
      const snapshot = await getDocs(charactersRef);
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
    } catch {
      setCharacterLibrary(DEFAULT_CHARACTERS);
    }
  };

  useEffect(() => {
    let isMounted = true;
    let authResolved = false;
    const markAuthReady = () => {
      if (!isMounted || authResolved) return;
      authResolved = true;
      setAuthReady(true);
    };
    const authReadyFallbackTimer = typeof window !== 'undefined'
      ? window.setTimeout(markAuthReady, 3500)
      : null;
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser) => {
      try {
        if (!firebaseUser) {
          setSessionCookieReady(false);
          if (charactersUnsubscribeRef.current) {
            charactersUnsubscribeRef.current();
            charactersUnsubscribeRef.current = null;
          }
          clearDriveTokenCache();
          removeStorageKey(STORAGE_KEYS.settings);
          setUser(BLANK_USER);
          setCharacterLibrary(DEFAULT_CHARACTERS);
          setStats(INITIAL_STATS);
          setHistory([]);
          return;
        }
        if (requiresEmailVerificationForUser(firebaseUser)) {
          await waitForAuthUserReload(firebaseUser);
        }
        if (requiresEmailVerificationForUser(firebaseUser)) {
          if (charactersUnsubscribeRef.current) {
            charactersUnsubscribeRef.current();
            charactersUnsubscribeRef.current = null;
          }
          setSessionCookieReady(false);
          await signOut(firebaseAuth).catch(() => undefined);
          clearDriveTokenCache();
          removeStorageKey(STORAGE_KEYS.settings);
          setUser(BLANK_USER);
          setCharacterLibrary(DEFAULT_CHARACTERS);
          setStats(INITIAL_STATS);
          setHistory([]);
          return;
        }
        const profile = await mapFirebaseUserToProfile(firebaseUser);
        setUser(profile);
        void bootstrapCharacterSync(firebaseUser.uid);
      } finally {
        markAuthReady();
      }
    });
    return () => {
      isMounted = false;
      if (authReadyFallbackTimer !== null) {
        window.clearTimeout(authReadyFallbackTimer);
      }
      unsubscribe();
      if (charactersUnsubscribeRef.current) charactersUnsubscribeRef.current();
    };
  }, [refreshAdminActor, refreshEntitlements]);

  useEffect(() => {
    const unsubscribe = onIdTokenChanged(firebaseAuth, async (firebaseUser) => {
      try {
        if (!firebaseUser) {
          setSessionCookieReady(false);
          lastSessionTokenRef.current = '';
          await clearFirebaseSession();
          return;
        }

        const idToken = await firebaseUser.getIdToken();
        if (!idToken || lastSessionTokenRef.current === idToken) {
          setSessionCookieReady(Boolean(idToken));
          return;
        }

        await syncFirebaseSession(idToken);
        lastSessionTokenRef.current = idToken;
        setSessionCookieReady(true);
      } catch (error) {
        setSessionCookieReady(false);
        lastSessionTokenRef.current = '';
        console.warn('[UserContext] session sync failed', error);
      }
    });

    return () => {
      unsubscribe();
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
    if (!shouldBootstrapAccountData) return;
    if (!user.isAdmin) {
      if (user.adminActor) {
        setUser((prev) => ({ ...prev, adminActor: null }));
      }
      return;
    }
    void refreshAdminActor();
  // user.adminActor intentionally excluded to avoid a fetch loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshAdminActor, shouldBootstrapAccountData, user.isAdmin, user.uid]);

  useEffect(() => {
    const safeUid = String(user.uid || '').trim();
    if (!safeUid || !shouldBootstrapAccountData) return;
    void Promise.allSettled([refreshEntitlements(), loadHistory()]);
  }, [loadHistory, refreshEntitlements, shouldBootstrapAccountData, user.uid]);

  const finalizeFirebaseSignIn = useCallback(async (
    firebaseUser: { getIdToken: (forceRefresh?: boolean) => Promise<string> }
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      setSessionCookieReady(false);
      const idToken = await firebaseUser.getIdToken();
      if (!idToken) {
        throw new Error('Missing Firebase ID token.');
      }
      await syncFirebaseSession(idToken);
      lastSessionTokenRef.current = idToken;
      setSessionCookieReady(true);
      return { ok: true };
    } catch (error) {
      setSessionCookieReady(false);
      lastSessionTokenRef.current = '';
      await clearFirebaseSession().catch(() => undefined);
      await signOut(firebaseAuth).catch(() => undefined);
      return {
        ok: false,
        error: mapSessionSyncFailureMessage(error),
      };
    }
  }, []);

  const signInWithEmail = useCallback<UserContextType['signInWithEmail']>(async (email, password) => {
    const rawEmail = String(email || '').trim();
    const firebaseAuthConfigIssue = requireFirebaseConfigForAuth();
    if (firebaseAuthConfigIssue) {
      return { ok: false, error: firebaseAuthConfigIssue };
    }

    try {
      if (!rawEmail.includes('@')) {
        return {
          ok: false,
          error: 'Use a full email address to sign in.',
        };
      }
      const credential = await signInWithEmailAndPassword(firebaseAuth, rawEmail, String(password || ''));
      if (requiresEmailVerificationForUser(credential.user)) {
        await waitForAuthUserReload(credential.user);
      }
      if (requiresEmailVerificationForUser(credential.user)) {
        await signOut(firebaseAuth).catch(() => undefined);
        return buildUnverifiedEmailSignInResult();
      }
      const sessionResult = await finalizeFirebaseSignIn(credential.user);
      if (!sessionResult.ok) {
        return sessionResult;
      }
      return { ok: true };
    } catch (error: any) {
      const errorCode = String(error?.code || '').trim().toLowerCase();
      const provisioningHint = resolveAdminProvisioningHint(rawEmail, errorCode);
      return {
        ok: false,
        error: mapFirebaseAuthError(error),
        ...(provisioningHint ? { provisioningHint } : {}),
      };
    }
  }, [finalizeFirebaseSignIn]);

  const signUpWithEmail: UserContextType['signUpWithEmail'] = async (email, password, displayName) => {
    if (isSignupTemporarilyDisabled()) {
      return buildSignupDisabledResult();
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
      const credential = await createUserWithEmailAndPassword(firebaseAuth, normalizedEmail, String(password || ''));
      if (displayName?.trim()) {
        await updateProfile(credential.user, { displayName: displayName.trim() });
      }
      await sendVerificationEmailWithFallback(credential.user);
      await signOut(firebaseAuth).catch(() => undefined);
      setUser(BLANK_USER);
      return { ok: true, requiresEmailVerification: true };
    } catch (error: any) {
      return { ok: false, error: mapFirebaseAuthError(error, 'signup') };
    }
  };

  const resendEmailVerification: UserContextType['resendEmailVerification'] = async (email, password) => {
    const rawEmail = String(email || '').trim();
    if (!rawEmail) {
      return { ok: false, error: 'Enter your email first.' };
    }

    const firebaseAuthConfigIssue = requireFirebaseConfigForAuth();
    if (firebaseAuthConfigIssue) {
      return { ok: false, error: firebaseAuthConfigIssue };
    }

    if (!rawEmail.includes('@')) {
      return { ok: false, error: 'Use a valid email address.' };
    }

    let signedInTemporarily = false;
    try {
      let currentUser = firebaseAuth.currentUser;
      const currentEmail = String(currentUser?.email || '').trim().toLowerCase();
      if (!currentUser || currentEmail !== rawEmail.toLowerCase()) {
        if (!String(password || '').trim()) {
          return { ok: false, error: 'Enter your password to resend verification email.' };
        }
        const credential = await signInWithEmailAndPassword(firebaseAuth, rawEmail, String(password || ''));
        currentUser = credential.user;
        signedInTemporarily = true;
      }

      await currentUser.reload().catch(() => undefined);
      if (!requiresEmailVerificationForUser(currentUser)) {
        return { ok: true };
      }

      await sendVerificationEmailWithFallback(currentUser);
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

    const firebaseAuthConfigIssue = requireFirebaseConfigForAuth();
    if (firebaseAuthConfigIssue) {
      return { ok: false, error: firebaseAuthConfigIssue };
    }

    if (!rawEmail.includes('@')) {
      return { ok: false, error: 'Use a valid email address.' };
    }
    try {
      await sendPasswordResetEmail(firebaseAuth, rawEmail);
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
      const providerUserInfo = getAdditionalUserInfo(result);
      if (providerUserInfo?.isNewUser && isSignupTemporarilyDisabled()) {
        await deleteUser(result.user).catch(() => undefined);
        await signOut(firebaseAuth).catch(() => undefined);
        return buildSignupDisabledResult();
      }
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (requiresEmailVerificationForUser(result.user)) {
        await waitForAuthUserReload(result.user);
      }
      if (requiresEmailVerificationForUser(result.user)) {
        await signOut(firebaseAuth).catch(() => undefined);
        return {
          ok: false,
          error: unverifiedEmailAuthMessage,
          requiresEmailVerification: true,
        };
      }
      const sessionResult = await finalizeFirebaseSignIn(result.user);
      if (!sessionResult.ok) {
        return sessionResult;
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
      const result = await signInWithPopup(firebaseAuth, facebookProvider);
      const providerUserInfo = getAdditionalUserInfo(result);
      if (providerUserInfo?.isNewUser && isSignupTemporarilyDisabled()) {
        await deleteUser(result.user).catch(() => undefined);
        await signOut(firebaseAuth).catch(() => undefined);
        return buildSignupDisabledResult();
      }
      const sessionResult = await finalizeFirebaseSignIn(result.user);
      if (!sessionResult.ok) {
        return sessionResult;
      }
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
      const credential = await confirmationRef.current.confirm(code);
      confirmationRef.current = null;
      const sessionResult = await finalizeFirebaseSignIn(credential.user);
      if (!sessionResult.ok) {
        return sessionResult;
      }
      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: mapFirebaseAuthError(error) };
    }
  };

  const signOutUser: UserContextType['signOutUser'] = async () => {
    if (charactersUnsubscribeRef.current) {
      charactersUnsubscribeRef.current();
      charactersUnsubscribeRef.current = null;
    }
    setSessionCookieReady(false);
    await clearFirebaseSession().catch(() => undefined);
    lastSessionTokenRef.current = '';
    if (firebaseAuth.currentUser) {
      await signOut(firebaseAuth).catch(() => undefined);
    }
    clearDriveTokenCache();
    removeStorageKey(STORAGE_KEYS.settings);
    removeStorageKey(STORAGE_KEYS.stats);
    removeStorageKey(STORAGE_KEYS.studioSidebarMode);
    removeStorageKey(STORAGE_KEYS.studioEditorMode);
    removeStorageKey(STORAGE_KEYS.studioDraftText);
    removeStorageKey(STORAGE_KEYS.studioDraftHistory);
    removeStorageKey(STORAGE_KEYS.workspaceActiveTab);
    removeStorageKey(STORAGE_KEYS.studioRailTab);
    removeStorageKey(STORAGE_KEYS.studioQueue);
    removeStorageKey(STORAGE_KEYS.studioSingleInflightGeneration);
    removeStorageKey(STORAGE_KEYS.studioSpeakerVcReferences);
    setUser(BLANK_USER);
    setCharacterLibrary(DEFAULT_CHARACTERS);
    setStats(INITIAL_STATS);
    setHistory([]);
    setClonedVoices([]);
    clearSessionClonedVoices();
    setShowSubscriptionModal(false);
  };

  const updateCharacter = useCallback((character: CharacterProfile) => {
    const uid = firebaseAuth.currentUser?.uid;
    const id = character.id || crypto.randomUUID();
    const payload: CharacterProfile = { ...character, id };
    if (!uid) return;
    void runFirestoreWriteWithTokenRefreshRetry(
      () => setDoc(doc(firestoreDb, 'users', uid, 'characters', id), payload, { merge: true })
    ).then((result) => {
      if (result.ok) return;
      const permissionDenied = isFirestorePermissionError(result.error);
      emitCharacterSyncWarning(
        permissionDenied
          ? 'Voice preset changed locally, but cloud save was denied. Please sign in again or check account permissions.'
          : 'Voice preset changed locally, but cloud sync failed. You can continue and retry later.'
      );
      console.warn('[UserContext] updateCharacter sync failed', result.error);
    });
  }, []);

  const deleteCharacter = useCallback((id: string) => {
    if (DEFAULT_CHARACTERS.some((item) => item.id === id)) return;
    const uid = firebaseAuth.currentUser?.uid;
    if (!uid) return;
    void runFirestoreWriteWithTokenRefreshRetry(
      () => deleteDoc(doc(firestoreDb, 'users', uid, 'characters', id))
    ).then((result) => {
      if (result.ok) return;
      const permissionDenied = isFirestorePermissionError(result.error);
      emitCharacterSyncWarning(
        permissionDenied
          ? 'Character removed locally, but cloud delete was denied by permissions.'
          : 'Character removed locally, but cloud sync failed. You can continue and retry later.'
      );
      console.warn('[UserContext] deleteCharacter sync failed', result.error);
    });
  }, []);

  const syncCast = useCallback((cast: string[] | CharacterProfile[]) => {
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
  }, [characterLibrary, updateCharacter]);

  const contextValue = useMemo<ExtendedUserContextType>(() => ({
    user,
    authReady,
    sessionCookieReady,
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
    addToHistory: (item) => {
      const normalizedItem = normalizeHistoryItem(item);
      setHistory((prev) => {
        const normalizedId = String(normalizedItem.id || '');
        const withoutDuplicate = normalizedId
          ? prev.filter((entry) => String(entry.id || '') !== normalizedId)
          : prev;
        return [normalizedItem, ...withoutDuplicate].slice(0, MAX_IN_MEMORY_HISTORY_ITEMS);
      });
      // Persist generation to the backend to fix the tech debt!
      const persistHistory = async () => {
        try {
          await authFetch('/api/v1/account/generation-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item: normalizedItem }),
          }, { requireAuth: true });
        } catch (err) {
          console.warn('Failed to persist history item', err);
        }
      };
      // Fire and forget
      if (normalizedItem.audioUrl) {
        persistHistory();
      }
    },
    clearHistory: async () => {
      await clearHistoryRemote();
    },
    deleteAccount: async () => {
      await deleteAccountRequest(undefined, ACCOUNT_DELETE_CONFIRM_PHRASE);
      await signOutUser();
      setHistory([]);
      setClonedVoices([]);
      clearSessionClonedVoices();
      setCharacterLibrary(DEFAULT_CHARACTERS);
    },
    clonedVoices,
    addClonedVoice: (voice) => {
      addSessionClonedVoice(voice);
      setClonedVoices((prev) => [voice, ...prev.filter((item) => item.id !== voice.id)]);
    },
    showSubscriptionModal,
    setShowSubscriptionModal: (show) => setShowSubscriptionModal(show),
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
    hasUnlimitedAccess,
    history,
    isAdmin,
    isAuthenticated,
    isSyncing,
    authReady,
    sessionCookieReady,
    refreshAdminActor,
    refreshEntitlements,
    signInWithEmail,
    showSubscriptionModal,
    stats,
    updateCharacter,
    user,
    syncCast,
  ]);

  return <UserContext.Provider value={contextValue}>{children}</UserContext.Provider>;
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) throw new Error('useUser must be used within a UserProvider');
  return context;
};

export const useOptionalUser = () => useContext(UserContext);

