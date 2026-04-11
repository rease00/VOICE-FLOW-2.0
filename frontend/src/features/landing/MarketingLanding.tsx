import type { CSSProperties } from 'react';
import {
  ArrowRight,
  AudioLines,
  BookOpen,
  Mic2,
  Sparkles,
  WandSparkles,
  Zap,
  Globe,
  Shield,
  Layers,
  Play,
} from 'lucide-react';
import { BrandLogo } from '../../../components/BrandLogo';
import { DeepfakeFooterTool } from './components/DeepfakeFooterTool';
import { APP_ROUTE_PATHS, resolveLoginPath } from '../../app/navigation';
import { UI_BRAND_THEME_CONFIGS } from '../../shared/theme/brandThemes';
import { LegalLinks } from '../legal/LegalLinks';
import { MarketingAudioCard } from './MarketingAudioCard';
import {
  LANDING_DIRECTOR_PROOF,
  LANDING_MULTI_SPEAKER_DEMOS,
  LANDING_WRITING_PROOF,
  LANDING_SINGLE_SPEAKER_DEMOS,
  LANDING_VOICE_CLONE_PROOF,
} from './landingData';

const signupHref = resolveLoginPath('signup', APP_ROUTE_PATHS.studio);
const billingHref = '/billing';
const studioHref = APP_ROUTE_PATHS.studio;
const featuredPrimeScene = LANDING_MULTI_SPEAKER_DEMOS[0];

const motionDelayStyle = (delayMs: number): CSSProperties => ({
  '--vf-marketing-delay': `${delayMs}ms`,
} as CSSProperties);

export const LANDING_TAB_KEYS = [
  'home',
  'single-voice',
  'prime-scenes',
  'clone-proof',
  'direction',
  'writing',
] as const;

export type LandingTabKey = (typeof LANDING_TAB_KEYS)[number];

const navLinks = [
  { key: 'home', label: 'Home', href: '/landing' },
  { key: 'single-voice', label: 'Voice', href: '/landing/single-voice' },
  { key: 'prime-scenes', label: 'Prime', href: '/landing/prime-scenes' },
  { key: 'clone-proof', label: 'Clone', href: '/landing/clone-proof' },
  { key: 'direction', label: 'Direct', href: '/landing/direction' },
  { key: 'writing', label: 'Writing', href: '/landing/writing' },
] as const;

const marqueeChips = [
  { label: 'Prime', icon: <WandSparkles size={11} />, color: 'rgba(139,92,246,0.7)' },
  { label: 'Clone', icon: <Mic2 size={11} />, color: 'rgba(6,182,212,0.7)' },
  { label: 'Direct', icon: <Sparkles size={11} />, color: 'rgba(244,63,94,0.7)' },
  { label: 'Writing', icon: <BookOpen size={11} />, color: 'rgba(250,204,21,0.7)' },
  { label: 'Live', icon: <AudioLines size={11} />, color: 'rgba(34,197,94,0.7)' },
  { label: 'Global', icon: <Globe size={11} />, color: 'rgba(6,182,212,0.7)' },
  { label: 'Fast', icon: <Zap size={11} />, color: 'rgba(139,92,246,0.7)' },
  { label: 'Ready', icon: <Shield size={11} />, color: 'rgba(250,204,21,0.7)' },
] as const;

const WAVE_BAR_SCALES = [0.4, 0.75, 0.55, 0.9, 0.65, 0.82, 0.48, 0.7, 0.58, 0.88, 0.44, 0.72, 0.62, 0.94, 0.5, 0.78] as const;

const HERO_STAGE_SCALES = [0.5, 0.86, 0.62, 0.94, 0.7, 0.88] as const;
const HERO_STAGE_ROWS = [
  { label: 'Flow', value: 'Prime / clone / writing' },
  { label: 'Motion', value: 'Soft reveals' },
  { label: 'Status', value: 'Demo-first' },
] as const;
const HERO_PROOF_PILLS = ['Fast', 'Clean', 'Ready'] as const;

