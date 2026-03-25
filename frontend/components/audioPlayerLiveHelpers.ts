export type PlayerSourceType = 'none' | 'live' | 'final';

export const shouldShowElapsedOnlyLiveTimeline = (input: {
  isLiveMode: boolean;
  activeSourceType: PlayerSourceType;
  audioUrl: string | null;
}): boolean => {
  const hasFinalSource = input.activeSourceType === 'final' && Boolean(input.audioUrl);
  return input.isLiveMode && !hasFinalSource;
};

export const shouldHoldLiveElapsedBetweenChunks = (input: {
  isGenerating: boolean;
  isLiveStreaming: boolean;
  hasFinalAudio: boolean;
}): boolean => {
  if (input.hasFinalAudio) return false;
  return Boolean(input.isGenerating || input.isLiveStreaming);
};

export const resolveSequentialLiveChunkIndexes = (input: {
  pendingIndexes: Iterable<number>;
  nextIndex: number;
}): { readyIndexes: number[]; nextIndex: number } => {
  const pendingSet = new Set<number>();
  for (const rawIndex of input.pendingIndexes) {
    const safeIndex = Math.max(0, Math.floor(Number(rawIndex) || 0));
    pendingSet.add(safeIndex);
  }
  const readyIndexes: number[] = [];
  let cursor = Math.max(0, Math.floor(Number(input.nextIndex) || 0));
  while (pendingSet.has(cursor)) {
    readyIndexes.push(cursor);
    cursor += 1;
  }
  return { readyIndexes, nextIndex: cursor };
};
