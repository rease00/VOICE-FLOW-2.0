'use client';

import React, { type CSSProperties } from 'react';
import { ArrowRight, AudioLines, BookOpen, Mic2, Sparkles, WandSparkles, Zap } from 'lucide-react';
import { AppScreen } from '../../../types';
import { BrandLogo } from '../../../components/BrandLogo';
import { STORAGE_KEYS } from '../../shared/storage/keys';
import { writeStorageString } from '../../shared/storage/localStore';
import type { AuthRouteMode } from '../../app/navigation';

interface OnboardingProps {
  setScreen: (screen: AppScreen) => void;
  openAuthScreen?: (mode: AuthRouteMode) => void;
}

const ONBOARDING_STEPS = [
  {
    num: 1,
    icon: <Sparkles size={14} />,
    title: 'Create your account or sign in',
    body: 'We keep the path short and only ask for what is needed.',
    color: 'rgba(6,182,212,0.8)',
    delay: '80ms',
  },
  {
    num: 2,
    icon: <Zap size={14} />,
    title: 'Complete user ID setup if prompted',
    body: 'This step only appears when your account needs it.',
    color: 'rgba(139,92,246,0.8)',
    delay: '160ms',
  },
  {
    num: 3,
    icon: <AudioLines size={14} />,
    title: 'Enter Studio and start a script',
    body: 'Import a file or try the demo scene to see the workflow right away.',
    color: 'rgba(244,63,94,0.8)',
    delay: '240ms',
  },
] as const;

const FEATURE_CHIPS = [
  { icon: <WandSparkles size={12} />, label: 'Prime Scenes', color: 'rgba(139,92,246,0.7)' },
  { icon: <Mic2 size={12} />, label: 'Voice Clone', color: 'rgba(6,182,212,0.7)' },
  { icon: <AudioLines size={12} />, label: 'AI Director', color: 'rgba(244,63,94,0.7)' },
  { icon: <BookOpen size={12} />, label: 'Writing', color: 'rgba(250,204,21,0.7)' },
] as const;

const WAVE_HEIGHTS = [0.45, 0.78, 0.55, 0.92, 0.65, 0.82, 0.48, 0.7, 0.58, 0.88, 0.42, 0.72] as const;