const featureCards = [
  {
    key: 'prime',
    icon: <WandSparkles size={20} />,
    iconBg: 'linear-gradient(135deg, rgba(139,92,246,0.35), rgba(109,40,217,0.2))',
    iconBorder: 'rgba(139,92,246,0.3)',
    iconColor: 'rgb(167,139,250)',
    label: 'Prime',
    href: '/landing/prime-scenes',
    detail: `${LANDING_MULTI_SPEAKER_DEMOS.length} scenes`,
    body: 'Multi-voice proof in one pass.',
  },
  {
    key: 'voice',
    icon: <Mic2 size={20} />,
    iconBg: 'linear-gradient(135deg, rgba(6,182,212,0.35), rgba(8,145,178,0.2))',
    iconBorder: 'rgba(6,182,212,0.3)',
    iconColor: 'rgb(103,232,249)',
    label: 'Voice',
    href: '/landing/single-voice',
    detail: `${LANDING_SINGLE_SPEAKER_DEMOS.length} reads`,
    body: 'Five clean single-voice cuts.',
  },
  {
    key: 'clone',
    icon: <Layers size={20} />,
    iconBg: 'linear-gradient(135deg, rgba(244,63,94,0.35), rgba(190,18,60,0.2))',
    iconBorder: 'rgba(244,63,94,0.3)',
    iconColor: 'rgb(251,113,133)',
    label: 'Clone',
    href: '/landing/clone-proof',
    detail: 'Compare',
    body: 'Source and render side by side.',
  },
  {
    key: 'direction',
    icon: <AudioLines size={20} />,
    iconBg: 'linear-gradient(135deg, rgba(250,204,21,0.3), rgba(217,119,6,0.2))',
    iconBorder: 'rgba(250,204,21,0.28)',
    iconColor: 'rgb(250,204,21)',
    label: 'Direct',
    href: '/landing/direction',
    detail: 'Prompted',
    body: 'Tighten pace before render.',
  },
  {
    key: 'writing',
    icon: <BookOpen size={20} />,
    iconBg: 'linear-gradient(135deg, rgba(34,197,94,0.3), rgba(21,128,61,0.2))',
    iconBorder: 'rgba(34,197,94,0.28)',
    iconColor: 'rgb(74,222,128)',
    label: 'Writing',
    href: '/landing/writing',
    detail: 'Review',
    body: 'Listen back before ship.',
  },
] as const;

const landingBrandTheme = UI_BRAND_THEME_CONFIGS.aurora;
const landingThemeStyle = {
  '--vf-brand-accent-primary': landingBrandTheme.accent,
  '--vf-brand-accent-secondary': landingBrandTheme.accent2,
  '--vf-brand-accent-tertiary': landingBrandTheme.accent3,
  '--vf-brand-glow': landingBrandTheme.modes.dark.glow,
  '--vf-brand-backdrop': landingBrandTheme.modes.dark.backdrop,
  '--vf-brand-surface': landingBrandTheme.modes.dark.surface,
  '--vf-brand-surface-strong': landingBrandTheme.modes.dark.surfaceStrong,
  '--vf-accent-primary': landingBrandTheme.accent,
  '--vf-accent-secondary': landingBrandTheme.accent2,
  '--vf-accent-tertiary': landingBrandTheme.accent3,
  '--vf-accent-primary-soft': `color-mix(in srgb, ${landingBrandTheme.accent} 22%, transparent)`,
  '--vf-accent-secondary-soft': `color-mix(in srgb, ${landingBrandTheme.accent2} 20%, transparent)`,
  '--vf-accent-tertiary-soft': `color-mix(in srgb, ${landingBrandTheme.accent3} 20%, transparent)`,
} as CSSProperties;

interface MarketingLandingProps {
  activeTab?: LandingTabKey;
}

const isLandingTab = (value?: string): value is LandingTabKey =>
  LANDING_TAB_KEYS.includes(value as LandingTabKey);

