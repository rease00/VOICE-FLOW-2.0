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

export interface LiveChunkRequestProfile {
  liveChunkChars: number;
  liveChunkWords: number;
}

export const MAX_WORDS_PER_REQUEST = 5000;
export const MAX_WORDS_PER_WINDOW = 500;
export const RETRY_ATTEMPTS_PER_CHUNK = 3;
export const RETRY_BACKOFF_MS: readonly [number, number] = [500, 1200];
const SENTENCE_OVERFLOW_RATIO = 1.35;
const SENTENCE_OVERFLOW_CHAR_GRACE = 96;
const SENTENCE_OVERFLOW_WORD_GRACE = 18;

const QUALITY_CHUNK_PROFILES: Record<
  PrimaryTtsEngine,
  { hi: ChunkingProfile; default: ChunkingProfile }
> = {
  KOKORO: {
    hi: { hardCharCap: 200, targetCharCap: 150, maxWordsPerChunk: 34, joinCrossfadeMs: 24 },
    default: { hardCharCap: 180, targetCharCap: 140, maxWordsPerChunk: 32, joinCrossfadeMs: 12 },
  },
  GEM: {
    hi: { hardCharCap: 360, targetCharCap: 260, maxWordsPerChunk: 56, joinCrossfadeMs: 8 },
    default: { hardCharCap: 360, targetCharCap: 260, maxWordsPerChunk: 56, joinCrossfadeMs: 8 },
  },
  GOOD: {
    hi: { hardCharCap: 360, targetCharCap: 260, maxWordsPerChunk: 56, joinCrossfadeMs: 8 },
    default: { hardCharCap: 360, targetCharCap: 260, maxWordsPerChunk: 56, joinCrossfadeMs: 8 },
  },
  NEURAL2: {
    hi: { hardCharCap: 360, targetCharCap: 260, maxWordsPerChunk: 56, joinCrossfadeMs: 8 },
    default: { hardCharCap: 360, targetCharCap: 260, maxWordsPerChunk: 56, joinCrossfadeMs: 8 },
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

const resolveOverflowCharCap = (limit: number): number => (
  Math.max(limit, Math.round(limit * SENTENCE_OVERFLOW_RATIO), limit + SENTENCE_OVERFLOW_CHAR_GRACE)
);

const resolveOverflowWordCap = (limit: number): number => (
  Math.max(limit, Math.round(limit * SENTENCE_OVERFLOW_RATIO), limit + SENTENCE_OVERFLOW_WORD_GRACE)
);

const canKeepUnitIntact = (
  charCount: number,
  wordCount: number,
  charLimit: number,
  wordLimit: number,
): boolean => (
  charCount <= resolveOverflowCharCap(charLimit)
  && wordCount <= resolveOverflowWordCap(wordLimit)
);

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
  return normalized === 'GEM' || normalized === 'GOOD' || normalized === 'NEURAL2' || normalized === 'KOKORO';
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
      result.push(safeWord);
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
    if (canKeepUnitIntact(sentence.length, sentenceWords, profile.hardCharCap, profile.maxWordsPerChunk)) {
      granularUnits.push(sentence);
      continue;
    }

    const phraseUnits = splitWithPattern(sentence, PHRASE_PATTERN);
    for (const phrase of phraseUnits) {
      const phraseWords = countWords(phrase);
      if (phrase.length <= profile.hardCharCap && phraseWords <= profile.maxWordsPerChunk) {
        granularUnits.push(phrase);
      } else if (canKeepUnitIntact(phrase.length, phraseWords, profile.hardCharCap, profile.maxWordsPerChunk)) {
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
    if (
      (unit.length > profile.hardCharCap || unitWords > profile.maxWordsPerChunk)
      && !canKeepUnitIntact(unit.length, unitWords, profile.hardCharCap, profile.maxWordsPerChunk)
    ) {
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
  for (let i = 0; i < words.length;) {
    const remaining = words.length - i;
    const take = Math.min(maxWords, remaining);
    windows.push(words.slice(i, i + take).join(' '));
    i += take;
  }
  return windows;
};

const splitOversizedByCharLimit = (unit: string, maxChars: number): string[] => {
  const words = String(unit || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const windows: string[] = [];
  let current = '';

  for (const word of words) {
    const safeWord = String(word || '').trim();
    if (!safeWord) continue;
    if (safeWord.length > maxChars) {
      if (current) {
        windows.push(current);
        current = '';
      }
      windows.push(safeWord);
      continue;
    }

    const candidate = current ? `${current} ${safeWord}` : safeWord;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) windows.push(current);
      current = safeWord;
    }
  }

  if (current) windows.push(current);
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
    if (canKeepUnitIntact(sentence.length, sentenceWords, Number.MAX_SAFE_INTEGER, safeMaxWords)) {
      granularUnits.push(sentence);
      continue;
    }
    const phraseUnits = splitWithPattern(sentence, PHRASE_PATTERN);
    for (const phrase of phraseUnits) {
      const phraseWords = countWords(phrase);
      if (phraseWords <= safeMaxWords) {
        granularUnits.push(phrase);
      } else if (canKeepUnitIntact(phrase.length, phraseWords, Number.MAX_SAFE_INTEGER, safeMaxWords)) {
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
    if (
      unitWords > safeMaxWords
      && !canKeepUnitIntact(safe.length, unitWords, Number.MAX_SAFE_INTEGER, safeMaxWords)
    ) {
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

export const buildSentenceAlignedCharWindows = (
  text: string,
  maxCharsPerWindow: number
): LongTextChunk[] => {
  const safeMaxChars = Math.max(1, Number(maxCharsPerWindow) || 1);
  const normalized = normalizeForSegmentation(text);
  if (!normalized) return [];

  if (normalized.length <= safeMaxChars) {
    return [
      {
        index: 0,
        text: normalized,
        charCount: normalized.length,
        wordCount: countWords(normalized),
      },
    ];
  }

  const sentenceUnits = splitWithPattern(normalized, SENTENCE_PATTERN);
  const granularUnits: string[] = [];

  for (const sentence of sentenceUnits) {
    const sentenceWords = countWords(sentence);
    if (
      sentence.length <= safeMaxChars
      || canKeepUnitIntact(sentence.length, sentenceWords, safeMaxChars, Number.MAX_SAFE_INTEGER)
    ) {
      granularUnits.push(sentence);
      continue;
    }

    const phraseUnits = splitWithPattern(sentence, PHRASE_PATTERN);
    for (const phrase of phraseUnits) {
      const phraseWords = countWords(phrase);
      if (
        phrase.length <= safeMaxChars
        || canKeepUnitIntact(phrase.length, phraseWords, safeMaxChars, Number.MAX_SAFE_INTEGER)
      ) {
        granularUnits.push(phrase);
      } else {
        granularUnits.push(...splitOversizedByCharLimit(phrase, safeMaxChars));
      }
    }
  }

  const windows: LongTextChunk[] = [];
  let current = '';

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
  };

  for (const unit of granularUnits) {
    const safe = unit.trim();
    if (!safe) continue;
    if (
      safe.length > safeMaxChars
      && !canKeepUnitIntact(safe.length, countWords(safe), safeMaxChars, Number.MAX_SAFE_INTEGER)
    ) {
      flushCurrent();
      for (const split of splitOversizedByCharLimit(safe, safeMaxChars)) {
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
    if (candidate.length <= safeMaxChars) {
      current = candidate;
    } else {
      flushCurrent();
      current = safe;
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
    const only = buffers[0];
    return only || ctx.createBuffer(1, 1, 24000);
  }

  const firstBuffer = buffers[0];
  if (!firstBuffer) {
    return ctx.createBuffer(1, 1, 24000);
  }
  const sampleRate = firstBuffer.sampleRate;
  const channels = Math.max(1, ...buffers.map((buffer) => buffer.numberOfChannels || 1));
  const maxOverlap = Math.max(0, Math.floor((sampleRate * Math.max(0, crossfadeMs)) / 1000));

  let totalFrames = 0;
  for (let i = 0; i < buffers.length; i += 1) {
    const current = buffers[i];
    if (!current) continue;
    totalFrames += current.length;
    if (i > 0) {
      const previous = buffers[i - 1];
      if (previous) {
        totalFrames -= Math.min(maxOverlap, previous.length, current.length);
      }
    }
  }

  const output = ctx.createBuffer(channels, Math.max(1, totalFrames), sampleRate);
  let writeOffset = 0;

  const first = firstBuffer;
  for (let channel = 0; channel < channels; channel += 1) {
    const sourceChannel = Math.min(channel, first.numberOfChannels - 1);
    output.getChannelData(channel).set(first.getChannelData(sourceChannel), 0);
  }
  writeOffset = first.length;

  for (let index = 1; index < buffers.length; index += 1) {
    const current = buffers[index];
    if (!current) continue;
    const overlap = Math.min(maxOverlap, writeOffset, current.length);
    const start = writeOffset - overlap;

    for (let channel = 0; channel < channels; channel += 1) {
      const outputData = output.getChannelData(channel);
      const sourceChannel = Math.min(channel, current.numberOfChannels - 1);
      const sourceData = current.getChannelData(sourceChannel);

      for (let i = 0; i < overlap; i += 1) {
        const ratio = overlap <= 1 ? 1 : i / (overlap - 1);
        const writeIndex = start + i;
        outputData[writeIndex] = (outputData[writeIndex] ?? 0) * (1 - ratio) + (sourceData[i] ?? 0) * ratio;
      }

      outputData.set(sourceData.subarray(overlap), start + overlap);
    }

    writeOffset = start + current.length;
  }

  return output;
};

export const resolveLiveChunkRequest = (
  engine: PrimaryTtsEngine,
  language?: string,
): LiveChunkRequestProfile => {
  const profile = getChunkProfile(engine, language);
  const LIVE_CHUNK_CHARS_MIN = 100;
  const LIVE_CHUNK_CHARS_TARGET = 150;
  const LIVE_CHUNK_WORDS_MIN = 16;
  const LIVE_CHUNK_WORDS_TARGET = 26;
  return {
    liveChunkChars: Math.max(
      LIVE_CHUNK_CHARS_MIN,
      Math.min(profile.hardCharCap, LIVE_CHUNK_CHARS_TARGET),
    ),
    liveChunkWords: Math.max(
      LIVE_CHUNK_WORDS_MIN,
      Math.min(profile.maxWordsPerChunk, LIVE_CHUNK_WORDS_TARGET),
    ),
  };
};
