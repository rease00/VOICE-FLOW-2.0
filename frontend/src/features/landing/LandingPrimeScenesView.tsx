import { WandSparkles } from 'lucide-react';
import { LandingCallToAction } from './LandingCallToAction';
import type { LandingMultiSpeakerDemo } from './landingData';
import { MarketingAudioCard } from './MarketingAudioCard';

interface LandingPrimeScenesViewProps {
  demos: readonly LandingMultiSpeakerDemo[];
}

export function LandingPrimeScenesView({ demos }: LandingPrimeScenesViewProps) {
  return (
    <>
      <section className="lp-page lp-page--detail" data-testid="landing-multi-speaker">
        <div className="lp-section">
          <div className="lp-section-head lp-page__intro" data-vf-reveal>
            <p className="lp-eyebrow"><WandSparkles size={13} /> Prime Scenes</p>
            <h1 className="lp-section-title">Review the cast, pacing, and handoff before you open the heavier workspace.</h1>
            <p className="lp-section-sub">
              Prime Scenes are generated from the real app workflow so teams can hear final handoffs,
              pacing, and cast contrast before opening the heavy workspace.
            </p>
          </div>
          <div className="lp-audio-grid">
            {demos.map((demo, index) => (
              <MarketingAudioCard
                key={demo.id}
                variant="scene"
                eyebrow={`${demo.scene} / ${demo.market}`}
                title={demo.title}
                summary={demo.summary}
                audioSrc={demo.audioSrc}
                ariaLabel={`${demo.title} preview`}
                motionDelayMs={120 + index * 90}
                badges={[
                  { label: 'Prime scene', tone: 'accent' },
                  { label: `${demo.cast.length} voices`, tone: 'neutral' },
                ]}
                cast={demo.cast}
                note={demo.cue}
              />
            ))}
          </div>
        </div>
      </section>

      <LandingCallToAction
        kicker="Move into direction"
        title="Once the scene works, shape the delivery before you render the final pass."
        body="AI Direction picks up right after Prime Scenes so the team can tighten emphasis, handoffs, and pacing without leaving the flow."
      />
    </>
  );
}
