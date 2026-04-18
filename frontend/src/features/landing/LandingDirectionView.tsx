import type { CSSProperties } from 'react';
import { Brain } from 'lucide-react';
import { LandingCallToAction } from './LandingCallToAction';
import type { LandingDirectorProof } from './landingData';

interface LandingDirectionViewProps {
  proof: LandingDirectorProof;
}

export function LandingDirectionView({ proof }: LandingDirectionViewProps) {
  return (
    <>
      <section className="lp-page lp-page--detail" data-testid="landing-ai-director">
        <div className="lp-section">
          <div className="lp-section-head lp-page__intro" data-vf-reveal>
            <p className="lp-eyebrow"><Brain size={13} /> AI Direction</p>
            <h1 className="lp-section-title">Direction stays readable, so the team can review the change before rerender.</h1>
            <p className="lp-section-sub">
              Voice Flow uses a structured prompt contract so delivery changes are visible, discussable, and easier to approve.
            </p>
          </div>
          <div className="lp-direction-panel">
            <div
              className="lp-direction-block"
              data-testid="landing-ai-director-prompt"
              data-vf-reveal
              style={{ '--vf-marketing-delay': '140ms' } as CSSProperties}
            >
              <p className="lp-direction-block__label">Live prompt contract</p>
              <pre>{proof.prompt}</pre>
            </div>
            <div className="lp-direction-block" data-vf-reveal style={{ '--vf-marketing-delay': '220ms' } as CSSProperties}>
              <p className="lp-direction-block__label">Delivery comparison</p>
              <div className="lp-before-after">
                <div className="lp-ba-item">
                  <p className="lp-ba-label">Before</p>
                  <p className="lp-ba-text">{proof.before}</p>
                </div>
                <div className="lp-ba-item lp-ba-item--after">
                  <p className="lp-ba-label">After</p>
                  <p className="lp-ba-text">{proof.after}</p>
                </div>
              </div>
              <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {proof.bullets.map((bullet, index) => (
                  <div key={`${bullet.label}-${index}`} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <span style={{ color: 'var(--lp-accent, #38e8d0)', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                      {bullet.label}
                    </span>
                    <span style={{ color: 'rgba(203,213,225,0.78)', fontSize: '0.88rem', lineHeight: 1.65 }}>
                      {bullet.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <LandingCallToAction
        kicker="Final review"
        title="After direction is locked, the lighter reader surface takes over."
        body="The final pass is about continuity, listening, and approval without crowding the screen."
      />
    </>
  );
}
