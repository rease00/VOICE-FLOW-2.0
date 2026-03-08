export const MAX_WORDS_PER_REQUEST = 5000;
export const SEGMENTATION_PROFILE = 'quality-first';
const SENTENCE_OVERFLOW_RATIO = 1.35;
const SENTENCE_OVERFLOW_CHAR_GRACE = 96;
const SENTENCE_OVERFLOW_WORD_GRACE = 18;

export const CHUNKING_PROFILES = {
  hi: {
    hardCharCap: 240,
    targetCharCap: 190,
    maxWordsPerChunk: 42,
    joinCrossfadeMs: 32,
  },
  default: {
    hardCharCap: 220,
    targetCharCap: 180,
    maxWordsPerChunk: 45,
    joinCrossfadeMs: 15,
  },
};

const SENTENCE_PATTERN = /[^.!?\n\u0964\u0965]+[.!?\u0964\u0965]?/g;
const PHRASE_PATTERN = /[^,;:\n]+[,;:]?/g;

export function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function countWords(text) {
  const cleaned = normalizeText(text);
  if (!cleaned) return 0;
  return cleaned.split(' ').filter(Boolean).length;
}

export function isHindiLanguage(langCode, text) {
  const normalizedLang = String(langCode || '').trim().toLowerCase();
  if (['h', 'hi', 'hin'].includes(normalizedLang)) return true;
  return /[\u0900-\u097F]/.test(String(text || ''));
}

function resolveOverflowCharCap(limit) {
  return Math.max(limit, Math.round(limit * SENTENCE_OVERFLOW_RATIO), limit + SENTENCE_OVERFLOW_CHAR_GRACE);
}

function resolveOverflowWordCap(limit) {
  return Math.max(limit, Math.round(limit * SENTENCE_OVERFLOW_RATIO), limit + SENTENCE_OVERFLOW_WORD_GRACE);
}

function canKeepUnitIntact(charCount, wordCount, hardLimit, maxWordsPerChunk) {
  return charCount <= resolveOverflowCharCap(hardLimit) && wordCount <= resolveOverflowWordCap(maxWordsPerChunk);
}

function splitWithPattern(text, pattern) {
  const units = String(text || '').match(pattern)?.map((item) => item.trim()).filter(Boolean) || [];
  if (units.length > 0) return units;
  return text ? [String(text)] : [];
}

function splitOversizedByWords(unit, hardLimit, maxWordsPerChunk) {
  const words = String(unit || '').split(' ').filter(Boolean);
  if (words.length === 0) return [];

  const result = [];
  let current = '';
  let currentWords = 0;

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const candidateWords = currentWords + 1;
    if (candidate.length <= hardLimit && candidateWords <= maxWordsPerChunk) {
      current = candidate;
      currentWords = candidateWords;
      continue;
    }
    if (current) {
      result.push(current);
      current = '';
      currentWords = 0;
    }

    current = word;
    currentWords = 1;
  }

  if (current) {
    result.push(current);
  }

  return result;
}

export function resolveChunkProfile(langCode, text) {
  return isHindiLanguage(langCode, text)
    ? { ...CHUNKING_PROFILES.hi }
    : { ...CHUNKING_PROFILES.default };
}

export function chunkTextForTts(text, langCode) {
  const cleaned = normalizeText(text);
  if (!cleaned) return [];

  const profile = resolveChunkProfile(langCode, cleaned);
  const { hardCharCap, targetCharCap, maxWordsPerChunk } = profile;
  const sentenceUnits = splitWithPattern(cleaned, SENTENCE_PATTERN);
  const granularUnits = [];

  for (const sentence of sentenceUnits) {
    const sentenceWords = countWords(sentence);
    if (sentence.length <= hardCharCap && sentenceWords <= maxWordsPerChunk) {
      granularUnits.push(sentence);
      continue;
    }
    if (canKeepUnitIntact(sentence.length, sentenceWords, hardCharCap, maxWordsPerChunk)) {
      granularUnits.push(sentence);
      continue;
    }
    const phraseUnits = splitWithPattern(sentence, PHRASE_PATTERN);
    for (const phrase of phraseUnits) {
      const phraseWords = countWords(phrase);
      if (phrase.length <= hardCharCap && phraseWords <= maxWordsPerChunk) {
        granularUnits.push(phrase);
        continue;
      }
      if (canKeepUnitIntact(phrase.length, phraseWords, hardCharCap, maxWordsPerChunk)) {
        granularUnits.push(phrase);
        continue;
      }
      granularUnits.push(...splitOversizedByWords(phrase, hardCharCap, maxWordsPerChunk));
    }
  }

  const chunks = [];
  let current = '';
  let currentWords = 0;

  for (const unit of granularUnits) {
    const trimmed = unit.trim();
    if (!trimmed) continue;
    const unitWords = countWords(trimmed);
    if (
      (trimmed.length > hardCharCap || unitWords > maxWordsPerChunk)
      && !canKeepUnitIntact(trimmed.length, unitWords, hardCharCap, maxWordsPerChunk)
    ) {
      if (current) {
        chunks.push(current);
        current = '';
        currentWords = 0;
      }
      chunks.push(...splitOversizedByWords(trimmed, hardCharCap, maxWordsPerChunk));
      continue;
    }

    const candidate = current ? `${current} ${trimmed}` : trimmed;
    const candidateWords = currentWords + unitWords;
    if (candidate.length <= targetCharCap && candidateWords <= maxWordsPerChunk) {
      current = candidate;
      currentWords = candidateWords;
      continue;
    }

    if (current) {
      chunks.push(current);
    }
    current = trimmed;
    currentWords = unitWords;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : [cleaned.slice(0, hardCharCap)];
}
