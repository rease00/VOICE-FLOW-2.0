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

function LogoLockup({ mobile = false }: { mobile?: boolean }) {
  return (
    <div className={`flex items-center ${mobile ? 'justify-center gap-3' : 'gap-4'}`}>
      <img
        src="/brand-logo.svg"
        alt=""
        aria-hidden="true"
        draggable={false}
        className={`shrink-0 select-none object-contain ${
          mobile ? 'h-14 w-14' : 'h-[4.5rem] w-[4.5rem]'
        }`}
      />
      <div className="min-w-0">
        <div className={`truncate font-black tracking-[-0.05em] text-white ${mobile ? 'text-[22px]' : 'text-[28px]'}`}>
          V FLOW AI
        </div>
        <div className={`mt-1 truncate font-extrabold uppercase tracking-[0.34em] text-cyan-100/70 ${mobile ? 'text-[9px]' : 'text-[10px]'}`}>
          AI STUDIO
        </div>
      </div>
    </div>
  );
}

function BrandPanel() {
  return (
    <aside className="vf-login-brand relative hidden min-h-[620px] overflow-hidden border-r border-white/10 px-10 py-10 lg:flex lg:flex-col lg:justify-between xl:px-12 xl:py-12">
      <div className="vf-login-brand__backdrop" aria-hidden="true">
        <div className="vf-login-brand__glow vf-login-brand__glow--a" />
        <div className="vf-login-brand__glow vf-login-brand__glow--b" />
        <div className="vf-login-brand__grid" />
        <div className="vf-login-brand__mesh" />
      </div>

      <div className="relative z-10">
        <LogoLockup />

        <h2 className="mt-10 max-w-[22rem] text-[clamp(2.55rem,4vw,4rem)] font-black leading-[0.96] tracking-[-0.06em] text-white">
          Your AI Studio
          <br />
          for Automated
          <br />
          Workflows
        </h2>

        <div className="mt-8 grid gap-4 text-sm font-semibold text-slate-200">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center text-sky-200">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
                <path d="m9 12 2 2 4-5" />
              </svg>
            </span>
            <span>Secure &amp; Private</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center text-sky-200">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M13 2 3 14h8l-1 8 10-12h-8l1-8Z" />
              </svg>
            </span>
            <span>Built for Performance</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center text-sky-200">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </span>
            <span>Designed for Teams</span>
          </div>
        </div>
      </div>

      <div className="relative z-10">
        <div className="vf-login-wave" aria-hidden="true" />
      </div>
    </aside>
  );
}

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
    <main className="vf-auth-shell relative px-4 py-6 text-slate-100 selection:bg-cyan-300/30 sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="vf-login-ambient vf-login-ambient--a" />
        <div className="vf-login-ambient vf-login-ambient--b" />
        <div className="vf-login-ambient vf-login-ambient--c" />
        <div className="vf-login-topline" />
        <div className="vf-login-backdrop-grid" />
      </div>

      <section className="relative mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-[1240px] items-center justify-center">
        <div className="vf-auth-card vf-login-shell-card grid w-full grid-cols-1 overflow-hidden rounded-[24px] border border-white/10 bg-[linear-gradient(145deg,rgba(6,12,26,0.92),rgba(8,18,34,0.94)_52%,rgba(8,16,33,0.98))] shadow-[0_30px_90px_rgba(0,0,0,0.50)] backdrop-blur-2xl lg:min-h-[640px] lg:grid-cols-[1.08fr_0.92fr]">
          <BrandPanel />

          <section className="relative flex items-center justify-center px-5 py-6 sm:px-8 lg:px-10 lg:py-10">
            <div className="w-full max-w-[31rem]">
              <div className="lg:hidden">
                <LogoLockup mobile />
              </div>

              <div className="mt-6 text-center lg:mt-0">
                <p className="vf-auth-chip mx-auto w-fit rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]">
                  Secure sign-in
                </p>
                <h1 className="mt-4 text-3xl font-black tracking-[-0.05em] text-white sm:text-4xl">Welcome back</h1>
                <p className="mt-3 text-sm leading-7 text-slate-300">Sign in to continue to your workspace.</p>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-2 rounded-[1.2rem] border border-white/10 bg-white/[0.03] p-2 text-sm">
                <div className="rounded-[0.9rem] bg-white/10 px-4 py-3 text-center font-semibold text-white">Login</div>
                <div className="rounded-[0.9rem] border border-white/10 bg-white/[0.03] px-4 py-3 text-center text-slate-300">
                  Signup <span className="opacity-70">(Paused)</span>
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
                  <label htmlFor="route-login-email" className="mb-1 ml-1 block text-xs font-bold uppercase tracking-wide text-[#9CB1C9]">
                    Email
                  </label>
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
                  <label htmlFor="route-login-password" className="mb-1 ml-1 block text-xs font-bold uppercase tracking-wide text-[#9CB1C9]">
                    Password
                  </label>
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
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#47d6ca] via-[#4f7cff] to-[#9b88f1] px-6 py-3 text-sm font-semibold text-slate-950 shadow-[0_18px_40px_rgba(71,214,202,0.22)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
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
          </section>
        </div>
      </section>

      <style jsx global>{`
        .vf-login-shell-card {
          position: relative;
        }

        .vf-login-shell-card::before {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
        }

        .vf-login-shell-card::after {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent 16%, transparent 84%, rgba(255, 255, 255, 0.03));
          opacity: 0.8;
        }

        .vf-login-brand {
          background:
            radial-gradient(circle at 14% 10%, rgba(71, 214, 202, 0.18), transparent 28%),
            radial-gradient(circle at 76% 72%, rgba(79, 124, 255, 0.16), transparent 38%),
            linear-gradient(155deg, rgba(10, 17, 42, 0.98), rgba(5, 10, 24, 0.98));
        }

        .vf-login-brand__backdrop {
          position: absolute;
          inset: 0;
          overflow: hidden;
          background:
            radial-gradient(circle at 18% 20%, rgba(79, 124, 255, 0.20), transparent 28%),
            radial-gradient(circle at 82% 78%, rgba(71, 214, 202, 0.12), transparent 30%),
            radial-gradient(circle at 46% 88%, rgba(139, 92, 246, 0.10), transparent 44%);
        }

        .vf-login-brand__glow {
          position: absolute;
          border-radius: 999px;
          filter: blur(52px);
          opacity: 0.75;
          will-change: transform, opacity;
        }

        .vf-login-brand__glow--a {
          left: -8%;
          top: -10%;
          width: 22rem;
          height: 22rem;
          background: radial-gradient(circle, rgba(71, 214, 202, 0.24), transparent 64%);
          animation: vfLoginGlowA 18s ease-in-out infinite alternate;
        }

        .vf-login-brand__glow--b {
          right: -10%;
          bottom: 4%;
          width: 24rem;
          height: 24rem;
          background: radial-gradient(circle, rgba(79, 124, 255, 0.18), transparent 68%);
          animation: vfLoginGlowB 22s ease-in-out infinite alternate;
        }

        .vf-login-brand__grid {
          position: absolute;
          inset: 0;
          opacity: 0.14;
          background-image:
            linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent 12%),
            linear-gradient(rgba(96, 123, 197, 0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(96, 123, 197, 0.06) 1px, transparent 1px);
          background-size: 100% 100%, 44px 44px, 44px 44px;
          mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.88), transparent 120%);
        }

        .vf-login-brand__mesh {
          position: absolute;
          inset: auto -8% -8% 14%;
          height: 18rem;
          opacity: 0.5;
          background-image:
            repeating-radial-gradient(ellipse at center, rgba(79, 124, 255, 0.24) 0 1px, transparent 1px 13px);
          transform: translate3d(0, 0, 0) rotate(-10deg) scale(1.22, 0.6);
          mask-image: linear-gradient(90deg, transparent 0%, black 18%, black 84%, transparent 100%);
          animation: vfLoginWave 14s ease-in-out infinite alternate;
        }

        .vf-login-wave {
          position: relative;
          height: 15rem;
          opacity: 0.42;
          background-image:
            repeating-radial-gradient(ellipse at center, rgba(71, 214, 202, 0.16) 0 1px, transparent 1px 13px);
          transform: translate3d(10%, 0, 0) rotate(-10deg) scale(1.22, 0.6);
          mask-image: linear-gradient(90deg, transparent 0%, black 24%, black 80%, transparent 100%);
          animation: vfLoginWave 12s ease-in-out infinite alternate;
        }

        .vf-login-ambient {
          position: absolute;
          border-radius: 999px;
          filter: blur(56px);
          opacity: 0.72;
          will-change: transform, opacity;
        }

        .vf-login-ambient--a {
          left: -7rem;
          top: -6rem;
          width: 20rem;
          height: 20rem;
          background: radial-gradient(circle, rgba(71, 214, 202, 0.18), transparent 66%);
          animation: vfLoginAmbientA 18s ease-in-out infinite alternate;
        }

        .vf-login-ambient--b {
          right: -6rem;
          top: 2rem;
          width: 22rem;
          height: 22rem;
          background: radial-gradient(circle, rgba(96, 72, 255, 0.18), transparent 68%);
          animation: vfLoginAmbientB 22s ease-in-out infinite alternate;
        }

        .vf-login-ambient--c {
          left: 16%;
          bottom: -7rem;
          width: 18rem;
          height: 18rem;
          background: radial-gradient(circle, rgba(243, 184, 107, 0.08), transparent 66%);
          animation: vfLoginAmbientC 24s ease-in-out infinite alternate;
        }

        .vf-login-topline {
          position: absolute;
          inset: 0 0 auto 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(125, 211, 252, 0.28), transparent);
          opacity: 0.8;
        }

        .vf-login-backdrop-grid {
          position: absolute;
          inset: 0;
          opacity: 0.16;
          background-image:
            linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 16%),
            linear-gradient(rgba(148, 163, 184, 0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148, 163, 184, 0.05) 1px, transparent 1px);
          background-size: 100% 100%, 42px 42px, 42px 42px;
          mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.85), transparent 122%);
        }

        .vf-login-card-shine {
          animation: vfLoginSheen 11s ease-in-out infinite alternate;
          will-change: transform, opacity;
        }

        @keyframes vfLoginGlowA {
          from {
            transform: translate3d(-1rem, -1rem, 0) scale(1);
            opacity: 0.76;
          }
          to {
            transform: translate3d(2rem, 1rem, 0) scale(1.06);
            opacity: 0.98;
          }
        }

        @keyframes vfLoginGlowB {
          from {
            transform: translate3d(0, 0, 0) scale(1);
            opacity: 0.56;
          }
          to {
            transform: translate3d(-2rem, 1.5rem, 0) scale(1.05);
            opacity: 0.82;
          }
        }

        @keyframes vfLoginWave {
          from {
            transform: translate3d(0, 0, 0) rotate(-10deg) scale(1.18, 0.58);
            opacity: 0.34;
          }
          to {
            transform: translate3d(2rem, -1rem, 0) rotate(-8deg) scale(1.26, 0.64);
            opacity: 0.54;
          }
        }

        @keyframes vfLoginAmbientA {
          from {
            transform: translate3d(-1rem, -0.5rem, 0) scale(1);
            opacity: 0.7;
          }
          to {
            transform: translate3d(2rem, 1rem, 0) scale(1.08);
            opacity: 0.94;
          }
        }

        @keyframes vfLoginAmbientB {
          from {
            transform: translate3d(0, 0, 0) scale(1);
            opacity: 0.56;
          }
          to {
            transform: translate3d(-2rem, 1rem, 0) scale(1.05);
            opacity: 0.84;
          }
        }

        @keyframes vfLoginAmbientC {
          from {
            transform: translate3d(0, 0, 0) scale(1);
            opacity: 0.18;
          }
          to {
            transform: translate3d(1rem, -1rem, 0) scale(1.08);
            opacity: 0.34;
          }
        }

        @keyframes vfLoginSheen {
          from {
            transform: translateX(-18%) rotate(-5deg);
            opacity: 0.26;
          }
          50% {
            opacity: 0.52;
          }
          to {
            transform: translateX(18%) rotate(-5deg);
            opacity: 0.32;
          }
        }

        @media (max-width: 1023px) {
          .vf-login-shell-card {
            max-width: 404px;
            border-radius: 22px;
          }

          .vf-login-brand {
            display: none;
          }

          .vf-login-topline,
          .vf-login-backdrop-grid {
            opacity: 0.12;
          }

          .vf-login-wave {
            display: none;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .vf-login-ambient,
          .vf-login-brand__glow,
          .vf-login-brand__mesh,
          .vf-login-wave,
          .vf-login-card-shine {
            animation: none !important;
          }
        }
      `}</style>
    </main>
  );
}
