type PlayerSourceType = 'none' | 'live' | 'final';

export interface AutoplayFirstLiveChunkInput {
  autoPlayOnFirstChunk: boolean;
  activeSourceType: PlayerSourceType;
  currentLiveIndex: number;
  isPlaying: boolean;
  lastAutoplayedLiveIndex: number;
}

export const shouldAutoplayFirstLiveChunk = (input: AutoplayFirstLiveChunkInput): boolean => {
  if (!input.autoPlayOnFirstChunk) return false;
  if (input.activeSourceType !== 'live') return false;
  if (input.isPlaying) return false;
  if (!Number.isFinite(input.currentLiveIndex) || input.currentLiveIndex < 0) return false;
  return input.currentLiveIndex !== input.lastAutoplayedLiveIndex;
};

export interface AutoplayGeneratedAudioInput {
  autoPlayGeneratedAudio: boolean;
  activeSourceType: PlayerSourceType;
  activeUrl: string | null;
  finalAudioUrl: string | null;
  autoplayNonce: number;
  lastConsumedAutoplayNonce: number;
}

export const shouldAutoplayGeneratedAudio = (input: AutoplayGeneratedAudioInput): boolean => {
  if (!input.autoPlayGeneratedAudio) return false;
  if (input.activeSourceType !== 'final') return false;
  if (!input.activeUrl || !input.finalAudioUrl) return false;
  if (input.activeUrl !== input.finalAudioUrl) return false;
  if (!Number.isFinite(input.autoplayNonce) || input.autoplayNonce <= 0) return false;
  return input.autoplayNonce !== input.lastConsumedAutoplayNonce;
};
