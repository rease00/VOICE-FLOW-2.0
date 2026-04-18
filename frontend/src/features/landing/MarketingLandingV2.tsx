'use client';

import { useState, useCallback, useEffect } from 'react';
import type { CSSProperties } from 'react';
import {
  ArrowRight,
  AudioLines,
  BookOpen,
  Brain,
  ChevronRight,
  Globe,
  Menu,
  Mic2,
  Play,
  Sparkles,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react';
import { BrandLogo } from '../../../components/BrandLogo';
import { APP_ROUTE_PATHS, resolveLoginPath } from '../../app/navigation';
import { LegalLinks } from '../legal/LegalLinks';
import { MarketingAudioCard } from './MarketingAudioCard';
import type {
  LandingDirectorProof,
  LandingMultiSpeakerDemo,
  LandingReaderProof,
  LandingSingleSpeakerDemo,
} from './landingData';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const loginHref = resolveLoginPath('login', APP_ROUTE_PATHS.studio);

const d = (ms: number): CSSProperties =>
  ({ '--vf-marketing-delay': `${ms}ms` } as CSSProperties);

const HERO_METER = [0.42, 0.76, 0.54, 0.92, 0.62, 0.88, 0.48, 0.72] as const;

const TRUST_ITEMS = [
  'Multi-language TTS',
  'Multi-speaker scenes',
  'AI-directed delivery',
  'Reader-ready approval',
  'Token-based billing',
  'No monthly minimum',
  'Real-time preview',
  'One-click AI Director',
] as const;

const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'Demos', href: '#demos' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Pricing', href: '#pricing' },
] as const;

const STEPS = [
  {
    num: '01',
    title: 'Write or paste your script',
    body: 'Drop in any text — dialogue, narration, alerts, chapters. Pick voices and languages from the studio panel.',
    icon: Mic2,
  },
  {
    num: '02',
    title: 'Press AI Director',
    body: 'The AI Director detects speakers, tags emotions, and formats your text into a multi-voice script — ready to assign voices and render.',
    icon: Brain,
  },
  {
    num: '03',
    title: 'Render, review, publish',
    body: 'Generate the audio, listen in the Reader surface, approve, and export. The whole flow stays in one place.',
    icon: BookOpen,
  },
] as const;

const FAQ_ITEMS = [
  {
    q: 'What is Voice Flow?',
    a: 'Voice Flow is a web-based voice production workspace. You write scripts, assign AI voices, direct delivery with prompts, and review rendered audio — all in one tool.',
  },
  {
    q: 'What languages are supported?',
    a: 'The Vector engine supports 30+ languages including English, Hindi, Spanish, Japanese, Arabic, French, German, and more. New languages are added as the upstream model expands.',
  },
  {
    q: 'How does billing work?',
    a: 'You purchase VF Credits in packs or via a subscription plan. Credits are consumed per generation — no hidden fees, no monthly minimum. You only pay for what you use.',
  },
  {
    q: 'Can I use multiple voices in one scene?',
    a: 'Yes. Multi-speaker mode lets you assign different voices to different speakers in a single script and render the entire scene in one pass.',
  },
  {
    q: 'Is there a free tier?',
    a: 'Pricing plans start at ₹129/month with credits included. Token top-up packs are also available if you need more without committing to a larger plan.',
  },
  {
    q: 'Who builds this?',
    a: 'V FLOW AI is a solo-built product focused on doing a few things well rather than promising everything. Updates ship frequently based on real usage.',
  },
] as const;

