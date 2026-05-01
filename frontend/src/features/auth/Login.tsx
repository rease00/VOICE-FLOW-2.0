'use client';
import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Check, Eye, EyeOff, Lock, Mail, User, X } from 'lucide-react';
import { AppScreen } from '../../../types';
import { useAuthSession } from './hooks/useAuthSession';
import { STORAGE_KEYS } from '../../shared/storage/keys';
import { removeStorageKey, readStorageString } from '../../shared/storage/localStore';
import { BrandLogo } from '../../../components/BrandLogo';
import { useOptionalNotifications } from '../../shared/notifications/NotificationProvider';
import { sanitizeUiText } from '../../shared/ui/terminology';
import { resolveLegalDocument } from '../legal/legalContent';
import { resolveSafeInternalNextPath, type AuthRouteMode } from '../../app/navigation';
import {
  SIGNUP_DISABLED_DETAIL,
  SIGNUP_DISABLED_TITLE,
  isSignupMode,
  normalizeLoginRouteMode,
} from '../../shared/auth/signupLock';

interface LoginProps {
  setScreen: (screen: AppScreen) => void;
  initialMode?: AuthRouteMode;
  syncModeToRoute?: (mode: AuthRouteMode) => void;
  nextPath?: string | null;
  navigateToPath?: (path: string) => void;
}

type AuthMode = 'login' | 'signup';
const TERMS_PATH = '/legal/terms' as const;
const PRIVACY_PATH = '/legal/privacy' as const;
type LegalPopupPath = typeof TERMS_PATH | typeof PRIVACY_PATH;

