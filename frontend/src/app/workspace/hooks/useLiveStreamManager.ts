import { useState, useRef, useCallback, useEffect } from 'react';

export interface LiveAudioChunk {
  jobId: string;
  index: number;
  contentType?: string;
  durationMs?: number;
  audioBase64?: string;
}

export const useLiveStreamManager = () => {
  const [liveChunks, setLiveChunks] = useState<LiveAudioChunk[]>([]);
  const [isLiveStreaming, setIsLiveStreaming] = useState(false);
  const seenChunkKeysRef = useRef<Set<string>>(new Set());

  const addChunk = useCallback((chunk: LiveAudioChunk) => {
    const key = `${chunk.jobId}:${chunk.index}`;
    if (seenChunkKeysRef.current.has(key)) return;
    
    seenChunkKeysRef.current.add(key);
    setLiveChunks((prev) => [...prev, chunk]);
  }, []);

  const resetLiveStream = useCallback(() => {
    setLiveChunks([]);
    setIsLiveStreaming(false);
    seenChunkKeysRef.current.clear();
  }, []);

  const startLiveStream = useCallback(() => {
    resetLiveStream();
    setIsLiveStreaming(true);
  }, [resetLiveStream]);

  const stopLiveStream = useCallback(() => {
    setIsLiveStreaming(false);
  }, []);

  return {
    liveChunks,
    isLiveStreaming,
    addChunk,
    startLiveStream,
    stopLiveStream,
    resetLiveStream,
  };
};
