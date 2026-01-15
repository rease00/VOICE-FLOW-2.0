
import React, { useState, useEffect } from 'react';
import { Mic, Loader2, ShieldCheck, Mail, Lock, AlertCircle, CheckCircle2, ArrowRight, Database, User, Eye, EyeOff } from 'lucide-react';
import { AppScreen } from '../types';
import { supabase } from '../services/supabaseClient';
import { useUser } from '../contexts/UserContext';

interface LoginProps {
  setScreen: (screen: AppScreen) => void;
}

export const Login: React.FC<LoginProps> = ({ setScreen }) => {
  const { loginAsGuest } = useUser();
  const [isLoading, setIsLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false); // Toggle between Login and Sign Up
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showResend, setShowResend] = useState(false);
  const [dbConnectionStatus, setDbConnectionStatus] = useState<'checking' | 'connected' | 'warning' | 'error'>('checking');

  // Check for errors returned in the URL (OAuth redirects)
  useEffect(() => {
    const handleAuthRedirectErrors = () => {
      const hash = window.location.hash;
      if (hash && hash.includes('error=')) {
        // Simplify OAuth errors for the user
        setErrorMsg("Login Failed: Could not authenticate with Google. Please try again.");
        window.history.replaceState(null, '', window.location.pathname);
      }
    };

    const checkConnection = async () => {
        try {
            const { error } = await supabase.auth.getSession();
            if (error && (error.message.includes('fetch failed') || error.status === 500)) {
                 console.warn("Supabase connection warning:", error);
                 setDbConnectionStatus('warning');
            } else {
                 setDbConnectionStatus('connected');
            }
        } catch (e: any) {
            console.error("Supabase Connection Check Failed:", e);
            setDbConnectionStatus('error');
        }
    };

    handleAuthRedirectErrors();
    checkConnection();
  }, []);

  const handleGoogleLogin = async () => {
    if (dbConnectionStatus === 'error') {
       console.warn("Attempting login despite connection error state");
    }
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}${window.location.pathname}`,
          queryParams: {
            prompt: 'select_account',
          }
        },
      });
      if (error) throw error;
    } catch (error: any) {
      console.error('Google Login error:', error);
      setErrorMsg("Google Login unavailable. Please check your connection or use Email/Password.");
      setIsLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail) {
        setErrorMsg("Please enter your email address to resend confirmation.");
        return;
    }
    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    
    try {
        const { error } = await supabase.auth.resend({
            type: 'signup',
            email: cleanEmail,
        });
        if (error) throw error;
        setSuccessMsg(`Confirmation email sent to ${cleanEmail}. Please check your inbox (and spam).`);
        setShowResend(false);
    } catch (error: any) {
        if (error.status === 429) {
            setErrorMsg("Too many requests. Please wait 60 seconds before requesting another email.");
        } else {
            setErrorMsg(error.message || "Failed to resend confirmation.");
        }
    } finally {
        setIsLoading(false);
    }
  };

  // Dedicated Login Logic
  const performLogin = async (emailStr: string, passStr: string) => {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: emailStr,
          password: passStr,
        });

        if (error) throw error;
        if (!data.session) throw new Error("Login succeeded but no session created. Please try again.");
        
        // Success is handled by the auth listener in UserContext
      } catch (error: any) {
          handleAuthError(error);
      }
  };

  // Dedicated Signup Logic
  const performSignup = async (emailStr: string, passStr: string) => {
      try {
        const { data, error } = await supabase.auth.signUp({
            email: emailStr,
            password: passStr,
        });
        
        if (error) throw error;

        if (data.user && !data.session) {
            setSuccessMsg("Account created! Please check your email to confirm your registration.");
            setIsLoading(false);
        } else if (data.session) {
            setSuccessMsg("Account created! Logging you in...");
        }
      } catch (error: any) {
          handleAuthError(error);
      }
  };

  const handleAuthError = (error: any) => {
      console.warn('Auth attempt failed:', error);
      let msg = error.message || "Authentication failed.";
      const errorStr = msg.toLowerCase();

      if (errorStr.includes('not confirmed') || errorStr.includes('email not verified')) {
          msg = "Your email is not confirmed. Please check your inbox.";
          setShowResend(true);
      } else if (errorStr.includes('invalid login credentials') || errorStr.includes('invalid grant')) {
          msg = "Incorrect email or password.";
      } else if (errorStr.includes('user already registered')) {
          msg = "This email is already registered. Please Sign In instead.";
          setIsSignUp(false); 
      } else if (errorStr.includes('network request failed') || errorStr.includes('fetch failed')) {
          msg = "Connection error. Please check your internet connection.";
      } else if (errorStr.includes('rate limit')) {
          msg = "Too many attempts. Please try again later.";
      } else if (errorStr.includes('password should be at least')) {
          msg = "Password must be at least 6 characters long.";
      }

      setErrorMsg(msg);
      setIsLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const cleanEmail = email.trim();
    const cleanPassword = password.trim();

    if (!cleanEmail || !cleanPassword) {
      setErrorMsg("Please enter both email and password.");
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setShowResend(false);

    if (isSignUp) {
        await performSignup(cleanEmail, cleanPassword);
    } else {
        await performLogin(cleanEmail, cleanPassword);
    }
  };

  const handleGuestLogin = () => {
      loginAsGuest();
      setScreen(AppScreen.MAIN);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 w-full">
      
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8 md:p-10 animate-in fade-in zoom-in duration-300 border border-gray-100">
        
        {/* Connection Warning Banner */}
        {dbConnectionStatus === 'error' && (
            <div className="absolute top-0 left-0 right-0 bg-red-500 text-white text-xs font-bold p-2 text-center rounded-t-3xl flex items-center justify-center gap-2">
                <Database size={14} /> Database Configuration Error
            </div>
        )}
        {dbConnectionStatus === 'warning' && (
            <div className="absolute top-0 left-0 right-0 bg-amber-500 text-white text-xs font-bold p-2 text-center rounded-t-3xl flex items-center justify-center gap-2">
                <Database size={14} /> Network Connection Issues
            </div>
        )}

        {/* Header Area */}
        <div className="flex flex-col items-center justify-center mb-8 space-y-4 mt-2">
          <div className="relative group">
             <div className="bg-[#8b5cf6] p-4 rounded-2xl shadow-xl shadow-indigo-200 relative z-10 transform transition-transform group-hover:scale-110">
               <Mic size={32} className="text-white" fill="white" />
             </div>
             <div className="absolute -inset-2 bg-indigo-500/20 rounded-full blur-lg group-hover:blur-xl transition-all"></div>
          </div>
          
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              {isSignUp ? 'Create Account' : 'Welcome Back'}
            </h1>
            <p className="text-gray-500 text-sm">
              {isSignUp ? 'Join VoiceFlow AI Studio' : 'Sign in to continue creating'}
            </p>
          </div>
        </div>

        {/* Error / Success Messages */}
        {errorMsg && (
          <div className="mb-6 p-3 bg-red-50 border border-red-100 rounded-xl flex flex-col gap-2 text-red-600 text-sm animate-in slide-in-from-top-2">
            <div className="flex items-start gap-3">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                <span className="font-medium">{errorMsg}</span>
            </div>
            {showResend && (
                <button 
                    type="button" 
                    onClick={handleResendConfirmation}
                    disabled={isLoading}
                    className="ml-7 text-xs font-bold underline hover:text-red-800 text-left flex items-center gap-1"
                >
                    Resend Confirmation Email {isLoading && <Loader2 size={10} className="animate-spin" />}
                </button>
            )}
          </div>
        )}
        
        {successMsg && (
          <div className="mb-6 p-3 bg-green-50 border border-green-100 rounded-xl flex items-start gap-3 text-green-700 text-sm animate-in slide-in-from-top-2">
            <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
            <span className="font-medium">{successMsg}</span>
          </div>
        )}

        {/* Auth Area */}
        <div className="w-full space-y-5">
          
          {/* Google Button */}
          <button 
            type="button"
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full py-3.5 px-4 border border-gray-200 rounded-xl flex items-center justify-center gap-3 bg-white hover:bg-gray-50 transition-all hover:border-gray-300 hover:shadow-sm text-gray-700 font-bold text-sm group disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <Loader2 className="animate-spin text-indigo-600" size={20} />
            ) : (
              <>
                <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </>
            )}
          </button>

          <div className="flex items-center gap-4">
             <div className="h-px bg-gray-200 flex-1"></div>
             <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">Or with Email</span>
             <div className="h-px bg-gray-200 flex-1"></div>
          </div>

          {/* Email Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
             <div className="space-y-1">
                <label className="text-xs font-bold text-gray-600 ml-1">Email Address</label>
                <div className="relative">
                  <input 
                    type="email" 
                    required
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#8b5cf6] focus:border-transparent outline-none transition-all"
                  />
                  <Mail size={16} className="absolute left-3.5 top-3.5 text-gray-400" />
                </div>
             </div>
             <div className="space-y-1">
                <label className="text-xs font-bold text-gray-600 ml-1">Password</label>
                <div className="relative">
                  <input 
                    type={showPassword ? "text" : "password"}
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={6}
                    className="w-full pl-10 pr-10 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#8b5cf6] focus:border-transparent outline-none transition-all"
                  />
                  <Lock size={16} className="absolute left-3.5 top-3.5 text-gray-400" />
                  <button 
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-3.5 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
             </div>

             <button 
               type="submit"
               disabled={isLoading}
               className="w-full py-3.5 rounded-xl font-bold text-sm bg-gray-900 text-white hover:bg-black shadow-lg shadow-gray-200 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
             >
               {isLoading ? (
                 <Loader2 className="animate-spin" size={18} /> 
               ) : (
                 <>
                   {isSignUp ? 'Create Account' : 'Sign In'} <ArrowRight size={16} />
                 </>
               )}
             </button>
          </form>

          <button 
            onClick={handleGuestLogin}
            className="w-full py-3 rounded-xl font-bold text-sm bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all flex items-center justify-center gap-2"
          >
            <User size={16} /> Continue as Guest (Dev Mode)
          </button>

        </div>

        {/* Toggle */}
        <div className="mt-8 text-center">
          <p className="text-sm text-gray-500">
            {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button 
              onClick={() => { setIsSignUp(!isSignUp); setErrorMsg(null); setSuccessMsg(null); setShowResend(false); }}
              className="font-bold text-indigo-600 hover:text-indigo-700 hover:underline transition-all"
            >
              {isSignUp ? 'Sign In' : 'Sign Up'}
            </button>
          </p>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-100 flex items-center justify-center gap-2 text-gray-400 text-xs">
           <ShieldCheck size={14} />
           {dbConnectionStatus === 'checking' ? 'Checking secure connection...' : 'Secured by Supabase Auth'}
        </div>
      </div>
    </div>
  );
};
