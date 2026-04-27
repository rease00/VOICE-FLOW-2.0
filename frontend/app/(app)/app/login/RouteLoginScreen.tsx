'use client';

import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
} from 'lucide-react';
import {
  GoogleAuthProvider,
  deleteUser,
  getAdditionalUserInfo,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { useRouter } from 'next/navigation';

import { APP_ROUTE_PATHS, resolveSafeInternalNextPath } from '../../../../src/app/navigation';
import { sanitizeUiText } from '../../../../src/shared/ui/terminology';
import { resolveAdminProvisioningHint } from '../../../../src/shared/auth/adminProvisioning';
import {
  SIGNUP_DISABLED_API_MESSAGE,
  SIGNUP_DISABLED_DETAIL,
  SIGNUP_DISABLED_TITLE,
} from '../../../../src/shared/auth/signupLock';
import {
  firebaseAuth,
  firebaseConfigIssue,
  googleProvider,
  isAdminIdentity,
  isFirebaseConfigured,
} from '../../../../services/firebaseClient';
import { clearFirebaseSession, syncFirebaseSession } from '../../../../services/authSessionService';
import { warmDriveTokenFromGoogleSignIn } from '../../../../services/driveAuthService';

interface RouteLoginScreenProps {
  nextPath?: string | null;
}

const resolveFirebaseConfigIssueMessage = (): string =>
  String(firebaseConfigIssue || '').trim()
  || 'Firebase auth is not configured. Set NEXT_PUBLIC_FIREBASE_* and restart the frontend server.';

const mapAuthError = (error: unknown, context: 'signin' | 'google' | 'reset' = 'signin'): string => {
  const code = String((error as { code?: unknown } | null)?.code || '').trim().toLowerCase();
  const rawMessage = String((error as { message?: unknown } | null)?.message || '').trim();
  const loweredMessage = rawMessage.toLowerCase();

  if (code === 'auth/api-key-not-valid' || code === 'auth/invalid-api-key') {
    return resolveFirebaseConfigIssueMessage();
  }
  if (code === 'auth/invalid-email') {
    return 'Use a valid email address.';
  }
  if (code === 'auth/network-request-failed' || loweredMessage.includes('network-request-failed')) {
    return 'Cannot reach authentication service right now. Check your connection, then retry.';
  }
  if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
    return 'Invalid email or password.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many attempts. Wait a minute and retry.';
  }
  if (code === 'auth/unauthorized-domain') {
    return 'Google sign-in requires localhost in local development. Open the app at http://localhost:3000 and retry.';
  }
  if (context === 'reset') {
    return 'Could not request password reset.';
  }
  if (context === 'google') {
    return 'Google sign-in failed. Please try again.';
  }
  return 'Sign-in failed. Please check your details and try again.';
};

const requiresEmailVerification = (user: { uid?: string | null; email?: string | null; emailVerified?: boolean | null }): boolean => {
  const email = String(user.email || '').trim();
  if (!email) return false;
  if (isAdminIdentity(user.uid, user.email, false)) return false;
  return user.emailVerified !== true;
};

