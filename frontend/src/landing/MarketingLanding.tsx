'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  AudioLines,
  Check,
  CirclePlay,
  Globe2,
  Mic2,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { BrandLogo } from '../../components/BrandLogo';
import { LANGUAGES } from '../../constants';
import { STORAGE_KEYS } from '../shared/storage/keys';
import { readStorageString, writeStorageString } from '../shared/storage/localStore';
import { applyBrandThemeToDocument, readUiBrandThemeFromStorage } from '../shared/theme/themeDom';
import { LegalLinks } from './LegalLinks';
import {
  LANDING_DEMOS,
  LANDING_LANGUAGE_CHIPS,
  LANDING_MULTI_DEMOS,
  LANDING_SINGLE_DEMOS,
  LANDING_SOCIAL_PROOF,
  LANDING_THEME_CONFIGS,
  LANDING_THEME_ORDER,
  LANDING_USE_CASES,
  type LandingDemoCard,
  type LandingThemeId,
} from './landingContent';
import { VERIFIED_MULTI_SPEAKER_PROOF } from './verifiedMultiSpeakerProof';

type DemoFilter = 'all' | 'single' | 'multi';

const appUrl = '/app';

const demosByFilter = (filter: DemoFilter): readonly LandingDemoCard[] => {
  if (filter === 'single') return LANDING_SINGLE_DEMOS;
  if (filter === 'multi') return LANDING_MULTI_DEMOS;
  return LANDING_DEMOS;
};

