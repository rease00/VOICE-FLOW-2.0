import { DubSegment, GenerationSettings } from "../types";
import { audioBufferToWav, getAudioContext } from "./geminiService";

// --- 1. AUDIO MIX ENGINE (DSP) ---
export const isolateBackgroundTrack = async (videoFile: File): Promise<AudioBuffer> => {
  const ctx = getAudioContext();
  const arrayBuffer = await videoFile.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
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
      const targetDuration = seg.endTime - seg.startTime;
      const currentDuration = segmentBuffer.duration;
      let stretchRatio = 1.0;
      
      // Only stretch if too long and not SFX
      if (!isSFX && currentDuration > targetDuration && targetDuration > 0) {
        stretchRatio = currentDuration / targetDuration;
        if (stretchRatio > 1.4) stretchRatio = 1.4; // Cap speedup to avoid artifacts
        if (stretchRatio < 0.7) stretchRatio = 0.7; // Cap slowdown
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
      vocalGain.gain.value = settings.speechVolume || 1.0;
      
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