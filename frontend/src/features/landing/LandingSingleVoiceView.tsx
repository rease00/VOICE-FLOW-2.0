import { Mic2 } from 'lucide-react';
import { LandingCallToAction } from './LandingCallToAction';
import type { LandingSingleSpeakerDemo } from './landingData';
import { MarketingAudioCard } from './MarketingAudioCard';

interface LandingSingleVoiceViewProps {
  demos: readonly LandingSingleSpeakerDemo[];
}

export function LandingSingleVoiceView({ demos }: LandingSingleVoiceViewProps) {
  return (
    <>
      <section className="lp-page lp-page--detail" data-testid="landing-single-speaker">
        <div className="lp-section">
          <div className="lp-section-head lp-page__intro" data-vf-reveal>
            <p className="lp-eyebrow"><Mic2 size={13} /> Single Voice</p>
            <h1 className="lp-section-title">Hear short reads before you commit the scene.</h1>
            <p className="lp-section-sub">
              These app-generated previews mirror the same fast audition flow teams use inside
              Voice Flow for language checks, tone matching, and shorter approval loops.
            </p>
          </div>
          <div className="lp-audio-grid">
            {demos.map((demo, index) => (
              <MarketingAudioCard
                key={demo.id}
                eyebrow={`${demo.language} / ${demo.market}`}
                title={demo.title}
                summary={demo.summary}
                audioSrc={demo.audioSrc}
                ariaLabel={`${demo.title} preview`}
                motionDelayMs={120 + index * 80}
                badges={[
                  { label: 'Single voice', tone: 'neutral' },
                  { label: demo.language, tone: 'warm' },
                ]}
                note={demo.cue}
              />
            ))}
          </div>
        </div>
      </section>

      <LandingCallToAction
        kicker="Ready for the next lane"
        title="Move from short reads to full multi-speaker scene review."
        body="When the voice direction feels right, the next step is hearing the handoffs between the cast."
      />
    </>
  );
}
