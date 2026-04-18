export type PlayerSourceType = 'none' | 'live' | 'final';

export interface LivePlaybackEntry {
  index: number;
  url: string;
  revokeOnRelease: boolean;
}

export interface LivePlaybackState {
  sessionKey: string;
  nextIndex: number;
  currentEntry: LivePlaybackEntry | null;
  queuedEntries: LivePlaybackEntry[];
}

export interface PreparedLivePlaybackChunk extends LivePlaybackEntry {
  sessionKey: string;
}

export const createLivePlaybackState = (): LivePlaybackState => ({
  sessionKey: '',
  nextIndex: 0,
  currentEntry: null,
  queuedEntries: [],
});

const releaseTrackedEntryUrls = (entries: LivePlaybackEntry[]): string[] => (
  entries
    .filter((entry) => entry.revokeOnRelease && entry.url)
    .map((entry) => entry.url)
);

export const resolveLivePlaybackSessionKey = (input: {
  jobId?: string;
  sessionEpoch?: number;
}): string => {
  const jobId = String(input.jobId || '').trim();
  if (!jobId) return '';
  const sessionEpoch = Math.max(0, Math.floor(Number(input.sessionEpoch) || 0));
  return sessionEpoch > 0 ? `${jobId}:${sessionEpoch}` : jobId;
};

export const resetLivePlaybackState = (
  state: LivePlaybackState,
  nextSessionKey: string = '',
): { state: LivePlaybackState; revokedUrls: string[] } => {
  const revokedUrls = releaseTrackedEntryUrls([
    ...(state.currentEntry ? [state.currentEntry] : []),
    ...state.queuedEntries,
  ]);
  return {
    state: {
      sessionKey: String(nextSessionKey || '').trim(),
      nextIndex: 0,
      currentEntry: null,
      queuedEntries: [],
    },
    revokedUrls,
  };
};

export const appendLivePlaybackChunks = (
  state: LivePlaybackState,
  chunks: PreparedLivePlaybackChunk[],
): { state: LivePlaybackState; revokedUrls: string[] } => {
  if (chunks.length <= 0) {
    return { state, revokedUrls: [] };
  }

  const incomingSessionKey = chunks.find((chunk) => chunk.sessionKey)?.sessionKey || state.sessionKey;
  let workingState = state;
  let revokedUrls: string[] = [];

  if (incomingSessionKey && incomingSessionKey !== state.sessionKey) {
    const reset = resetLivePlaybackState(state, incomingSessionKey);
    workingState = reset.state;
    revokedUrls = [...revokedUrls, ...reset.revokedUrls];
  }

  const knownIndexes = new Set<number>();
  if (workingState.currentEntry) {
    knownIndexes.add(workingState.currentEntry.index);
  }
  workingState.queuedEntries.forEach((entry) => {
    knownIndexes.add(entry.index);
  });

  const pendingByIndex = new Map<number, PreparedLivePlaybackChunk>();
  [...chunks]
    .sort((left, right) => left.index - right.index)
    .forEach((chunk) => {
      if (!chunk.url) return;
      if (workingState.sessionKey && chunk.sessionKey && chunk.sessionKey !== workingState.sessionKey) {
        if (chunk.revokeOnRelease) revokedUrls.push(chunk.url);
        return;
      }
      if (knownIndexes.has(chunk.index) || pendingByIndex.has(chunk.index)) {
        if (chunk.revokeOnRelease) revokedUrls.push(chunk.url);
        return;
      }
      pendingByIndex.set(chunk.index, chunk);
    });

  const readyIndexes = resolveSequentialLiveChunkIndexes({
    pendingIndexes: pendingByIndex.keys(),
    nextIndex: workingState.nextIndex,
  });

  const acceptedEntries: LivePlaybackEntry[] = readyIndexes.readyIndexes
    .map((index) => pendingByIndex.get(index))
    .filter((entry): entry is PreparedLivePlaybackChunk => Boolean(entry))
    .map((entry) => ({
      index: entry.index,
      url: entry.url,
      revokeOnRelease: entry.revokeOnRelease,
    }));

  pendingByIndex.forEach((entry, index) => {
    if (readyIndexes.readyIndexes.includes(index)) return;
    if (entry.revokeOnRelease) revokedUrls.push(entry.url);
  });

  if (acceptedEntries.length <= 0) {
    return {
      state: {
        ...workingState,
        nextIndex: readyIndexes.nextIndex,
      },
      revokedUrls,
    };
  }

  const nextCurrentEntry = workingState.currentEntry || acceptedEntries.shift() || null;

  return {
    state: {
      ...workingState,
      nextIndex: readyIndexes.nextIndex,
      currentEntry: nextCurrentEntry,
      queuedEntries: [...workingState.queuedEntries, ...acceptedEntries],
    },
    revokedUrls,
  };
};

export const advanceLivePlaybackState = (
  state: LivePlaybackState,
): { state: LivePlaybackState; revokedUrls: string[] } => {
  const revokedUrls = state.currentEntry && state.currentEntry.revokeOnRelease
    ? [state.currentEntry.url]
    : [];

  if (state.queuedEntries.length <= 0) {
    return {
      state: {
        ...state,
        currentEntry: null,
      },
      revokedUrls,
    };
  }

  const [nextEntry, ...rest] = state.queuedEntries;
  return {
    state: {
      ...state,
      currentEntry: nextEntry || null,
      queuedEntries: rest,
    },
    revokedUrls,
  };
};

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
