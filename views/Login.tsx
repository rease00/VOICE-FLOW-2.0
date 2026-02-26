import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Eye, EyeOff, Facebook, Lock, Mail, Phone, ShieldCheck, User } from 'lucide-react';
import { AppScreen } from '../types';
import { useUser } from '../contexts/UserContext';

interface LoginProps {
  setScreen: (screen: AppScreen) => void;
}

type AuthMode = 'login' | 'signup';

export const Login: React.FC<LoginProps> = ({ setScreen }) => {
  const {
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signInWithFacebook,
    startPhoneSignIn,
    confirmPhoneSignIn,
  } = useUser();
  const [mode, setMode] = useState<AuthMode>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneStep, setPhoneStep] = useState<'idle' | 'otp_sent'>('idle');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      const intent = localStorage.getItem('vf_auth_intent');
      if (intent === 'signup' || intent === 'login') {
        setMode(intent);
      }
      localStorage.removeItem('vf_auth_intent');
    } catch {
      // no-op
    }
  }, []);

  const handleEmailSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);
    setIsLoading(true);
    try {
      const result = mode === 'signup'
        ? await signUpWithEmail(email, password, displayName)
        : await signInWithEmail(email, password);
      if (!result.ok) {
        setErrorMsg(result.error || 'Authentication failed.');
        return;
      }
      setScreen(AppScreen.MAIN);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogle = async () => {
    setErrorMsg(null);
    setIsLoading(true);
    try {
      const result = await signInWithGoogle();
      if (!result.ok) {
        setErrorMsg(result.error || 'Google sign-in failed.');
        return;
      }
      setScreen(AppScreen.MAIN);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFacebook = async () => {
    setErrorMsg(null);
    setIsLoading(true);
    try {
      const result = await signInWithFacebook();
      if (!result.ok) {
        setErrorMsg(result.error || 'Facebook sign-in failed.');
        return;
      }
      setScreen(AppScreen.MAIN);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendOtp = async () => {
    setErrorMsg(null);
    setIsLoading(true);
    try {
      const result = await startPhoneSignIn(phoneNumber, 'vf-phone-recaptcha');
      if (!result.ok) {
        setErrorMsg(result.error || 'Could not send OTP.');
        return;
      }
      setPhoneStep('otp_sent');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setErrorMsg(null);
    setIsLoading(true);
    try {
      const result = await confirmPhoneSignIn(phoneCode);
      if (!result.ok) {
        setErrorMsg(result.error || 'Invalid OTP.');
        return;
      }
      setScreen(AppScreen.MAIN);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full overflow-y-auto bg-transparent p-4 sm:p-6">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(70%_60%_at_0%_0%,rgba(99,102,241,0.12),transparent_60%),radial-gradient(75%_65%_at_100%_20%,rgba(14,165,233,0.12),transparent_62%)]" />
      <div className="vf-surface-card relative mx-auto my-4 w-full max-w-md rounded-3xl border border-gray-100 bg-white p-8 shadow-2xl animate-in fade-in zoom-in duration-300 md:my-8 md:p-10">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-xl shadow-indigo-200">
            <ShieldCheck size={30} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Welcome to VoiceFlow</h1>
          <p className="mt-1 text-sm text-gray-500">Firebase-powered login and account security.</p>
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

        <form onSubmit={handleEmailSubmit} className="space-y-4">
          {mode === 'signup' && (
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
          </div>

          <button
            type="submit"
            disabled={isLoading}
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

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleGoogle}
            disabled={isLoading}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Google
          </button>
          <button
            type="button"
            onClick={handleFacebook}
            disabled={isLoading}
            className="inline-flex items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <Facebook size={14} /> Facebook
          </button>
        </div>

        <div className="mt-6 rounded-xl border border-indigo-100 bg-indigo-50 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-indigo-700">
            <Phone size={12} /> Phone (Optional)
          </div>
          {phoneStep === 'idle' ? (
            <div className="space-y-2">
              <input
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
                placeholder="+919999999999"
                className="w-full rounded-lg border border-indigo-100 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
              <button
                type="button"
                onClick={handleSendOtp}
                disabled={isLoading || !phoneNumber.trim()}
                className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                Send OTP
              </button>
              <div id="vf-phone-recaptcha" className="min-h-[18px]" />
            </div>
          ) : (
            <div className="space-y-2">
              <input
                value={phoneCode}
                onChange={(event) => setPhoneCode(event.target.value)}
                placeholder="Enter OTP code"
                className="w-full rounded-lg border border-indigo-100 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
              <button
                type="button"
                onClick={handleVerifyOtp}
                disabled={isLoading || !phoneCode.trim()}
                className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                Verify OTP
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