export const MarketingLanding: React.FC = () => {
  const [demoFilter, setDemoFilter] = useState<DemoFilter>('all');
  const [selectedLanguageCode, setSelectedLanguageCode] = useState(LANDING_LANGUAGE_CHIPS[0]?.code || 'en');
  const [themeId, setThemeId] = useState<LandingThemeId>(() => {
    if (typeof window === 'undefined') return 'neon';
    return readUiBrandThemeFromStorage(readStorageString(STORAGE_KEYS.uiBrandTheme));
  });
  const [activeDemoId, setActiveDemoId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setThemeId(readUiBrandThemeFromStorage(readStorageString(STORAGE_KEYS.uiBrandTheme)));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    writeStorageString(STORAGE_KEYS.uiBrandTheme, themeId);
    return applyBrandThemeToDocument(document, themeId);
  }, [themeId]);

  useEffect(() => {
    const reveal = Array.from(document.querySelectorAll<HTMLElement>('[data-landing-reveal]'));
    if (!reveal.length) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      reveal.forEach((node) => node.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.16, rootMargin: '0px 0px -8% 0px' },
    );
    reveal.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  const selectedLanguage = useMemo(
    () => LANDING_LANGUAGE_CHIPS.find((chip) => chip.code === selectedLanguageCode) || LANDING_LANGUAGE_CHIPS[0],
    [selectedLanguageCode],
  );

  const selectedPreview = useMemo(() => {
    const previewMap: Record<string, string> = {
      en: 'Launch-ready AI narration with premium emotional control.',
      'en-US': 'Studio-quality voiceovers for global product storytelling.',
      hi: 'Cinematic Hindi direction for stories, ads, and training content.',
      es: 'Multi-speaker Spanish dialogue with clear role handoffs.',
      fr: 'Premium French brand voice with consistent tonal control.',
      ar: 'Expressive Arabic delivery with scene-level pacing cues.',
    };
    return previewMap[selectedLanguageCode] || 'High-fidelity AI speech generation across global markets.';
  }, [selectedLanguageCode]);

  const visibleDemos = useMemo(() => demosByFilter(demoFilter), [demoFilter]);
  const theme = LANDING_THEME_CONFIGS[themeId];
  const demoCounts = useMemo(() => ({
    total: LANDING_DEMOS.length,
    single: LANDING_SINGLE_DEMOS.length,
    multi: LANDING_MULTI_DEMOS.length,
  }), []);

  return (
    <div
      className="vf-landing-shell relative min-h-screen overflow-x-hidden"
      data-landing-theme={themeId}
      data-vf-brand-theme={themeId}
      data-testid="landing-shell"
    >
      <div className="vf-landing-backdrop" aria-hidden="true" />
      <div className="vf-landing-orb vf-landing-orb-a" aria-hidden="true" />
      <div className="vf-landing-orb vf-landing-orb-b" aria-hidden="true" />
      <div className="vf-landing-grid" aria-hidden="true" />

      <header
        className="vf-landing-header fixed inset-x-0 top-0 z-40 border-b backdrop-blur-xl"
        data-testid="landing-header"
      >
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <BrandLogo size="md" tone="light" />
          <nav
            className="vf-landing-nav flex flex-wrap items-center gap-1 rounded-full border px-1.5 py-1"
            data-testid="landing-header-nav"
            aria-label="Landing sections"
          >
            <a href="#demos" className="vf-landing-nav-link">Demos</a>
            <a href="#ai-directors" className="vf-landing-nav-link">AI Directors</a>
            <a href="#languages" className="vf-landing-nav-link">Languages</a>
            <a href="/billing" className="vf-landing-nav-link" data-testid="landing-nav-pricing">View Pricing</a>
          </nav>
          <div className="flex items-center gap-2">
            <a
              href={appUrl}
              className="vf-landing-primary-cta inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold text-white shadow-lg"
            >
              Start Free in Studio <ArrowRight size={15} />
            </a>
          </div>
        </div>
      </header>

      <main className="relative z-10 pt-24 sm:pt-28">
        <section className="mx-auto w-full max-w-7xl px-4 pb-10 pt-8 sm:px-6 lg:px-8 lg:pb-14 lg:pt-12">
          <div className="grid gap-6 lg:grid-cols-[1.06fr_0.94fr] lg:items-end">
            <div data-landing-reveal className="vf-landing-reveal">
              <p className="vf-landing-kicker inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]">
                <Sparkles size={12} /> Cinematic Neon Landing
              </p>
              <h1 className="mt-5 max-w-4xl text-4xl font-black leading-[0.98] text-white sm:text-5xl lg:text-7xl" data-testid="landing-hero-heading">
                Voice experiences that feel directed, lit, and alive.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
                A premium AI voice studio with live motion, multi-theme atmosphere, and vector demos shaped for single-speaker precision and cast-driven storytelling.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <a href={appUrl} className="vf-landing-primary-cta inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold text-white">
                  Start Free in Studio <ArrowRight size={15} />
                </a>
                <a href="#demos" className="vf-landing-secondary-cta inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-slate-100">
                  Explore Demos <CirclePlay size={15} />
                </a>
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                {[
                  'Live theme switching',
                  'Clickable demo playback',
                  'Balanced motion system',
                ].map((signal) => (
                  <span key={signal} className="vf-landing-proof-chip inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs">
                    <Check size={13} /> {signal}
                  </span>
                ))}
              </div>
            </div>

            <div data-landing-reveal className="vf-landing-reveal vf-landing-reveal-delay vf-brand-card rounded-[2rem] border p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">Live Canvas</p>
                  <p className="mt-1 text-xl font-black text-white">VECTOR engine stage</p>
                </div>
                <span className="vf-landing-live-pill inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]">
                  <span className="vf-landing-live-dot" /> Play live
                </span>
              </div>
              <div className="mt-5 rounded-[1.6rem] border p-4">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>{theme.label} theme</span>
                  <span>{theme.description}</span>
                </div>
                <div className="mt-5 grid grid-cols-[repeat(16,minmax(0,1fr))] items-end gap-1.5">
                  {Array.from({ length: 16 }).map((_, index) => (
                    <span
                      key={`hero-wave-${index}`}
                      className="vf-landing-wave-bar rounded-full"
                      style={{ animationDelay: `${index * 100}ms` }}
                      aria-hidden="true"
                    />
                  ))}
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <article className="vf-landing-mini-card rounded-2xl border p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">Theme</p>
                  <p className="mt-1 text-sm font-bold text-white">{theme.label}</p>
                  <p className="mt-1 text-xs text-slate-300">Selected and persisted in local storage.</p>
                </article>
                <article className="vf-landing-mini-card rounded-2xl border p-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">Active demo</p>
                  <p className="mt-1 text-sm font-bold text-white">{activeDemoId || 'None yet'}</p>
                  <p className="mt-1 text-xs text-slate-300">Cards light up while audio is playing.</p>
                </article>
              </div>
            </div>
          </div>

          <div data-landing-reveal className="vf-landing-reveal mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="landing-social-proof">
            {LANDING_SOCIAL_PROOF.map((card) => (
              <article key={card.label} className="vf-landing-stat vf-brand-card rounded-3xl border p-5">
                <p className="text-xs uppercase tracking-[0.14em] text-slate-400">{card.label}</p>
                <p className="mt-2 text-2xl font-black text-white">{card.value}</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{card.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-4 pb-14 sm:px-6 lg:px-8" data-landing-reveal>
          <div className="vf-landing-reveal grid gap-4 rounded-[2rem] border p-4 sm:p-5 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Theme Switcher</p>
              <h2 className="mt-2 text-2xl font-black text-white sm:text-3xl">Live colorways that reshape the landing atmosphere.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300">
                Switch between neon, aurora, sunset, and emerald. The selected theme updates the background, glow, accents, and live stage palette immediately.
              </p>
            </div>
            <div
              className="vf-landing-theme-switcher vf-brand-card flex flex-wrap items-center gap-2 rounded-3xl border p-3"
              data-testid="landing-theme-switcher"
            >
              {LANDING_THEME_ORDER.map((id) => {
                const option = LANDING_THEME_CONFIGS[id];
                const active = id === themeId;
                return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setThemeId(id)}
                      className="vf-landing-theme-button vf-brand-chip inline-flex min-w-0 flex-1 items-center gap-3 rounded-2xl border px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.14em]"
                    data-testid={`landing-theme-${id}`}
                    aria-pressed={active}
                    data-active={active}
                  >
                    <span
                      className="vf-landing-theme-swatch vf-brand-swatch h-8 w-8 shrink-0 rounded-full"
                      style={{
                        background: `linear-gradient(135deg, ${option.accent} 0%, ${option.accent2} 55%, ${option.accent3} 100%)`,
                      }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-black normal-case tracking-normal text-white">{option.label}</span>
                      <span className="block truncate text-[11px] font-medium normal-case tracking-normal text-slate-300">{option.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section id="demos" className="mx-auto w-full max-w-7xl px-4 pb-14 sm:px-6 lg:px-8" data-landing-reveal data-testid="landing-demo-showcase">
          <div className="vf-landing-reveal mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Demo Showcase</p>
              <h2 className="mt-2 text-3xl font-black text-white sm:text-4xl">10 featured demos with live vector playback.</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-full border p-1 text-xs font-semibold">
                {(['all', 'single', 'multi'] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setDemoFilter(filter)}
                    className={`rounded-full px-3 py-1.5 ${demoFilter === filter ? 'bg-white/12 text-white' : 'text-slate-300 hover:text-white'}`}
                    aria-pressed={demoFilter === filter}
                  >
                    {filter === 'all' ? 'All 10' : filter === 'single' ? '5 Single' : '5 Multi'}
                  </button>
                ))}
              </div>
              <div className="vf-landing-count-pill rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200">
                {visibleDemos.length} visible / {demoCounts.total} total
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {visibleDemos.map((demo) => {
              const active = activeDemoId === demo.id;
              const cue = demo.emotionCue;
              return (
                <article
                  key={demo.id}
                  className="vf-landing-demo-card vf-brand-card rounded-[1.8rem] border p-5"
                  data-testid="landing-demo-card"
                  data-demo-kind={demo.kind}
                  data-demo-active={active}
                  onMouseEnter={() => setActiveDemoId(demo.id)}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.13em] ${demo.kind === 'single' ? 'bg-cyan-400/15 text-cyan-100' : 'bg-fuchsia-400/15 text-fuchsia-100'}`}>
                      {demo.kind === 'single' ? 'Single-Speaker' : 'Multi-Speaker'}
                    </span>
                    <span className="text-xs text-slate-400">Use Case: {demo.useCase}</span>
                  </div>
                  <h3 className="mt-3 text-lg font-bold text-white">{demo.title}</h3>
                  <p className="mt-2 text-xs text-slate-300">Language: {demo.language}</p>
                  <p className="mt-1 text-xs text-slate-300">Speaker Labels: {demo.speakerLabels.join(' | ')}</p>
                  <p className="mt-3 rounded-2xl border p-3 text-xs leading-relaxed text-slate-100">
                    {demo.sampleScript}
                  </p>
                  <p className="mt-3 text-xs text-slate-300">
                    <span className="font-semibold text-white">Cue:</span> {cue}
                  </p>
                  <p className="mt-2 text-xs text-slate-400">
                    <span className="font-semibold text-slate-200">Playback UI concept:</span> {demo.playbackConcept}
                  </p>
                  <p className="mt-2 text-xs text-slate-300">
                    <span className="font-semibold text-white">Performance direction:</span> {demo.performanceCue}
                  </p>
                  <div className="mt-4 rounded-2xl border p-3">
                    <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <AudioLines size={12} /> Audio Preview
                      </span>
                      <span className={active ? 'text-white' : ''}>{active ? 'Playing live' : 'Controls enabled'}</span>
                    </div>
                    <audio
                      controls
                      preload="none"
                      className="w-full"
                      src={demo.audioSrc}
                      onPlay={() => setActiveDemoId(demo.id)}
                      onPause={() => setActiveDemoId((current) => (current === demo.id ? null : current))}
                      onEnded={() => setActiveDemoId((current) => (current === demo.id ? null : current))}
                    >
                      Your browser does not support the audio element.
                    </audio>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section id="ai-directors" className="mx-auto w-full max-w-7xl px-4 pb-14 sm:px-6 lg:px-8" data-landing-reveal data-testid="landing-ai-directors">
          <div className="vf-landing-reveal rounded-[2rem] border p-6 sm:p-8">
            <p className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-100">
              <WandSparkles size={13} /> AI Directors
            </p>
            <h2 className="mt-3 text-3xl font-black text-white sm:text-4xl">Premium control over intent, emotion, pacing, and performance direction.</h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-200">
              AI Directors shapes the scene before generation, keeping the creative pass guided, editable, and production-ready.
            </p>
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              {[
                'Prompt with intent, pacing, and emotional outcomes.',
                'Review directed script changes before generation runs.',
                'Apply approved changes and generate with cast + language control.',
              ].map((step, index) => (
                <article key={step} className="vf-brand-card rounded-2xl border bg-black/15 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200">Step {index + 1}</p>
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">{step}</p>
                </article>
              ))}
            </div>
            <div className="mt-6 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="vf-brand-card rounded-2xl border bg-black/15 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">Directed Cast Preview</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-200">
                  {VERIFIED_MULTI_SPEAKER_PROOF.lines.slice(0, 3).map((line) => (
                    <li key={`${line.lineIndex}-${line.speaker}`} className="rounded-xl border bg-white/5 p-2.5">
                      <span className="font-semibold text-cyan-100">{line.speaker}:</span> {line.text}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="vf-brand-card rounded-2xl border bg-black/15 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">AI Director Audio Proof</p>
                <audio controls preload="none" className="mt-3 w-full" src={VERIFIED_MULTI_SPEAKER_PROOF.audioSrc}>
                  Your browser does not support the audio element.
                </audio>
                <p className="mt-3 text-xs text-slate-300">Market: {VERIFIED_MULTI_SPEAKER_PROOF.market}</p>
                <p className="mt-1 text-xs text-slate-400">Language: {VERIFIED_MULTI_SPEAKER_PROOF.language}</p>
              </div>
            </div>
          </div>
        </section>

        <section id="languages" className="mx-auto w-full max-w-7xl px-4 pb-14 sm:px-6 lg:px-8" data-landing-reveal data-testid="landing-languages">
          <div className="vf-landing-reveal grid gap-5 lg:grid-cols-[1.02fr_0.98fr]">
            <div className="vf-brand-card rounded-[1.8rem] border p-6">
              <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">
                <Globe2 size={14} /> Global Reach
              </p>
              <h2 className="mt-3 text-3xl font-black text-white sm:text-4xl">Scale voice releases across 70+ languages.</h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">
                Market-facing messaging is 70+ languages, with <span className="font-semibold text-cyan-100">83 configured languages</span> in the current runtime catalog.
              </p>
              <p className="mt-4 rounded-2xl border p-3 text-sm text-slate-200">{selectedPreview}</p>
              <p className="mt-3 text-xs text-slate-400">
                Selected: <span className="font-semibold text-slate-200">{selectedLanguage?.name}</span> ({selectedLanguage?.code})
              </p>
            </div>
            <div className="vf-brand-card rounded-[1.8rem] border p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">Language Grid</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {LANDING_LANGUAGE_CHIPS.map((chip) => {
                  const active = chip.code === selectedLanguageCode;
                  return (
                    <button
                      key={chip.code}
                      type="button"
                      onClick={() => setSelectedLanguageCode(chip.code)}
                      className="rounded-full border px-3 py-1.5 text-xs font-semibold"
                      dir={chip.rtl ? 'rtl' : 'ltr'}
                      aria-pressed={active}
                      data-active={active}
                    >
                      {chip.name}
                    </button>
                  );
                })}
              </div>
              <p className="mt-4 text-xs text-slate-400">Catalog breadth: {LANGUAGES.length} configured options with RTL support in selected languages.</p>
            </div>
          </div>
        </section>

        <section id="use-cases" className="mx-auto w-full max-w-7xl px-4 pb-14 sm:px-6 lg:px-8" data-landing-reveal data-testid="landing-use-cases">
          <div className="vf-landing-reveal mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Use Cases</p>
            <h2 className="mt-2 text-3xl font-black text-white sm:text-4xl">From creators to enterprise media teams.</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {LANDING_USE_CASES.map((useCase) => (
              <article key={useCase.title} className="vf-landing-use-case rounded-[1.8rem] border p-5">
                <h3 className="text-lg font-bold text-white">{useCase.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{useCase.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="seo-content" className="mx-auto w-full max-w-7xl px-4 pb-14 sm:px-6 lg:px-8" data-landing-reveal data-testid="landing-seo-content">
          <div className="vf-landing-reveal rounded-[2rem] border p-6 sm:p-8">
            <h2 className="text-3xl font-black text-white sm:text-4xl">Why teams choose this AI text to speech platform.</h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-300">
              V FLOW AI is an expressive AI text to speech platform for studio-quality voice generation, emotional AI voice control, multilingual TTS, and multi-speaker TTS workflows.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              Use it as an AI voice generator for ads, storytelling, training, support, and media production with single-speaker precision and cast-aware scene direction.
            </p>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <article className="vf-brand-card rounded-2xl border bg-black/15 p-4">
                <h3 className="text-lg font-bold text-white">SEO-focused FAQ</h3>
                <details className="mt-3 rounded-xl border bg-white/5 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-100">What is expressive text to speech?</summary>
                  <p className="mt-2 text-xs leading-relaxed text-slate-300">
                    Expressive text to speech applies emotional cues, pacing control, and style direction so generated audio feels natural and production-ready.
                  </p>
                </details>
                <details className="mt-2 rounded-xl border bg-white/5 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-100">Can I build multi-speaker scenes?</summary>
                  <p className="mt-2 text-xs leading-relaxed text-slate-300">
                    Yes. The platform supports cast-aware multi-speaker generation with role mapping and clear handoffs.
                  </p>
                </details>
              </article>
              <article className="vf-brand-card rounded-2xl border bg-black/15 p-4">
                <h3 className="text-lg font-bold text-white">Internal Links</h3>
                <ul className="mt-3 space-y-2 text-sm text-slate-300">
                  <li><a href="/app" className="text-cyan-200 hover:text-cyan-100">Open the AI voice studio</a></li>
                  <li><a href="/legal" className="text-cyan-200 hover:text-cyan-100">Read legal and policy pages</a></li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section id="cta" className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6 lg:px-8" data-landing-reveal data-testid="landing-cta">
          <div className="vf-landing-reveal rounded-[2rem] border p-7 text-center shadow-[0_22px_70px_rgba(8,47,73,0.38)] sm:p-10">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-100">Launch Ready</p>
            <h2 className="mt-3 text-3xl font-black text-white sm:text-5xl">Build your next voice release in minutes.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-slate-200">
              Generate studio-quality AI speech, direct emotional performance with AI Directors, and ship single or multi-speaker content globally.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <a href={appUrl} className="vf-landing-primary-cta inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold text-white">
                Start Free in Studio <ArrowRight size={15} />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/10 bg-black/20">
        <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[1.3fr_0.7fr] lg:px-8">
          <div>
            <BrandLogo size="md" tone="light" />
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-400">
              Premium AI voice platform for expressive text to speech, single-speaker narration, multi-speaker production, and multilingual release workflows.
            </p>
            <p className="mt-4 text-xs text-slate-500">Copyright {new Date().getFullYear()} V FLOW AI. All rights reserved.</p>
          </div>
          <div className="grid gap-3 text-sm text-slate-300">
            <a href="/app" className="inline-flex items-center gap-2 hover:text-cyan-100">
              <Mic2 size={14} /> Product Studio
            </a>
            <a href="#demos" className="inline-flex items-center gap-2 hover:text-cyan-100">
              <AudioLines size={14} /> Voice Demos
            </a>
            <a href="#languages" className="inline-flex items-center gap-2 hover:text-cyan-100">
              <Globe2 size={14} /> Language Coverage
            </a>
            <LegalLinks />
          </div>
        </div>
      </footer>
    </div>
  );
};
