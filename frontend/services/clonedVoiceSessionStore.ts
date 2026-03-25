import type { ClonedVoice } from '../types';

let sessionClonedVoices: ClonedVoice[] = [];

const syncWindowCache = (voices: ClonedVoice[]): void => {
  if (typeof window === 'undefined') return;
  try {
    (window as unknown as { __vfSessionClonedVoices?: ClonedVoice[] }).__vfSessionClonedVoices = voices;
  } catch {
    // Best effort only.
  }
};

export const setSessionClonedVoices = (voices: ClonedVoice[]): void => {
  sessionClonedVoices = Array.isArray(voices) ? [...voices] : [];
  syncWindowCache(sessionClonedVoices);
};

export const addSessionClonedVoice = (voice: ClonedVoice): void => {
  const next = [voice, ...sessionClonedVoices.filter((item) => item.id !== voice.id)];
  setSessionClonedVoices(next);
};

export const clearSessionClonedVoices = (): void => {
  sessionClonedVoices = [];
  syncWindowCache([]);
};

export const getSessionClonedVoices = (): ClonedVoice[] => {
  if (typeof window !== 'undefined') {
    const globalVoices = (window as unknown as { __vfSessionClonedVoices?: ClonedVoice[] }).__vfSessionClonedVoices;
    if (Array.isArray(globalVoices)) {
      return globalVoices;
    }
  }
  return sessionClonedVoices;
};
