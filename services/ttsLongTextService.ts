import { GenerationSettings } from '../types';

export type PrimaryTtsEngine = GenerationSettings['engine'];

export interface ChunkingProfile {
  hardCharCap: number;
  targetCharCap: number;
  maxWordsPerChunk: number;
  joinCrossfadeMs: number;
}

export interface LongTextChunk {
  index: number;
  text: string;
  charCount: number;
  wordCount: number;
}

export interface ChunkSynthesisAttempt {
  chunkIndex: number;
  chunkTotal: number;
  attempt: number;
  traceId?: string;
}

export interface LongTextPreflightResult {
  ok: boolean;
  wordCount: number;
  maxWords: number;
  reason?: string;
}

export const MAX_WORDS_PER_REQUEST = 5000;
export const MAX_WORDS_PER_WINDOW = 500;
export const RETRY_ATTEMPTS_PER_CHUNK = 3;
export const RETRY_BACKOFF_MS: readonly [number, number] = [500, 1200];

const QUALITY_CHUNK_PROFILES: Record<
  PrimaryTtsEngine,
  { hi: ChunkingProfile; default: ChunkingProfile }
> = {
  KOKORO: {
    hi: { hardCharCap: 160, targetCharCap: 130, maxWordsPerChunk: 30, joinCrossfadeMs: 15 },
    default: { hardCharCap: 220, targetCharCap: 180, maxWordsPerChunk: 45, joinCrossfadeMs: 15 },
  },
  GEM: {
    hi: { hardCharCap: 620, targetCharCap: 420, maxWordsPerChunk: 80, joinCrossfadeMs: 10 },
    default: { hardCharCap: 620, targetCharCap: 420, maxWordsPerChunk: 80, joinCrossfadeMs: 10 },
  },
};

const SENTENCE_PATTERN = /[^.!?\n\u0964\u0965]+[.!?\u0964\u0965]?/g;
const PHRASE_PATTERN = /[^,;:\n]+[,;:]?/g;

const toLanguage = (value?: string): string => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'en';
  const base = raw.split(/[-_]/)[0] || 'en';
  return base;
};

export const normalizeForSegmentation = (text: string): string => {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/\s+/g, ' ')
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n[ ]+/g, '\n')
    .trim();
};

export const countWords = (text: string): number => {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
};

export const preflightWordLimit = (text: string, maxWords = MAX_WORDS_PER_REQUEST): LongTextPreflightResult => {
  const normalized = normalizeForSegmentation(text);
  const words = countWords(normalized);
  if (words > maxWords) {
    return {
      ok: false,
      wordCount: words,
      maxWords,
      reason: `Word limit exceeded: ${words}/${maxWords}`,
    };
  }
  return {
    ok: true,
    wordCount: words,
    maxWords,
  };
};

export const isPrimaryTtsEngine = (value: string): value is PrimaryTtsEngine => {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'GEM' || normalized === 'KOKORO';
};

export const getChunkProfile = (engine: PrimaryTtsEngine, language?: string): ChunkingProfile => {
  const lang = toLanguage(language);
  const base = QUALITY_CHUNK_PROFILES[engine] || QUALITY_CHUNK_PROFILES.GEM;
  return lang === 'hi' ? base.hi : base.default;
};

const splitWithPattern = (text: string, pattern: RegExp): string[] => {
  const matches = String(text || '').match(pattern);
  if (!matches || matches.length === 0) {
    const trimmed = String(text || '').trim();
    return trimmed ? [trimmed] : [];
  }
  return matches.map((item) => item.trim()).filter(Boolean);
};

