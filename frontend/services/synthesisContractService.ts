import { GenerationSettings, NormalizedSynthesisRequest } from '../types';

type SynthesisEngine = 'VECTOR' | 'PRIME';

const ENGINE_SPEED_BOUNDS: Record<
  GenerationSettings['engine'],
  { min: number; max: number; default: number }
> = {
  PRIME: { min: 0.7, max: 1.3, default: 1.0 },
  VECTOR: { min: 0.7, max: 1.3, default: 1.0 },
};

const clampNumber = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
};

const normalizeLanguageCode = (value: string): string => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'en';
  const base = raw.split(/[-_]/)[0] || 'en';
  if (base === 'hi' || base === 'hin') return 'hi';
  if (base === 'en' || base === 'eng') return 'en';
  return base;
};

const inferLanguageFromText = (text: string): string => {
  const sample = String(text || '');
  if (!sample.trim()) return 'en';
  if (/[\u0900-\u097F]/.test(sample)) return 'hi';
  if (/\b(kya|kyu|kaise|main|tum|aap|hai|hain|tha|thi|mera|meri|nahi)\b/i.test(sample)) return 'hi';
  return 'en';
};

export const createSynthesisTraceId = (engine: SynthesisEngine): string => {
  const prefix = String(engine || 'TTS').toLowerCase();
  const ts = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 0xffffff).toString(36).padStart(4, '0');
  return `vf_${prefix}_${ts}_${rand}`;
};

export const normalizeSynthesisRequest = (input: {
  engine: SynthesisEngine;
  text: string;
  voiceId: string;
  language?: string | undefined;
  speed?: number | undefined;
  emotion?: string | undefined;
  style?: string | undefined;
  traceId?: string | undefined;
  requestId?: string | undefined;
}): NormalizedSynthesisRequest => {
  const speedBounds = ENGINE_SPEED_BOUNDS[input.engine === 'PRIME' ? 'PRIME' : 'VECTOR'] || ENGINE_SPEED_BOUNDS.PRIME;
  const text = String(input.text || '').replace(/\s+/g, ' ').trim();
  const voiceId = String(input.voiceId || '').trim();
  const detectedLanguage = input.language
    ? normalizeLanguageCode(input.language)
    : inferLanguageFromText(text);
  const speed = clampNumber(
    Number(input.speed ?? speedBounds.default),
    speedBounds.min,
    speedBounds.max
  );
  const rawEmotion = String(input.emotion || '').trim();
  const emotion = rawEmotion || undefined;
  const style = String(input.style || '').trim() || undefined;
  const trace_id = String(input.traceId || '').trim() || undefined;
  const request_id = (
    String(input.requestId || '').trim()
    || trace_id
    || createSynthesisTraceId(input.engine)
  );

  return {
    text,
    voice_id: voiceId,
    language: detectedLanguage,
    speed,
    emotion,
    style,
    trace_id,
    request_id,
  };
};


