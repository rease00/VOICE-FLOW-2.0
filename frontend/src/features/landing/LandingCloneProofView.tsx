import { Copy } from 'lucide-react';
import { LandingCallToAction } from './LandingCallToAction';
import type { LandingVoiceCloneProof } from './landingData';
import { MarketingAudioCard } from './MarketingAudioCard';

interface LandingCloneProofViewProps {
  proof: LandingVoiceCloneProof;
}

export function LandingCloneProofView({ proof }: LandingCloneProofViewProps) {
  return (
    <>
      <section className="lp-page lp-page--detail" data-testid="landing-voice-cloning">
        <div className="lp-section">
          <div className="lp-section-head lp-page__intro" data-vf-reveal>
            <p className="lp-eyebrow"><Copy size={13} /> Clone Proof</p>
            <h1 className="lp-section-title">Reference and render stay together so approval is fast.</h1>
            <p className="lp-section-sub">
              This is the moment where Voice Flow keeps the decision honest: hear the original take, hear the clone, and move forward only when both line up.
            </p>
          </div>
          <div className="lp-clone-pair">
            <MarketingAudioCard
              eyebrow="Reference source"
              title={proof.source.label}
              summary="Original source used to guide the clone."
              audioSrc={proof.source.audioSrc}
              ariaLabel={`${proof.source.label} preview`}
              motionDelayMs={140}
              badges={[{ label: 'Reference', tone: 'neutral' }]}
              note={proof.source.name}
            />
            <MarketingAudioCard
              eyebrow="Rendered output"
              title={proof.rendered.label}
              summary="Rendered clone kept beside the source for a clear approval call."
              audioSrc={proof.rendered.audioSrc}
              ariaLabel={`${proof.rendered.label} preview`}
              motionDelayMs={220}
              badges={[{ label: 'Rendered clone', tone: 'accent' }]}
              note={proof.rendered.name}
            />
          </div>
        </div>
      </section>

      <LandingCallToAction
        kicker="Tighten delivery"
        title="After the voice matches, use direction prompts to shape the performance."
        body="The direction lane is built for editorial adjustments, not for rewriting the whole scene."
      />
    </>
  );
}