export function MarketingLanding({ activeTab = 'home' }: MarketingLandingProps) {
  const resolvedTab = isLandingTab(activeTab) ? activeTab : 'home';
  const showHomeHero = resolvedTab === 'home';

  return (
    <div
      className="vf-marketing-shell lp-v2-shell vf-theme-dark relative isolate min-h-screen overflow-x-hidden text-slate-100"
      data-testid="marketing-landing"
      data-vf-brand-theme="aurora"
      style={landingThemeStyle}
    >
      <a className="vf-marketing-skip-link" href="#main-content">
        Skip to main content
      </a>

      {/* Background layers */}
      <div className="vf-marketing-grid" aria-hidden="true" />
      <div className="lp-aurora lp-aurora--a" aria-hidden="true" />
      <div className="lp-aurora lp-aurora--b" aria-hidden="true" />
      <div className="lp-aurora lp-aurora--c" aria-hidden="true" />

      {/* Ã¢â€â‚¬Ã¢â€â‚¬ HEADER Ã¢â€â‚¬Ã¢â€â‚¬ */}
      <header className="vf-marketing-header">
        <div className="vf-marketing-header__inner" data-vf-reveal style={motionDelayStyle(0)}>
          <a href="/" className="vf-marketing-header__brand">
            <BrandLogo size="sm" tone="light" />
          </a>

          {/* Desktop nav pills */}
          <nav className="hidden md:flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1 backdrop-blur-md" aria-label="Main navigation">
            {navLinks.slice(1).map((link) => (
              <a
                key={link.key}
                href={link.href}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-all duration-200 ${
                  resolvedTab === link.key
                    ? 'bg-white/10 text-white shadow-sm'
                    : 'text-slate-400 hover:bg-white/[0.06] hover:text-white'
                }`}
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2.5">
            <a href={billingHref} className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-300 transition-all hover:bg-white/[0.08] hover:text-white">
              Pricing
            </a>
            <a href={signupHref} className="lp-cta-primary text-sm !py-2 !px-5" data-testid="hero-primary-cta">
              Start free
              <ArrowRight size={15} />
            </a>
          </div>
        </div>
      </header>

      {/* Ã¢â€â‚¬Ã¢â€â‚¬ MARQUEE STRIP Ã¢â€â‚¬Ã¢â€â‚¬ */}
      <div className="border-y border-white/[0.06] bg-white/[0.02] py-2.5 overflow-hidden" aria-hidden="true">
        <div className="lp-marquee-track">
          <div className="lp-marquee-inner">
            {[...marqueeChips, ...marqueeChips].map((chip, i) => (
              <span
                key={`chip-${i}`}
                className="lp-marquee-chip"
                style={{ color: chip.color, borderColor: `color-mix(in srgb, ${chip.color} 40%, transparent)` } as CSSProperties}
              >
                {chip.icon}
                {chip.label}
              </span>
            ))}
          </div>
          <div className="lp-marquee-inner" aria-hidden="true">
            {[...marqueeChips, ...marqueeChips].map((chip, i) => (
              <span
                key={`chip2-${i}`}
                className="lp-marquee-chip"
                style={{ color: chip.color, borderColor: `color-mix(in srgb, ${chip.color} 40%, transparent)` } as CSSProperties}
              >
                {chip.icon}
                {chip.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Ã¢â€â‚¬Ã¢â€â‚¬ MAIN Ã¢â€â‚¬Ã¢â€â‚¬ */}
      <main id="main-content">

        {/* Ã¢â€â‚¬Ã¢â€â‚¬ HERO Ã¢â€â‚¬Ã¢â€â‚¬ */}
        {showHomeHero && (
          <section
            id="landing-home"
            className="relative px-4 py-20 md:py-28 lg:py-36"
            data-testid="landing-home"
          >
            <div className="mx-auto max-w-5xl" data-testid="landing-home-hero">
              {/* Kicker row */}
              <div className="flex flex-wrap items-center justify-center gap-3 mb-8" data-vf-reveal style={motionDelayStyle(100)}>
                <span className="lp-live-badge">
                  <span className="lp-live-dot" />
                  Live Studio
                </span>
                <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold uppercase tracking-widest text-slate-400">
                  <Sparkles size={11} className="text-violet-400" />
                  Premium voice studio
                </span>
              </div>

              {/* Headline */}
              <h1
                aria-label="Make voice work feel premium."
                className="lp-headline-gradient text-center text-4xl font-black tracking-tight sm:text-5xl md:text-6xl lg:text-7xl leading-[1.04] mb-6"
                data-vf-reveal
                style={motionDelayStyle(180)}
              >
                Make voice work<br className="hidden sm:block" /> feel{' '}
                <span className="italic">premium.</span>
              </h1>

              {/* Sub-headline */}
                            <p
                className="mx-auto max-w-2xl text-center text-lg text-slate-400 leading-relaxed mb-10"
                data-vf-reveal
                style={motionDelayStyle(260)}
              >
                Single voice. Prime scenes. Clone proof. One clean flow.
              </p>

              {/* CTA row */}
              <div className="flex flex-wrap items-center justify-center gap-3 mb-14" data-vf-reveal style={motionDelayStyle(340)}>
                <a href={studioHref} className="lp-cta-primary">
                  <Play size={16} fill="currentColor" />
                  Open studio
                </a>
                <a href="/landing/prime-scenes" className="lp-cta-secondary">
                  Hear Prime scenes
                  <ArrowRight size={15} />
                </a>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2.5 mb-14" data-vf-reveal style={motionDelayStyle(390)}>
                {HERO_PROOF_PILLS.map((pill) => (
                  <span key={pill} className="vf-marketing-proof-pill">
                    {pill}
                  </span>
                ))}
              </div>

              {/* Animated waveform */}
              <div className="flex justify-center mb-14" data-vf-reveal style={motionDelayStyle(400)}>
                <div className="lp-waveform" aria-hidden="true">
                  {WAVE_BAR_SCALES.map((scale, i) => (
                    <span
                      key={`wave-${i}`}
                      className="lp-waveform__bar"
                      style={{
                        animationDelay: `${i * 110}ms`,
                        animationDuration: `${1.4 + (i % 5) * 0.18}s`,
                        height: `${scale * 100}%`,
                      } as CSSProperties}
                    />
                  ))}
                </div>
              </div>

              {/* Hero audio card preview */}
              {featuredPrimeScene && (
                <div
                  className="mx-auto max-w-2xl lp-stage-scan relative rounded-2xl border border-white/10 bg-white/[0.035] p-6 backdrop-blur-sm overflow-hidden"
                  data-vf-reveal
                  style={motionDelayStyle(460)}
                >
                  {/* Ambient inner glow */}
                  <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-cyan-500/[0.06] via-violet-500/[0.04] to-transparent" aria-hidden="true" />

                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-4">
                      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-slate-500">
                        <Sparkles size={11} className="text-violet-400" />
                        Prime scene
                      </span>
                      <span className="lp-live-badge text-[10px]">
                        <span className="lp-live-dot" style={{ height: '5px', width: '5px' }} />
                        Live
                      </span>
                    </div>

                    <MarketingAudioCard
                      variant="hero"
                      eyebrow={`${featuredPrimeScene.useCase} / ${featuredPrimeScene.market}`}
                      title={featuredPrimeScene.title}
                      summary={featuredPrimeScene.summary}
                      audioSrc={featuredPrimeScene.audioSrc}
                      ariaLabel={`${featuredPrimeScene.title} preview`}
                      badges={[
                        { label: 'Prime', tone: 'accent' },
                        { label: 'Scene', tone: 'neutral' },
                      ]}
                      cast={featuredPrimeScene.cast}
                      note="Tap to hear the scene."
                    />
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        <hr className="lp-divider" />

        {/* Ã¢â€â‚¬Ã¢â€â‚¬ TAB NAV (mobile) Ã¢â€â‚¬Ã¢â€â‚¬ */}
        <div className="vf-marketing-subtab-row md:hidden" aria-label="Section navigation" data-vf-reveal style={motionDelayStyle(90)}>
          <div className="vf-marketing-subtab-row__inner">
            {navLinks.map((link) => (
              <a
                key={`subtab-${link.href}`}
                href={link.href}
                className={`vf-marketing-subtab-link${resolvedTab === link.key ? ' is-active' : ''}`}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>

        {/* Ã¢â€â‚¬Ã¢â€â‚¬ FEATURE GRID (home only) Ã¢â€â‚¬Ã¢â€â‚¬ */}
        {showHomeHero && (
          <section className="px-4 py-20 md:py-28" data-vf-reveal style={motionDelayStyle(120)}>
            <div className="mx-auto max-w-6xl">
              <div className="mb-12 text-center">
                <p className="mb-3 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-widest text-violet-400">
                  <Layers size={13} />
                  Studio lanes
                </p>
                <h2 className="text-3xl font-black text-white md:text-4xl">
                  Five lanes. One studio.
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-slate-400 text-base leading-relaxed">
                  Pick the proof you need and open it in one tap.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {featureCards.map((card, i) => (
                  <a
                    key={card.key}
                    href={card.href}
                    className="lp-card group block p-6 no-underline"
                    data-vf-reveal
                    style={motionDelayStyle(200 + i * 70)}
                  >
                    <div
                      className="lp-card__icon mb-4"
                      style={{
                        background: card.iconBg,
                        border: `1px solid ${card.iconBorder}`,
                        color: card.iconColor,
                      }}
                    >
                      {card.icon}
                    </div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="text-base font-bold text-white">{card.label}</h3>
                      <span className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        {card.detail}
                      </span>
                    </div>
                    <p className="text-sm text-slate-400 leading-relaxed">{card.body}</p>
                    <div className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-slate-500 transition-colors group-hover:text-violet-400">
                      Open
                      <ArrowRight size={12} />
                    </div>
                  </a>
                ))}

                {/* Stats card */}
                <div
                  className="lp-card p-6 flex flex-col justify-between sm:col-span-2 lg:col-span-1"
                  data-vf-reveal
                  style={motionDelayStyle(550)}
                >
                  <p className="mb-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
                    <Sparkles size={11} className="text-cyan-400" />
                    Studio snapshot
                  </p>
                    <div className="vf-marketing-stat-grid--five-up grid grid-cols-2 gap-4">
                      {[
                      { v: LANDING_MULTI_SPEAKER_DEMOS.length, l: 'Prime' },
                      { v: LANDING_SINGLE_SPEAKER_DEMOS.length, l: 'Reads' },
                      { v: '5', l: 'Languages' },
                      { v: '1', l: 'Flow' },
                      ].map((s) => (
                      <div key={s.l} className="lp-stat-card vf-marketing-stat">
                        <p className="vf-marketing-stat__value text-2xl font-black text-white tabular-nums">{s.v}</p>
                        <p className="vf-marketing-stat__detail mt-1 text-xs text-slate-500">{s.l}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        <hr className="lp-divider" />

        {/* Ã¢â€â‚¬Ã¢â€â‚¬ TABBED CONTENT SECTIONS Ã¢â€â‚¬Ã¢â€â‚¬ */}
        <section className="vf-marketing-tab-page">
          <div className="vf-marketing-tab-page__inner">
            <div className="vf-marketing-scroll-box" data-active-tab={resolvedTab} aria-label="Tab content">

              {/* Ã¢â€â‚¬Ã¢â€â‚¬ Voice Ã¢â€â‚¬Ã¢â€â‚¬ */}
              <section
                id="single-speaker"
                data-tab-key="single-voice"
                data-testid="landing-single-speaker"
                className="vf-marketing-section vf-marketing-section--panel"
                data-vf-reveal
                style={motionDelayStyle(showHomeHero ? 0 : 120)}
              >
                <div className="vf-marketing-section__intro" data-vf-reveal style={motionDelayStyle(showHomeHero ? 0 : 160)}>
                  <p className="vf-marketing-section__eyebrow">
                    <Mic2 size={13} />
                    Single voice
                  </p>
                  <h2 className="vf-marketing-section__title">Five clean reads.</h2>
                  <p className="vf-marketing-section__body">
                    Five markets, one clean read each.
                  </p>
                </div>

                <div className="vf-marketing-audio-grid vf-marketing-audio-grid--five-up">
                  {LANDING_SINGLE_SPEAKER_DEMOS.map((demo, index) => (
                    <MarketingAudioCard
                      key={demo.id}
                      eyebrow={`${demo.language} / ${demo.market}`}
                      title={demo.title}
                      summary={demo.summary}
                      audioSrc={demo.audioSrc}
                      ariaLabel={`${demo.title} preview`}
                      motionDelayMs={260 + index * 90}
                      badges={[
                        { label: 'Voice', tone: 'neutral' },
                        { label: demo.language, tone: 'warm' },
                      ]}
                      note={demo.cue}
                    />
                  ))}
                </div>
              </section>

              {/* Ã¢â€â‚¬Ã¢â€â‚¬ PRIME SCENES Ã¢â€â‚¬Ã¢â€â‚¬ */}
              <section
                id="multi-speaker"
                data-tab-key="prime-scenes"
                data-testid="landing-multi-speaker"
                className="vf-marketing-section vf-marketing-section--panel"
                data-vf-reveal
                style={motionDelayStyle(showHomeHero ? 0 : 200)}
              >
                <div className="vf-marketing-section__intro" data-vf-reveal style={motionDelayStyle(240)}>
                  <p className="vf-marketing-section__eyebrow">
                    <WandSparkles size={13} />
                    Prime scenes
                  </p>
                  <h2 className="vf-marketing-section__title">Five scenes. One pass.</h2>
                  <p className="vf-marketing-section__body">
                    Fast compare mode for multi-voice scenes.
                  </p>
                </div>

                <div className="vf-marketing-scene-grid vf-marketing-scene-grid--five-up">
                  {LANDING_MULTI_SPEAKER_DEMOS.map((demo, index) => (
                    <MarketingAudioCard
                      key={demo.id}
                      variant="scene"
                      eyebrow={`${demo.scene} / ${demo.market}`}
                      title={demo.title}
                      summary={demo.summary}
                      audioSrc={demo.audioSrc}
                      ariaLabel={`${demo.title} preview`}
                      motionDelayMs={300 + index * 90}
                      badges={[
                        { label: 'Prime', tone: 'accent' },
                        { label: `${demo.cast.length} voices`, tone: 'neutral' },
                      ]}
                      note={demo.cue}
                    />
                  ))}
                </div>
              </section>

              {/* Ã¢â€â‚¬Ã¢â€â‚¬ VOICE CLONE Ã¢â€â‚¬Ã¢â€â‚¬ */}
              <section
                id="voice-cloning"
                data-tab-key="clone-proof"
                data-testid="landing-voice-cloning"
                className="vf-marketing-section vf-marketing-section--panel"
                data-vf-reveal
                style={motionDelayStyle(showHomeHero ? 0 : 200)}
              >
                <div className="vf-marketing-section__intro" data-vf-reveal style={motionDelayStyle(240)}>
                  <p className="vf-marketing-section__eyebrow">
                    <Sparkles size={13} />
                    Clone proof
                  </p>
                  <p className="vf-marketing-block__label">Clone compare</p>
                  <h2 className="vf-marketing-section__title">Reference and render.</h2>
                  <p className="vf-marketing-section__body">{LANDING_VOICE_CLONE_PROOF.summary}</p>
                </div>

                <div className="vf-marketing-feature-panel vf-marketing-feature-panel--clone">
                  <MarketingAudioCard
                    eyebrow="Reference source"
                    title={LANDING_VOICE_CLONE_PROOF.source.label}
                    summary="Original source used to guide the clone."
                    audioSrc={LANDING_VOICE_CLONE_PROOF.source.audioSrc}
                    ariaLabel={`${LANDING_VOICE_CLONE_PROOF.source.label} preview`}
                    motionDelayMs={360}
                    badges={[{ label: 'Clone', tone: 'neutral' }]}
                    note={LANDING_VOICE_CLONE_PROOF.source.name}
                  />
                  <MarketingAudioCard
                    eyebrow="Rendered output"
                    title={LANDING_VOICE_CLONE_PROOF.rendered.label}
                    summary="Rendered clone kept beside the source for fast approval."
                    audioSrc={LANDING_VOICE_CLONE_PROOF.rendered.audioSrc}
                    ariaLabel={`${LANDING_VOICE_CLONE_PROOF.rendered.label} preview`}
                    motionDelayMs={450}
                    badges={[{ label: 'Clone render', tone: 'accent' }]}
                    note={LANDING_VOICE_CLONE_PROOF.rendered.name}
                  />
                </div>
                <p className="mt-4 text-xs leading-6 text-slate-400">
                  Voice cloning still requires consent and rights clearance. The footer authenticity check confirms Voice-Flow watermark presence on supported WAV exports only, and it does not identify a speaker or prove ownership.
                </p>
              </section>

              {/* Ã¢â€â‚¬Ã¢â€â‚¬ AI DIRECTOR Ã¢â€â‚¬Ã¢â€â‚¬ */}
              <section
                id="ai-director"
                data-tab-key="direction"
                data-testid="landing-ai-director"
                className="vf-marketing-section vf-marketing-section--panel"
                data-vf-reveal
                style={motionDelayStyle(showHomeHero ? 0 : 200)}
              >
                <div className="vf-marketing-section__intro" data-vf-reveal style={motionDelayStyle(240)}>
                  <p className="vf-marketing-section__eyebrow">
                    <AudioLines size={13} />
                    AI Director
                  </p>
                  <h2 className="vf-marketing-section__title">Shape the take.</h2>
                  <p className="vf-marketing-section__body">{LANDING_DIRECTOR_PROOF.summary}</p>
                </div>

                <div className="vf-marketing-feature-panel vf-marketing-feature-panel--director">
                  <div className="vf-marketing-feature-panel__block" data-vf-reveal style={motionDelayStyle(340)}>
                    <p className="vf-marketing-block__label">Prompt contract</p>
                    <pre className="vf-marketing-prompt" data-testid="landing-ai-director-prompt">
                      {LANDING_DIRECTOR_PROOF.prompt}
                    </pre>
                  </div>

                  <div className="vf-marketing-feature-panel__block" data-vf-reveal style={motionDelayStyle(420)}>
                    <div className="vf-marketing-before-after">
                      <div className="vf-marketing-before-after__item">
                        <p className="vf-marketing-block__label">Before</p>
                        <p>{LANDING_DIRECTOR_PROOF.before}</p>
                      </div>
                      <div className="vf-marketing-before-after__item vf-marketing-before-after__item--accent">
                        <p className="vf-marketing-block__label">After</p>
                        <p>{LANDING_DIRECTOR_PROOF.after}</p>
                      </div>
                    </div>

                    <div className="vf-marketing-director-bullets">
                      {LANDING_DIRECTOR_PROOF.bullets.map((bullet, index) => (
                        <div
                          key={bullet.label}
                          className="vf-marketing-director-bullet"
                          data-vf-reveal
                          style={motionDelayStyle(500 + index * 70)}
                        >
                          <p className="vf-marketing-block__label">{bullet.label}</p>
                          <p>{bullet.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              {/* Ã¢â€â‚¬Ã¢â€â‚¬ READER Ã¢â€â‚¬Ã¢â€â‚¬ */}
              <section
                id="writing-playback"
                data-tab-key="writing"
                data-testid="landing-writing-playback"
                className="vf-marketing-section vf-marketing-section--panel"
                data-vf-reveal
                style={motionDelayStyle(showHomeHero ? 0 : 200)}
              >
                <div className="vf-marketing-section__intro" data-vf-reveal style={motionDelayStyle(240)}>
                  <p className="vf-marketing-section__eyebrow">
                    <BookOpen size={13} />
                    Writing
                  </p>
                  <h2 className="vf-marketing-section__title">Review by ear.</h2>
                  <p className="vf-marketing-section__body">{LANDING_WRITING_PROOF.summary}</p>
                </div>

                <div className="vf-marketing-reader-deck">
                  <aside className="vf-marketing-reader-deck__rail" data-vf-reveal style={motionDelayStyle(360)}>
                    <div className="vf-marketing-reader-deck__head">
                      <div>
                        <p className="vf-marketing-block__label">{LANDING_WRITING_PROOF.modeLabel}</p>
                        <h3>{LANDING_WRITING_PROOF.title}</h3>
                      </div>
                      <span className="vf-marketing-reader-deck__status">{LANDING_WRITING_PROOF.progressLabel}</span>
                    </div>

                    <div className="vf-marketing-reader-deck__list">
                      {LANDING_WRITING_PROOF.units.map((unit, index) => (
                        <div
                          key={unit.id}
                          className="vf-marketing-reader-deck__item"
                          data-vf-reveal
                          style={motionDelayStyle(440 + index * 80)}
                        >
                          <div className="vf-marketing-reader-deck__item-head">
                            <p>{unit.title}</p>
                            <span>{unit.status}</span>
                          </div>
                          <p>{unit.body}</p>
                        </div>
                      ))}
                    </div>
                  </aside>

                  <section className="vf-marketing-reader-deck__stage" data-vf-reveal style={motionDelayStyle(440)}>
                    <div className="vf-marketing-reader-deck__head">
                      <div>
                        <p className="vf-marketing-block__label">{LANDING_WRITING_PROOF.coverLabel}</p>
                        <h3>{LANDING_WRITING_PROOF.activeTitle}</h3>
                      </div>
                      <span className="vf-marketing-reader-deck__status vf-marketing-reader-deck__status--accent">
                        {LANDING_WRITING_PROOF.activeStatus}
                      </span>
                    </div>

                    <div className="vf-marketing-reader-deck__cover">
                      <div className="vf-marketing-reader-deck__cover-inner">
                        <BrandLogo size="hero" tone="light" showWordmark={false} />
                        <p className="vf-marketing-reader-deck__cover-kicker">Approval loop</p>
                        <p className="vf-marketing-reader-deck__cover-title">
                          Keep the pass tight and clean.
                        </p>
                      </div>
                    </div>
                  </section>
                </div>
              </section>

              {/* Ã¢â€â‚¬Ã¢â€â‚¬ FINAL CTA Ã¢â€â‚¬Ã¢â€â‚¬ */}
              <section className="vf-marketing-final-cta vf-marketing-final-cta--panel" data-testid="landing-final-cta">
                <div className="vf-marketing-final-cta__panel relative overflow-hidden" data-vf-reveal style={motionDelayStyle(600)}>
                  {/* Background glow */}
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet-600/[0.12] via-cyan-600/[0.08] to-transparent rounded-[inherit]" aria-hidden="true" />

                  <div className="relative z-10">
                    <p className="vf-marketing-kicker flex items-center justify-center gap-1.5">
                      <Sparkles size={13} className="text-violet-400" />
                      Ready to publish
                    </p>
                    <h2 className="vf-marketing-final-cta__title">
                      Open the studio.
                    </h2>
                    <p className="vf-marketing-final-cta__body">
                      Hear the proof, then move on.
                    </p>
                    <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                      <a href={studioHref} className="lp-cta-primary">
                        <Play size={16} fill="currentColor" />
                        Open studio
                      </a>
                      <a href={billingHref} className="lp-cta-secondary">
                        View pricing
                        <ArrowRight size={15} />
                      </a>
                    </div>
                  </div>
                </div>
              </section>

              {/* Ã¢â€â‚¬Ã¢â€â‚¬ FOOTER Ã¢â€â‚¬Ã¢â€â‚¬ */}
              <footer className="vf-marketing-footer vf-marketing-footer--panel">
                <div className="vf-marketing-footer__inner" data-vf-reveal style={motionDelayStyle(700)}>
                  <div>
                    <BrandLogo size="md" tone="light" />
                    <p className="vf-marketing-footer__copy">
                      V FLOW AI is a premium voice studio for demos, clone checks, direction, and review.
                    </p>
                    <div className="vf-marketing-footer__links">
                      <a href={studioHref}>Studio</a>
                      <a href={billingHref}>Pricing</a>
                      <a href="/legal">Legal</a>
                    </div>
                  </div>

                  <LegalLinks className="justify-start lg:justify-end" linkClassName="vf-marketing-legal-link" />
                </div>
                <DeepfakeFooterTool />
              </footer>

              {/* Mobile Safe Area */}
              <div className="h-24 sm:h-32 w-full shrink-0" aria-hidden="true" />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
