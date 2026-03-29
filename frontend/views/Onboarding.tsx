'use client';

import React, { useState, useEffect } from 'react';
import { ArrowRight, CheckCircle2, Sparkles, Wand2 } from 'lucide-react';
import { AppScreen } from '../types';
import { BrandLogo } from '../components/BrandLogo';
import { STORAGE_KEYS } from '../src/shared/storage/keys';
import { writeStorageString } from '../src/shared/storage/localStore';
import type { AuthRouteMode } from '../src/app/navigation';

interface OnboardingProps {
  setScreen: (screen: AppScreen) => void;
  openAuthScreen?: (mode: AuthRouteMode) => void;
}

const onboardingHighlights = [
  {
    icon: Sparkles,
    title: 'Clear first step',
    body: 'Start with a guided path instead of landing in a crowded interface.',
  },
  {
    icon: Wand2,
    title: 'Fast path to output',
    body: 'Import a script, pick a voice, and get to a reviewable draft quickly.',
  },
  {
    icon: CheckCircle2,
    title: 'One-time setup',
    body: 'A quick account setup step appears only when it is actually needed.',
  },
];

const onboardingSteps = [
  'Create your account or sign in',
  'Complete user ID setup when required',
  'Enter Studio with your account ready',
];

const onboardingSlides = [
  'Turn one script into polished voice output quickly.',
  'Shape delivery with AI Director before export.',
  'Publish across languages without rebuilding the workflow.',
];

export const Onboarding: React.FC<OnboardingProps> = ({ setScreen, openAuthScreen }) => {
  const [activeSlide, setActiveSlide] = useState(0);

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

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % onboardingSlides.length);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="vf-auth-shell min-h-[100dvh] w-full overflow-hidden px-4 py-6 text-[#F5F7FB] sm:px-6 lg:px-8" data-testid="auth-onboarding-shell">
      <div className="relative z-10 mx-auto grid min-h-[100dvh] w-full max-w-7xl gap-10 py-4 lg:grid-cols-[0.96fr_1.04fr] lg:items-center lg:py-8">
        <section className="vf-landing-reveal max-w-xl space-y-6 lg:pr-8">
          <div className="inline-flex">
            <BrandLogo size="md" tone="light" />
          </div>

          <div className="space-y-4">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#46E7C7]/18 bg-[#46E7C7]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#CFFAF0]">
              Public access
            </p>
            <h1 className="max-w-xl font-serif text-4xl font-semibold leading-tight text-[#F5F7FB] sm:text-5xl lg:text-6xl">
              Start with the studio, not a setup maze.
            </h1>
            <p className="max-w-lg text-base leading-7 text-[#B8C7DA] sm:text-lg">
              V FLOW AI keeps the starting path short: learn the product, create your account, and land in the studio with a clear next step.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: '5 featured markets', value: 'Live' },
              { label: '83 supported languages', value: 'Atlas' },
              { label: 'AI Director', value: 'Ready' },
            ].map((item) => (
              <div key={item.label} className="rounded-[1.4rem] border border-white/10 bg-white/[0.03] p-4 shadow-[0_18px_42px_rgba(2,8,23,0.24)] backdrop-blur">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9CB1C9]">{item.value}</p>
                <p className="mt-2 text-sm font-semibold text-[#F5F7FB]">{item.label}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {onboardingHighlights.map((item) => (
              <div
                key={item.title}
                className="rounded-[1.4rem] border border-white/10 bg-white/[0.03] p-4 shadow-[0_18px_42px_rgba(2,8,23,0.24)] backdrop-blur"
              >
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-[#46E7C7]/16 to-[#F4B66A]/16 text-[#CFFAF0] ring-1 ring-white/10">
                  <item.icon size={18} />
                </span>
                <p className="mt-3 text-sm font-semibold text-[#F5F7FB]">{item.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-[#A9BCD3]">{item.body}</p>
              </div>
            ))}
          </div>

          <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5 text-sm leading-7 text-[#B8C7DA] shadow-[0_18px_42px_rgba(2,8,23,0.24)] backdrop-blur">
            Start with a clear path into the product, then move straight into account creation or sign-in without extra friction.
          </div>
        </section>

        <div className="flex justify-center lg:justify-end">
          <div className="vf-auth-card vf-auth-card--nested w-full max-w-[34rem] rounded-[2.25rem] border p-6 shadow-[0_28px_65px_rgba(3,5,12,0.48)] backdrop-blur-xl sm:p-7">
            <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#9CB1C9]">Welcome path</p>
                  <h2 className="mt-2 text-xl font-semibold text-[#F5F7FB]">Three simple steps to start</h2>
                </div>
                <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-[#CFFAF0]">
                  Guided
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {onboardingSlides.map((slide, idx) => (
                  <div
                    key={slide}
                    className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3"
                    style={{ transform: activeSlide === idx ? 'translateY(-1px)' : 'translateY(0)' }}
                  >
                    <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                      activeSlide === idx
                        ? 'bg-gradient-to-r from-[#46E7C7] to-[#F4B66A] text-[#07131E] shadow-sm shadow-cyan-400/20'
                        : 'bg-white/[0.08] text-[#A9BCD3]'
                    }`}>
                      {idx + 1}
                    </span>
                    <p className="text-sm leading-relaxed text-[#F5F7FB]">{slide}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex justify-center gap-3">
                {onboardingSlides.map((_, idx) => (
                  <span
                    key={idx}
                    className={`h-1.5 rounded-full transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] duration-500 ${
                      activeSlide === idx ? 'w-8 bg-[#CFFAF0]' : 'w-2 bg-white/30'
                    }`}
                  />
                ))}
              </div>

              <div className="mt-5 grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:grid-cols-3">
                {onboardingSteps.map((step, idx) => (
                  <div key={step} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9CB1C9]">Step {idx + 1}</p>
                    <p className="mt-1 text-xs leading-relaxed text-[#DCE6F3]">{step}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={goToSignup}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#46E7C7] via-[#31B8E6] to-[#F4B66A] px-5 py-4 font-bold text-[#07131E] shadow-xl shadow-cyan-900/20 transition hover:-translate-y-0.5 hover:brightness-105 sm:flex-1"
              >
                Create Account <ArrowRight size={16} />
              </button>
              <button
                type="button"
                onClick={goToLogin}
                className="inline-flex w-full items-center justify-center rounded-2xl border border-white/12 bg-white/[0.04] px-5 py-4 font-semibold text-[#F5F7FB] transition hover:bg-white/[0.08] sm:w-auto"
              >
                Sign In
              </button>
            </div>

            <p className="mt-4 text-center text-xs leading-relaxed text-[#9CB1C9]">
              Choose the path that fits: create a new account or sign in and continue.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
