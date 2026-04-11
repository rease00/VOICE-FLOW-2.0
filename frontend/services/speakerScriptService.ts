import { extractEmotionAndCrewTags, normalizeEmotionTag, splitTagBlock } from './emotionTagRules';

interface ParsedSpeakerLine {
  speaker: string;
  dialogue: string;
  emotion: string;
  emotionTags: string[];
  crewTags: string[];
}

export interface DirectorTagInjectionResult {
  text: string;
  patchedLineCount: number;
}

const SPEAKER_NAME_PATTERN = String.raw`[\p{L}\p{N}][\p{L}\p{M}\p{N}\s.'\u2019_-]{0,58}?`;
const SPEAKER_LINE_PREFIX_PATTERN = String.raw`(\s*)`;

export const SPEAKER_REGEX = new RegExp(
  String.raw`^${SPEAKER_LINE_PREFIX_PATTERN}(\*+)?(?:\(\s*(${SPEAKER_NAME_PATTERN})\s*\)|\[\s*(${SPEAKER_NAME_PATTERN})\s*\])(?:\s*[\(\[]([^\)\]]{1,120})[\)\]])?(\*+)?\s*[:：]\s*(.*)$`,
  'su'
);

const LEGACY_SPEAKER_REGEX = new RegExp(
  String.raw`^${SPEAKER_LINE_PREFIX_PATTERN}(\*+)?(${SPEAKER_NAME_PATTERN})(?:\s*[\(\[]([^\)\]]{1,120})[\)\]])?(\*+)?\s*[:：]\s*(.*)$`,
  'su'
);
const HINDI_SFX_SOUND_TOKEN = 'ध्वनि';
const HINDI_SFX_MUSIC_TOKEN = 'संगीत';
const FULLWIDTH_COLON = '：';
export const SFX_REGEX = new RegExp(
  String.raw`^(?:\[|\()(?:SFX|sfx|Sound|SOUND|Music|MUSIC|${HINDI_SFX_SOUND_TOKEN}|${HINDI_SFX_MUSIC_TOKEN})[:${FULLWIDTH_COLON}\s]?\s*([^\]\)]+)(?:\]|\))`,
  'iu'
);

const SPEAKER_IGNORE_PREFIXES = [
  'chapter',
  'scene',
  'part',
  'note',
  'end',
  'sfx',
  'unknown',
  'start',
  'recap',
  'prologue',
  'epilogue',
  'act',
  'time',
  'location',
  'title',
  'intro',
  'outro',
  'credits',
  'background',
  'camera',
  'fade',
  'music',
  'sound',
  'अध्याय',
  'दृश्य',
  'भाग',
  'समाप्त',
  'शीर्षक',
  HINDI_SFX_MUSIC_TOKEN,
  HINDI_SFX_SOUND_TOKEN,
];

