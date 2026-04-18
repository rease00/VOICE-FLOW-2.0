import './MarketingLanding.css';

import { LandingDirectionView } from './LandingDirectionView';
import { LandingOverviewView } from './LandingOverviewView';
import { LandingPrimeScenesView } from './LandingPrimeScenesView';
import { LandingReaderView } from './LandingReaderView';
import { LandingShell } from './LandingShell';
import { LandingSingleVoiceView } from './LandingSingleVoiceView';
import type {
  LandingDirectorProof,
  LandingMultiSpeakerDemo,
  LandingReaderProof,
  LandingSingleSpeakerDemo,
} from './landingData';
import {
  LANDING_DIRECTOR_PROOF,
  LANDING_MULTI_SPEAKER_DEMOS,
  LANDING_READER_PROOF,
  LANDING_SINGLE_SPEAKER_DEMOS,
} from './landingData';
import {
  resolveLandingNextAction,
  type LandingPageVariant,
} from './landingTabs';

interface MarketingLandingProps {
  activePage?: LandingPageVariant;
  singleSpeakerDemos?: readonly LandingSingleSpeakerDemo[];
  multiSpeakerDemos?: readonly LandingMultiSpeakerDemo[];
  directorProof?: LandingDirectorProof;
  readerProof?: LandingReaderProof;
}

export function MarketingLanding({
  activePage = 'overview',
  singleSpeakerDemos = LANDING_SINGLE_SPEAKER_DEMOS,
  multiSpeakerDemos = LANDING_MULTI_SPEAKER_DEMOS,
  directorProof = LANDING_DIRECTOR_PROOF,
  readerProof = LANDING_READER_PROOF,
}: MarketingLandingProps) {
  const nextAction = resolveLandingNextAction(activePage);

  const content = (() => {
    switch (activePage) {
      case 'single-voice':
        return <LandingSingleVoiceView demos={singleSpeakerDemos} />;
      case 'prime-scenes':
        return <LandingPrimeScenesView demos={multiSpeakerDemos} />;
      case 'direction':
        return <LandingDirectionView proof={directorProof} />;
      case 'reader':
        return <LandingReaderView proof={readerProof} />;
      case 'overview':
      default:
        return (
          <LandingOverviewView
            singleSpeakerDemos={singleSpeakerDemos}
            multiSpeakerDemos={multiSpeakerDemos}
          />
        );
    }
  })();

  return (
    <LandingShell activePage={activePage} nextAction={nextAction}>
      {content}
    </LandingShell>
  );
}
