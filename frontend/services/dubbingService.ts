import { DubSegment, GenerationSettings } from "../types";
import { audioBufferToWav, getAudioContext } from "./geminiService";
import { separateVideoStemWithBackend } from "./mediaBackendService";

export interface DubbingStemPack {
  fullMix: AudioBuffer;
  speechStem: AudioBuffer;
  backgroundStem: AudioBuffer;
  speechStemBlob: Blob;
  backgroundStemBlob: Blob;
  duration: number;
}

interface DubbingStemExtractionOptions {
  backendUrl?: string;
  preferBackendModel?: boolean;
  onStatus?: (message: string) => void;
}

const createCompatibleBuffer = (
  ctx: BaseAudioContext,
  channels: number,
  length: number,
  sampleRate: number
): AudioBuffer => ctx.createBuffer(Math.max(1, channels), Math.max(1, length), Math.max(8000, sampleRate));

const renderSpeechStem = async (input: AudioBuffer): Promise<AudioBuffer> => {
  const sampleRate = input.sampleRate || 48000;
  const OfflineContextClass = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  if (!OfflineContextClass) return input;

  const offlineCtx = new OfflineContextClass(input.numberOfChannels, input.length, sampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = input;

  // Dialogue-focused chain: highpass + lowpass + mild compression.
  const highpass = offlineCtx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 110;
  highpass.Q.value = 0.75;

  const lowpass = offlineCtx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 5200;
  lowpass.Q.value = 0.85;

  const compressor = offlineCtx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 18;
  compressor.ratio.value = 2.8;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.22;

  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(compressor);
  compressor.connect(offlineCtx.destination);
  source.start(0);

  try {
    return await offlineCtx.startRendering();
  } catch {
    return input;
  }
};

const subtractSpeechFromFull = (full: AudioBuffer, speech: AudioBuffer): AudioBuffer => {
  const ctx = getAudioContext();
  const channels = Math.max(full.numberOfChannels, speech.numberOfChannels);
  const length = Math.max(full.length, speech.length);
  const out = createCompatibleBuffer(ctx, channels, length, full.sampleRate || speech.sampleRate || 48000);

  for (let ch = 0; ch < channels; ch += 1) {
    const outData = out.getChannelData(ch);
    const fullData = full.getChannelData(Math.min(ch, full.numberOfChannels - 1));
    const speechData = speech.getChannelData(Math.min(ch, speech.numberOfChannels - 1));
    const speechAttenuation = 0.76;

    for (let i = 0; i < outData.length; i += 1) {
      const base = i < fullData.length ? fullData[i] : 0;
      const dialogue = i < speechData.length ? speechData[i] : 0;
      outData[i] = Math.max(-1, Math.min(1, base - (dialogue * speechAttenuation)));
    }
  }

  return out;
};

// --- 1 + 2. EXTRACT AUDIO AND SPLIT DIALOGUE/BED ---
const decodeAudioBlob = async (ctx: AudioContext, blob: Blob): Promise<AudioBuffer> => {
  const payload = await blob.arrayBuffer();
  // Safari decodeAudioData mutates/consumes buffer in some runtimes.
  return ctx.decodeAudioData(payload.slice(0));
};

export const extractAndSeparateDubbingStems = async (
  videoFile: File,
  options?: DubbingStemExtractionOptions
): Promise<DubbingStemPack> => {
  const ctx = getAudioContext();
  const arrayBuffer = await videoFile.arrayBuffer();
  const fullMix = await ctx.decodeAudioData(arrayBuffer.slice(0));

  const shouldUseBackend = Boolean(options?.preferBackendModel && options?.backendUrl);
  if (shouldUseBackend) {
    try {
      options?.onStatus?.("Running model-based source separation (Demucs)...");
      const speechStemBlob = await separateVideoStemWithBackend(options?.backendUrl || '', videoFile, {
        stem: 'speech',
      });
      options?.onStatus?.("Extracting background stem from model output...");
      const backgroundStemBlob = await separateVideoStemWithBackend(options?.backendUrl || '', videoFile, {
        stem: 'background',
      });
      const speechStem = await decodeAudioBlob(ctx, speechStemBlob);
      const backgroundStem = await decodeAudioBlob(ctx, backgroundStemBlob);
      return {
        fullMix,
        speechStem,
        backgroundStem,
        speechStemBlob,
        backgroundStemBlob,
        duration: fullMix.duration,
      };
    } catch (error) {
      console.warn("Model-based separation failed; falling back to local stem extraction.", error);
    }
  }

  const speechStem = await renderSpeechStem(fullMix);
  const backgroundStem = subtractSpeechFromFull(fullMix, speechStem);

  return {
    fullMix,
    speechStem,
    backgroundStem,
    speechStemBlob: audioBufferToWav(speechStem),
    backgroundStemBlob: audioBufferToWav(backgroundStem),
    duration: fullMix.duration,
  };
};

// Backward-compat helper used by existing callers.
export const isolateBackgroundTrack = async (videoFile: File): Promise<AudioBuffer> => {
  const stems = await extractAndSeparateDubbingStems(videoFile);
  return stems.backgroundStem;
};

// --- 2. ADVANCED TTS ENGINE (Formants & F0 Simulation) ---
/**
 * Applies acoustic modeling to simulate Age and Gender characteristics.
 * FIXED: Better error handling and robust context creation
 */
export const applyCharacterProfile = async (
  rawAudioBuffer: AudioBuffer,
  gender: 'Male' | 'Female' | 'Unknown',
  age: string
): Promise<AudioBuffer> => {
  const sampleRate = rawAudioBuffer.sampleRate || 44100;
  const length = rawAudioBuffer.length || 1;
  
  // Use robust offline context creation
  const OfflineContextClass = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  
  if (!OfflineContextClass) {
    console.warn("OfflineAudioContext not available, returning original buffer");
    return rawAudioBuffer;
  }
  
  const ctx = new OfflineContextClass(rawAudioBuffer.numberOfChannels, length, sampleRate);
  
  const source = ctx.createBufferSource();
  source.buffer = rawAudioBuffer;
  
  // --- F0 (Pitch) / Playback Rate Logic ---
  let rate = 1.0;
  
  if (gender === 'Male') rate *= 0.93; // Deeper base
  if (gender === 'Female') rate *= 1.08; // Higher base
  
  if (age.toLowerCase().includes('child')) rate *= 1.18;
  else if (age.toLowerCase().includes('elder')) rate *= 0.88;
  else if (age.toLowerCase().includes('young')) rate *= 1.05;
  
  source.playbackRate.value = Math.max(0.5, Math.min(2.0, rate)); // Clamp
  
  // --- Formant Filter Logic (Vocal Tract Simulation) ---
  const filter = ctx.createBiquadFilter();
  filter.type = 'peaking';
  filter.Q.value = 1.2;
  
  if (gender === 'Female' || age.includes('Child')) {
    filter.frequency.value = 3200; // Higher formants
    filter.gain.value = 5;
  } else if (gender === 'Male' || age.includes('Elder')) {
    filter.frequency.value = 180; // Lower formants
    filter.gain.value = 4;
  } else {
    filter.gain.value = 0; // Neutral
  }
  
  // Chain
  source.connect(filter);
  filter.connect(ctx.destination);
  source.start(0);
  
  try {
    return await ctx.startRendering();
  } catch (e) {
    console.error("Character profile rendering failed:", e);
    return rawAudioBuffer; // Fallback to original
  }
};

// --- 3. MIXING ENGINE (DYNAMIC DUCKING & EQ SUPPRESSION) ---
// FIXED: Better segment handling, proper time boundaries, improved ducking logic
export const mixFinalDub = async (
  backgroundBuffer: AudioBuffer,
  segments: DubSegment[],
  settings: GenerationSettings
): Promise<string> => {
  const ctx = getAudioContext();
  const duration = backgroundBuffer.duration;
  const sampleRate = backgroundBuffer.sampleRate || 48000;
  
  const OfflineContextClass = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  
  if (!OfflineContextClass) {
    throw new Error("OfflineAudioContext not supported in this browser");
  }
  
  const offlineCtx = new OfflineContextClass(
    backgroundBuffer.numberOfChannels, 
    Math.ceil(duration * sampleRate), 
    sampleRate
  );
  
  // --- 1. Background Track Setup with Dynamic FX ---
  const bgSource = offlineCtx.createBufferSource();
  bgSource.buffer = backgroundBuffer;
  
  // A. Vocal Suppression EQ (Peaking Filter to cut mids)
  const vocalCutFilter = offlineCtx.createBiquadFilter();
  vocalCutFilter.type = 'peaking';
  vocalCutFilter.frequency.value = 1200; // Center of vocal range
  vocalCutFilter.Q.value = 1.8; // Wide bandwidth
  vocalCutFilter.gain.value = 0; // Start neutral
  
  // B. Dynamic Volume (Ducking)
  const duckingGain = offlineCtx.createGain();
  duckingGain.gain.value = 1.0; // Start full volume
  
  // C. Chain: Source -> EQ -> Gain -> Master
  bgSource.connect(vocalCutFilter);
  vocalCutFilter.connect(duckingGain);
  duckingGain.connect(offlineCtx.destination);
  bgSource.start(0);
  
  // --- 2. Process Segments & Automate Background ---
  // Constants for fades
  const FADE_TIME = 0.15; // Shortened for snappier response
  const DUCK_VOLUME = 0.18; // Lower bg to 18% during speech
  const EQ_CUT_DB = -20; // Cut mids by 20dB during speech
  const SFX_DUCK_VOLUME = 0.35; // Less aggressive duck for SFX
  
  // Sort segments by start time to process sequentially
  const sortedSegments = [...segments].sort((a, b) => a.startTime - b.startTime);
  
  // Track successful segment loads
  let processedCount = 0;
  
  for (const seg of sortedSegments) {
    if (!seg.audioUrl) continue;
    
    try {
      // Fetch generated audio
      const response = await fetch(seg.audioUrl);
      if (!response.ok) {
        console.warn(`Failed to fetch segment ${seg.id}: ${response.status}`);
        continue;
      }
      
      const arrayBuffer = await response.arrayBuffer();
      let segmentBuffer = await ctx.decodeAudioData(arrayBuffer);
      
      const isSFX = seg.speaker === 'SFX';
      
      // Apply Character Acoustics (Age/Gender DSP)
      // SKIP IF SFX
      if (!isSFX && seg.gender && seg.age) {
        try {
          segmentBuffer = await applyCharacterProfile(segmentBuffer, seg.gender, seg.age);
        } catch (e) {
          console.warn(`Character profile failed for ${seg.speaker}:`, e);
          // Continue with original buffer
        }
      }
      
      // --- TIME STRETCH / FIT ---
      const targetDurationRaw = seg.endTime - seg.startTime;
      const currentDuration = segmentBuffer.duration;
      const hasTargetWindow = Number.isFinite(targetDurationRaw) && targetDurationRaw > 0.06;
      const targetDuration = hasTargetWindow ? targetDurationRaw : currentDuration;
      let stretchRatio = 1.0;
      
      // Stretch both faster/slower to fit target window for better lip-sync.
      if (!isSFX && hasTargetWindow && targetDuration > 0) {
        stretchRatio = currentDuration / targetDuration;
        if (stretchRatio > 1.42) stretchRatio = 1.42; // Cap speedup to avoid artifacts
        if (stretchRatio < 0.72) stretchRatio = 0.72; // Cap slowdown
      }
      
      const actualDuration = currentDuration / stretchRatio;
      const startTime = Math.max(0, seg.startTime); // Ensure non-negative
      const endTime = Math.min(duration, startTime + actualDuration); // Clamp to track duration
      
      // Skip if segment is outside track bounds
      if (startTime >= duration) {
        console.warn(`Segment ${seg.id} starts beyond track duration, skipping`);
        continue;
      }
      
      // --- MIX VOCALS ---
      const source = offlineCtx.createBufferSource();
      source.buffer = segmentBuffer;
      source.playbackRate.value = stretchRatio;
      
      const vocalGain = offlineCtx.createGain();
      vocalGain.gain.value = settings.speechVolume ?? 1.0;
      
      source.connect(vocalGain);
      vocalGain.connect(offlineCtx.destination);
      source.start(startTime);
      
      // --- AUTOMATION (DUCKING & EQ) ---
      // Duck volume for both Speech and SFX to make them stand out.
      // But only cut EQ frequencies for Speech (to suppress original vocals), not for SFX.
      
      const targetDuckVolume = isSFX ? SFX_DUCK_VOLUME : DUCK_VOLUME;
      const fadeStart = Math.max(0, startTime - FADE_TIME);
      const fadeEnd = Math.min(duration, endTime + FADE_TIME);
      
      // Ramp Down (Start)
      duckingGain.gain.setValueAtTime(duckingGain.gain.value, fadeStart);
      if (!isSFX) vocalCutFilter.gain.setValueAtTime(vocalCutFilter.gain.value, fadeStart);
      
      duckingGain.gain.linearRampToValueAtTime(targetDuckVolume, startTime);
      if (!isSFX) vocalCutFilter.gain.linearRampToValueAtTime(EQ_CUT_DB, startTime);
      
      // Hold during segment
      duckingGain.gain.setValueAtTime(targetDuckVolume, endTime);
      if (!isSFX) vocalCutFilter.gain.setValueAtTime(EQ_CUT_DB, endTime);
      
      // Ramp Up (End)
      duckingGain.gain.linearRampToValueAtTime(1.0, fadeEnd);
      if (!isSFX) vocalCutFilter.gain.linearRampToValueAtTime(0, fadeEnd);
      
      processedCount++;
      
    } catch (e) {
      console.error(`Failed to mix segment ${seg.id}:`, e);
      // Continue processing other segments
    }
  }
  
  if (processedCount === 0) {
    console.warn("No segments were successfully processed");
  }
  
  try {
    const renderedBuffer = await offlineCtx.startRendering();
    const wavBlob = audioBufferToWav(renderedBuffer);
    return URL.createObjectURL(wavBlob);
  } catch (e) {
    console.error("Final rendering failed:", e);
    throw new Error("Failed to render final mix");
  }
};

export interface DubAlignmentEntry {
  speaker: string;
  targetDuration: number;
  generatedDuration: number;
}

export interface DubAlignmentReport {
  ok: boolean;
  coveragePct: number;
  averageRatioErrorPct: number;
  maxRatioErrorPct: number;
  lipSyncScore: number;
  notes: string[];
}

export const buildDubAlignmentReport = (
  allSegmentsCount: number,
  generatedSegmentsCount: number,
  entries: DubAlignmentEntry[]
): DubAlignmentReport => {
  const safeAll = Math.max(1, allSegmentsCount);
  const coveragePct = Math.max(0, Math.min(100, (generatedSegmentsCount / safeAll) * 100));

  const ratioErrors = entries
    .filter((entry) => entry.targetDuration > 0 && Number.isFinite(entry.targetDuration) && Number.isFinite(entry.generatedDuration))
    .map((entry) => Math.abs(entry.generatedDuration - entry.targetDuration) / entry.targetDuration);

  const avgError = ratioErrors.length > 0
    ? ratioErrors.reduce((sum, value) => sum + value, 0) / ratioErrors.length
    : 0;
  const maxError = ratioErrors.length > 0 ? Math.max(...ratioErrors) : 0;

  const averageRatioErrorPct = avgError * 100;
  const maxRatioErrorPct = maxError * 100;
  const lipSyncScore = Math.max(0, Math.round(100 - (avgError * 120) - (maxError * 40) - ((100 - coveragePct) * 0.35)));

  const notes: string[] = [];
  if (coveragePct < 95) notes.push('Low generated segment coverage.');
  if (averageRatioErrorPct > 28) notes.push('Average duration drift is high; lip-sync may look loose.');
  if (maxRatioErrorPct > 55) notes.push('Some lines are heavily stretched/compressed.');
  if (!notes.length) notes.push('Alignment checks passed for current dubbing track.');

  return {
    ok: coveragePct >= 95 && averageRatioErrorPct <= 28 && maxRatioErrorPct <= 55,
    coveragePct: Number(coveragePct.toFixed(1)),
    averageRatioErrorPct: Number(averageRatioErrorPct.toFixed(1)),
    maxRatioErrorPct: Number(maxRatioErrorPct.toFixed(1)),
    lipSyncScore,
    notes,
  };
};

// --- 4. ADDITIONAL HELPER: DETECT OPTIMAL DUCK POINTS ---
/**
 * Analyzes audio buffer to detect speech/silence for smarter ducking
 * This can be used to improve ducking automation
 */
export const detectSpeechSegments = (buffer: AudioBuffer, threshold: number = 0.01): { start: number, end: number }[] => {
  const segments: { start: number, end: number }[] = [];
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const windowSize = Math.floor(sampleRate * 0.05); // 50ms windows
  
  let inSpeech = false;
  let segmentStart = 0;
  
  for (let i = 0; i < channelData.length; i += windowSize) {
    const window = channelData.slice(i, i + windowSize);
    const rms = Math.sqrt(window.reduce((sum, val) => sum + val * val, 0) / window.length);
    
    if (rms > threshold && !inSpeech) {
      inSpeech = true;
      segmentStart = i / sampleRate;
    } else if (rms <= threshold && inSpeech) {
      inSpeech = false;
      segments.push({ start: segmentStart, end: i / sampleRate });
    }
  }
  
  // Close final segment if still in speech
  if (inSpeech) {
    segments.push({ start: segmentStart, end: buffer.duration });
  }
  
  return segments;
};
