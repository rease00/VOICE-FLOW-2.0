import type { CSSProperties } from 'react';
import { ArrowRight, AudioLines, Mic2, Sparkles, WandSparkles } from 'lucide-react';
import { APP_ROUTE_PATHS } from '../../app/navigation';
import type { LandingMultiSpeakerDemo, LandingSingleSpeakerDemo } from './landingData';
import { LandingCallToAction } from './LandingCallToAction';

const heroMeterScales = [0.42, 0.76, 0.54, 0.92, 0.62, 0.88, 0.48, 0.72] as const;

const delay = (ms: number): CSSProperties => ({ '--vf-marketing-delay': `${ms}ms` } as CSSProperties);

interface LandingOverviewViewProps {
  singleSpeakerDemos: readonly LandingSingleSpeakerDemo[];
  multiSpeakerDemos: readonly LandingMultiSpeakerDemo[];
}

export function LandingOverviewView({
  singleSpeakerDemos,
  multiSpeakerDemos,
}: LandingOverviewViewProps) {
  const featuredScene = multiSpeakerDemos[0];

  return (
    <>
      <section className="lp-hero lp-page" data-testid="landing-home">
        <div className="lp-hero__inner">
          <div className="lp-hero__copy">
            <div className="lp-hero__badge" data-vf-reveal style={delay(60)}>
              <span className="lp-hero__badge-dot" />
              Voice Flow product tour
            </div>
            <h1 className="lp-hero__title" data-testid="landing-home-hero" data-vf-reveal style={delay(140)}>
              Audition voices.
              <br />
              Direct scenes.
              <br />
              <span className="lp-hero__title-gradient">Approve the final take.</span>
            </h1>
            <p className="lp-hero__sub" data-vf-reveal style={delay(220)}>
              Voice Flow gives creators one clear path from quick single-voice reads to
              multi-speaker scenes, AI direction, and studio-level review.
            </p>
            <div className="lp-hero__actions" data-vf-reveal style={delay(300)}>
              <a href={APP_ROUTE_PATHS.studio} className="lp-btn-primary">
                Open Studio <ArrowRight size={16} />
              </a>
              <a href="/landing/single-voice" className="lp-btn-secondary">
                Start the tour
              </a>
            </div>
            <div className="lp-proof-strip" data-vf-reveal style={delay(360)}>
              <span className="lp-proof-chip"><Mic2 size={14} /> {singleSpeakerDemos.length} real voice previews</span>
              <span className="lp-proof-chip"><WandSparkles size={14} /> {multiSpeakerDemos.length} multi-speaker demos</span>
              <span className="lp-proof-chip"><AudioLines size={14} /> direction pass included</span>
            </div>
          </div>

          {featuredScene ? (
            <div className="lp-hero__stage" data-vf-reveal style={delay(260)}>
              <div className="lp-stage">
                <div className="lp-stage__header">
                  <span className="lp-stage__label"><Sparkles size={11} /> Featured prime scene</span>
                  <span className="lp-stage__live"><span className="lp-stage__live-dot" aria-hidden="true" /> Guided tour</span>
                </div>
                <div className="lp-stage__meter" aria-hidden="true">
                  {heroMeterScales.map((scale, index) => (
                    <span
                      key={`overview-meter-${index}`}
                      className="lp-stage__meter-bar"
                      style={{ '--lp-meter-scale': scale, animationDelay: `${index * 160}ms` } as CSSProperties}
                    />
                  ))}
                </div>
                <div className="lp-stage__body">
                  <p style={{ color: 'var(--lp-accent, #38e8d0)', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', margin: '0 0 0.45rem' }}>
                    {featuredScene.useCase} / {featuredScene.market}
                  </p>
                  <h3 style={{ color: 'white', fontSize: '1.05rem', fontWeight: 800, margin: '0 0 0.45rem' }}>
                    {featuredScene.title}
                  </h3>
                  <p style={{ color: 'rgba(203,213,225,0.72)', fontSize: '0.88rem', lineHeight: 1.65, margin: '0 0 1rem' }}>
                    {featuredScene.summary}
                  </p>
                  <p style={{ color: 'rgba(203,213,225,0.52)', fontStyle: 'italic', fontSize: '0.8rem', margin: 0 }}>
                    {featuredScene.cue}
                  </p>
                </div>
                <div className="lp-stage__footer" aria-label="Cast members">
                  {featuredScene.cast.map((member, index) => (
                    <span key={`${member}-${index}`} className="lp-stage__cast-chip">{member}</span>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="lp-features lp-page__body">
        <div className="lp-section">
          <div className="lp-section-head" data-vf-reveal>
            <p className="lp-eyebrow"><AudioLines size={13} /> Voice Flow in one pass</p>
            <h2 className="lp-section-title">Four product lanes, one cleaner review flow.</h2>
            <p className="lp-section-sub">
              Start on the surface you need, keep the proof visible, and move forward when you are ready.
            </p>
          </div>
          <div className="lp-features__grid">
            <a href="/landing/single-voice" className="lp-feature-card" data-vf-reveal>
              <div className="lp-feature-icon"><Mic2 size={20} /></div>
              <h3 className="lp-feature-title">Single Voice</h3>
              <p className="lp-feature-body">Run short reads quickly when you need tone, pacing, and language checks before the full studio.</p>
              <span className="lp-feature-tag">Fast audition</span>
            </a>
            <a href="/landing/prime-scenes" className="lp-feature-card" data-vf-reveal style={delay(70)}>
              <div className="lp-feature-icon"><WandSparkles size={20} /></div>
              <h3 className="lp-feature-title">Prime Scenes</h3>
              <p className="lp-feature-body">Hear cast handoffs, contrast, and scene rhythm without digging through a crowded interface.</p>
              <span className="lp-feature-tag">Multi-speaker proof</span>
            </a>
            <a href="/landing/direction" className="lp-feature-card" data-vf-reveal style={delay(140)}>
              <div className="lp-feature-icon"><AudioLines size={20} /></div>
              <h3 className="lp-feature-title">AI Direction</h3>
              <p className="lp-feature-body">Tighten emphasis and handoffs with a prompt contract that stays readable before rerender.</p>
              <span className="lp-feature-tag">Editorial control</span>
            </a>
          </div>
        </div>
      </section>

      <LandingCallToAction
        kicker="Open the workflow"
        title="Use the public tour to choose your lane, then continue in the full studio."
        body="The public pages stay compact on purpose. Once you know the surface you want, the studio picks up the heavier production work."
      />
    </>
  );
}
