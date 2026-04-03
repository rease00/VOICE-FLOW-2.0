import type { CSSProperties } from 'react';
import {
  ArrowRight,
  AudioLines,
  BookOpen,
  Mic2,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { BrandLogo } from '../../../components/BrandLogo';
import { APP_ROUTE_PATHS, resolveLoginPath } from '../../app/navigation';
import { UI_BRAND_THEME_CONFIGS } from '../../shared/theme/brandThemes';
import { LegalLinks } from '../legal/LegalLinks';
import { MarketingAudioCard } from './MarketingAudioCard';
import {
  LANDING_DIRECTOR_PROOF,
  LANDING_MULTI_SPEAKER_DEMOS,
  LANDING_READER_PROOF,
  LANDING_SINGLE_SPEAKER_DEMOS,
  LANDING_VOICE_CLONE_PROOF,
} from './landingData';

const signupHref = resolveLoginPath('signup', APP_ROUTE_PATHS.studio);
const billingHref = '/billing';
const studioHref = APP_ROUTE_PATHS.studio;
const featuredPrimeScene = LANDING_MULTI_SPEAKER_DEMOS[0];
const landingHeroMeterBars = [0.42, 0.66, 0.54, 0.78, 0.58, 0.9] as const;

const motionDelayStyle = (delayMs: number): CSSProperties => ({
  '--vf-marketing-delay': `${delayMs}ms`,
} as CSSProperties);

export const LANDING_TAB_KEYS = [
  'home',
  'single-voice',
  'prime-scenes',
  'clone-proof',
  'direction',
  'reader',
] as const;

export type LandingTabKey = (typeof LANDING_TAB_KEYS)[number];

const navLinks = [
  { key: 'home', label: 'Home', href: '/landing' },
  { key: 'single-voice', label: 'Single Voice', href: '/landing/single-voice' },
  { key: 'prime-scenes', label: 'Prime Scenes', href: '/landing/prime-scenes' },
  { key: 'clone-proof', label: 'Clone Proof', href: '/landing/clone-proof' },
  { key: 'direction', label: 'Direction', href: '/landing/direction' },
  { key: 'reader', label: 'Reader', href: '/landing/reader' },
] as const;

const heroSignals = [
  'Prime multi-speaker reel',
  'Voice Clone comparison',
  'Reader-ready approvals',
] as const;

const homePanels = [
  {
    key: 'single-voice',
    label: 'Single Voice',
    href: '/landing/single-voice',
    detail: `${LANDING_SINGLE_SPEAKER_DEMOS.length} launch-ready reads`,
  },
  {
    key: 'prime-scenes',
    label: 'Prime Scenes',
    href: '/landing/prime-scenes',
    detail: `${LANDING_MULTI_SPEAKER_DEMOS.length} compact scene proofs`,
  },
  {
    key: 'clone-proof',
    label: 'Clone Proof',
    href: '/landing/clone-proof',
    detail: 'Reference versus render',
  },
  {
    key: 'direction',
    label: 'Direction',
    href: '/landing/direction',
    detail: 'Prompt-led pacing edits',
  },
  {
    key: 'reader',
    label: 'Reader',
    href: '/landing/reader',
    detail: 'Approval playback lane',
  },
] as const;

const heroStats = [
  {
    label: 'Featured scenes',
    value: `${LANDING_MULTI_SPEAKER_DEMOS.length} Prime casts`,
    detail: 'Five multi-speaker proofs ready to review.',
  },
  {
    label: 'Single voice',
    value: `${LANDING_SINGLE_SPEAKER_DEMOS.length} launch reads`,
    detail: 'Five single-speaker reads across launch workflows.',
  },
  {
    label: 'Voice proof',
    value: 'Reference + clone',
    detail: 'Reference and render stay side by side.',
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
      className="vf-marketing-shell vf-theme-dark relative isolate min-h-screen overflow-hidden text-slate-100"
      data-testid="marketing-landing"
      data-vf-brand-theme="aurora"
      style={landingThemeStyle}
    >
      <a className="vf-marketing-skip-link" href="#main-content">
        Skip to main content
      </a>

      <div className="vf-marketing-backdrop" aria-hidden="true" />
      <div className="vf-marketing-grid" aria-hidden="true" />
      <div className="vf-marketing-spotlight vf-marketing-spotlight-a" aria-hidden="true" />
      <div className="vf-marketing-spotlight vf-marketing-spotlight-b" aria-hidden="true" />

      <header className="vf-marketing-header">
        <div className="vf-marketing-header__inner" data-vf-reveal style={motionDelayStyle(0)}>
          <a
            href="/landing"
            className="vf-marketing-header__brand"
          >
            <BrandLogo size="sm" tone="light" />
          </a>

          <div className="vf-marketing-header__actions">
            <a href={billingHref} className="vf-marketing-header__secondary">
              Pricing
            </a>
            <a href={signupHref} className="vf-marketing-header__primary" data-testid="hero-primary-cta">
              Start free
              <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </header>

      <div
        className="vf-marketing-subtab-row"
        aria-label="Subtabs below header"
        data-vf-reveal
        style={motionDelayStyle(90)}
      >
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

      <main id="main-content" className="vf-marketing-main">
        {showHomeHero ? (
          <section
            className="vf-marketing-hero"
            data-testid="landing-home-hero"
            data-vf-reveal
            style={motionDelayStyle(120)}
          >
            <div className="vf-marketing-hero__inner">
              <div className="vf-marketing-hero__copy">
                <p className="vf-marketing-kicker" data-vf-reveal style={motionDelayStyle(160)}>
                  Premium AI voice studio
                </p>
                <h1 className="vf-marketing-hero__title" data-vf-reveal style={motionDelayStyle(220)}>
                  Publish voice work that already sounds finished.
                </h1>
                <p className="vf-marketing-hero__lede" data-vf-reveal style={motionDelayStyle(300)}>
                  Prime scenes, clone proof, live direction, and reader approvals in one listening-first studio.
                </p>

                <div className="vf-marketing-hero__actions" data-vf-reveal style={motionDelayStyle(380)}>
                  <a href={studioHref} className="vf-marketing-cta vf-marketing-cta--primary">
                    Open studio
                    <ArrowRight size={16} />
                  </a>
                  <a href="/landing/prime-scenes" className="vf-marketing-cta vf-marketing-cta--secondary">
                    Hear Prime scenes
                  </a>
                </div>

                <div
                  className="vf-marketing-proof-note"
                  aria-label="Landing proof note"
                  data-vf-reveal
                  style={motionDelayStyle(460)}
                >
                  {heroSignals.map((signal, index) => (
                    <span
                      key={signal}
                      className="vf-marketing-proof-pill"
                      data-vf-reveal
                      style={motionDelayStyle(520 + index * 70)}
                    >
                      {signal}
                    </span>
                  ))}
                </div>

                <div className="vf-marketing-stat-grid" data-vf-reveal style={motionDelayStyle(560)}>
                  {heroStats.map((stat, index) => (
                    <div
                      key={stat.label}
                      className="vf-marketing-stat"
                      data-vf-reveal
                      style={motionDelayStyle(620 + index * 90)}
                    >
                      <p className="vf-marketing-stat__label">{stat.label}</p>
                      <p className="vf-marketing-stat__value">{stat.value}</p>
                      <p className="vf-marketing-stat__detail">{stat.detail}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div
                className="vf-marketing-hero__stage"
                data-testid="hero-stage"
                data-vf-reveal
                style={motionDelayStyle(360)}
              >
                <div className="vf-marketing-stage">
                  <div className="vf-marketing-stage__ambient" aria-hidden="true">
                    <span className="vf-marketing-stage__ambient-orb vf-marketing-stage__ambient-orb--primary" />
                    <span className="vf-marketing-stage__ambient-orb vf-marketing-stage__ambient-orb--secondary" />
                    <span className="vf-marketing-stage__ambient-orb vf-marketing-stage__ambient-orb--tertiary" />
                    <span className="vf-marketing-stage__ambient-line" />
                    <div className="vf-marketing-stage__meter">
                      {landingHeroMeterBars.map((scale, index) => (
                        <span
                          key={`hero-meter-${index}`}
                          className="vf-marketing-stage__meter-bar"
                          style={{
                            '--vf-marketing-meter-scale': scale,
                            animationDelay: `${index * 140}ms`,
                          } as CSSProperties}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="vf-marketing-stage__topline">
                    <span className="vf-marketing-stage__eyebrow">
                      <Sparkles size={13} />
                      Featured Prime scene
                    </span>
                    <span className="vf-marketing-stage__badge vf-marketing-stage__badge--live">
                      <span className="vf-marketing-stage__live-dot" aria-hidden="true" />
                      Live preview
                    </span>
                  </div>

                  {featuredPrimeScene ? (
                    <>
                      <MarketingAudioCard
                        variant="hero"
                        eyebrow={`${featuredPrimeScene.useCase} / ${featuredPrimeScene.market}`}
                        title={featuredPrimeScene.title}
                        summary={featuredPrimeScene.summary}
                        audioSrc={featuredPrimeScene.audioSrc}
                        ariaLabel={`${featuredPrimeScene.title} preview`}
                        badges={[
                          { label: 'Prime engine', tone: 'accent' },
                          { label: featuredPrimeScene.scene, tone: 'neutral' },
                        ]}
                        cast={featuredPrimeScene.cast}
                        note={featuredPrimeScene.cue}
                      />

                      <div className="vf-marketing-detail-grid">
                        <div className="vf-marketing-detail-row">
                          <span>Direction</span>
                          <strong>{featuredPrimeScene.direction}</strong>
                        </div>
                        <div className="vf-marketing-detail-row">
                          <span>Scene format</span>
                          <strong>{featuredPrimeScene.useCase}</strong>
                        </div>
                        <div className="vf-marketing-detail-row">
                          <span>Market</span>
                          <strong>{featuredPrimeScene.market}</strong>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <section className="vf-marketing-tab-page">
          <div className="vf-marketing-tab-page__inner">
              <div className="vf-marketing-scroll-box" data-active-tab={resolvedTab} aria-label="Dedicated tab content">
                <section
                  id="landing-home"
                  data-tab-key="home"
                  data-testid="landing-home"
                  className="vf-marketing-section vf-marketing-section--panel"
                  data-vf-reveal
                  style={motionDelayStyle(120)}
                >
                  <div className="vf-marketing-section__intro" data-vf-reveal style={motionDelayStyle(150)}>
                    <p className="vf-marketing-section__eyebrow">
                      <Sparkles size={13} />
                      Home
                    </p>
                    <h2 className="vf-marketing-section__title">Pick one lane and hear the proof.</h2>
                    <p className="vf-marketing-section__body">
                      Jump straight into the exact surface you need without carrying the homepage hero into every tab.
                    </p>
                  </div>

                  <div className="vf-marketing-stat-grid vf-marketing-stat-grid--five-up">
                    {homePanels.map((panel, index) => (
                      <a
                        key={panel.key}
                        href={panel.href}
                        className="vf-marketing-stat"
                        data-vf-reveal
                        style={motionDelayStyle(220 + index * 70)}
                      >
                        <p className="vf-marketing-stat__label">Open tab</p>
                        <p className="vf-marketing-stat__value">{panel.label}</p>
                        <p className="vf-marketing-stat__detail">{panel.detail}</p>
                      </a>
                    ))}
                  </div>
                </section>

                <section
                  id="single-speaker"
                  data-tab-key="single-voice"
                  data-testid="landing-single-speaker"
                  className="vf-marketing-section vf-marketing-section--panel"
                  data-vf-reveal
                  style={motionDelayStyle(260)}
                >
                  <div className="vf-marketing-section__intro" data-vf-reveal style={motionDelayStyle(300)}>
                    <p className="vf-marketing-section__eyebrow">
                      <Mic2 size={13} />
                      Single-speaker system
                    </p>
                    <h2 className="vf-marketing-section__title">Five launch-ready single voice reads.</h2>
                    <p className="vf-marketing-section__body">
                      Assistant, support, delivery, meeting, and lifestyle demos in one clean row.
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
                        motionDelayMs={360 + index * 90}
                        badges={[
                          { label: 'Single voice', tone: 'neutral' },
                          { label: demo.language, tone: 'warm' },
                        ]}
                        note={demo.cue}
                      />
                    ))}
                  </div>
                </section>

                <section
                  id="multi-speaker"
                  data-tab-key="prime-scenes"
                  data-testid="landing-multi-speaker"
                  className="vf-marketing-section vf-marketing-section--panel"
                  data-vf-reveal
                  style={motionDelayStyle(340)}
                >
                  <div className="vf-marketing-section__intro" data-vf-reveal style={motionDelayStyle(380)}>
                    <p className="vf-marketing-section__eyebrow">
                      <WandSparkles size={13} />
                      Prime multi-speaker scenes
                    </p>
                    <h2 className="vf-marketing-section__title">Five Prime scenes, one compact compare pass.</h2>
                    <p className="vf-marketing-section__body">
                      Each scene keeps the setup, playback, and pacing note in one compact card.
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
                        motionDelayMs={440 + index * 90}
                        badges={[
                          { label: 'Prime', tone: 'accent' },
                          { label: `${demo.cast.length} voices`, tone: 'neutral' },
                        ]}
                        note={demo.cue}
                      />
                    ))}
                  </div>
                </section>

                <section
                  id="voice-cloning"
                  data-tab-key="clone-proof"
                  data-testid="landing-voice-cloning"
                  className="vf-marketing-section vf-marketing-section--panel"
                  data-vf-reveal
                  style={motionDelayStyle(420)}
                >
                  <div className="vf-marketing-section__intro" data-vf-reveal style={motionDelayStyle(460)}>
                    <p className="vf-marketing-section__eyebrow">
                      <Sparkles size={13} />
                      Voice Clone proof
                    </p>
                    <h2 className="vf-marketing-section__title">Hear the reference beside the rendered clone.</h2>
                    <p className="vf-marketing-section__body">{LANDING_VOICE_CLONE_PROOF.summary}</p>
                  </div>

                  <div className="vf-marketing-feature-panel vf-marketing-feature-panel--clone">
                    <MarketingAudioCard
                      eyebrow="Reference source"
                      title={LANDING_VOICE_CLONE_PROOF.source.label}
                      summary="Original source used to guide the clone."
                      audioSrc={LANDING_VOICE_CLONE_PROOF.source.audioSrc}
                      ariaLabel={`${LANDING_VOICE_CLONE_PROOF.source.label} preview`}
                      motionDelayMs={520}
                      badges={[{ label: 'Voice Clone', tone: 'neutral' }]}
                      note={LANDING_VOICE_CLONE_PROOF.source.name}
                    />
                    <MarketingAudioCard
                      eyebrow="Rendered output"
                      title={LANDING_VOICE_CLONE_PROOF.rendered.label}
                      summary="Rendered clone kept beside the source for fast approval."
                      audioSrc={LANDING_VOICE_CLONE_PROOF.rendered.audioSrc}
                      ariaLabel={`${LANDING_VOICE_CLONE_PROOF.rendered.label} preview`}
                      motionDelayMs={600}
                      badges={[{ label: 'Clone render', tone: 'accent' }]}
                      note={LANDING_VOICE_CLONE_PROOF.rendered.name}
                    />
                  </div>
                </section>

                <section
                  id="ai-director"
                  data-tab-key="direction"
                  data-testid="landing-ai-director"
                  className="vf-marketing-section vf-marketing-section--panel"
                  data-vf-reveal
                  style={motionDelayStyle(500)}
                >
                  <div className="vf-marketing-section__intro" data-vf-reveal style={motionDelayStyle(540)}>
                    <p className="vf-marketing-section__eyebrow">
                      <AudioLines size={13} />
                      AI Director
                    </p>
                    <h2 className="vf-marketing-section__title">Direct the scene before final render.</h2>
                    <p className="vf-marketing-section__body">{LANDING_DIRECTOR_PROOF.summary}</p>
                  </div>

                  <div className="vf-marketing-feature-panel vf-marketing-feature-panel--director">
                    <div className="vf-marketing-feature-panel__block" data-vf-reveal style={motionDelayStyle(600)}>
                      <p className="vf-marketing-block__label">Live prompt contract</p>
                      <pre className="vf-marketing-prompt" data-testid="landing-ai-director-prompt">
                        {LANDING_DIRECTOR_PROOF.prompt}
                      </pre>
                    </div>

                    <div className="vf-marketing-feature-panel__block" data-vf-reveal style={motionDelayStyle(680)}>
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
                            style={motionDelayStyle(760 + index * 70)}
                          >
                            <p className="vf-marketing-block__label">{bullet.label}</p>
                            <p>{bullet.value}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                <section
                  id="reader-playback"
                  data-tab-key="reader"
                  data-testid="landing-reader-playback"
                  className="vf-marketing-section vf-marketing-section--panel"
                  data-vf-reveal
                  style={motionDelayStyle(620)}
                >
                  <div className="vf-marketing-section__intro" data-vf-reveal style={motionDelayStyle(660)}>
                    <p className="vf-marketing-section__eyebrow">
                      <BookOpen size={13} />
                      Reader playback
                    </p>
                    <h2 className="vf-marketing-section__title">Move the script into listening review.</h2>
                    <p className="vf-marketing-section__body">{LANDING_READER_PROOF.summary}</p>
                  </div>

                  <div className="vf-marketing-reader-deck">
                    <aside className="vf-marketing-reader-deck__rail" data-vf-reveal style={motionDelayStyle(720)}>
                      <div className="vf-marketing-reader-deck__head">
                        <div>
                          <p className="vf-marketing-block__label">{LANDING_READER_PROOF.modeLabel}</p>
                          <h3>{LANDING_READER_PROOF.title}</h3>
                        </div>
                        <span className="vf-marketing-reader-deck__status">{LANDING_READER_PROOF.progressLabel}</span>
                      </div>

                      <div className="vf-marketing-reader-deck__list">
                        {LANDING_READER_PROOF.units.map((unit, index) => (
                          <div
                            key={unit.id}
                            className="vf-marketing-reader-deck__item"
                            data-vf-reveal
                            style={motionDelayStyle(800 + index * 80)}
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

                    <section className="vf-marketing-reader-deck__stage" data-vf-reveal style={motionDelayStyle(800)}>
                      <div className="vf-marketing-reader-deck__head">
                        <div>
                          <p className="vf-marketing-block__label">{LANDING_READER_PROOF.coverLabel}</p>
                          <h3>{LANDING_READER_PROOF.activeTitle}</h3>
                        </div>
                        <span className="vf-marketing-reader-deck__status vf-marketing-reader-deck__status--accent">
                          {LANDING_READER_PROOF.activeStatus}
                        </span>
                      </div>

                      <div className="vf-marketing-reader-deck__cover">
                        <div className="vf-marketing-reader-deck__cover-inner">
                          <BrandLogo size="hero" tone="light" showWordmark={false} />
                          <p className="vf-marketing-reader-deck__cover-kicker">Approval loop</p>
                          <p className="vf-marketing-reader-deck__cover-title">
                            Review pacing and continuity in the same lane.
                          </p>
                        </div>
                      </div>
                    </section>
                  </div>
                </section>

                <section className="vf-marketing-final-cta vf-marketing-final-cta--panel" data-testid="landing-final-cta">
                  <div className="vf-marketing-final-cta__panel" data-vf-reveal style={motionDelayStyle(900)}>
                    <p className="vf-marketing-kicker">Ready to publish</p>
                    <h2 className="vf-marketing-final-cta__title">
                      Open the studio when you are ready to ship.
                    </h2>
                    <p className="vf-marketing-final-cta__body">
                      Hear the proof first, then move into pricing or checkout when you are ready.
                    </p>
                    <div className="vf-marketing-hero__actions">
                      <a href={studioHref} className="vf-marketing-cta vf-marketing-cta--primary">
                        Open studio
                        <ArrowRight size={16} />
                      </a>
                      <a href={billingHref} className="vf-marketing-cta vf-marketing-cta--secondary">
                        View pricing
                      </a>
                    </div>
                  </div>
                </section>

                <footer className="vf-marketing-footer vf-marketing-footer--panel">
                  <div className="vf-marketing-footer__inner" data-vf-reveal style={motionDelayStyle(980)}>
                    <div>
                      <BrandLogo size="md" tone="light" />
                      <p className="vf-marketing-footer__copy">
                        V FLOW AI is a listening-first studio for scenes, voice cloning, direction, and approvals.
                      </p>
                      <div className="vf-marketing-footer__links">
                        <a href={studioHref}>Studio</a>
                        <a href={billingHref}>Pricing</a>
                        <a href="/legal">Legal</a>
                      </div>
                    </div>

                    <LegalLinks className="justify-start lg:justify-end" linkClassName="vf-marketing-legal-link" />
                  </div>
                </footer>
              </div>
          </div>
        </section>
      </main>
    </div>
  );
}