const splitOversizedByWords = (
  unit: string,
  hardCharCap: number,
  maxWordsPerChunk: number
): string[] => {
  const words = String(unit || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const result: string[] = [];
  let current = '';
  let currentWords = 0;

  for (const word of words) {
    const safeWord = word.trim();
    if (!safeWord) continue;
    if (safeWord.length > hardCharCap) {
      if (current) {
        result.push(current);
        current = '';
        currentWords = 0;
      }
      for (let i = 0; i < safeWord.length; i += hardCharCap) {
        result.push(safeWord.slice(i, i + hardCharCap));
      }
      continue;
    }

    const candidate = current ? `${current} ${safeWord}` : safeWord;
    const candidateWords = currentWords + 1;
    if (candidate.length <= hardCharCap && candidateWords <= maxWordsPerChunk) {
      current = candidate;
      currentWords = candidateWords;
    } else {
      if (current) result.push(current);
      current = safeWord;
      currentWords = 1;
    }
  }

  if (current) result.push(current);
  return result;
};

export const buildLongTextChunks = (input: {
  engine: PrimaryTtsEngine;
  language?: string;
  text: string;
}): LongTextChunk[] => {
  const profile = getChunkProfile(input.engine, input.language);
  const normalized = normalizeForSegmentation(input.text);
  if (!normalized) return [];

  const sentenceUnits = splitWithPattern(normalized, SENTENCE_PATTERN);
  const granularUnits: string[] = [];

  for (const sentence of sentenceUnits) {
    const sentenceWords = countWords(sentence);
    if (sentence.length <= profile.hardCharCap && sentenceWords <= profile.maxWordsPerChunk) {
      granularUnits.push(sentence);
      continue;
    }

    const phraseUnits = splitWithPattern(sentence, PHRASE_PATTERN);
    for (const phrase of phraseUnits) {
      const phraseWords = countWords(phrase);
      if (phrase.length <= profile.hardCharCap && phraseWords <= profile.maxWordsPerChunk) {
        granularUnits.push(phrase);
      } else {
        granularUnits.push(
          ...splitOversizedByWords(phrase, profile.hardCharCap, profile.maxWordsPerChunk)
        );
      }
    }
  }

  const chunks: LongTextChunk[] = [];
  let current = '';
  let currentWords = 0;

  const flushCurrent = () => {
    const text = current.trim();
    if (!text) return;
    chunks.push({
      index: chunks.length,
      text,
      charCount: text.length,
      wordCount: countWords(text),
    });
    current = '';
    currentWords = 0;
  };

  for (const unit of granularUnits) {
    const text = unit.trim();
    if (!text) continue;
    const unitWords = countWords(text);
    if (unit.length > profile.hardCharCap || unitWords > profile.maxWordsPerChunk) {
      flushCurrent();
      const splitUnits = splitOversizedByWords(text, profile.hardCharCap, profile.maxWordsPerChunk);
      for (const splitText of splitUnits) {
        chunks.push({
          index: chunks.length,
          text: splitText,
          charCount: splitText.length,
          wordCount: countWords(splitText),
        });
      }
      continue;
    }

    const candidate = current ? `${current} ${text}` : text;
    const candidateWords = currentWords + unitWords;
    if (candidate.length <= profile.targetCharCap && candidateWords <= profile.maxWordsPerChunk) {
      current = candidate;
      currentWords = candidateWords;
    } else {
      flushCurrent();
      current = text;
      currentWords = unitWords;
    }
  }

  flushCurrent();
  return chunks;
};

const splitOversizedByWordLimit = (unit: string, maxWords: number): string[] => {
  const words = String(unit || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const windows: string[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    windows.push(words.slice(i, i + maxWords).join(' '));
  }
  return windows;
};

export const buildSentenceAlignedWordWindows = (
  text: string,
  maxWordsPerWindow: number = MAX_WORDS_PER_WINDOW
): LongTextChunk[] => {
  const safeMaxWords = Math.max(1, Number(maxWordsPerWindow) || MAX_WORDS_PER_WINDOW);
  const normalized = normalizeForSegmentation(text);
  if (!normalized) return [];

  const totalWords = countWords(normalized);
  if (totalWords <= safeMaxWords) {
    return [
      {
        index: 0,
        text: normalized,
        charCount: normalized.length,
        wordCount: totalWords,
      },
    ];
  }

  const sentenceUnits = splitWithPattern(normalized, SENTENCE_PATTERN);
  const granularUnits: string[] = [];

  for (const sentence of sentenceUnits) {
    const sentenceWords = countWords(sentence);
    if (sentenceWords <= safeMaxWords) {
      granularUnits.push(sentence);
      continue;
    }
    const phraseUnits = splitWithPattern(sentence, PHRASE_PATTERN);
    for (const phrase of phraseUnits) {
      const phraseWords = countWords(phrase);
      if (phraseWords <= safeMaxWords) {
        granularUnits.push(phrase);
      } else {
        granularUnits.push(...splitOversizedByWordLimit(phrase, safeMaxWords));
      }
    }
  }

  const windows: LongTextChunk[] = [];
  let current = '';
  let currentWords = 0;

  const flushCurrent = () => {
    const value = current.trim();
    if (!value) return;
    windows.push({
      index: windows.length,
      text: value,
      charCount: value.length,
      wordCount: countWords(value),
    });
    current = '';
    currentWords = 0;
  };

  for (const unit of granularUnits) {
    const safe = unit.trim();
    if (!safe) continue;
    const unitWords = countWords(safe);
    if (unitWords > safeMaxWords) {
      flushCurrent();
      for (const split of splitOversizedByWordLimit(safe, safeMaxWords)) {
        windows.push({
          index: windows.length,
          text: split,
          charCount: split.length,
          wordCount: countWords(split),
        });
      }
      continue;
    }

    const candidate = current ? `${current} ${safe}` : safe;
    const candidateWords = currentWords + unitWords;
    if (candidateWords <= safeMaxWords) {
      current = candidate;
      currentWords = candidateWords;
    } else {
      flushCurrent();
      current = safe;
      currentWords = unitWords;
    }
  }

  flushCurrent();
  return windows;
};

export const sleepMs = async (delayMs: number): Promise<void> => {
  const safeDelay = Math.max(0, Math.floor(delayMs));
  if (safeDelay <= 0) return;
  await new Promise<void>((resolve) => {
    window.setTimeout(() => resolve(), safeDelay);
  });
};

export const mergeChunkBuffersWithCrossfade = (
  ctx: AudioContext,
  buffers: AudioBuffer[],
  crossfadeMs: number
): AudioBuffer => {
  if (!Array.isArray(buffers) || buffers.length === 0) {
    return ctx.createBuffer(1, 1, 24000);
  }
  if (buffers.length === 1) {
    return buffers[0];
  }

  const sampleRate = buffers[0].sampleRate;
  const channels = Math.max(1, ...buffers.map((buffer) => buffer.numberOfChannels || 1));
  const maxOverlap = Math.max(0, Math.floor((sampleRate * Math.max(0, crossfadeMs)) / 1000));

  let totalFrames = 0;
  for (let i = 0; i < buffers.length; i += 1) {
    const current = buffers[i];
    totalFrames += current.length;
    if (i > 0) {
      const previous = buffers[i - 1];
      totalFrames -= Math.min(maxOverlap, previous.length, current.length);
    }
  }

  const output = ctx.createBuffer(channels, Math.max(1, totalFrames), sampleRate);
  let writeOffset = 0;

  const first = buffers[0];
  for (let channel = 0; channel < channels; channel += 1) {
    const sourceChannel = Math.min(channel, first.numberOfChannels - 1);
    output.getChannelData(channel).set(first.getChannelData(sourceChannel), 0);
  }
  writeOffset = first.length;

  for (let index = 1; index < buffers.length; index += 1) {
    const current = buffers[index];
    const overlap = Math.min(maxOverlap, writeOffset, current.length);
    const start = writeOffset - overlap;

    for (let channel = 0; channel < channels; channel += 1) {
      const outputData = output.getChannelData(channel);
      const sourceChannel = Math.min(channel, current.numberOfChannels - 1);
      const sourceData = current.getChannelData(sourceChannel);

      for (let i = 0; i < overlap; i += 1) {
        const ratio = overlap <= 1 ? 1 : i / (overlap - 1);
        outputData[start + i] = outputData[start + i] * (1 - ratio) + sourceData[i] * ratio;
      }

      outputData.set(sourceData.subarray(overlap), start + overlap);
    }

    writeOffset = start + current.length;
  }

  return output;
};
