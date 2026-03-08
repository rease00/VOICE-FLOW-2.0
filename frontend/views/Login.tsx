import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Eye, EyeOff, Lock, Mail, User } from 'lucide-react';
import { AppScreen } from '../types';
import { useAuthSession } from '../src/features/auth/hooks/useAuthSession';
import { STORAGE_KEYS } from '../src/shared/storage/keys';
import { removeStorageKey, readStorageString, writeStorageString } from '../src/shared/storage/localStore';
import { isLocalAdminUsername } from '../services/localAdminAuth';
import { BrandLogo } from '../components/BrandLogo';
import { useNotifications } from '../src/shared/notifications/NotificationProvider';
import { sanitizeUiText } from '../src/shared/ui/terminology';

interface LoginProps {
  setScreen: (screen: AppScreen) => void;
}

type AuthMode = 'login' | 'signup';

export const Login: React.FC<LoginProps> = ({ setScreen }) => {
  const {
    isFirebaseConfigured,
    firebaseConfigIssue,
    signInWithEmail,
    signUpWithEmail,
    requestPasswordReset,
    signInWithGoogle,
  } = useAuthSession();
  const { emit } = useNotifications();
  const [mode, setMode] = useState<AuthMode>('login');
  const [displayName, setDisplayName] = useState('');
  const [userId, setUserId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const firebaseIssue = !isFirebaseConfigured
    ? (String(firebaseConfigIssue || '').trim() || 'Firebase auth is not configured. Set VITE_FIREBASE_* and restart frontend.')
    : '';
  const localAdminLoginAttempt = mode === 'login' && isLocalAdminUsername(email);
  const disableEmailAuthSubmit = Boolean(firebaseIssue) && !localAdminLoginAttempt;
  const disableOAuthAuthSubmit = Boolean(firebaseIssue);

  useEffect(() => {
    const intent = readStorageString(STORAGE_KEYS.authIntent);
    if (intent === 'signup' || intent === 'login') {
      setMode(intent);
    }
    removeStorageKey(STORAGE_KEYS.authIntent);
  }, []);

  useEffect(() => {
    setInfoMsg(null);
  }, [mode]);

  const handleEmailSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setIsLoading(true);
    try {
      const result = mode === 'signup'
        ? await signUpWithEmail(email, password, displayName, userId)
        : await signInWithEmail(email, password);
      if (!result.ok) {
        const message = sanitizeUiText(result.error || 'Authentication failed.');
        setErrorMsg(message);
        emit(mode === 'signup' ? 'auth.signup.failed' : 'auth.signin.failed', {
          title: mode === 'signup' ? 'Sign Up Failed' : 'Sign In Failed',
          message,
          category: 'security',
          dedupeKey: mode === 'signup' ? 'auth-signup-failed' : 'auth-signin-failed',
        });
        return;
      }
      emit(mode === 'signup' ? 'auth.signup.success' : 'auth.signin.success', {
        title: mode === 'signup' ? 'Sign Up Success' : 'Sign In Success',
        message: mode === 'signup' ? 'Account created successfully.' : 'Signed in successfully.',
        category: 'security',
      });
      if ('requiresUserIdSetup' in result && result.requiresUserIdSetup) {
        writeStorageString(STORAGE_KEYS.uidSetupRequired, '1');
        setScreen(AppScreen.USER_ID_SETUP);
        return;
      }
      removeStorageKey(STORAGE_KEYS.uidSetupRequired);
      setScreen(AppScreen.MAIN);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogle = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setIsLoading(true);
    try {
      const result = await signInWithGoogle();
      if (!result.ok) {
        const message = sanitizeUiText(result.error || 'Google sign-in failed.');
        setErrorMsg(message);
        emit('auth.signin.failed', {
          title: 'Google Sign-In Failed',
          message,
          category: 'security',
          dedupeKey: 'auth-google-failed',
        });
        return;
      }
      emit('auth.signin.success', {
        title: 'Sign In Success',
        message: 'Signed in with Google.',
        category: 'security',
      });
      if (result.requiresUserIdSetup) {
        writeStorageString(STORAGE_KEYS.uidSetupRequired, '1');
        setScreen(AppScreen.USER_ID_SETUP);
        return;
      }
      removeStorageKey(STORAGE_KEYS.uidSetupRequired);
      setScreen(AppScreen.MAIN);
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setIsResetting(true);
    try {
      const result = await requestPasswordReset(email);
      if (!result.ok) {
        const message = sanitizeUiText(result.error || 'Could not request password reset.');
        setErrorMsg(message);
        emit('auth.reset.failed', {
          title: 'Password Reset Failed',
          message,
          category: 'security',
          dedupeKey: 'auth-reset-failed',
        });
        return;
      }
      const message = 'If an account exists for this email, a reset link has been sent.';
      setInfoMsg(message);
      emit('auth.reset.success', {
        title: 'Password Reset Requested',
        message,
        category: 'security',
        dedupeKey: 'auth-reset-sent',
      });
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="vf-auth-shell min-h-[100dvh] w-full overflow-y-auto bg-transparent p-4 sm:p-6">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(70%_60%_at_0%_0%,rgba(99,102,241,0.12),transparent_60%),radial-gradient(75%_65%_at_100%_20%,rgba(14,165,233,0.12),transparent_62%)]" />
      <div className="vf-auth-card vf-surface-card relative mx-auto my-4 w-full max-w-md rounded-3xl border border-gray-100 bg-white p-8 shadow-2xl animate-in fade-in zoom-in duration-300 md:my-8 md:p-10">
        <div className="mb-8 text-center">
          <div className="mx-auto flex justify-center">
            <BrandLogo size="lg" tone="dark" />
          </div>
          <p className="mt-3 text-sm text-gray-500">Secure sign-in for your VoiceFlow workspace.</p>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl bg-gray-100 p-1">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors ${mode === 'login' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => setMode('signup')}
            className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors ${mode === 'signup' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
          >
            Sign Up
          </button>
        </div>

        {errorMsg && (
          <div className="mb-5 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {firebaseIssue && (
          <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{firebaseIssue}</span>
          </div>
        )}

        {infoMsg && (
          <div className="mb-5 flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{infoMsg}</span>
          </div>
        )}

        <form onSubmit={handleEmailSubmit} className="space-y-4">
          {mode === 'signup' && (
            <>
              <div>
                <label className="mb-1 ml-1 block text-xs font-bold uppercase tracking-wide text-gray-500">Display Name</label>
                <div className="relative">
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Guest Artist"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 py-3 pl-10 pr-3 text-sm outline-none transition-all focus:border-indigo-500 focus:bg-white"
                  />
                  <User size={16} className="absolute left-3 top-3.5 text-gray-400" />
                </div>
              </div>
              <div>
                <label className="mb-1 ml-1 block text-xs font-bold uppercase tracking-wide text-gray-500">User ID</label>
                <div className="relative">
                  <input
                    value={userId}
                    onChange={(event) => setUserId(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    placeholder="artist_01"
                    pattern="[a-z0-9_]{4,24}"
                    title="Use lowercase letters, numbers, underscore. 4-24 chars."
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 py-3 pl-10 pr-3 text-sm outline-none transition-all focus:border-indigo-500 focus:bg-white"
                    required
                  />
                  <User size={16} className="absolute left-3 top-3.5 text-gray-400" />
                </div>
                <p className="mt-1 text-[11px] text-gray-500">Lowercase only, 4-24 chars. You can set it only once.</p>
              </div>
            </>
          )}

          <div>
            <label className="mb-1 ml-1 block text-xs font-bold uppercase tracking-wide text-gray-500">Email</label>
            <div className="relative">
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 py-3 pl-10 pr-3 text-sm outline-none transition-all focus:border-indigo-500 focus:bg-white"
                required
              />
              <Mail size={16} className="absolute left-3 top-3.5 text-gray-400" />
            </div>
          </div>

          <div>
            <label className="mb-1 ml-1 block text-xs font-bold uppercase tracking-wide text-gray-500">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 py-3 pl-10 pr-10 text-sm outline-none transition-all focus:border-indigo-500 focus:bg-white"
                required
              />
              <Lock size={16} className="absolute left-3 top-3.5 text-gray-400" />
              <button
                type="button"
                className="absolute right-3 top-3.5 text-gray-400 hover:text-gray-600"
                onClick={() => setShowPassword((prev) => !prev)}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {mode === 'login' && (
              <div className="mt-2 text-right">
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={isLoading || isResetting || (Boolean(firebaseIssue) && !localAdminLoginAttempt)}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isResetting ? 'Sending reset link...' : 'Forgot password?'}
                </button>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading || isResetting || disableEmailAuthSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 py-3.5 text-sm font-bold text-white shadow-lg shadow-gray-200 transition-all hover:bg-black disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isLoading ? 'Please wait...' : mode === 'signup' ? 'Create Account' : 'Sign In'} {!isLoading && <ArrowRight size={16} />}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          <span className="h-px flex-1 bg-gray-200" />
          Or continue with
          <span className="h-px flex-1 bg-gray-200" />
        </div>

        <div className="grid grid-cols-1 gap-2">
          <button
            type="button"
            onClick={handleGoogle}
            disabled={isLoading || disableOAuthAuthSubmit}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Google
          </button>
        </div>
      </div>
    </div>
  );
};
