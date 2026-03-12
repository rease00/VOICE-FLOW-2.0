let sharedAudioContext: AudioContext | null = null;

export const getSharedAudioContext = (): AudioContext => {
  if (typeof window === 'undefined') {
    throw new Error('Audio playback is unavailable during server-side execution.');
  }

  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('Audio playback is not supported in this browser.');
    }
    sharedAudioContext = new AudioContextClass();
  }

  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume().catch(() => undefined);
  }

  return sharedAudioContext;
};
