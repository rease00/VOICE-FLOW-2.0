import { MUSIC_TRACKS } from "../constants";
import { GenerationSettings } from "../types";
import {
  resolveStudioMusicGain,
  resolveStudioSpeechGain,
} from "../src/shared/studio/studioGain";

export {
  STUDIO_MUSIC_GAIN_DEFAULT,
  STUDIO_MUSIC_GAIN_MAX,
  STUDIO_MUSIC_GAIN_MIN,
  STUDIO_SPEECH_GAIN_DEFAULT,
  STUDIO_SPEECH_GAIN_MAX,
  STUDIO_SPEECH_GAIN_MIN,
  resolveStudioMusicGain,
  resolveStudioSpeechGain,
} from "../src/shared/studio/studioGain";

function getAudioContext(): AudioContext {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("AudioContext is not supported in this browser.");
  }
  return new AudioContextClass();
}

async function fetchTrackBuffer(url: string): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.arrayBuffer();
    if (!data.byteLength) throw new Error("Empty audio data");
    // Safari workaround: copy buffer to prevent mutation
    return await ctx.decodeAudioData(data.slice(0));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load music track from ${url}: ${message}`);
  }
}

export async function applyStudioAudioMix(
  speechBuffer: AudioBuffer,
  settings: GenerationSettings,
  options?: { customMusicTrackUrl?: string | undefined }
): Promise<AudioBuffer> {
  const hasMusic = !!settings.musicTrackId && settings.musicTrackId !== "m_none";
  const speechGainValue = resolveStudioSpeechGain(settings.speechVolume);
  const musicGainValue = resolveStudioMusicGain(settings.musicVolume);

  // Preserve source fidelity when no effective mix operation is requested.
  if (!hasMusic && Math.abs(speechGainValue - 1.0) < 0.001) {
    return speechBuffer;
  }

  const OfflineContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
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
    const musicSourceUrl = track?.url ?? options?.customMusicTrackUrl;
    if (musicSourceUrl) {
      try {
        const musicBuffer = await fetchTrackBuffer(musicSourceUrl);
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
      } catch (error) {
        console.warn("[studioMixService] Failed to apply background music; continuing with speech only.", error);
      }
    }
  }

  return await offline.startRendering();
}
