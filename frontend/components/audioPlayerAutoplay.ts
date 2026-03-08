type PlayerSourceType = 'none' | 'live' | 'final';

export interface AutoplayFirstLiveChunkInput {
  autoPlayOnFirstChunk: boolean;
  activeSourceType: PlayerSourceType;
  isPlaying: boolean;
  liveQueueSize: number;
}

export const shouldAutoplayFirstLiveChunk = (input: AutoplayFirstLiveChunkInput): boolean => {
  if (!input.autoPlayOnFirstChunk) return false;
  if (input.activeSourceType !== 'none') return false;
  if (input.isPlaying) return false;
  return input.liveQueueSize > 0;
};
