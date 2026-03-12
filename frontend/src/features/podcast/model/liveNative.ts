export {
  PODCAST_DEFAULT_CAST as LIVE_PODCAST_DEFAULT_CAST,
  PODCAST_DEFAULT_LIVE_PACING as LIVE_PODCAST_DEFAULT_PACING,
  PODCAST_DEFAULT_TOPIC as LIVE_PODCAST_DEFAULT_TOPIC,
  PODCAST_LIVE_DURATION_OPTIONS as LIVE_PODCAST_DURATION_OPTIONS,
  type LivePodcastJobRequest,
  type PodcastArtifacts as LivePodcastArtifacts,
  type PodcastCastMember as LivePodcastCastMember,
  type PodcastChunk as LivePodcastChunk,
  type PodcastOrchestrationState as LivePodcastOrchestrationState,
} from './podcast';

export const LIVE_PODCAST_DEFAULT_SPEAKER_COUNT: 2 | 3 | 4 = 4;
export const LIVE_PODCAST_DEFAULT_DURATION_SEC = 180;
export const LIVE_PODCAST_CAST_FALLBACK = {
  id: 'lead',
  name: 'LEAD',
  role: 'show lead',
  voice: 'Zephyr',
  persona: 'Strong opener who sets direction and keeps pacing tight.',
} as const;
