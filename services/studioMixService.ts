import { MUSIC_TRACKS } from "../constants";
import { GenerationSettings } from "../types";

function getAudioContext(): AudioContext {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("AudioContext is not supported in this browser.");
  }
  return new AudioContextClass();
}

async function fetchTrackBuffer(url: string): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load music track (${res.status}).`);
  const data = await res.arrayBuffer();
  return await ctx.decodeAudioData(data);
}

export async function applyStudioAudioMix(
  speechBuffer: AudioBuffer,
  settings: GenerationSettings
): Promise<AudioBuffer> {
  const hasMusic = !!settings.musicTrackId && settings.musicTrackId !== "m_none";
  const speechGainValue = settings.speechVolume ?? 1.0;
  const musicGainValue = settings.musicVolume ?? 0.3;

  // Preserve source fidelity when no effective mix operation is requested.
  if (!hasMusic && Math.abs(speechGainValue - 1.0) < 0.001) {
    return speechBuffer;
  }

  const OfflineContextClass = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  if (!OfflineContextClass) {
    return speechBuffer;
  }

  const sampleRate = speechBuffer.sampleRate || 24000;
  const duration = speechBuffer.duration || 0;
  if (duration <= 0) return speechBuffer;
  const channels = Math.max(1, speechBuffer.numberOfChannels || 1);
  const offline = new OfflineContextClass(channels, Math.ceil(duration * sampleRate), sampleRate);

  const speechSource = offline.createBufferSource();
  speechSource.buffer = speechBuffer;
  const speechGain = offline.createGain();
  speechGain.gain.value = speechGainValue;
  speechSource.connect(speechGain);
  speechGain.connect(offline.destination);
  speechSource.start(0);

  if (hasMusic && musicGainValue > 0) {
    const track = MUSIC_TRACKS.find((t) => t.id === settings.musicTrackId);
    if (track?.url) {
      try {
        const musicBuffer = await fetchTrackBuffer(track.url);
        const musicGain = offline.createGain();
        musicGain.gain.value = musicGainValue;
        musicGain.connect(offline.destination);

        let cursor = 0;
        while (cursor < duration) {
          const musicSource = offline.createBufferSource();
          musicSource.buffer = musicBuffer;
          musicSource.connect(musicGain);
          musicSource.start(cursor);
          musicSource.stop(duration);
          cursor += Math.max(0.1, musicBuffer.duration);
        }
      } catch (e) {
        // Fail open: if music fetch/mix fails, keep pure speech output.
      }
    }
  }

  return await offline.startRendering();
}