type PlanHighlight = { name: string; price: string; credits: string; note: string; featured?: boolean };
const PLAN_HIGHLIGHTS: readonly PlanHighlight[] = [
  { name: 'Launcher', price: '₹129', credits: '30K', note: 'Great for trying the studio' },
  { name: 'Creator', price: '₹1,499', credits: '225K', note: 'Most popular', featured: true },
  { name: 'Pro', price: '₹2,999', credits: '500K', note: 'For heavy production' },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MarketingLandingV2Props {
  singleSpeakerDemos: readonly LandingSingleSpeakerDemo[];
  multiSpeakerDemos: readonly LandingMultiSpeakerDemo[];
  directorProof: LandingDirectorProof;
  readerProof: LandingReaderProof;
}

export function MarketingLandingV2({
  singleSpeakerDemos,
  multiSpeakerDemos,
  directorProof,
  readerProof,
}: MarketingLandingV2Props) {
  const featuredScene = multiSpeakerDemos[0];
  const singleDemos = singleSpeakerDemos.slice(0, 3);
  const multiDemos = multiSpeakerDemos.slice(0, 2);

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const toggleMobileNav = useCallback(() => setMobileNavOpen((v) => !v), []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  // Close mobile nav on escape
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileNavOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileNavOpen]);

  return (
    <div
      className="lp-shell"
      data-testid="marketing-landing"
      data-vf-brand-theme="aurora"
    >
      <a className="lp-skip" href="#main-content">Skip to main content</a>

      {/* ── Background ──────────────────────────────── */}
      <div className="lp-bg-grid" aria-hidden="true" />
      <div className="lp-spotlight lp-spotlight--a" aria-hidden="true" />
      <div className="lp-spotlight lp-spotlight--b" aria-hidden="true" />
      <div className="lp-spotlight lp-spotlight--c" aria-hidden="true" />

      {/* ── Header ──────────────────────────────────── */}
      <header className="lp-header" data-vf-reveal>
        <div className="lp-header__inner">
          <a href="/landing" className="lp-header__brand" aria-label="V FLOW AI home">
            <BrandLogo size="sm" tone="light" />
          </a>
          <nav className="lp-header__nav" aria-label="Landing navigation">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="lp-header__nav-link">
                {link.label}
              </a>
            ))}
          </nav>
          <div className="lp-header__actions">
            <a href="/billing" className="lp-header__secondary">Pricing</a>
            <a href={loginHref} className="lp-btn-primary" data-testid="hero-primary-cta">
              Open Studio <ArrowRight size={16} />
            </a>
            <button
              className="lp-mobile-menu-btn"
              onClick={toggleMobileNav}
              aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileNavOpen}
            >
              {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile nav drawer */}
        {mobileNavOpen && (
          <nav className="lp-mobile-nav" aria-label="Mobile navigation">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="lp-mobile-nav__link" onClick={closeMobileNav}>
                {link.label}
              </a>
            ))}
            <a href="/billing" className="lp-mobile-nav__link" onClick={closeMobileNav}>Pricing</a>
            <a href={loginHref} className="lp-btn-primary lp-mobile-nav__cta" onClick={closeMobileNav}>
              Open Studio <ArrowRight size={16} />
            </a>
          </nav>
        )}
      </header>

      <main id="main-content">
        {/* ═══════════════ HERO ═══════════════════════ */}
        <section className="lp-hero lp-page" data-testid="landing-home" id="hero">
          <div className="lp-hero__inner">
            <div className="lp-hero__copy">
              <div className="lp-hero__badge" data-vf-reveal style={d(60)}>
                <span className="lp-hero__badge-dot" />
                Production-ready voice studio
              </div>
              <h1 className="lp-hero__title" data-vf-reveal style={d(140)}>
                Script to voice.
                <br />
                One workspace.
                <br />
                <span className="lp-hero__title-gradient">No filler.</span>
              </h1>
              <p className="lp-hero__sub" data-vf-reveal style={d(220)}>
                Write your script, pick AI voices across 30+ languages,
                direct delivery with prompts, and render final audio — without
                switching tools.
              </p>
              <div className="lp-hero__actions" data-vf-reveal style={d(300)}>
                <a href={APP_ROUTE_PATHS.studio} className="lp-btn-primary">
                  Open Studio <ArrowRight size={16} />
                </a>
                <a href="#demos" className="lp-btn-secondary">
                  Hear real demos <Play size={14} />
                </a>
              </div>
              <div className="lp-proof-strip" data-vf-reveal style={d(360)}>
                <span className="lp-proof-chip"><Globe size={14} /> 30+ languages</span>
                <span className="lp-proof-chip"><AudioLines size={14} /> Real-time preview</span>
                <span className="lp-proof-chip"><Zap size={14} /> Token-based — pay only for what you use</span>
              </div>
            </div>

            {featuredScene ? (
              <div className="lp-hero__stage" data-vf-reveal style={d(260)}>
                <div className="lp-stage">
                  <div className="lp-stage__header">
                    <span className="lp-stage__label"><Sparkles size={11} /> Live scene preview</span>
                    <span className="lp-stage__live"><span className="lp-stage__live-dot" aria-hidden="true" /> Vector</span>
                  </div>
                  <div className="lp-stage__meter" aria-hidden="true">
                    {HERO_METER.map((scale, i) => (
                      <span
                        key={`m-${i}`}
                        className="lp-stage__meter-bar"
                        style={{ '--lp-meter-scale': scale, '--lp-meter-delay': `${i * 160}ms` } as CSSProperties}
                      />
                    ))}
                  </div>
                  <div className="lp-stage__body">
                    <p className="lp-stage__scene-eye">
                      {featuredScene.useCase} / {featuredScene.market}
                    </p>
                    <h3 className="lp-stage__scene-title">{featuredScene.title}</h3>
                    <p className="lp-stage__scene-summary">{featuredScene.summary}</p>
                    <p className="lp-stage__scene-cue">{featuredScene.cue}</p>
                  </div>
                  <div className="lp-stage__footer" aria-label="Engine info">
                    {featuredScene.cast.map((voice, i) => (
                      <span key={`cast-${i}`} className="lp-stage__cast-chip">{voice}</span>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {/* ═══════════════ TRUST MARQUEE ══════════════ */}
        <div className="lp-marquee-wrap" aria-hidden="true">
          <div className="lp-marquee-track">
            {[...TRUST_ITEMS, ...TRUST_ITEMS].map((item, i) => (
              <span key={`t-${i}`} className="lp-marquee-item">
                <Sparkles size={12} /> {item}
              </span>
            ))}
          </div>
        </div>

        {/* ═══════════════ FEATURES ═══════════════════ */}
        <section className="lp-features lp-page__body" id="features">
          <div className="lp-section">
            <div className="lp-section-head" data-vf-reveal>
              <p className="lp-eyebrow"><Zap size={13} /> Core features</p>
              <h2 className="lp-section-title">Four lanes, one clean flow.</h2>
              <p className="lp-section-sub">
                Each feature solves one step in voice production. Use them together
                or jump straight to the lane you need.
              </p>
            </div>
            <div className="lp-features__grid">
              <a href="#demos" className="lp-feature-card" data-vf-reveal style={d(0)}>
                <div className="lp-feature-icon"><Mic2 size={20} /></div>
                <h3 className="lp-feature-title">Single Voice</h3>
                <p className="lp-feature-body">
                  Audition voices across languages in seconds. Hear the read before you commit the whole scene.
                </p>
                <span className="lp-feature-tag">Fast audition</span>
              </a>
              <div className="lp-feature-card" data-vf-reveal style={d(70)}>
                <div className="lp-feature-icon" style={{ '--lp-card-accent': 'var(--lp-accent2)' } as CSSProperties}><WandSparkles size={20} /></div>
                <h3 className="lp-feature-title">Multi-Speaker Scenes</h3>
                <p className="lp-feature-body">
                  Assign voices to speakers, set direction, and render full cast dialogues in one pass.
                </p>
                <span className="lp-feature-tag">Cast production</span>
              </div>
              <div className="lp-feature-card" data-vf-reveal style={d(140)}>
                <div className="lp-feature-icon" style={{ '--lp-card-accent': 'var(--lp-accent3)' } as CSSProperties}><Brain size={20} /></div>
                <h3 className="lp-feature-title">AI Director</h3>
                <p className="lp-feature-body">
                  Paste any story, press AI Director — it detects speakers, tags emotions, and formats a multi-voice script.
                </p>
                <span className="lp-feature-tag">One-click direction</span>
              </div>
              <div className="lp-feature-card" data-vf-reveal style={d(210)}>
                <div className="lp-feature-icon" style={{ '--lp-card-accent': '#a78bfa' } as CSSProperties}><BookOpen size={20} /></div>
                <h3 className="lp-feature-title">Reader Review</h3>
                <p className="lp-feature-body">
                  A quiet listening surface for final approval. Chapter-level playback, progress tracking, export.
                </p>
                <span className="lp-feature-tag">Approval surface</span>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════ DEMOS ══════════════════════ */}
        <section className="lp-demos" id="demos">
          <div className="lp-section">
            <div className="lp-section-head" data-vf-reveal>
              <p className="lp-eyebrow"><AudioLines size={13} /> Real output</p>
              <h2 className="lp-section-title">These were generated in the app. Press play.</h2>
              <p className="lp-section-sub">
                Every audio clip below was rendered using the same studio you get access to.
                No post-processing, no external tools.
              </p>
            </div>

            {/* Single voice demos */}
            <div className="lp-demo-section" data-vf-reveal>
              <div className="lp-demo-section__head">
                <h3 className="lp-demo-section__title"><Mic2 size={16} /> Single voice reads</h3>
                <p className="lp-demo-section__sub">Quick auditions across languages</p>
              </div>
              <div className="lp-audio-grid">
                {singleDemos.map((demo, i) => (
                  <MarketingAudioCard
                    key={demo.id}
                    eyebrow={`${demo.language} / ${demo.market}`}
                    title={demo.title}
                    summary={demo.summary}
                    audioSrc={demo.audioSrc}
                    ariaLabel={`${demo.title} preview`}
                    motionDelayMs={120 + i * 80}
                    badges={[
                      { label: demo.language, tone: 'warm' },
                    ]}
                    note={demo.cue}
                  />
                ))}
              </div>
            </div>

            {/* Multi-speaker demos */}
            <div className="lp-demo-section" data-vf-reveal style={{ marginTop: '3rem' }}>
              <div className="lp-demo-section__head">
                <h3 className="lp-demo-section__title"><WandSparkles size={16} /> Multi-speaker scenes</h3>
                <p className="lp-demo-section__sub">Full cast dialogues with natural handoffs</p>
              </div>
              <div className="lp-audio-grid lp-audio-grid--2col">
                {multiDemos.map((demo, i) => (
                  <MarketingAudioCard
                    key={demo.id}
                    variant="scene"
                    eyebrow={`${demo.scene} / ${demo.market}`}
                    title={demo.title}
                    summary={demo.summary}
                    audioSrc={demo.audioSrc}
                    ariaLabel={`${demo.title} preview`}
                    motionDelayMs={120 + i * 90}
                    badges={[
                      { label: `${demo.cast.length} voices`, tone: 'accent' },
                      { label: demo.market, tone: 'warm' },
                    ]}
                    cast={demo.cast}
                    note={demo.cue}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════ AI DIRECTION ═══════════════ */}
        <section className="lp-direction-section" id="direction" data-testid="landing-ai-director">
          <div className="lp-section">
            <div className="lp-section-head" data-vf-reveal>
              <p className="lp-eyebrow"><Brain size={13} /> AI Director</p>
              <h2 className="lp-section-title">
                Paste a story. Get a directed script.
              </h2>
              <p className="lp-section-sub">
                Write or paste any story into the editor and press AI Director. It detects every speaker,
                tags emotions line by line, and outputs a cast-ready script you can render immediately.
              </p>
            </div>
            <div className="lp-direction-panel">
              <div
                className="lp-direction-block"
                data-testid="landing-ai-director-prompt"
                data-vf-reveal
                style={d(140)}
              >
                <p className="lp-direction-block__label">What you write</p>
                <pre>{directorProof.before}</pre>
              </div>
              <div className="lp-direction-block" data-vf-reveal style={d(220)}>
                <p className="lp-direction-block__label">What AI Director outputs</p>
                <pre className="lp-ba-pre lp-ba-pre--after">{directorProof.after}</pre>
                <div className="lp-direction-bullets">
                  {directorProof.bullets.map((b, i) => (
                    <div key={`b-${i}`} className="lp-direction-bullet">
                      <span className="lp-direction-bullet__label">{b.label}</span>
                      <span className="lp-direction-bullet__value">{b.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {directorProof.prompt && (
              <div className="lp-direction-block" data-vf-reveal style={d(300)}>
                <p className="lp-direction-block__label">Live prompt contract</p>
                <pre className="lp-direction-block__code">{directorProof.prompt}</pre>
              </div>
            )}
          </div>
        </section>

        {/* ═══════════════ READER ════════════════════ */}
        <section className="lp-reader-section" id="reader" data-testid="landing-reader">
          <div className="lp-section">
            <div className="lp-section-head" data-vf-reveal>
              <p className="lp-eyebrow"><BookOpen size={13} /> Reader</p>
              <h2 className="lp-section-title">
                Listen, review, approve — all in one surface.
              </h2>
              <p className="lp-section-sub">
                After rendering, the Reader gives you chapter-level playback, progress tracking,
                and a quiet space to listen before you publish.
              </p>
            </div>
            <div className="lp-reader-showcase" data-vf-reveal style={d(140)}>
              <div className="lp-reader-card">
                <div className="lp-reader-card__cover">
                  <BookOpen size={32} />
                </div>
                <div className="lp-reader-card__body">
                  <p className="lp-reader-card__label">{readerProof.modeLabel}</p>
                  <h3 className="lp-reader-card__title">{readerProof.sample.title}</h3>
                  <p className="lp-reader-card__summary">{readerProof.sample.summary}</p>
                  <div className="lp-reader-card__meta">
                    <span className="lp-reader-card__chip"><Globe size={12} /> {readerProof.sample.language}</span>
                    <span className="lp-reader-card__chip">{readerProof.progressLabel}</span>
                  </div>
                </div>
              </div>
              {readerProof.virtualBook.chapters.length > 0 && (
                <div className="lp-reader-chapters">
                  <p className="lp-reader-chapters__title">Chapter preview</p>
                  {readerProof.virtualBook.chapters.slice(0, 3).map((ch, i) => (
                    <div key={ch.id} className="lp-reader-chapter" data-vf-reveal style={d(200 + i * 80)}>
                      <span className="lp-reader-chapter__num">{String(ch.order).padStart(2, '0')}</span>
                      <div className="lp-reader-chapter__info">
                        <span className="lp-reader-chapter__name">{ch.title}</span>
                        <span className="lp-reader-chapter__dur">{Math.floor(ch.durationSec / 60)}:{String(Math.floor(ch.durationSec % 60)).padStart(2, '0')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ═══════════════ HOW IT WORKS ═══════════════ */}
        <section className="lp-how" id="how-it-works">
          <div className="lp-section">
            <div className="lp-section-head" data-vf-reveal>
              <p className="lp-eyebrow"><Zap size={13} /> How it works</p>
              <h2 className="lp-section-title">Three steps. No onboarding maze.</h2>
              <p className="lp-section-sub">
                Voice Flow is built for people who want to generate audio, not learn another platform.
              </p>
            </div>
            <div className="lp-steps">
              {STEPS.map((step, i) => {
                const Icon = step.icon;
                return (
                  <div key={step.num} className="lp-step" data-vf-reveal style={d(i * 100)}>
                    <div className="lp-step__num">{step.num}</div>
                    <div className="lp-step__icon"><Icon size={22} /></div>
                    <h3 className="lp-step__title">{step.title}</h3>
                    <p className="lp-step__body">{step.body}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ═══════════════ PRICING ════════════════════ */}
        <section className="lp-pricing" id="pricing">
          <div className="lp-section">
            <div className="lp-section-head" data-vf-reveal>
              <p className="lp-eyebrow"><Sparkles size={13} /> Pricing</p>
              <h2 className="lp-section-title">Simple credit-based plans.</h2>
              <p className="lp-section-sub">
                Pick a plan, get VF Credits, spend them on any feature. No hidden fees. Cancel anytime.
              </p>
            </div>
            <div className="lp-pricing-grid" data-vf-reveal>
              {PLAN_HIGHLIGHTS.map((plan) => (
                <div
                  key={plan.name}
                  className={`lp-price-card${plan.featured ? ' lp-price-card--featured' : ''}`}
                >
                  {plan.featured && <span className="lp-price-card__badge">Most popular</span>}
                  <h3 className="lp-price-card__name">{plan.name}</h3>
                  <div className="lp-price-card__amount">
                    <span className="lp-price-card__price">{plan.price}</span>
                    <span className="lp-price-card__period">/month</span>
                  </div>
                  <p className="lp-price-card__credits">{plan.credits} VF Credits included</p>
                  <p className="lp-price-card__note">{plan.note}</p>
                  <a
                    href="/billing"
                    className={plan.featured ? 'lp-btn-primary lp-price-card__cta' : 'lp-btn-secondary lp-price-card__cta'}
                  >
                    View plans <ChevronRight size={14} />
                  </a>
                </div>
              ))}
            </div>
            <p className="lp-pricing-footnote" data-vf-reveal>
              Token top-up packs also available from ₹550. All prices in INR.
              <a href="/billing" className="lp-pricing-footnote__link"> See full pricing →</a>
            </p>
          </div>
        </section>

        {/* ═══════════════ FAQ ════════════════════════ */}
        <section className="lp-faq" id="faq">
          <div className="lp-section">
            <div className="lp-section-head" data-vf-reveal>
              <p className="lp-eyebrow"><BookOpen size={13} /> FAQ</p>
              <h2 className="lp-section-title">Common questions, straight answers.</h2>
            </div>
            <div className="lp-faq-grid" data-vf-reveal>
              {FAQ_ITEMS.map((item, i) => (
                <details key={`faq-${i}`} className="lp-faq-item">
                  <summary className="lp-faq-item__q">{item.q}</summary>
                  <p className="lp-faq-item__a">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════ FINAL CTA ═════════════════ */}
        <section className="lp-final-cta" data-vf-reveal>
          <div className="lp-section">
            <div className="lp-final-cta__panel">
              <p className="lp-final-cta__kicker">Ready to start?</p>
              <h2 className="lp-final-cta__title">
                Open the studio and render your first scene.
              </h2>
              <p className="lp-final-cta__body">
                Voice Flow keeps everything in one workspace — no installs, no file
                juggling, no setup guides. Sign in, paste a script, and press render.
              </p>
              <div className="lp-final-cta__actions">
                <a href={APP_ROUTE_PATHS.studio} className="lp-btn-primary">
                  Open Studio <ArrowRight size={16} />
                </a>
                <a href="/billing" className="lp-btn-secondary">View pricing</a>
              </div>
              <p className="lp-final-cta__note">Solo-built, shipped weekly, and improving with real usage.</p>
            </div>
          </div>
        </section>
      </main>

      {/* ═══════════════ FOOTER ═══════════════════════ */}
      <footer className="lp-footer" data-vf-reveal>
        <div className="lp-footer__inner">
          <div className="lp-footer__brand">
            <a href="/landing" aria-label="V FLOW AI home"><BrandLogo size="md" tone="light" /></a>
            <p className="lp-footer__tagline">
              Script to voice. One workspace. No filler.
            </p>
          </div>
          <div>
            <p className="lp-footer__col-title">Product</p>
            <nav className="lp-footer__links">
              <a href="#features" className="lp-footer__link">Features</a>
              <a href="#demos" className="lp-footer__link">Demos</a>
              <a href="#how-it-works" className="lp-footer__link">How it works</a>
              <a href="#pricing" className="lp-footer__link">Pricing</a>
              <a href="#faq" className="lp-footer__link">FAQ</a>
            </nav>
          </div>
          <div>
            <p className="lp-footer__col-title">Get started</p>
            <nav className="lp-footer__links">
              <a href="/billing" className="lp-footer__link">Pricing</a>
              <a href={APP_ROUTE_PATHS.studio} className="lp-footer__link">Studio</a>
              <a href={loginHref} className="lp-footer__link">Sign in</a>
            </nav>
          </div>
        </div>
        <div className="lp-footer__bottom">
          <p className="lp-footer__copy">© {new Date().getFullYear()} V FLOW AI. All rights reserved.</p>
          <LegalLinks className="justify-start lg:justify-end" linkClassName="lp-footer__link" />
        </div>
      </footer>
    </div>
  );
}