const normalizeSpeakerName = (raw: string): string => (
  String(raw || '')
    .replace(/^\*+|\*+$/g, '')
    .replace(/[\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

export const normalizeSpeakerMapKey = (raw: string): string => (
  normalizeSpeakerName(raw)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s._'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
);

const findSpeakerMappingKey = (
  speakerMapping: Record<string, string> | undefined,
  speaker: string,
): string => {
  if (!speakerMapping || typeof speakerMapping !== 'object') return '';
  const rawSpeaker = String(speaker || '');
  if (!rawSpeaker.trim()) return '';
  if (speakerMapping[rawSpeaker]) return rawSpeaker;
  const trimmed = rawSpeaker.trim();
  if (trimmed && speakerMapping[trimmed]) return trimmed;

  const normalizedTarget = normalizeSpeakerMapKey(rawSpeaker);
  if (!normalizedTarget) return '';

  for (const key of Object.keys(speakerMapping)) {
    if (!key) continue;
    if (normalizeSpeakerMapKey(key) === normalizedTarget) {
      return key;
    }
  }
  return '';
};

export const resolveSpeakerMappedVoiceId = (
  speakerMapping: Record<string, string> | undefined,
  speaker: string,
): string => {
  const matchedKey = findSpeakerMappingKey(speakerMapping, speaker);
  if (!matchedKey) return '';
  return String(speakerMapping?.[matchedKey] || '').trim();
};

export type SpeakerAgeGroup = 'Child' | 'Adult' | 'Elderly' | 'Unknown';

const MALE_INDICATORS = [
  'mr', 'lord', 'king', 'sir', 'father', 'dad', 'uncle', 'brother', 'boy', 'man', 'he', 'him', 'his',
  'john', 'david', 'michael', 'james', 'robert', 'william', 'joseph', 'thomas', 'charles', 'christopher',
  'daniel', 'matthew', 'anthony', 'mark', 'donald', 'steven', 'paul', 'andrew', 'joshua', 'kenneth',
  'kevin', 'brian', 'george', 'edward', 'ronald', 'timothy', 'jason', 'jeffrey', 'ryan', 'jacob', 'gary',
  'nicholas', 'eric', 'jonathan', 'stephen', 'larry', 'justin', 'scott', 'brandon', 'benjamin', 'samuel',
  'gregory', 'frank', 'alexander', 'raymond', 'patrick', 'jack', 'dennis', 'jerry', 'tyler', 'aaron',
  'jose', 'adam', 'henry', 'nathan', 'douglas', 'zachary', 'peter', 'kyle', 'walter', 'ethan', 'jeremy',
  'harold', 'keith', 'christian', 'roger', 'noah', 'gerald', 'terry', 'sean', 'austin', 'carl', 'arthur',
  'lawrence', 'dylan', 'jesse', 'jordan', 'bryan', 'billy', 'joe', 'bruce', 'gabriel', 'logan', 'albert',
  'willie', 'alan', 'juan', 'wayne', 'elijah', 'randy', 'roy', 'vincent', 'ralph', 'eugene', 'russell',
  'bobby', 'mason', 'philip', 'louis', 'detective', 'officer', 'sergeant', 'captain', 'commander', 'chief',
  'boss', 'guard', 'soldier',
];

const FEMALE_INDICATORS = [
  'mrs', 'ms', 'miss', 'lady', 'queen', 'madam', 'mother', 'mom', 'aunt', 'sister', 'girl', 'woman', 'she',
  'her', 'hers', 'mary', 'patricia', 'jennifer', 'linda', 'elizabeth', 'barbara', 'susan', 'jessica',
  'sarah', 'karen', 'nancy', 'lisa', 'betty', 'margaret', 'sandra', 'ashley', 'kimberly', 'emily', 'donna',
  'michelle', 'dorothy', 'carol', 'amanda', 'melissa', 'deborah', 'stephanie', 'rebecca', 'sharon', 'laura',
  'cynthia', 'kathleen', 'amy', 'shirley', 'angela', 'helen', 'anna', 'brenda', 'pamela', 'nicole',
  'samantha', 'katherine', 'emma', 'ruth', 'christine', 'catherine', 'debra', 'rachel', 'carolyn', 'janet',
  'virginia', 'maria', 'heather', 'diane', 'julie', 'joyce', 'evelyn', 'joan', 'victoria', 'kelly',
  'christina', 'lauren', 'frances', 'martha', 'judith', 'cheryl', 'megan', 'andrea', 'olivia', 'ann',
  'alice', 'jean', 'doris', 'jacqueline', 'kathryn', 'hannah', 'julia', 'gloria', 'teresa', 'velma',
  'sara', 'janice', 'phyllis', 'marie', 'grace', 'judy', 'theresa', 'madison', 'beverly', 'denise',
  'marilyn', 'amber', 'danielle', 'rose', 'brittany', 'diana', 'abigail', 'natalie', 'jane', 'lori',
  'alexis', 'tiffany', 'kayla', 'witch', 'princess', 'bride', 'nurse', 'waitress', 'actress',
];

export function guessGenderFromName(name: string): 'Male' | 'Female' | 'Unknown' {
  const raw = String(name || '').trim();
  const normalized = raw.toLowerCase().trim();
  const parts = normalized.split(' ');

  if (/(?:\u092e\u093e\u0901|\u0906\u0902\u091f\u0940|\u0926\u0940\u0926\u0940|\u092c\u0939\u0928|\u092e\u0948\u0921\u092e|\u0936\u094d\u0930\u0940\u092e\u0924\u0940)/u.test(raw)) {
    return 'Female';
  }
  if (/(?:\u092a\u093e\u092a\u093e|\u091a\u093e\u091a\u093e|\u092d\u093e\u0908|\u092d\u0948\u092f\u093e|\u0938\u0930|\u0936\u094d\u0930\u0940\u092e\u093e\u0928)/u.test(raw)) {
    return 'Male';
  }
  if (/\b(mom|mother|mummy|maa|aunty|aunt|didi|sister|madam|mrs|ms)\b/i.test(normalized)) {
    return 'Female';
  }
  if (/\b(dad|father|papa|uncle|brother|bhai|bhaiya|sir|mr)\b/i.test(normalized)) {
    return 'Male';
  }

  for (const part of parts) {
    if (MALE_INDICATORS.includes(part)) return 'Male';
    if (FEMALE_INDICATORS.includes(part)) return 'Female';
  }

  if (normalized.endsWith('a') || normalized.endsWith('ie') || normalized.endsWith('elle') || normalized.endsWith('i') || normalized.endsWith('enne') || normalized.endsWith('ine')) return 'Female';
  if (normalized.endsWith('o') || normalized.endsWith('us') || normalized.endsWith('er') || normalized.endsWith('or') || normalized.endsWith('son') || normalized.endsWith('an')) return 'Male';

  return 'Unknown';
}

const CHILD_AGE_INDICATORS = [
  'child', 'kid', 'boy', 'girl', 'teen', 'son', 'daughter', 'school', 'student',
  'beta', 'bacha', 'bachi', 'ladka', 'ladki', 'baccha',
];

const ELDER_AGE_INDICATORS = [
  'elder', 'elderly', 'old', 'senior', 'aged', 'grandpa', 'grandma', 'grandfather', 'grandmother',
  'dada', 'dadi', 'nana', 'nani', 'uncle', 'aunty', 'auntie', 'buzurg', 'vridh',
];

const normalizeAgeGroupToken = (value: string): SpeakerAgeGroup => {
  const token = String(value || '').trim().toLowerCase();
  if (!token) return 'Unknown';
  if (token.includes('young') && token.includes('adult')) return 'Adult';
  if (token.includes('adult')) return 'Adult';
  if (CHILD_AGE_INDICATORS.some((item) => token.includes(item))) return 'Child';
  if (ELDER_AGE_INDICATORS.some((item) => token.includes(item))) return 'Elderly';
  return 'Unknown';
};

export function guessAgeGroupFromSpeaker(name: string): SpeakerAgeGroup {
  const raw = String(name || '').trim();
  if (!raw) return 'Unknown';
  const normalized = raw.toLowerCase();

  if (/(?:\u092c\u091a\u094d\u091a\u093e|\u092c\u091a\u094d\u091a\u0940|\u0932\u0921\u093c\u0915\u093e|\u0932\u0921\u093c\u0915\u0940|\u0915\u093f\u0936\u094b\u0930)/u.test(raw)) {
    return 'Child';
  }
  if (/(?:\u092c\u0941\u091c\u0941\u0930\u094d\u0917|\u0935\u0943\u0926\u094d\u0927|\u0926\u093e\u0926\u093e|\u0926\u093e\u0926\u0940|\u0928\u093e\u0928\u093e|\u0928\u093e\u0928\u0940)/u.test(raw)) {
    return 'Elderly';
  }

  if (CHILD_AGE_INDICATORS.some((item) => normalized.includes(item))) return 'Child';
  if (ELDER_AGE_INDICATORS.some((item) => normalized.includes(item))) return 'Elderly';
  return 'Unknown';
}

const isLikelySpeakerName = (name: string): boolean => {
  const normalized = normalizeSpeakerName(name);
  if (!normalized) return false;
  if (normalized.length > 60) return false;
  if (!/[\p{L}]/u.test(normalized)) return false;
  if (/^\d+$/.test(normalized)) return false;

  const lower = normalized.toLowerCase();
  if (SPEAKER_IGNORE_PREFIXES.some((prefix) => lower.startsWith(prefix))) return false;
  if (normalized.split(' ').length > 8) return false;
  return true;
};

const normalizeSpeakerTagBlock = (rawTagSection?: string | null): string => {
  const raw = String(rawTagSection || '').trim();
  if (!raw) return '';
  const inner = raw
    .replace(/^[\(\[\{]\s*/u, '')
    .replace(/\s*[\)\]\}]$/u, '')
    .trim();
  if (!inner) return '';
  return splitTagBlock(inner)
    .map((token) => String(token || '').trim())
    .filter(Boolean)
    .join(', ');
};

const formatCanonicalSpeakerLine = (
  speaker: string,
  dialogue: string,
  rawTagSection?: string | null,
  leadingWhitespace = ''
): string => {
  const normalizedSpeaker = normalizeSpeakerName(speaker);
  const normalizedDialogue = String(dialogue || '').trim();
  const normalizedTagBlock = normalizeSpeakerTagBlock(rawTagSection);
  const header = normalizedTagBlock
    ? `[${normalizedSpeaker}] (${normalizedTagBlock}):`
    : `[${normalizedSpeaker}]:`;
  return normalizedDialogue
    ? `${leadingWhitespace}${header} ${normalizedDialogue}`
    : `${leadingWhitespace}${header}`;
};

export const normalizeLegacySpeakerHeaderLine = (line: string): string => {
  const source = String(line || '');

  const canonicalMatch = source.match(SPEAKER_REGEX);
  if (canonicalMatch) {
    const canonicalSpeaker = normalizeSpeakerName(canonicalMatch[3] || canonicalMatch[4] || '');
    if (!isLikelySpeakerName(canonicalSpeaker)) return source;
    return formatCanonicalSpeakerLine(
      canonicalSpeaker,
      canonicalMatch[7] || '',
      canonicalMatch[5],
      canonicalMatch[1] || ''
    );
  }

  const legacyMatch = source.match(LEGACY_SPEAKER_REGEX);
  if (!legacyMatch) return source;
  const legacySpeaker = normalizeSpeakerName(legacyMatch[3] || '');
  if (!isLikelySpeakerName(legacySpeaker)) return source;

  return formatCanonicalSpeakerLine(
    legacySpeaker,
    legacyMatch[6] || '',
    legacyMatch[4],
    legacyMatch[1] || ''
  );
};

export const normalizeSpeakerHeaderScript = (text: string): string => (
  String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => normalizeLegacySpeakerHeaderLine(line))
    .join('\n')
);

const parseSpeakerLine = (line: string): ParsedSpeakerLine | null => {
  const match = normalizeLegacySpeakerHeaderLine(line).match(SPEAKER_REGEX);
  if (!match) return null;

  const speaker = normalizeSpeakerName(match[3] || match[4] || '');
  if (!isLikelySpeakerName(speaker)) return null;

  const dialogue = String(match[7] || '').trim();
  const tags = extractEmotionAndCrewTags(match[5]);
  const normalizedPrimaryEmotion = normalizeEmotionTag(tags.primaryEmotion) || 'Neutral';

  return {
    speaker,
    dialogue,
    emotion: normalizedPrimaryEmotion,
    emotionTags: tags.emotionTags,
    crewTags: tags.crewTags,
  };
};

const INLINE_BRACKET_SPEAKER_REGEX = /\[([^\]\n:]{1,40})\]/g;
const INLINE_BRACKET_SFX_TOKEN_REGEX = /^(sfx|sound|music|bgm|fx|noise|ambient|ambience)\b/i;

const normalizeInlineBracketSpeakerScript = (text: string): string => {
  const source = String(text || '').replace(/\r/g, '');
  if (!source.includes('[') || !source.includes(']')) return source;

  const lines = source.split('\n');
  const normalizedLines: string[] = [];

  for (const rawLine of lines) {
    const trimmed = String(rawLine || '').trim();
    if (!trimmed) {
      normalizedLines.push('');
      continue;
    }
    if (SFX_REGEX.test(trimmed) || parseSpeakerLine(trimmed)) {
      normalizedLines.push(trimmed);
      continue;
    }

    const allMarkers = Array.from(trimmed.matchAll(INLINE_BRACKET_SPEAKER_REGEX));
    if (allMarkers.length === 0) {
      normalizedLines.push(trimmed);
      continue;
    }

    const leadingWhitespace = (String(rawLine || '').match(/^\s*/) || [''])[0].length;
    const firstMarker = allMarkers[0];
    if (!firstMarker || (firstMarker.index ?? -1) > leadingWhitespace) {
      normalizedLines.push(trimmed);
      continue;
    }

    const speakerMarkers = allMarkers
      .map((marker) => {
        const label = normalizeSpeakerName(String(marker[1] || ''));
        if (!label || !isLikelySpeakerName(label)) return null;
        if (INLINE_BRACKET_SFX_TOKEN_REGEX.test(label)) return null;
        return {
          speaker: label,
          start: Number(marker.index || 0),
          end: Number((marker.index || 0) + String(marker[0] || '').length),
        };
      })
      .filter((item): item is { speaker: string; start: number; end: number } => Boolean(item));

    if (speakerMarkers.length === 0) {
      normalizedLines.push(trimmed);
      continue;
    }

    const converted: string[] = [];
    for (let index = 0; index < speakerMarkers.length; index += 1) {
      const marker = speakerMarkers[index];
      if (!marker) continue;
      const nextStart = speakerMarkers[index + 1]?.start ?? trimmed.length;
      let dialogue = trimmed.slice(marker.end, nextStart).trim();
      if (dialogue.startsWith(':')) dialogue = dialogue.slice(1).trim();
      if (!dialogue) continue;
      converted.push(formatCanonicalSpeakerLine(marker.speaker, dialogue));
    }

    if (converted.length === 0) {
      normalizedLines.push(trimmed);
      continue;
    }
    normalizedLines.push(...converted);
  }

  return normalizedLines.join('\n');
};

const addCrewCueToDialogue = (dialogue: string, crewTags: string[]): string => {
  const cleanedDialogue = String(dialogue || '').trim();
  if (!cleanedDialogue) return '';
  if (!crewTags.length) return cleanedDialogue;
  return `[${crewTags.join(', ')}] ${cleanedDialogue}`;
};

const estimateSfxDurationSeconds = (label: string): number => {
  const normalized = String(label || '').trim();
  if (!normalized) return 1.2;
  const words = normalized.split(/\s+/).filter(Boolean).length;
  return Math.max(0.8, Math.min(4.5, 0.7 + (words * 0.35) + (normalized.length / 120)));
};

export const parseScriptToSegments = (text: string): {
  startTime: number;
  endTime?: number | undefined;
  speaker: string;
  text: string;
  emotion?: string | undefined;
  crewTags?: string[] | undefined;
  emotionTags?: string[] | undefined;
}[] => {
  const lines = normalizeInlineBracketSpeakerScript(text).split('\n');
  const segments: {
    startTime: number;
    endTime?: number | undefined;
    speaker: string;
    text: string;
    emotion?: string | undefined;
    crewTags?: string[] | undefined;
    emotionTags?: string[] | undefined;
  }[] = [];
  let fallbackCursor = 0;
  let currentSpeaker = 'Narrator';
  let currentEmotion = 'Neutral';
  let currentCrewTags: string[] = [];
  let currentEmotionTags: string[] = [];

  const timeToSeconds = (timestamp: string) => {
    const parts = String(timestamp || '').split(':').map((part) => Number(part));
    if (parts.length === 2) return ((parts[0] ?? 0) * 60) + (parts[1] ?? 0);
    if (parts.length === 3) return ((parts[0] ?? 0) * 3600) + ((parts[1] ?? 0) * 60) + (parts[2] ?? 0);
    return 0;
  };

  const estimateSpeechDuration = (dialogue: string) => {
    const words = dialogue.trim().split(/\s+/).filter(Boolean).length;
    const punctuation = (dialogue.match(/[,.!?;:]/g) || []).length;
    const base = Math.max(1, words) / 2.6;
    return Math.max(0.7, Math.min(12, base + (punctuation * 0.08)));
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let working = trimmed;
    let explicitStart: number | undefined;
    let explicitEnd: number | undefined;

    // Accept [00:00], (00:00), bare 00:00, and range formats like (00:01.20-00:03.85).
    const timestampMatch = working.match(
      /^[\[(]?\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?)(?:\s*[-\u2013]\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,3})?))?\s*[\])]?\s*(.*)$/
    );
    if (timestampMatch) {
      explicitStart = timeToSeconds(String(timestampMatch[1] || '0:00'));
      if (timestampMatch[2]) {
        const parsedEnd = timeToSeconds(String(timestampMatch[2] || '0:00'));
        if (parsedEnd > explicitStart) explicitEnd = parsedEnd;
      }
      working = (timestampMatch[3] || '').trim();
    }

    if (!working) return;

    const sfxMatch = working.match(SFX_REGEX);
    if (sfxMatch) {
      const label = String(sfxMatch[1] || '').trim();
      const start = explicitStart ?? fallbackCursor;
      const dur = estimateSfxDurationSeconds(label);
      segments.push({
        startTime: start,
        endTime: explicitEnd,
        speaker: 'SFX',
        text: label,
        emotion: 'Neutral',
      });
      fallbackCursor = explicitEnd && explicitEnd > start ? explicitEnd : start + dur;
      return;
    }

    const parsed = parseSpeakerLine(working);
    if (parsed) {
      currentSpeaker = parsed.speaker;
      currentEmotion = parsed.emotion || 'Neutral';
      currentCrewTags = parsed.crewTags;
      currentEmotionTags = parsed.emotionTags;

      const dialogue = addCrewCueToDialogue(parsed.dialogue, parsed.crewTags);
      if (!dialogue) return;

      const start = explicitStart ?? fallbackCursor;
      segments.push({
        startTime: start,
        endTime: explicitEnd,
        speaker: currentSpeaker,
        text: dialogue,
        emotion: currentEmotion,
        crewTags: currentCrewTags,
        emotionTags: currentEmotionTags,
      });
      fallbackCursor = explicitEnd && explicitEnd > start ? explicitEnd : start + estimateSpeechDuration(dialogue);
      return;
    }

    const fallbackDialogue = addCrewCueToDialogue(working, currentCrewTags);
    if (!fallbackDialogue) return;

    const start = explicitStart ?? fallbackCursor;
    segments.push({
      startTime: start,
      endTime: explicitEnd,
      speaker: currentSpeaker,
      text: fallbackDialogue,
      emotion: currentEmotion,
      crewTags: currentCrewTags,
      emotionTags: currentEmotionTags,
    });
    fallbackCursor = explicitEnd && explicitEnd > start ? explicitEnd : start + estimateSpeechDuration(fallbackDialogue);
  });

  return segments;
};

