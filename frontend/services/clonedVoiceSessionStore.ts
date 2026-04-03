import type { ClonedVoice } from '../types';

let sessionClonedVoices: ClonedVoice[] = [];
const CLONED_VOICE_STORAGE_KEY = 'vf_session_cloned_voices_v1';

const readPersistedClonedVoices = (): ClonedVoice[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = String(window.localStorage.getItem(CLONED_VOICE_STORAGE_KEY) || '').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ClonedVoice[]) : [];
  } catch {
    return [];
  }
};

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
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(CLONED_VOICE_STORAGE_KEY, JSON.stringify(sessionClonedVoices));
    } catch {
      // Best effort only.
    }
  }
};

export const addSessionClonedVoice = (voice: ClonedVoice): void => {
  const next = [voice, ...sessionClonedVoices.filter((item) => item.id !== voice.id)];
  setSessionClonedVoices(next);
};

export const clearSessionClonedVoices = (): void => {
  sessionClonedVoices = [];
  syncWindowCache([]);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(CLONED_VOICE_STORAGE_KEY);
    } catch {
      // Best effort only.
    }
  }
};

export const getSessionClonedVoices = (): ClonedVoice[] => {
  if (typeof window !== 'undefined') {
    const globalVoices = (window as unknown as { __vfSessionClonedVoices?: ClonedVoice[] }).__vfSessionClonedVoices;
    if (Array.isArray(globalVoices)) {
      return globalVoices;
    }
    const persistedVoices = readPersistedClonedVoices();
    if (persistedVoices.length > 0) {
      sessionClonedVoices = [...persistedVoices];
      syncWindowCache(sessionClonedVoices);
      return sessionClonedVoices;
    }
  }
  return sessionClonedVoices;
};
