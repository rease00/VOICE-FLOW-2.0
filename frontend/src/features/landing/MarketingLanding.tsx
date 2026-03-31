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
const studioHref = APP_ROUTE_PATHS.studio;
const featuredPrimeScene = LANDING_MULTI_SPEAKER_DEMOS[0];

const navLinks = [
  { label: 'Single Voice', href: '#single-speaker' },
  { label: 'Prime Scenes', href: '#multi-speaker' },
  { label: 'Clone Proof', href: '#voice-cloning' },
  { label: 'Direction', href: '#ai-director' },
  { label: 'Reader', href: '#reader-playback' },
] as const;

const heroSignals = [
  'Prime multi-speaker reel',
  'OpenVoice comparison',
  'Reader-ready approvals',
] as const;

const heroStats = [
  {
    label: 'Featured scenes',
    value: `${LANDING_MULTI_SPEAKER_DEMOS.length} Prime casts`,
    detail: 'Podcast, briefing, audiobook, recap, and documentary formats.',
  },
  {
    label: 'Single voice',
    value: `${LANDING_SINGLE_SPEAKER_DEMOS.length} launch reads`,
    detail: 'Localized hero clips for the first pass of a release campaign.',
  },
  {
    label: 'Voice proof',
    value: 'Reference + clone',
    detail: 'Source and rendered voice-clone audio stay side by side.',
  },
] as const;