const normalizeSpeakerNameForHeader = (raw: string): string => (
  normalizeSpeakerName(raw)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s._'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
);

const ATTRIBUTION_VERB_PATTERN = String.raw`(?:\u0915\u0939\u093e|\u0915\u0939\u0915\u0930|\u0915\u0939\u0924\u0940|\u0915\u0939\u0924\u093e|\u092c\u094b\u0932\u093e|\u092c\u094b\u0932\u0940|\u092a\u0942\u091b\u093e|\u092a\u0942\u091b\u0940|\u091a\u093f\u0932\u094d\u0932\u093e\u092f\u093e|\u091a\u093f\u0932\u094d\u0932\u093e\u0908|\u091c\u0935\u093e\u092c \u0926\u093f\u092f\u093e|\u0909\u0924\u094d\u0924\u0930 \u0926\u093f\u092f\u093e|\u092c\u0924\u093e\u092f\u093e|\u092c\u0924\u093e\u0908|said|asked|replied|shouted|whispered|told)`;
const QUOTE_CHAR_CLASS = String.raw`"\u2018\u2019\u201C\u201D'`;
const OPTIONAL_HINDI_NE_PATTERN = String.raw`(?:\u0928\u0947\s*)?`;
const ATTRIBUTION_SEPARATOR_CHAR_CLASS = String.raw`,\uFF0C:\uFF1A-`;