export const Onboarding: React.FC<OnboardingProps> = ({ setScreen, openAuthScreen }) => {
  const goToSignup = () => {
    writeStorageString(STORAGE_KEYS.authIntent, 'signup');
    if (openAuthScreen) { openAuthScreen('signup'); return; }
    setScreen(AppScreen.LOGIN);
  };

  const goToLogin = () => {
    writeStorageString(STORAGE_KEYS.authIntent, 'login');
    if (openAuthScreen) { openAuthScreen('login'); return; }
    setScreen(AppScreen.LOGIN);
  };

  return (
    <div className="ap-shell" data-testid="auth-onboarding-shell">
      {/* Ambient layers */}
      <div className="ap-grid" aria-hidden="true" />
      <div className="ap-aurora ap-aurora--a" aria-hidden="true" />
      <div className="ap-aurora ap-aurora--b" aria-hidden="true" />
      <div className="ap-aurora ap-aurora--c" aria-hidden="true" />

      {/* Body */}
      <div className="relative z-10 mx-auto flex min-h-[100dvh] max-w-6xl flex-col justify-center gap-10 px-4 py-10 sm:px-6 lg:grid lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-14">

        {/* ── LEFT: hero content ── */}
        <section className="max-w-xl lg:pr-10">

          {/* Logo */}
          <div className="mb-8 inline-flex">
            <BrandLogo size="md" tone="light" />
          </div>

          {/* Kicker */}
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="ap-eyebrow">
              <span className="ap-live-dot" style={{ height: '6px', width: '6px' }} />
              Studio onboarding
            </span>
            {FEATURE_CHIPS.map((chip) => (
              <span
                key={chip.label}
                className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
                style={{
                  color: chip.color,
                  borderColor: `color-mix(in srgb, ${chip.color} 40%, transparent)`,
                  background: `color-mix(in srgb, ${chip.color} 8%, transparent)`,
                } as CSSProperties}
              >
                {chip.icon}
                {chip.label}
              </span>
            ))}
          </div>

          {/* Headline */}
          <h1 className="mb-4 text-4xl font-black leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl">
            Open Studio in{' '}
            <span className="lp-headline-gradient">three simple steps.</span>
          </h1>

          <p className="mb-8 max-w-lg text-base leading-7 text-slate-400 sm:text-lg">
            Choose an account path, finish setup only if prompted, and land in Studio ready to import a script or try a demo scene.
          </p>

          {/* Steps */}
          <ol className="mb-8 space-y-3">
            {ONBOARDING_STEPS.map((step) => (
              <li
                key={step.num}
                className="ap-step-card"
                style={{ animationDelay: step.delay } as CSSProperties}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="ap-step-num"
                    style={{
                      background: `linear-gradient(135deg, color-mix(in srgb, ${step.color} 30%, transparent), color-mix(in srgb, ${step.color} 22%, transparent))`,
                      borderColor: `color-mix(in srgb, ${step.color} 45%, transparent)`,
                      color: step.color,
                    } as CSSProperties}
                  >
                    {step.num}
                  </span>
                  <div>
                    <p className="font-semibold text-white text-sm">{step.title}</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-slate-400">{step.body}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>

          {/* CTAs */}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={goToSignup}
              className="ap-btn-primary sm:w-auto sm:flex-none"
              style={{ width: 'auto', paddingLeft: '1.75rem', paddingRight: '1.75rem' }}
            >
              Create Account <ArrowRight size={16} />
            </button>
            <button
              type="button"
              onClick={goToLogin}
              className="ap-btn-secondary sm:w-auto"
            >
              Sign In
            </button>
          </div>
        </section>

        {/* ── RIGHT: preview panel ── */}
        <div className="flex justify-center lg:justify-end">
          <div className="ap-card w-full max-w-sm p-6 sm:p-7">

            <p className="mb-5 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
              <Sparkles size={11} className="text-cyan-400" />
              Studio preview
            </p>

            {/* Animated waveform */}
            <div className="mb-5 flex items-end justify-center gap-1" aria-hidden="true" style={{ height: '3.5rem' }}>
              {WAVE_HEIGHTS.map((h, i) => (
                <span
                  key={`obwave-${i}`}
                  className="lp-waveform__bar"
                  style={{
                    animationDelay: `${i * 105}ms`,
                    animationDuration: `${1.4 + (i % 5) * 0.17}s`,
                    height: `${h * 100}%`,
                  } as CSSProperties}
                />
              ))}
            </div>

            {/* Steps condensed in the panel */}
            <div className="space-y-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Quick path</p>
              {ONBOARDING_STEPS.map((step, i) => (
                <div key={step.num} className="flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
                  <span
                    className="ap-step-num text-[10px]"
                    style={{
                      height: '1.7rem',
                      width: '1.7rem',
                      color: step.color,
                      borderColor: `color-mix(in srgb, ${step.color} 40%, transparent)`,
                      background: `color-mix(in srgb, ${step.color} 12%, transparent)`,
                      animationDelay: `${i * 80}ms`,
                    } as CSSProperties}
                  >
                    {step.num}
                  </span>
                  <div>
                    <p className="text-xs font-semibold text-white">{step.title}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{step.body}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Note */}
            <div className="mt-4 rounded-xl border border-cyan-500/[0.18] bg-cyan-500/[0.07] px-4 py-3 text-xs leading-6 text-slate-300">
              You stay in control: sign up, sign in, or move on if your account is already ready.
            </div>

            <p className="mt-5 text-center text-[11px] text-slate-500">
              Studio opens right after account setup — no extra steps.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