export function MarketingLanding() {
  return (
    <div
      className="vf-marketing-shell vf-theme-dark relative isolate min-h-screen overflow-x-hidden text-slate-100"
      data-testid="marketing-landing"
      data-vf-brand-theme="aurora"
    >
      <a className="vf-marketing-skip-link" href="#main-content">
        Skip to main content
      </a>

      <div className="vf-marketing-backdrop" aria-hidden="true" />
      <div className="vf-marketing-grid" aria-hidden="true" />
      <div className="vf-marketing-spotlight vf-marketing-spotlight-a" aria-hidden="true" />
      <div className="vf-marketing-spotlight vf-marketing-spotlight-b" aria-hidden="true" />

      <header className="vf-marketing-header">
        <div className="vf-marketing-header__inner">
          <a
            href="/landing"
            className="vf-marketing-header__brand"
          >
            <BrandLogo size="sm" tone="light" />
          </a>

          <nav className="vf-marketing-header__nav" aria-label="Landing sections">
            {navLinks.map((link) => (
              <a key={link.href} href={link.href} className="vf-marketing-header__nav-link">
                {link.label}
              </a>
            ))}
          </nav>

          <div className="vf-marketing-header__actions">
            <a href="/billing" className="vf-marketing-header__secondary">
              Pricing
            </a>
            <a href={signupHref} className="vf-marketing-header__primary" data-testid="hero-primary-cta">
              Start free
              <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </header>

      <main id="main-content">
        <section className="vf-marketing-hero">
          <div className="vf-marketing-hero__inner">
            <div className="vf-marketing-hero__copy">
              <p className="vf-marketing-kicker animate-fade-in-up">Premium AI voice studio</p>
              <h1 className="vf-marketing-hero__title animate-fade-in-up">
                Publish voice work that already sounds finished.
              </h1>
              <p className="vf-marketing-hero__lede animate-fade-in-up">
                V FLOW AI brings Prime multi-speaker scenes, voice-clone proof, live direction, and reader approvals
                into one listening-first studio. The landing now opens with the proof itself, not placeholder product copy.
              </p>

              <div className="vf-marketing-hero__actions animate-fade-in-up">
                <a href={studioHref} className="vf-marketing-cta vf-marketing-cta--primary">
                  Open studio
                  <ArrowRight size={16} />
                </a>
                <a href="#multi-speaker" className="vf-marketing-cta vf-marketing-cta--secondary">
                  Hear Prime scenes
                </a>
              </div>

              <div className="vf-marketing-proof-note animate-fade-in-up" aria-label="Landing proof note">
                {heroSignals.map((signal) => (
                  <span key={signal} className="vf-marketing-proof-pill">
                    {signal}
                  </span>
                ))}
              </div>

              <div className="vf-marketing-stat-grid animate-fade-in-up">
                {heroStats.map((stat) => (
                  <div key={stat.label} className="vf-marketing-stat">
                    <p className="vf-marketing-stat__label">{stat.label}</p>
                    <p className="vf-marketing-stat__value">{stat.value}</p>
                    <p className="vf-marketing-stat__detail">{stat.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="vf-marketing-hero__stage animate-fade-in-up" data-testid="hero-stage">
              <div className="vf-marketing-stage">
                <div className="vf-marketing-stage__topline">
                  <span className="vf-marketing-stage__eyebrow">
                    <Sparkles size={13} />
                    Featured Prime scene
                  </span>
                  <span className="vf-marketing-stage__badge">Publish-ready proof</span>
                </div>

                {featuredPrimeScene ? (
                  <>
                    <MarketingAudioCard
                      variant="hero"
                      eyebrow={`${featuredPrimeScene.useCase} / ${featuredPrimeScene.market}`}
                      title={featuredPrimeScene.title}
                      summary={featuredPrimeScene.translation}
                      audioSrc={featuredPrimeScene.audioSrc}
                      ariaLabel={`${featuredPrimeScene.title} preview`}
                      badges={[
                        { label: 'Prime engine', tone: 'accent' },
                        { label: featuredPrimeScene.scene, tone: 'neutral' },
                      ]}
                      cast={featuredPrimeScene.cast}
                      note={featuredPrimeScene.cue}
                      downloadFileName={`${featuredPrimeScene.id}.wav`}
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

          <div className="vf-marketing-anchor-strip" aria-label="Quick jump navigation">
            {navLinks.map((link) => (
              <a key={link.href} href={link.href} className="vf-marketing-anchor-link">
                {link.label}
              </a>
            ))}
          </div>
        </section>

        <section id="single-speaker" data-testid="landing-single-speaker" className="vf-marketing-section">
          <div className="vf-marketing-section__intro">
            <p className="vf-marketing-section__eyebrow">
              <Mic2 size={13} />
              Single-speaker system
            </p>
            <h2 className="vf-marketing-section__title">Localized reads for launch films, explainer cuts, and campaign spots.</h2>
            <p className="vf-marketing-section__body">
              These clips give the page a clean first layer of proof: short polished reads that show how the studio sounds before cast complexity enters the frame.
            </p>
          </div>

          <div className="vf-marketing-audio-grid">
            {LANDING_SINGLE_SPEAKER_DEMOS.map((demo) => (
              <MarketingAudioCard
                key={demo.id}
                eyebrow={`${demo.language} / ${demo.market}`}
                title={demo.title}
                summary={demo.summary}
                audioSrc={demo.audioSrc}
                ariaLabel={`${demo.title} preview`}
                badges={[
                  { label: 'Single voice', tone: 'neutral' },
                  { label: demo.language, tone: 'warm' },
                ]}
                note={demo.cue}
                downloadFileName={`${demo.id}.wav`}
              />
            ))}
          </div>
        </section>

        <section id="multi-speaker" data-testid="landing-multi-speaker" className="vf-marketing-section">
          <div className="vf-marketing-section__intro">
            <p className="vf-marketing-section__eyebrow">
              <WandSparkles size={13} />
              Prime multi-speaker scenes
            </p>
            <h2 className="vf-marketing-section__title">Five cast-aware scenes, all surfaced on the page and ready to compare.</h2>
            <p className="vf-marketing-section__body">
              The reel now shows the full Prime set instead of a partial sample, including the Arabic documentary scene that was missing from the public page.
            </p>
          </div>

          <div className="vf-marketing-scene-grid">
            {LANDING_MULTI_SPEAKER_DEMOS.map((demo) => (
              <article key={demo.id} className="vf-marketing-scene">
                <div className="vf-marketing-scene__copy">
                  <div className="vf-marketing-scene__meta">
                    <span>{demo.scene}</span>
                    <span>{demo.useCase}</span>
                    <span>{demo.market}</span>
                  </div>
                  <h3 className="vf-marketing-scene__title">{demo.title}</h3>
                  <p className="vf-marketing-scene__summary">{demo.summary}</p>
                  <p className="vf-marketing-scene__translation">{demo.translation}</p>

                  <div className="vf-marketing-cast-grid" aria-label={`${demo.title} cast`}>
                    {demo.cast.map((member) => (
                      <span key={`${demo.id}-${member}`} className="vf-marketing-cast-chip">
                        {member}
                      </span>
                    ))}
                  </div>
                </div>

                <MarketingAudioCard
                  eyebrow={`${demo.useCase} / Prime`}
                  title={demo.title}
                  summary={demo.translation}
                  audioSrc={demo.audioSrc}
                  ariaLabel={`${demo.title} preview`}
                  badges={[
                    { label: demo.scene, tone: 'neutral' },
                    { label: 'Prime engine', tone: 'accent' },
                  ]}
                  note={demo.cue}
                  downloadFileName={`${demo.id}.wav`}
                />
              </article>
            ))}
          </div>
        </section>

        <section id="voice-cloning" data-testid="landing-voice-cloning" className="vf-marketing-section">
          <div className="vf-marketing-section__intro">
            <p className="vf-marketing-section__eyebrow">
              <Sparkles size={13} />
              Voice cloning proof
            </p>
            <h2 className="vf-marketing-section__title">Compare the reference and rendered clone without leaving the landing.</h2>
            <p className="vf-marketing-section__body">{LANDING_VOICE_CLONE_PROOF.summary}</p>
          </div>

          <div className="vf-marketing-feature-panel">
            <MarketingAudioCard
              eyebrow="Reference source"
              title={LANDING_VOICE_CLONE_PROOF.source.label}
              summary="Original source material used to guide the rendered voice clone."
              audioSrc={LANDING_VOICE_CLONE_PROOF.source.audioSrc}
              ariaLabel={`${LANDING_VOICE_CLONE_PROOF.source.label} preview`}
              badges={[{ label: 'OpenVoice', tone: 'neutral' }]}
              note={LANDING_VOICE_CLONE_PROOF.source.name}
              downloadFileName={LANDING_VOICE_CLONE_PROOF.source.name}
            />
            <MarketingAudioCard
              eyebrow="Rendered output"
              title={LANDING_VOICE_CLONE_PROOF.rendered.label}
              summary="Final clone output positioned next to the source for fast approval."
              audioSrc={LANDING_VOICE_CLONE_PROOF.rendered.audioSrc}
              ariaLabel={`${LANDING_VOICE_CLONE_PROOF.rendered.label} preview`}
              badges={[{ label: 'Clone render', tone: 'accent' }]}
              note={LANDING_VOICE_CLONE_PROOF.rendered.name}
              downloadFileName={LANDING_VOICE_CLONE_PROOF.rendered.name}
            />
          </div>
        </section>

        <section id="ai-director" data-testid="landing-ai-director" className="vf-marketing-section">
          <div className="vf-marketing-section__intro">
            <p className="vf-marketing-section__eyebrow">
              <AudioLines size={13} />
              AI Director
            </p>
            <h2 className="vf-marketing-section__title">Direct the scene before it reaches final render.</h2>
            <p className="vf-marketing-section__body">{LANDING_DIRECTOR_PROOF.summary}</p>
          </div>

          <div className="vf-marketing-feature-panel vf-marketing-feature-panel--director">
            <div className="vf-marketing-feature-panel__block">
              <p className="vf-marketing-block__label">Live prompt contract</p>
              <pre className="vf-marketing-prompt" data-testid="landing-ai-director-prompt">
                {LANDING_DIRECTOR_PROOF.prompt}
              </pre>
            </div>

            <div className="vf-marketing-feature-panel__block">
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
                {LANDING_DIRECTOR_PROOF.bullets.map((bullet) => (
                  <div key={bullet.label} className="vf-marketing-director-bullet">
                    <p className="vf-marketing-block__label">{bullet.label}</p>
                    <p>{bullet.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="reader-playback" data-testid="landing-reader-playback" className="vf-marketing-section">
          <div className="vf-marketing-section__intro">
            <p className="vf-marketing-section__eyebrow">
              <BookOpen size={13} />
              Reader playback
            </p>
            <h2 className="vf-marketing-section__title">Carry the script into listening review and final approval.</h2>
            <p className="vf-marketing-section__body">{LANDING_READER_PROOF.summary}</p>
          </div>

          <div className="vf-marketing-reader-deck">
            <aside className="vf-marketing-reader-deck__rail">
              <div className="vf-marketing-reader-deck__head">
                <div>
                  <p className="vf-marketing-block__label">{LANDING_READER_PROOF.modeLabel}</p>
                  <h3>{LANDING_READER_PROOF.title}</h3>
                </div>
                <span className="vf-marketing-reader-deck__status">{LANDING_READER_PROOF.progressLabel}</span>
              </div>

              <div className="vf-marketing-reader-deck__list">
                {LANDING_READER_PROOF.units.map((unit) => (
                  <div key={unit.id} className="vf-marketing-reader-deck__item">
                    <div className="vf-marketing-reader-deck__item-head">
                      <p>{unit.title}</p>
                      <span>{unit.status}</span>
                    </div>
                    <p>{unit.body}</p>
                  </div>
                ))}
              </div>
            </aside>

            <section className="vf-marketing-reader-deck__stage">
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
                    Review pacing, structure, and scene continuity in the same product lane.
                  </p>
                </div>
              </div>
            </section>
          </div>
        </section>

        <section className="vf-marketing-final-cta" data-testid="landing-final-cta">
          <div className="vf-marketing-final-cta__panel">
            <p className="vf-marketing-kicker">Ready to publish</p>
            <h2 className="vf-marketing-final-cta__title">
              Start in the studio, listen through the proof, and ship work that already sounds premium.
            </h2>
            <p className="vf-marketing-final-cta__body">
              The landing now surfaces the full Prime scene set, upgraded players, clone comparison, direction prompt, and reader review story in one publish-ready flow.
            </p>
            <div className="vf-marketing-hero__actions">
              <a href={studioHref} className="vf-marketing-cta vf-marketing-cta--primary">
                Open studio
                <ArrowRight size={16} />
              </a>
              <a href="/billing" className="vf-marketing-cta vf-marketing-cta--secondary">
                View pricing
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="vf-marketing-footer">
        <div className="vf-marketing-footer__inner">
          <div>
            <BrandLogo size="md" tone="light" />
            <p className="vf-marketing-footer__copy">
              V FLOW AI is a premium listening-first studio for AI voice direction, multilingual production, voice cloning, and reader-grade approvals.
            </p>
            <div className="vf-marketing-footer__links">
              <a href={studioHref}>Studio</a>
              <a href="/billing">Pricing</a>
              <a href="/legal">Legal</a>
            </div>
          </div>

          <LegalLinks className="justify-start lg:justify-end" linkClassName="vf-marketing-legal-link" />
        </div>
      </footer>
    </div>
  );
}