const normalizeAttributionText = (value: string): string => (
  String(value || '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
);

const extractFirstQuotedSegment = (value: string): string => {
  const match = String(value || '').match(/["']([^"']{2,320})["']|\u201C([^\u201C\u201D]{2,320})\u201D|\u2018([^\u2018\u2019]{2,320})\u2019/u);
  const quoted = match ? (match[1] || match[2] || match[3] || '') : '';
  return String(quoted || '').trim();
};

const normalizeHeaderKey = (value: string): string => (
  normalizeAttributionText(value)
);

const isWeakSpeakerToken = (speaker: string): boolean => {
  const normalized = normalizeSpeakerNameForHeader(speaker);
  if (!normalized) return true;
  return /^(?:narrator|unknown speaker|speaker \d+|voice \d+|person \d+)$/i.test(normalized);
};

const buildSpeakerHeader = (speaker: string, parsed: ParsedSpeakerLine): string => {
  const normalizedSpeaker = normalizeSpeakerName(speaker);
  const normalizedDialogue = String(parsed.dialogue || '').trim();
  const tags = [
    parsed.emotion || 'Neutral',
    ...parsed.emotionTags.filter((tag) => normalizeAttributionText(tag) !== normalizeAttributionText(parsed.emotion || 'Neutral')),
    ...parsed.crewTags,
  ]
    .map((token) => String(token || '').trim())
    .filter(Boolean);
  const tagSection = tags.length > 0 ? ` (${tags.join(', ')})` : '';
  return normalizedDialogue
    ? `[${normalizedSpeaker}]${tagSection}: ${normalizedDialogue}`
    : `[${normalizedSpeaker}]${tagSection}:`;
};

const normalizeScriptTextLine = (line: string): string => (
  String(line || '')
    .replace(/[\u2018\u2019\u201C\u201D"]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
);

const normalizeDirectedTitleMeta = (sourceText: string, directedScript: string): string => {
  const lines = String(directedScript || '').split('\n');
  const firstIndex = lines.findIndex((line) => String(line || '').trim().length > 0);
  if (firstIndex < 0) return directedScript;

  const firstLine = String(lines[firstIndex] || '').trim();
  if (parseSpeakerLine(firstLine) || SFX_REGEX.test(firstLine)) return directedScript;

  const sourceFirstLine = String(sourceText || '')
    .split('\n')
    .map((line) => String(line || '').trim())
    .find((line) => line.length > 0) || '';
  const normalizedFirst = normalizeScriptTextLine(firstLine).toLowerCase();
  const normalizedSourceFirst = normalizeScriptTextLine(sourceFirstLine).toLowerCase();
  const looksLikeTitle =
    normalizedFirst.length > 0 &&
    normalizedFirst.length <= 120 &&
    (
      normalizedFirst === normalizedSourceFirst ||
      /\b(title|story|chapter)\b/i.test(normalizedFirst) ||
      /(?:\u0915\u0939\u093e\u0928\u0940|\u0936\u0940\u0930\u094d\u0937\u0915|\u0905\u0927\u094d\u092f\u093e\u092f)/u.test(firstLine)
    );
  if (!looksLikeTitle) return directedScript;

  lines[firstIndex] = formatCanonicalSpeakerLine(
    'Narrator',
    firstLine.replace(/^(?:["'\u2018\u2019\u201C\u201D])|(?:["'\u2018\u2019\u201C\u201D])$/gu, '').trim(),
    'Neutral'
  );
  return lines.join('\n');
};

const normalizeDirectedTitleMetaStrict = (sourceText: string, directedScript: string): string => {
  const lines = String(directedScript || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');
  const firstIndex = lines.findIndex((line) => String(line || '').trim().length > 0);
  if (firstIndex < 0) return directedScript;

  const firstLine = String(lines[firstIndex] || '').trim();
  const sourceFirstLine = String(sourceText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => String(line || '').trim())
    .find((line) => line.length > 0) || '';

  const normalizedFirst = normalizeScriptTextLine(firstLine).toLowerCase();
  const normalizedSourceFirst = normalizeScriptTextLine(sourceFirstLine).toLowerCase();
  const sourceLooksLikeSpeaker = Boolean(
    sourceFirstLine &&
    (parseSpeakerLine(sourceFirstLine) || SFX_REGEX.test(sourceFirstLine))
  );
  const looksLikeTitle =
    !sourceLooksLikeSpeaker &&
    normalizedFirst.length > 0 &&
    normalizedFirst.length <= 120 &&
    (
      normalizedFirst === normalizedSourceFirst ||
      /\b(title|story|chapter)\b/i.test(normalizedFirst) ||
      /(?:\u0915\u0939\u093e\u0928\u0940|\u0936\u0940\u0930\u094d\u0937\u0915|\u0905\u0927\u094d\u092f\u093e\u092f)/u.test(firstLine)
    );
  if (!looksLikeTitle) return directedScript;

  lines[firstIndex] = formatCanonicalSpeakerLine(
    'Narrator',
    firstLine.replace(/^(?:["'\u2018\u2019\u201C\u201D])+|(?:["'\u2018\u2019\u201C\u201D])+$/gu, '').trim(),
    'Neutral'
  );
  return lines.join('\n');
};

const SPEAKER_HEADER_PATCH_REGEX = new RegExp(
  String.raw`^${SPEAKER_LINE_PREFIX_PATTERN}(?:\*+)?(?:\(\s*(${SPEAKER_NAME_PATTERN})\s*\)|\[\s*(${SPEAKER_NAME_PATTERN})\s*\]|(${SPEAKER_NAME_PATTERN}))(?:\s*[\(\[]([^\)\]]{1,120})[\)\]])?((?:\*+)?\s*[:：]\s*)(.*)$`,
  'su'
);

const normalizeLocaleAgnosticKey = (value: string): string => {
  const normalized = String(value || '').normalize('NFKC');
  return normalizeAttributionText(normalized);
};

const hasUsableTagBlock = (tagBlock: string): boolean => {
  const raw = String(tagBlock || '').trim();
  if (!raw) return false;
  const inner = raw
    .replace(/^[\(\[\{]\s*/u, '')
    .replace(/\s*[\)\]\}]$/u, '')
    .trim();
  if (!inner) return false;
  const tokens = splitTagBlock(inner);
  if (!tokens.length) return false;
  return tokens.some((token) => /[\p{L}\p{N}]/u.test(String(token || '').trim()));
};

const buildDirectorTagBlock = (parsed: ParsedSpeakerLine): string => {
  const primaryEmotion = parsed.emotion || 'Neutral';
  const orderedTags = [
    primaryEmotion,
    ...parsed.emotionTags.filter((tag) => normalizeLocaleAgnosticKey(tag) !== normalizeLocaleAgnosticKey(primaryEmotion)),
    ...parsed.crewTags,
  ]
    .map((token) => String(token || '').trim())
    .filter(Boolean);
  if (!orderedTags.length) return 'Neutral';
  const deduped: string[] = [];
  const seen = new Set<string>();
  orderedTags.forEach((tag) => {
    const key = normalizeLocaleAgnosticKey(tag);
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(tag);
  });
  return deduped.length > 0 ? deduped.join(', ') : 'Neutral';
};

interface DirectorTagCandidate {
  tagBlock: string;
  dialogueKey: string;
  used: boolean;
}

const resolveDirectorTagCandidate = (
  candidates: DirectorTagCandidate[],
  targetDialogueKey: string
): DirectorTagCandidate | undefined => {
  const available = candidates.filter((candidate) => !candidate.used);
  if (!available.length) return undefined;

  if (targetDialogueKey) {
    const exact = available.find((candidate) => candidate.dialogueKey && candidate.dialogueKey === targetDialogueKey);
    if (exact) return exact;

    const closest = available.find((candidate) =>
      candidate.dialogueKey &&
      (
        candidate.dialogueKey.includes(targetDialogueKey) ||
        targetDialogueKey.includes(candidate.dialogueKey)
      ) &&
      Math.min(candidate.dialogueKey.length, targetDialogueKey.length) >= 8
    );
    if (closest) return closest;
  }

  return available[0];
};

export const parseMultiSpeakerScript = (text: string) => {
  const lines = normalizeInlineBracketSpeakerScript(text).split('\n');
  const uniqueSpeakers = new Map<string, string>();
  const crewTags = new Set<string>();

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 2) return;
    if (SFX_REGEX.test(trimmed)) return;

    const parsed = parseSpeakerLine(trimmed);
    if (!parsed) return;
    const key = parsed.speaker.toLowerCase();
    if (!uniqueSpeakers.has(key)) uniqueSpeakers.set(key, parsed.speaker);
    parsed.crewTags.forEach((tag) => crewTags.add(tag));
  });

  const speakersList = Array.from(uniqueSpeakers.values());
  return {
    isMultiSpeaker: speakersList.length > 0,
    speakersList,
    crewTagsList: Array.from(crewTags),
  };
};

export const injectDirectorTagsPreservingFormat = (
  sourceText: string,
  directedText: string
): DirectorTagInjectionResult => {
  const sourceRaw = String(sourceText || '');
  const directedRaw = String(directedText || '');
  if (!sourceRaw.trim()) return { text: sourceRaw, patchedLineCount: 0 };

  const sourceLines = sourceRaw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const normalizedDirectedRaw = normalizeDirectedTitleMetaStrict(sourceText, directedText);
  const directedLines = normalizedDirectedRaw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lineEnding = sourceRaw.includes('\r\n') ? '\r\n' : '\n';

  const directedCandidatesBySpeaker = new Map<string, DirectorTagCandidate[]>();

  directedLines.forEach((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed || SFX_REGEX.test(trimmed)) return;
    const parsed = parseSpeakerLine(trimmed);
    if (!parsed) return;
    const speakerKey = normalizeSpeakerMapKey(String(parsed.speaker || '').normalize('NFKC'));
    if (!speakerKey) return;
    const entry: DirectorTagCandidate = {
      tagBlock: buildDirectorTagBlock(parsed),
      dialogueKey: normalizeLocaleAgnosticKey(parsed.dialogue || ''),
      used: false,
    };
    const current = directedCandidatesBySpeaker.get(speakerKey) || [];
    current.push(entry);
    directedCandidatesBySpeaker.set(speakerKey, current);
  });

  let patchedLineCount = 0;
  const patchedLines = sourceLines.map((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed || SFX_REGEX.test(trimmed)) return line;
    const parsedSource = parseSpeakerLine(trimmed);
    if (!parsedSource) return line;

    const match = String(line || '').match(SPEAKER_HEADER_PATCH_REGEX);
    if (!match) return line;

    const existingTagBlock = String(match[5] || '').trim();
    if (hasUsableTagBlock(existingTagBlock)) return line;

    const speakerKey = normalizeSpeakerMapKey(String(parsedSource.speaker || '').normalize('NFKC'));
    const candidates = speakerKey ? (directedCandidatesBySpeaker.get(speakerKey) || []) : [];
    const candidate = resolveDirectorTagCandidate(
      candidates,
      normalizeLocaleAgnosticKey(parsedSource.dialogue || '')
    );
    if (candidate) candidate.used = true;
    const nextTagBlock = String(candidate?.tagBlock || 'Neutral').trim() || 'Neutral';

    const lead = String(match[1] || '');
    const dialogue = String(match[7] || parsedSource.dialogue || '');
    const patchedLine = formatCanonicalSpeakerLine(parsedSource.speaker, dialogue, nextTagBlock, lead);
    if (patchedLine !== line) {
      patchedLineCount += 1;
    }
    return patchedLine;
  });

  return {
    text: patchedLines.join(lineEnding),
    patchedLineCount,
  };
};
