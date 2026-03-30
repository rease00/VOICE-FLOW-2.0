'use client';

import React from 'react';
import { ArrowRight } from 'lucide-react';
import { AppScreen } from '../types';
import { BrandLogo } from '../components/BrandLogo';
import { STORAGE_KEYS } from '../src/shared/storage/keys';
import { writeStorageString } from '../src/shared/storage/localStore';
import type { AuthRouteMode } from '../src/app/navigation';

interface OnboardingProps {
  setScreen: (screen: AppScreen) => void;
  openAuthScreen?: (mode: AuthRouteMode) => void;
}

const onboardingSteps = [
  {
    title: 'Create your account or sign in',
    body: 'We keep the path short and only ask for what is needed.',
  },
  {
    title: 'Complete user ID setup if prompted',
    body: 'This step only appears when your account needs it.',
  },
  {
    title: 'Enter Studio and start a script',
    body: 'Import a file or try the demo scene to see the workflow right away.',
  },
] as const;

export const Onboarding: React.FC<OnboardingProps> = ({ setScreen, openAuthScreen }) => {
  const goToSignup = () => {
    writeStorageString(STORAGE_KEYS.authIntent, 'signup');
    if (openAuthScreen) {
      openAuthScreen('signup');
      return;
    }
    setScreen(AppScreen.LOGIN);
  };

  const goToLogin = () => {
    writeStorageString(STORAGE_KEYS.authIntent, 'login');
    if (openAuthScreen) {
      openAuthScreen('login');
      return;
    }
    setScreen(AppScreen.LOGIN);
  };

  return (
    <div className="vf-auth-shell min-h-[100dvh] w-full overflow-hidden px-4 py-6 text-[#F5F7FB] sm:px-6 lg:px-8" data-testid="auth-onboarding-shell">
      <div className="relative z-10 mx-auto grid min-h-[100dvh] w-full max-w-6xl gap-8 py-4 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-8">
        <section className="animate-fade-in-up max-w-xl space-y-6 lg:pr-8">
          <div className="inline-flex">
            <BrandLogo size="md" tone="light" />
          </div>

          <div className="space-y-4">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#46E7C7]/18 bg-[#46E7C7]/10 px-3 py-1 text-[12px] font-bold uppercase tracking-[0.16em] text-[#CFFAF0]">
              Studio onboarding
            </p>
            <h1 className="max-w-xl font-serif text-4xl font-semibold leading-tight text-[#F5F7FB] sm:text-5xl lg:text-6xl">
              Open Studio in three simple steps.
            </h1>
            <p className="max-w-lg text-base leading-7 text-[#B8C7DA] sm:text-lg">
              Choose an account path, finish setup only if prompted, and land in Studio ready to import a script or try the demo.
            </p>
          </div>

          <ol className="space-y-3">
            {onboardingSteps.map((item, index) => (
              <li key={item.title} className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4 shadow-[0_18px_42px_rgba(2,8,23,0.24)] backdrop-blur">
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#CFFAF0] text-xs font-black text-[#07131E]">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-[#F5F7FB]">{item.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-[#A9BCD3]">{item.body}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={goToSignup}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#46E7C7] via-[#31B8E6] to-[#F4B66A] px-5 py-4 font-bold text-[#07131E] shadow-xl shadow-cyan-900/20 transition hover:-translate-y-0.5 hover:brightness-105 sm:flex-1"
            >
              Create Account <ArrowRight size={16} />
            </button>
            <button
              type="button"
              onClick={goToLogin}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.04] px-5 py-4 font-semibold text-[#F5F7FB] transition hover:bg-white/[0.08] sm:w-auto"
            >
              Sign In
            </button>
          </div>
        </section>

        <div className="flex justify-center lg:justify-end">
          <div className="vf-auth-card vf-auth-card--nested w-full max-w-[34rem] rounded-[2.25rem] border p-6 shadow-[0_28px_65px_rgba(3,5,12,0.48)] backdrop-blur-xl sm:p-7">
            <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#9CB1C9]">Quick path</p>
              <h2 className="mt-2 text-xl font-semibold text-[#F5F7FB]">What happens next</h2>

              <div className="mt-5 space-y-3">
                {onboardingSteps.map((step, idx) => (
                  <div key={step.title} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-xs font-bold text-[#CFFAF0]">
                      {idx + 1}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-[#F5F7FB]">{step.title}</p>
                      <p className="mt-1 text-xs leading-relaxed text-[#A9BCD3]">{step.body}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-2xl border border-[#46E7C7]/14 bg-[#46E7C7]/8 px-4 py-3 text-sm leading-6 text-[#DCE6F3]">
                You stay in control: sign up, sign in, or move on if your account is already ready.
              </div>
            </div>

            <p className="mt-6 text-center text-xs leading-relaxed text-[#9CB1C9]">
              Studio opens right after account setup, with no extra steps in the way.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
