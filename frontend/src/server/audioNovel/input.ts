import type { AudioNovelDialogueLine, AudioNovelEmotion } from './contracts.ts';

export interface AudioNovelValidationResult {
  ok: boolean;
  code?: 'EMPTY' | 'TOO_LONG' | 'ENCODING_RISK';
}

const LEVEL_1 = /^\[([A-Za-z][A-Za-z0-9_\s]{0,30})\|([A-Za-z]+)\]:\s*(.+)$/;
const LEVEL_2 = /^\[([A-Za-z][A-Za-z0-9_\s]{0,30})\]:\s*(.+)$/;
const LEVEL_3 = /^([A-Z][A-Za-z0-9_]{1,30}):\s*(.+)$/;
const CHAR_LIMIT = 2_800;

export const EMOTION_CUE_MAP: Record<AudioNovelEmotion, string> = {
  narration: '',
  angry: 'Say this with intense anger and a raised voice',
  sad: 'Say this slowly with deep sorrow and grief',
  excited: 'Say this with high energy and enthusiasm',
  whisper: 'Whisper this softly and quietly',
  dramatic: 'Say this with dramatic tension, pause before key words',
  cold: 'Say this in a cold, emotionless, chilling tone',
  fearful: 'Say this with trembling, genuine fear',
  happy: 'Say this with bright warm happiness',
  sarcastic: 'Say this with dry sarcasm and irony',
  confused: 'Say this with uncertainty and hesitation',
  commanding: 'Say this with authority and power',
  gentle: 'Say this softly with kindness and warmth',
  tense: 'Say this with urgency and sharp tension',
  laugh: 'Say this with a warm laugh in your voice',
};

export const sanitizeText = (raw: string): string => {
  return String(raw || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[*_~`#>]/g, '')
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export const validateInput = (text: string): AudioNovelValidationResult => {
  if (!text || text.length < 1) return { ok: false, code: 'EMPTY' };
  if (text.length > 100_000) return { ok: false, code: 'TOO_LONG' };
  if (/[^\x00-\x7F\u0900-\u097F]/.test(text) && text.length > 50_000) {
    return { ok: false, code: 'ENCODING_RISK' };
  }
  return { ok: true };
};

export const validateEmotion = (value: string): AudioNovelEmotion => {
  const normalized = String(value || '').trim().toLowerCase();
  return (normalized in EMOTION_CUE_MAP ? normalized : 'narration') as AudioNovelEmotion;
};

export const normalizeSpeaker = (speaker: string): string => {
  return String(speaker || '')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (token) => token.toUpperCase());
};

export const splitLongLine = (text: string, maxChars: number = CHAR_LIMIT): string[] => {
  const input = String(text || '').trim();
  if (!input) return [];
  if (input.length <= maxChars) return [input];

  const sentences = input.split(/(?<=[.!?])\s+/).filter(Boolean);
  const chunks: string[] = [];
  let buffer = '';

  for (const sentence of sentences) {
    const next = `${buffer} ${sentence}`.trim();
    if (next.length > maxChars) {
      if (buffer) {
        chunks.push(buffer.trim());
        buffer = sentence;
        continue;
      }

      let remainder = sentence.trim();
      while (remainder.length > maxChars) {
        chunks.push(remainder.slice(0, maxChars).trim());
        remainder = remainder.slice(maxChars).trim();
      }
      buffer = remainder;
      continue;
    }

    buffer = next;
  }

  if (buffer) {
    chunks.push(buffer.trim());
  }

  return chunks.length > 0 ? chunks : [input.slice(0, maxChars)];
};

export const parseDialogue = (raw: string): AudioNovelDialogueLine[] => {
  const lines = String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const result: AudioNovelDialogueLine[] = [];
  let index = 0;

  for (const line of lines) {
    let match: RegExpMatchArray | null;

    if ((match = line.match(LEVEL_1))) {
      result.push({
        speaker: normalizeSpeaker(match[1] || ''),
        emotion: validateEmotion(match[2] || ''),
        text: String(match[3] || '').trim(),
        index: index++,
      });
      continue;
    }

    if ((match = line.match(LEVEL_2))) {
      result.push({
        speaker: normalizeSpeaker(match[1] || ''),
        emotion: 'narration',
        text: String(match[2] || '').trim(),
        index: index++,
      });
      continue;
    }

    if ((match = line.match(LEVEL_3))) {
      result.push({
        speaker: normalizeSpeaker(match[1] || ''),
        emotion: 'narration',
        text: String(match[2] || '').trim(),
        index: index++,
      });
      continue;
    }

    for (const chunk of splitLongLine(line)) {
      result.push({
        speaker: 'Narrator',
        emotion: 'narration',
        text: chunk,
        index: index++,
      });
    }
  }

  return result;
};