export function RouteLoginScreen({ nextPath }: RouteLoginScreenProps) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const safeNextPath = useMemo(
    () => resolveSafeInternalNextPath(nextPath, APP_ROUTE_PATHS.studio) || APP_ROUTE_PATHS.studio,
    [nextPath],
  );

  const finalizeSignIn = async (user: { getIdToken: (forceRefresh?: boolean) => Promise<string> }) => {
    try {
      const idToken = await user.getIdToken();
      if (!idToken) {
        throw new Error('Missing Firebase ID token.');
      }
      await syncFirebaseSession(idToken);
      router.replace(safeNextPath);
      return true;
    } catch {
      await clearFirebaseSession().catch(() => undefined);
      await signOut(firebaseAuth).catch(() => undefined);
      setErrorMsg('Signed in, but the app could not finish starting your secure session. Please try again.');
      return false;
    }
  };

  const handleEmailSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    if (!isFirebaseConfigured) {
      setErrorMsg(resolveFirebaseConfigIssueMessage());
      return;
    }

    setIsLoading(true);
    try {
      const normalizedEmail = String(email || '').trim();
      const credential = await signInWithEmailAndPassword(firebaseAuth, normalizedEmail, String(password || ''));

      if (requiresEmailVerification(credential.user)) {
        await signOut(firebaseAuth).catch(() => undefined);
        setInfoMsg('Verify your email before signing in. Check your inbox or spam folder, then try again.');
        return;
      }

      const completed = await finalizeSignIn(credential.user);
      if (completed) {
        setInfoMsg('Signed in successfully.');
      }
    } catch (error) {
      const normalizedEmail = String(email || '').trim();
      const errorCode = String((error as { code?: unknown } | null)?.code || '').trim().toLowerCase();
      const provisioningHint = resolveAdminProvisioningHint(normalizedEmail, errorCode);
      const baseMessage = mapAuthError(error, 'signin');
      setErrorMsg(provisioningHint ? `${baseMessage} ${provisioningHint}` : baseMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setInfoMsg(null);

    if (!isFirebaseConfigured) {
      setErrorMsg(resolveFirebaseConfigIssueMessage());
      return;
    }

    setIsLoading(true);
    try {
      const result = await signInWithPopup(firebaseAuth, googleProvider);
      const providerUserInfo = getAdditionalUserInfo(result);
      if (providerUserInfo?.isNewUser) {
        await deleteUser(result.user).catch(() => undefined);
        await signOut(firebaseAuth).catch(() => undefined);
        setErrorMsg(SIGNUP_DISABLED_API_MESSAGE);
        return;
      }

      if (requiresEmailVerification(result.user)) {
        await signOut(firebaseAuth).catch(() => undefined);
        setInfoMsg('Verify your email before signing in. Check your inbox or spam folder, then try again.');
        return;
      }

      const completed = await finalizeSignIn(result.user);
      if (completed) {
        const credential = GoogleAuthProvider.credentialFromResult(result);
        warmDriveTokenFromGoogleSignIn(credential);
        setInfoMsg('Signed in with Google.');
      }
    } catch (error) {
      setErrorMsg(sanitizeUiText(mapAuthError(error, 'google')));
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setErrorMsg(null);
    setInfoMsg(null);

    const normalizedEmail = String(email || '').trim();
    if (!normalizedEmail) {
      setErrorMsg('Enter your email first.');
      return;
    }
    if (!isFirebaseConfigured) {
      setErrorMsg(resolveFirebaseConfigIssueMessage());
      return;
    }

    setIsResetting(true);
    try {
      await sendPasswordResetEmail(firebaseAuth, normalizedEmail);
      setInfoMsg('If an account exists for this email, a reset link has been sent.');
    } catch (error) {
      setErrorMsg(sanitizeUiText(mapAuthError(error, 'reset')));
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="vf-auth-shell relative px-4 py-8 text-slate-100 selection:bg-cyan-300/30">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="vf-login-orb vf-login-orb-a absolute left-[-8rem] top-[-7rem] h-[20rem] w-[20rem] bg-[radial-gradient(circle,rgba(71,214,202,0.22),transparent_66%)]" />
        <div className="vf-login-orb vf-login-orb-b absolute right-[-6rem] top-[4rem] h-[24rem] w-[24rem] bg-[radial-gradient(circle,rgba(96,72,255,0.20),transparent_68%)]" />
        <div className="vf-login-orb vf-login-orb-c absolute bottom-[-8rem] left-[18%] h-[22rem] w-[22rem] bg-[radial-gradient(circle,rgba(243,184,107,0.10),transparent_66%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,7,18,0)_0%,rgba(3,7,18,0.24)_72%,rgba(3,7,18,0.7)_100%)]" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl items-center justify-center">
        <div className="vf-auth-card relative w-full max-w-[36rem] overflow-hidden rounded-[2rem] sm:rounded-[2.1rem]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(71,214,202,0.10),transparent_34%),radial-gradient(circle_at_100%_16%,rgba(139,92,246,0.12),transparent_28%),linear-gradient(120deg,rgba(255,255,255,0.04),transparent_28%,transparent_72%,rgba(255,255,255,0.02))] opacity-90" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent_20%,transparent_80%,rgba(255,255,255,0.02))]" />
          <div className="vf-login-card-shine absolute inset-x-[-20%] top-0 h-24 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.12),transparent)] opacity-50" />

          <div className="relative p-6 sm:p-8">
            <div className="mb-5 flex justify-center">
              <img
                src="/brand-logo.svg"
                alt="V FLOW AI logo"
                className="block h-16 w-16 select-none drop-shadow-[0_18px_32px_rgba(71,214,202,0.18)] sm:h-[4.75rem] sm:w-[4.75rem]"
                draggable={false}
              />
            </div>

            <p className="vf-auth-chip mx-auto w-fit rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]">Secure sign-in</p>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-white sm:text-4xl">Welcome back</h1>
            <p className="mt-3 text-sm leading-7 text-slate-300">Sign in to continue into your V FLOW AI workspace.</p>

            <div className="vf-auth-card--nested mt-6 grid grid-cols-[1fr,1fr] gap-2 rounded-[1.2rem] border p-2 text-sm">
              <div className="rounded-[0.9rem] bg-white/10 px-4 py-3 font-semibold text-white">Login</div>
              <div className="rounded-[0.9rem] border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-left text-amber-50">
                <p className="font-semibold">{SIGNUP_DISABLED_TITLE}</p>
              </div>
            </div>

            <div className="mt-4 rounded-[1.2rem] border border-amber-300/20 bg-amber-400/10 px-4 py-4 text-sm leading-6 text-amber-50">
              <p className="font-semibold">{SIGNUP_DISABLED_TITLE}</p>
              <p className="mt-1 text-amber-100/90">{SIGNUP_DISABLED_DETAIL}</p>
            </div>

            {errorMsg ? (
              <div className="mt-4 flex items-start gap-3 rounded-[1.1rem] border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-50">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            ) : null}

            {infoMsg ? (
              <div className="mt-4 flex items-start gap-3 rounded-[1.1rem] border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-50">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{infoMsg}</span>
              </div>
            ) : null}

            <form className="mt-5 space-y-4" onSubmit={handleEmailSubmit}>
              <div>
                <label htmlFor="route-login-email" className="mb-1 ml-1 block text-xs font-bold uppercase tracking-wide text-[#9CB1C9]">Email</label>
                <div className="relative">
                  <input
                    id="route-login-email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    className="vf-auth-field w-full rounded-[1rem] px-11 py-3 text-sm outline-none transition focus:ring-2 focus:ring-cyan-300/30"
                    required
                  />
                  <Mail size={16} className="pointer-events-none absolute left-4 top-3.5 text-[#7E92A8]" />
                </div>
              </div>

              <div>
                <label htmlFor="route-login-password" className="mb-1 ml-1 block text-xs font-bold uppercase tracking-wide text-[#9CB1C9]">Password</label>
                <div className="relative">
                  <input
                    id="route-login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter password"
                    autoComplete="current-password"
                    className="vf-auth-field w-full rounded-[1rem] px-11 py-3 pr-12 text-sm outline-none transition focus:ring-2 focus:ring-cyan-300/30"
                    required
                  />
                  <Lock size={16} className="pointer-events-none absolute left-4 top-3.5 text-[#7E92A8]" />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-2 top-2 inline-flex h-10 w-10 items-center justify-center rounded-full text-[#7E92A8] transition hover:text-white"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="mt-2 text-right">
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={isLoading || isResetting || !email.trim()}
                    className="text-xs font-semibold text-cyan-200 transition hover:text-cyan-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isResetting ? 'Sending reset link...' : 'Forgot password?'}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading || isResetting}
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#47d6ca] via-[#2f80ed] to-[#f3b86b] px-6 py-3 text-sm font-semibold text-slate-950 shadow-[0_18px_40px_rgba(71,214,202,0.24)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isLoading ? 'Please wait...' : 'Sign In'}
                {!isLoading ? <ArrowRight size={16} /> : null}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              <hr className="vf-auth-divider h-px flex-1 border-none" />
              Or continue with
              <hr className="vf-auth-divider h-px flex-1 border-none" />
            </div>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-full border border-white/12 bg-white/[0.04] px-6 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Sign in with Google
            </button>
          </div>
        </div>
      </div>

      <style jsx global>{`
        .vf-login-orb {
          will-change: transform, opacity;
          filter: blur(48px);
          transform-origin: center;
        }

        .vf-login-orb-a {
          animation: vfLoginOrbA 18s ease-in-out infinite alternate;
        }

        .vf-login-orb-b {
          animation: vfLoginOrbB 22s ease-in-out infinite alternate;
        }

        .vf-login-orb-c {
          animation: vfLoginOrbC 24s ease-in-out infinite alternate;
        }

        .vf-login-card-shine {
          animation: vfLoginSheen 11s ease-in-out infinite alternate;
          will-change: transform, opacity;
        }

        @keyframes vfLoginOrbA {
          from {
            transform: translate3d(-1.5rem, -1rem, 0) scale(1);
            opacity: 0.72;
          }
          to {
            transform: translate3d(2rem, 1.5rem, 0) scale(1.08);
            opacity: 0.94;
          }
        }

        @keyframes vfLoginOrbB {
          from {
            transform: translate3d(0, 0, 0) scale(1);
            opacity: 0.64;
          }
          to {
            transform: translate3d(-2.5rem, 1.5rem, 0) scale(1.06);
            opacity: 0.88;
          }
        }

        @keyframes vfLoginOrbC {
          from {
            transform: translate3d(0, 0, 0) scale(1);
            opacity: 0.24;
          }
          to {
            transform: translate3d(1.5rem, -1rem, 0) scale(1.05);
            opacity: 0.42;
          }
        }

        @keyframes vfLoginSheen {
          from {
            transform: translateX(-18%) rotate(-5deg);
            opacity: 0.28;
          }
          50% {
            opacity: 0.54;
          }
          to {
            transform: translateX(18%) rotate(-5deg);
            opacity: 0.34;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .vf-login-orb,
          .vf-login-card-shine {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