export const Login: React.FC<LoginProps> = ({ setScreen, initialMode, syncModeToRoute, nextPath, navigateToPath }) => {
  const {
    signInWithEmail,
    resendEmailVerification,
    requestPasswordReset,
    signInWithGoogle,
  } = useAuthSession();
  const notifications = useOptionalNotifications();
  const emit = notifications?.emit;
  const [mode, setMode] = useState<AuthMode>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [needsEmailVerification, setNeedsEmailVerification] = useState(false);
  const [verificationCooldownUntil, setVerificationCooldownUntil] = useState(0);
  const [verificationCooldownRemainingSec, setVerificationCooldownRemainingSec] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [provisioningHintMsg, setProvisioningHintMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [termsErrorMsg, setTermsErrorMsg] = useState<string | null>(null);
  const [activeLegalPath, setActiveLegalPath] = useState<LegalPopupPath | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const activeLegalDocument = activeLegalPath ? resolveLegalDocument(activeLegalPath) : null;
  const firebaseIssue = '';
  const disableEmailAuthSubmit = false;
  const disableOAuthAuthSubmit = true;
  const signupRequestedByRoute = isSignupMode(initialMode);
  const signupRequestedByStorage = !initialMode && isSignupMode(readStorageString(STORAGE_KEYS.authIntent));
  const signupRequestDetected = signupRequestedByRoute || signupRequestedByStorage;
  const isSignupScreen = false;

  useEffect(() => {
    if (!initialMode) return;
    const nextMode = normalizeLoginRouteMode(initialMode);
    if (nextMode) {
      setMode(nextMode);
    }
  }, [initialMode]);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (initialMode) {
      removeStorageKey(STORAGE_KEYS.authIntent);
      return;
    }
    const intent = readStorageString(STORAGE_KEYS.authIntent);
    const normalizedIntent = normalizeLoginRouteMode(intent);
    if (normalizedIntent) {
      setMode(normalizedIntent);
    }
    removeStorageKey(STORAGE_KEYS.authIntent);
  }, [initialMode]);

  useEffect(() => {
    setInfoMsg(null);
    setProvisioningHintMsg(null);
    setNeedsEmailVerification(false);
    setVerificationCooldownUntil(0);
    setTermsErrorMsg(null);
    setConfirmPassword('');
  }, [mode]);

  useEffect(() => {
    if (verificationCooldownUntil <= 0) {
      setVerificationCooldownRemainingSec(0);
      return;
    }
    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((verificationCooldownUntil - Date.now()) / 1000));
      setVerificationCooldownRemainingSec(remaining);
    };
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [verificationCooldownUntil]);

  useEffect(() => {
    if (!activeLegalPath) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveLegalPath(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [activeLegalPath]);

  const scrollToLegalSection = (sectionIndex: number) => {
    const target = document.getElementById(`legal-section-${sectionIndex}`);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openLegalModal = (path: LegalPopupPath) => {
    setActiveLegalPath(path);
  };

  const closeLegalModal = () => {
    setActiveLegalPath(null);
  };

  const handleAcceptTerms = () => {
    setAcceptedTerms(true);
    setTermsErrorMsg(null);
    setActiveLegalPath(null);
  };

  const authControlTransitionClass = 'transition-[border-color,background-color,color,box-shadow,filter,opacity,transform]';
  const authButtonTransitionClass = 'transition-[background-color,color,box-shadow,filter,opacity,transform]';
  const authControlFocusClass = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950';
  const authButtonFocusClass = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950';
  const authHeading = 'Welcome back';
  const authSubtitle = 'Secure access to your V FLOW AI account.';
  const safeNextPath = resolveSafeInternalNextPath(nextPath, null);
  const setAuthMode = (nextMode: AuthMode) => {
    const normalizedMode = normalizeLoginRouteMode(nextMode);
    if (!normalizedMode) return;
    setMode(normalizedMode);
    syncModeToRoute?.(normalizedMode);
  };

  const handleEmailSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setProvisioningHintMsg(null);
    setNeedsEmailVerification(false);
    setTermsErrorMsg(null);
    setIsLoading(true);
    try {
      const result = await signInWithEmail(email, password);
      if (!result.ok) {
        const message = sanitizeUiText(
          result.error || 'Sign-in failed. Please check your details and try again.'
        );
        if ('requiresEmailVerification' in result && result.requiresEmailVerification) {
          setNeedsEmailVerification(true);
          setInfoMsg(message);
          emit?.('auth.signin.failed', {
            title: 'Email Verification Required',
            message,
            category: 'security',
            dedupeKey: 'auth-signin-email-verification-required',
          });
          return;
        }
        setErrorMsg(message);
        const provisioningHint = 'provisioningHint' in result ? String(result.provisioningHint || '').trim() : '';
        setProvisioningHintMsg(provisioningHint ? sanitizeUiText(provisioningHint) : null);
        emit?.('auth.signin.failed', {
          title: 'Sign In Failed',
          message,
          category: 'security',
          dedupeKey: 'auth-signin-failed',
        });
        return;
      }
      emit?.('auth.signin.success', {
        title: 'Sign In Success',
        message: 'Signed in successfully.',
        category: 'security',
      });
      if (safeNextPath) {
        if (navigateToPath) {
          navigateToPath(safeNextPath);
          return;
        }
        if (typeof window !== 'undefined') {
          window.location.assign(safeNextPath);
          return;
        }
      }
      setScreen(AppScreen.MAIN);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (verificationCooldownRemainingSec > 0 || isResendingVerification) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setProvisioningHintMsg(null);
    setIsResendingVerification(true);
    try {
      const result = await resendEmailVerification(email, password);
      if (!result.ok) {
        const message = sanitizeUiText(result.error || 'Could not resend verification email.');
        setErrorMsg(message);
        emit?.('auth.signin.failed', {
          title: 'Verification Email Failed',
          message,
          category: 'security',
          dedupeKey: 'auth-resend-email-verification-failed',
        });
        return;
      }
      const message = 'Verification email sent. Please check inbox/spam.';
      setNeedsEmailVerification(true);
      setInfoMsg(message);
      setVerificationCooldownUntil(Date.now() + 30_000);
      emit?.('auth.signin.success', {
        title: 'Verification Email Sent',
        message,
        category: 'security',
        dedupeKey: 'auth-resend-email-verification-success',
      });
    } finally {
      setIsResendingVerification(false);
    }
  };

  const handleGoogle = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setProvisioningHintMsg(null);
    setIsLoading(true);
    try {
      const result = await signInWithGoogle();
      if (!result.ok) {
        const message = sanitizeUiText(
          result.error || 'Google sign-in failed.'
        );
        setErrorMsg(message);
        emit?.('auth.signin.failed', {
          title: 'Google Sign-In Failed',
          message,
          category: 'security',
          dedupeKey: 'auth-google-failed',
        });
        return;
      }
      emit?.('auth.signin.success', {
        title: 'Sign In Success',
        message: 'Signed in with Google.',
        category: 'security',
      });
      if (safeNextPath) {
        if (navigateToPath) {
          navigateToPath(safeNextPath);
          return;
        }
        if (typeof window !== 'undefined') {
          window.location.assign(safeNextPath);
          return;
        }
      }
      setScreen(AppScreen.MAIN);
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setProvisioningHintMsg(null);
    setIsResetting(true);
    try {
      const result = await requestPasswordReset(email);
      if (!result.ok) {
        const message = sanitizeUiText(result.error || 'Could not request password reset.');
        setErrorMsg(message);
        emit?.('auth.reset.failed', {
          title: 'Password Reset Failed',
          message,
          category: 'security',
          dedupeKey: 'auth-reset-failed',
        });
        return;
      }
      const message = 'If an account exists for this email, a reset link has been sent.';
      setInfoMsg(message);
      emit?.('auth.reset.success', {
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
    <div
      className="ap-shell"
      data-testid="auth-shell"
      data-auth-hydrated={isHydrated ? 'true' : 'false'}
    >
      {/* Aurora background */}
      <div className="ap-grid" aria-hidden="true" />
      <div className="ap-aurora ap-aurora--a" aria-hidden="true" />
      <div className="ap-aurora ap-aurora--b" aria-hidden="true" />
      <div className="ap-aurora ap-aurora--c" aria-hidden="true" />

      <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-7xl items-center justify-center px-4 py-8">
      <div className="ap-card w-full max-w-[36rem] p-5 sm:p-6 lg:p-8" data-testid="auth-card">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex justify-center">
            <BrandLogo size="lg" tone="light" />
          </div>
          <span className="ap-eyebrow">
            <span className="ap-live-dot" style={{ height: '6px', width: '6px' }} />
            Secure account access
          </span>
          <h1 className="mt-4 text-2xl font-black tracking-tight text-white sm:text-3xl">{authHeading}</h1>
          <p className="mt-2 text-sm text-slate-400">{authSubtitle}</p>
        </div>

        <div className="ap-mode-tab mb-5">
          <button
            type="button"
            onClick={() => setAuthMode('login')}
            aria-pressed={mode === 'login'}
            className={`ap-mode-tab__btn ap-mode-tab__btn--active ${authButtonFocusClass}`}
          >
            Login
          </button>
          <div className="ap-mode-tab__btn ap-mode-tab__btn--inactive text-left text-[11px] leading-5">
            {SIGNUP_DISABLED_TITLE}
          </div>
        </div>

        {signupRequestDetected ? (
          <div className="ap-banner ap-banner--warn mb-4" role="status" aria-live="polite" aria-atomic="true">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span><strong>{SIGNUP_DISABLED_TITLE}.</strong> {SIGNUP_DISABLED_DETAIL}</span>
          </div>
        ) : null}

        {errorMsg && (
          <div className="ap-banner ap-banner--error mb-4" role="alert" aria-live="assertive" aria-atomic="true">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
        {provisioningHintMsg && (
          <div className="ap-banner ap-banner--warn mb-4" role="alert" aria-live="assertive" aria-atomic="true">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>{provisioningHintMsg}</span>
          </div>
        )}
        {firebaseIssue && (
          <div className="ap-banner ap-banner--warn mb-4" role="alert" aria-live="assertive" aria-atomic="true">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>{firebaseIssue}</span>
          </div>
        )}
        {infoMsg && (
          <div className="ap-banner ap-banner--success mb-4" role="status" aria-live="polite" aria-atomic="true">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span>{infoMsg}</span>
          </div>
        )}

        <form onSubmit={handleEmailSubmit} className="space-y-3.5">
          {isSignupScreen && (
            <>
              <div>
                <label htmlFor="display-name" className="mb-1 ml-1 block text-xs font-bold uppercase tracking-wide text-[#9CB1C9]">Display Name</label>
                <div className="relative">
                  <input
                    id="display-name"
                    name="displayName"
                    type="text"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Guest Artist"
                    autoComplete="name"
                    spellCheck={false}
                    aria-describedby="display-name-help"
                    className={`ap-field text-sm ${authControlTransitionClass} ${authControlFocusClass}`}
                  />
                  <User size={16} className="absolute left-3 top-3.5 text-[#7E92A8]" />
                </div>
                <p id="display-name-help" className="mt-1 text-[11px] text-[#9CB1C9]">Shown on your account profile inside the app.</p>
              </div>
            </>
          )}

          <div>
            <label htmlFor="auth-email" className="mb-1 ml-1 block text-xs font-bold uppercase tracking-wide text-[#9CB1C9]">Email</label>
            <div className="relative">
              <input
                id="auth-email"
                name="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
                aria-describedby="auth-email-help"
                className={`ap-field text-sm ${authControlTransitionClass} ${authControlFocusClass}`}
                required
              />
              <Mail size={16} className="absolute left-3 top-3.5 text-[#7E92A8]" />
            </div>
            <p id="auth-email-help" className="mt-1 text-[11px] text-[#9CB1C9]">Use the email tied to your V FLOW AI account.</p>
          </div>

          <div>
            <label htmlFor="auth-password" className="mb-1 ml-1 block text-xs font-bold uppercase tracking-wide text-[#9CB1C9]">Password</label>
            <div className="relative">
              <input
                id="auth-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
                autoComplete={isSignupScreen ? 'new-password' : 'current-password'}
                spellCheck={false}
                aria-describedby="auth-password-help"
                className={`ap-field pr-10 text-sm ${authControlTransitionClass} ${authControlFocusClass}`}
                required
              />
              <Lock size={16} className="absolute left-3 top-3.5 text-[#7E92A8]" />
              <button
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                aria-controls="auth-password"
                className={`absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-full text-[#7E92A8] hover:text-[#E6EEF8] ${authButtonTransitionClass} ${authButtonFocusClass}`}
                onClick={() => setShowPassword((prev) => !prev)}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p id="auth-password-help" className="mt-1 text-[11px] text-[#9CB1C9]">
              Keep this private. Use a strong password you can remember.
            </p>
            {mode === 'login' && (
              <div className="mt-2 text-right">
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={isLoading || isResetting || disableEmailAuthSubmit || !email.trim()}
                  className={`inline-flex min-h-11 items-center rounded-md px-1.5 text-xs font-semibold text-[#78EBD1] hover:text-[#CFFAF0] disabled:cursor-not-allowed disabled:opacity-60 ${authButtonFocusClass}`}
                >
                  {isResetting ? 'Sending reset link...' : 'Forgot password?'}
                </button>
              </div>
            )}
          </div>

          {isSignupScreen && (
            <div>
              <label htmlFor="auth-password-confirm" className="mb-1 ml-1 block text-xs font-bold uppercase tracking-wide text-[#9CB1C9]">Confirm Password</label>
              <div className="relative">
                <input
                  id="auth-password-confirm"
                  name="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Re-enter password"
                  autoComplete="new-password"
                  spellCheck={false}
                  aria-describedby="auth-password-confirm-help"
                  className={`ap-field text-sm ${authControlTransitionClass} ${authControlFocusClass}`}
                  required
                />
                <Lock size={16} className="absolute left-3 top-3.5 text-[#7E92A8]" />
              </div>
              <p id="auth-password-confirm-help" className="mt-1 text-[11px] text-[#9CB1C9]">Use the same password again to avoid setup mistakes.</p>
            </div>
          )}

          {isSignupScreen && (
            <div className="rounded-[1.2rem] border border-white/10 bg-white/[0.03] px-4 py-4">
              <div className="flex items-start gap-2 text-sm text-[#DCE6F3]">
                <label htmlFor="accepted-terms" className="flex min-h-12 shrink-0 cursor-pointer items-start">
                  <span className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                    <input
                      id="accepted-terms"
                      name="acceptedTerms"
                      type="checkbox"
                      checked={acceptedTerms}
                      onChange={(event) => {
                        setAcceptedTerms(event.target.checked);
                        if (event.target.checked) setTermsErrorMsg(null);
                      }}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                    />
                    <span
                      aria-hidden="true"
                      className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${
                        acceptedTerms ? 'border-[#46E7C7] bg-[#46E7C7] text-[#07131E]' : 'border-[#6B7F96] bg-transparent text-transparent'
                      }`}
                    >
                      <Check size={13} strokeWidth={3} />
                    </span>
                  </span>
                </label>
                <div className="min-w-0 flex-1">
                  <label htmlFor="accepted-terms" className="flex min-h-11 cursor-pointer items-center text-sm leading-6">
                    I agree to the account terms and privacy policy.
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openLegalModal(TERMS_PATH)}
                      className="inline-flex min-h-11 items-center rounded-md px-3 py-1 font-semibold text-[#78EBD1] underline decoration-[#78EBD1]/60 underline-offset-2 hover:text-[#CFFAF0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                    >
                      Terms and Conditions
                    </button>
                    <button
                      type="button"
                      onClick={() => openLegalModal(PRIVACY_PATH)}
                      className="inline-flex min-h-11 items-center rounded-md px-3 py-1 font-semibold text-[#78EBD1] underline decoration-[#78EBD1]/60 underline-offset-2 hover:text-[#CFFAF0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                    >
                      Privacy Policy
                    </button>
                  </div>
                </div>
              </div>
              {termsErrorMsg && (
                <p id="accepted-terms-error" className="mt-2 text-xs font-semibold text-[#FFB4B4]" role="alert" aria-live="assertive">{termsErrorMsg}</p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || isResetting || disableEmailAuthSubmit}
            aria-busy={isLoading || isResetting}
            className={`ap-btn-primary text-sm ${authButtonFocusClass} disabled:cursor-not-allowed disabled:opacity-70`}
          >
            {isLoading ? 'Please wait...' : 'Sign In'} {!isLoading && <ArrowRight size={16} />}
          </button>
        </form>

        {needsEmailVerification && mode === 'login' && (
          <div className="mt-4 rounded-[1.2rem] border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-[#FFE3BF]">
            <p className="font-semibold">Verify your email first</p>
            <p className="mt-1">You must verify this account before accessing the app.</p>
            <button
              type="button"
              onClick={handleResendVerification}
              disabled={isResendingVerification || verificationCooldownRemainingSec > 0}
              className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-amber-400/20 bg-white/5 px-3 py-2 text-xs font-semibold text-[#F5F7FB] hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isResendingVerification
                ? 'Sending...'
                : verificationCooldownRemainingSec > 0
                  ? `Resend in ${verificationCooldownRemainingSec}s`
                  : 'Resend verification email'}
            </button>
          </div>
        )}

        <div className="my-5 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          <hr className="h-px flex-1 border-none bg-white/10" />
          Or continue with
          <hr className="h-px flex-1 border-none bg-white/10" />
        </div>

        <div className="grid grid-cols-1 gap-2">
          <button
            type="button"
            onClick={handleGoogle}
            disabled={isLoading || disableOAuthAuthSubmit}
            aria-busy={isLoading}
            className={`ap-google-btn ${authButtonFocusClass} disabled:opacity-60`}
          >
            Sign in with Google
          </button>
        </div>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-500">
          Use your email or Google account to continue into V FLOW AI.
        </p>
      </div>
      </div>

      {activeLegalPath && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/78 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="legal-dialog-title"
          onClick={closeLegalModal}
        >
          <div
            className="relative flex max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#07131F] shadow-[0_36px_90px_rgba(2,6,23,0.62)]"
            onClick={(event) => event.stopPropagation()}
          >
            {activeLegalDocument && (
              <aside className="hidden w-72 shrink-0 border-r border-white/10 bg-white/[0.03] p-4 lg:block">
                <p className="text-xs font-bold uppercase tracking-wide text-[#9CB1C9]">Navigate</p>
                <nav className="mt-3 flex max-h-[78vh] flex-col gap-1 overflow-y-auto pr-1">
                  {activeLegalDocument.sections.map((section, sectionIndex) => (
                    <button
                      key={section.heading}
                      type="button"
                      onClick={() => scrollToLegalSection(sectionIndex + 1)}
                      className="rounded-lg px-2 py-1.5 text-left text-xs font-medium text-[#B8C7DA] transition-colors hover:bg-white/[0.08] hover:text-[#F5F7FB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                    >
                      {section.heading}
                    </button>
                  ))}
                </nav>
              </aside>
            )}

            <section className="flex min-h-0 flex-1 flex-col">
              <header className="flex items-start justify-between gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-3 sm:px-5">
                <div>
                  <h2 id="legal-dialog-title" className="text-lg font-bold text-[#F5F7FB]">
                    {activeLegalDocument?.title || 'Legal document'}
                  </h2>
                  {activeLegalDocument?.lastUpdated && (
                    <p className="mt-0.5 text-xs text-[#9CB1C9]">Last updated: {activeLegalDocument.lastUpdated}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={closeLegalModal}
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 text-[#B8C7DA] hover:bg-white/[0.08] ${authButtonFocusClass}`}
                  aria-label="Close legal popup"
                >
                  <X size={16} />
                </button>
              </header>

              <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4 text-sm text-[#DCE6F3] sm:px-5">
                {activeLegalDocument ? (
                  <>
                    <p className="text-sm leading-6 text-[#B8C7DA]">{activeLegalDocument.description}</p>
                    {activeLegalDocument.sections.map((section, sectionIndex) => (
                      <article
                        key={section.heading}
                        id={`legal-section-${sectionIndex + 1}`}
                        className="scroll-mt-20 rounded-xl border border-white/10 bg-white/[0.03] p-4"
                      >
                        <h3 className="text-sm font-bold text-[#F5F7FB]">{section.heading}</h3>
                        <div className="mt-2 space-y-2">
                          {section.paragraphs.map((paragraph) => (
                            <p key={paragraph} className="text-sm leading-6 text-[#B8C7DA]">
                              {paragraph}
                            </p>
                          ))}
                        </div>
                      </article>
                    ))}
                  </>
                ) : (
                  <p className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-[#FFE3BF]">
                    Legal content is unavailable right now. Please open{' '}
                    <a
                      href={activeLegalPath || TERMS_PATH}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-[#78EBD1] underline underline-offset-2"
                    >
                      {activeLegalPath || TERMS_PATH}
                    </a>{' '}
                    to review before continuing.
                  </p>
                )}
              </div>

              <footer className="flex items-center justify-end gap-2 border-t border-white/10 bg-white/[0.03] px-4 py-3 sm:px-5">
                <a
                  href={activeLegalPath || TERMS_PATH}
                  target="_blank"
                  rel="noreferrer"
                  className="mr-auto inline-flex min-h-11 items-center rounded-md px-1 text-xs font-semibold text-[#78EBD1] underline decoration-[#78EBD1]/70 underline-offset-2 hover:text-[#CFFAF0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  Open full legal page
                </a>
                <button
                  type="button"
                  onClick={closeLegalModal}
                  className={`inline-flex min-h-11 items-center rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-[#F5F7FB] hover:bg-white/[0.08] ${authButtonFocusClass}`}
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleAcceptTerms}
                  className={`inline-flex min-h-11 items-center rounded-lg bg-gradient-to-r from-[#46E7C7] via-[#31B8E6] to-[#F4B66A] px-4 py-2 text-xs font-semibold text-[#07131E] shadow-md shadow-cyan-500/20 hover:brightness-105 ${authButtonFocusClass}`}
                >
                  Accept & Continue
                </button>
              </footer>
            </section>
          </div>
        </div>
      )}
    </div>
  );
};
