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
  const directedLines = directedRaw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
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
