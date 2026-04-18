import { GenerationSettings, NormalizedSynthesisRequest } from '../types';

type SynthesisEngine = 'VECTOR' | 'PRIME';

const DEFAULT_TTS_LANGUAGE = 'en-US';
const TTS_LANGUAGE_FALLBACKS: Record<string, string> = {
  en: 'en-US',
  hi: 'hi-IN',
  'hi-latn': 'hi-IN',
  hin: 'hi-IN',
  pt: 'pt-BR',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  it: 'it-IT',
  ru: 'ru-RU',
  ja: 'ja-JP',
  ko: 'ko-KR',
  zh: 'zh-CN',
};

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

const canonicalizeLanguageTag = (value: string): string => {
  const parts = String(value || '')
    .trim()
    .replace(/_/g, '-')
    .split('-')
    .filter(Boolean);
  if (parts.length === 0) return DEFAULT_TTS_LANGUAGE;
  return parts
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (part.length <= 3) return part.toUpperCase();
      return `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`;
    })
    .join('-');
};

export const normalizeTtsLanguageCode = (value: string): string => {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_TTS_LANGUAGE;
  const lower = raw.replace(/_/g, '-').toLowerCase();
  const directMatch = TTS_LANGUAGE_FALLBACKS[lower];
  if (directMatch) return directMatch;
  const base = lower.split('-')[0] || '';
  if (base && !lower.includes('-')) {
    return TTS_LANGUAGE_FALLBACKS[base] || canonicalizeLanguageTag(base);
  }
  return canonicalizeLanguageTag(raw);
};

const inferLanguageFromText = (text: string): string => {
  const sample = String(text || '');
  if (!sample.trim()) return DEFAULT_TTS_LANGUAGE;
  if (/[\u0900-\u097F]/.test(sample)) return 'hi-IN';
  if (/\b(kya|kyu|kaise|main|tum|aap|hai|hain|tha|thi|mera|meri|nahi)\b/i.test(sample)) return 'hi-IN';
  return DEFAULT_TTS_LANGUAGE;
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
    ? normalizeTtsLanguageCode(input.language)
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


