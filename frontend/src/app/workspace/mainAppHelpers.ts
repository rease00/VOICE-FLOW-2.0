import { VOICES, EMOTIONS } from '../../../constants';
import type { DubbingClip, GenerationSettings, VoiceOption } from '../../../types';
import { getEngineDisplayName } from '../../../services/engineDisplay';
import { getDefaultApiBaseUrl, sanitizeConfiguredApiBaseUrl } from '../../shared/api/config';
import { STORAGE_KEYS } from '../../shared/storage/keys';
import { readStorageString } from '../../shared/storage/localStore';
import { WorkspaceTab as Tab } from '../../features/workspace/model/tabs';
import type { TokenPackKey } from '../../../services/accountService';

export const STUDIO_SPEECH_GAIN_DEFAULT = 1.0;
export const STUDIO_SPEECH_GAIN_MIN = 0.05;
export const STUDIO_SPEECH_GAIN_MAX = 1.5;
const STUDIO_MUSIC_GAIN_DEFAULT = 0.3;
const STUDIO_MUSIC_GAIN_MIN = 0;
const STUDIO_MUSIC_GAIN_MAX = 1;

const clampFiniteNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
};

export const resolveStudioSpeechGain = (value: unknown): number => (
  clampFiniteNumber(value, STUDIO_SPEECH_GAIN_MIN, STUDIO_SPEECH_GAIN_MAX, STUDIO_SPEECH_GAIN_DEFAULT)
);

export const resolveStudioMusicGain = (value: unknown): number => (
  clampFiniteNumber(value, STUDIO_MUSIC_GAIN_MIN, STUDIO_MUSIC_GAIN_MAX, STUDIO_MUSIC_GAIN_DEFAULT)
);

export const SELECTED_ENGINE_TELEMETRY_HISTORY_LIMIT = 8;

export const appendRollingSample = <T,>(
  samples: readonly T[],
  sample: T,
  limit: number = SELECTED_ENGINE_TELEMETRY_HISTORY_LIMIT
): T[] => {
  const normalizedLimit = Math.max(1, Math.floor(Number(limit || 0)));
  const next = [...samples, sample];
  if (next.length <= normalizedLimit) return next;
  return next.slice(next.length - normalizedLimit);
};

export const shouldRefreshSelectedEngineTelemetry = (
  telemetry: { kind?: string; measuredAtMs?: number } | null | undefined,
  nowMs: number = Date.now(),
  staleAfterMs: number = 5000
): boolean => {
  const kind = String(telemetry?.kind || '').trim().toLowerCase();
  if (!kind) return true;
  if (kind === 'pending') return true;
  if (kind !== 'error') return false;

  const measuredAtMs = Number(telemetry?.measuredAtMs || 0);
  if (!Number.isFinite(measuredAtMs) || measuredAtMs <= 0) return true;

  const safeStaleAfterMs = Math.max(0, Math.floor(Number(staleAfterMs) || 0));
  return (nowMs - measuredAtMs) >= safeStaleAfterMs;
};

export interface RuntimeLatencyCandidate {
  state?: string | undefined;
  latencyMs?: number | null | undefined;
}

const normalizeLatency = (value: unknown): number | null => {
  const latency = Number(value);
  if (!Number.isFinite(latency) || latency < 0) return null;
  return Math.floor(latency);
};

export const pickLowestLatencyRuntimeEngine = (
  candidates: Partial<Record<GenerationSettings['engine'], RuntimeLatencyCandidate | null | undefined>>,
  engineOrder: readonly GenerationSettings['engine'][] = ['VECTOR', 'PRIME']
): GenerationSettings['engine'] | null => {
  let selectedEngine: GenerationSettings['engine'] | null = null;
  let selectedLatencyMs = Number.POSITIVE_INFINITY;
  let selectedOrder = Number.POSITIVE_INFINITY;

  engineOrder.forEach((engine, order) => {
    const candidate = candidates[engine];
    if (!candidate) return;
    const state = String(candidate.state || '').trim().toLowerCase();
    if (state !== 'online') return;
    const latencyMs = normalizeLatency(candidate.latencyMs);
    if (latencyMs === null) return;

    if (
      selectedEngine === null
      || latencyMs < selectedLatencyMs
      || (latencyMs === selectedLatencyMs && order < selectedOrder)
    ) {
      selectedEngine = engine;
      selectedLatencyMs = latencyMs;
      selectedOrder = order;
    }
  });

  return selectedEngine;
};

const normalizeEmotionKey = (value: string): string => (
  String(value || '')
    .toLowerCase()
    .replace(/[\(\)\[\]\{\}"']/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
);

const EMOTION_CANONICAL_BY_KEY = new Map<string, string>();
for (const emotion of EMOTIONS) {
  const key = normalizeEmotionKey(emotion);
  if (key && !EMOTION_CANONICAL_BY_KEY.has(key)) {
    EMOTION_CANONICAL_BY_KEY.set(key, emotion);
  }
}

const EMOTION_ALIASES: Record<string, string> = {
  'heroic veera': 'Heroic',
  'sorrowful karuna': 'Sad',
  'terrified bhayanaka': 'Fearful',
  'disgusted bibhatsa': 'Disgusted',
  'wonderstruck adbhuta': 'Surprised',
  'peaceful shanta': 'Calm',
  'amused hasya': 'Playful',
  'furious raudra': 'Furious',
  'romantic shringara': 'Romantic',
  'devotional bhakti': 'Devotional',
  stern: 'Serious',
  melodramatic: 'Cinematic Narration',
  sleepy: 'Relaxed',
  smiling: 'Cheerful',
  joking: 'Playful',
  amused: 'Playful',
  concerned: 'Empathetic',
  concern: 'Empathetic',
  whisper: 'Whispering',
  shout: 'Shouting',
  yell: 'Shouting',
  scream: 'Screaming',
  cry: 'Crying',
  laugh: 'Laughing',
  sad: 'Sad',
  angry: 'Angry',
  fear: 'Fearful',
  calm: 'Calm',
  happy: 'Happy',
  surpris: 'Surprised',
  worried: 'Anxious',
  panic: 'Anxious',
  shocked: 'Shocked',
  gasp: 'Gasping',
  gasping: 'Gasping',
  soft: 'Soft Spoken',
  gentle: 'Calm',
  storytelling: 'Warm Storytelling',
  dramatic: 'Cinematic Narration',
  cinematic: 'Cinematic Narration',
  romance: 'Romantic',
  loving: 'Loving',
  devotional: 'Devotional',
  bhakti: 'Devotional',
};

export const normalizeEmotionTag = (value: string): string | undefined => {
  const key = normalizeEmotionKey(value);
  if (!key) return undefined;
  if (EMOTION_CANONICAL_BY_KEY.has(key)) return EMOTION_CANONICAL_BY_KEY.get(key);
  if (Object.prototype.hasOwnProperty.call(EMOTION_ALIASES, key)) return EMOTION_ALIASES[key];
  for (const [token, emotion] of Object.entries(EMOTION_ALIASES)) {
    if (key.includes(token)) return emotion;
  }
  return undefined;
};

const MAINAPP_SPEAKER_NAME_PATTERN_V2 = String.raw`[\p{L}\p{N}][\p{L}\p{M}\p{N}\s.'\u2019_-]{0,58}?`;
const MAINAPP_SPEAKER_LINE_REGEX_V2 = new RegExp(
  String.raw`^\s*(?:\[(.+?)\]|\((.+?)\)|(${MAINAPP_SPEAKER_NAME_PATTERN_V2}))(?:\s*[\(\[]([^\)\]]{1,120})[\)\]])?\s*[:\uFF1A]\s*(.*)$`,
  'u'
);

const MAINAPP_SFX_REGEX = /^(?:\[|\()(?:SFX|sfx|Sound|SOUND|Music|MUSIC)\b/i;
const MAINAPP_SPEAKER_LINE_REGEX = MAINAPP_SPEAKER_LINE_REGEX_V2;
const MAINAPP_CANONICAL_HEADER_ONLY_REGEX = /^\s*\[[^\]\n]{1,80}\](?:\s*\([^\)\n]{1,120}\))?\s*[:\uFF1A]\s*$/u;

export const normalizeSpeakerName = (raw: string): string => (
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

export const resolveSpeakerMappedVoiceId = (
  speakerMapping: Record<string, string> | undefined,
  speaker: string
): string => {
  if (!speakerMapping || typeof speakerMapping !== 'object') return '';
  const rawSpeaker = String(speaker || '').trim();
  if (!rawSpeaker) return '';
  if (speakerMapping[rawSpeaker]) return String(speakerMapping[rawSpeaker] || '').trim();
  const normalizedTarget = normalizeSpeakerMapKey(rawSpeaker);
  if (!normalizedTarget) return '';
  for (const key of Object.keys(speakerMapping)) {
    if (normalizeSpeakerMapKey(key) === normalizedTarget) {
      return String(speakerMapping[key] || '').trim();
    }
  }
  return '';
};

const normalizeScriptTextLine = (line: string): string => (
  String(line || '')
    .replace(/[\u2018\u2019\u201C\u201D"]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

const logAiDirectorDebug = (message: string, details?: Record<string, unknown>): void => {
  if (typeof console === 'undefined' || typeof console.debug !== 'function') return;
  if (details) {
    console.debug(`[ai-director] ${message}`, details);
    return;
  }
  console.debug(`[ai-director] ${message}`);
};

const normalizeDirectedTitleMetaStrict = (sourceText: string, directedText: string): string => {
  const lines = String(directedText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');
  const firstIndex = lines.findIndex((line) => String(line || '').trim().length > 0);
  if (firstIndex < 0) return directedText;

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
    (String(sourceFirstLine).trim().match(MAINAPP_SPEAKER_LINE_REGEX) || MAINAPP_SFX_REGEX.test(sourceFirstLine))
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
  if (!looksLikeTitle) return directedText;

  lines[firstIndex] = `Narrator (Neutral): ${firstLine.replace(/^(?:["'\u2018\u2019\u201C\u201D])+|(?:["'\u2018\u2019\u201C\u201D])+$/gu, '').trim()}`;
  logAiDirectorDebug('normalized title-like first line to Narrator.', {
    title: normalizedFirst.slice(0, 80),
  });
  return lines.join('\n');
};

export const normalizeSpeakerHeaderScript = (text: string): string => (
  (() => {
    const normalizedLines = String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map((line) => {
        const match = String(line || '').match(MAINAPP_SPEAKER_LINE_REGEX);
        if (!match) return line;
        const speaker = normalizeSpeakerName(match[1] || match[2] || match[3] || '');
        if (!speaker) return line;
        const rawTagBlock = String(match[4] || '').trim();
        const dialogue = String(match[5] || '').trim();
        const tagBlock = rawTagBlock ? ` (${rawTagBlock})` : '';
        return dialogue ? `[${speaker}]${tagBlock}: ${dialogue}` : `[${speaker}]${tagBlock}:`;
      });

    // Remove duplicate orphan headers and merge orphan headers with following plain dialogue lines.
    const compacted: string[] = [];
    for (let index = 0; index < normalizedLines.length; index += 1) {
      const rawLine = String(normalizedLines[index] || '');
      const trimmed = rawLine.trim();
      if (!trimmed) {
        compacted.push(rawLine);
        continue;
      }
      if (!MAINAPP_CANONICAL_HEADER_ONLY_REGEX.test(trimmed)) {
        compacted.push(rawLine);
        continue;
      }

      const previous = String(compacted[compacted.length - 1] || '').trim();
      if (previous === trimmed) continue;

      const nextRaw = String(normalizedLines[index + 1] || '');
      const nextTrimmed = nextRaw.trim();
      if (
        nextTrimmed &&
        !MAINAPP_SFX_REGEX.test(nextTrimmed) &&
        !MAINAPP_SPEAKER_LINE_REGEX.test(nextTrimmed)
      ) {
        compacted.push(`${trimmed} ${nextTrimmed}`);
        index += 1;
        continue;
      }

      compacted.push(trimmed);
    }

    return compacted.join('\n');
  })()
);

export const parseMultiSpeakerScript = (text: string): { isMultiSpeaker: boolean; speakersList: string[]; crewTagsList: string[] } => {
  const speakers = new Map<string, string>();
  const crewTags: string[] = [];
  for (const rawLine of String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    const trimmed = String(rawLine || '').trim();
    if (!trimmed || MAINAPP_SFX_REGEX.test(trimmed)) continue;
    const match = trimmed.match(MAINAPP_SPEAKER_LINE_REGEX);
    if (!match) continue;
    const speaker = normalizeSpeakerName(match[1] || match[2] || match[3] || '');
    if (!speaker) continue;
    const key = speaker.toLowerCase();
    if (!speakers.has(key)) speakers.set(key, speaker);
  }
  return {
    isMultiSpeaker: speakers.size > 0,
    speakersList: Array.from(speakers.values()),
    crewTagsList: crewTags,
  };
};

interface DirectorHeaderTokens {
  speaker: string;
  primaryEmotion: string;
  cueTags: string[];
}

const parseDirectorTagTokens = (rawTagBlock: string): { primaryEmotion: string; cueTags: string[] } => {
  const tokens = String(rawTagBlock || '')
    .split(',')
    .map((token) => String(token || '').trim())
    .filter((token) => token.length > 0);
  if (tokens.length <= 0) {
    return { primaryEmotion: '', cueTags: [] };
  }
  const normalizedPrimaryEmotion = normalizeEmotionTag(tokens[0] || '') || tokens[0] || '';
  const seenCueTagKeys = new Set<string>();
  const cueTags: string[] = [];
  for (const token of tokens.slice(1)) {
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken) continue;
    const cueKey = normalizedToken.toLowerCase();
    if (cueKey === normalizedPrimaryEmotion.toLowerCase()) continue;
    if (seenCueTagKeys.has(cueKey)) continue;
    seenCueTagKeys.add(cueKey);
    cueTags.push(normalizedToken);
  }
  return {
    primaryEmotion: normalizedPrimaryEmotion,
    cueTags,
  };
};

const parseDirectorHeaderTokensFromLine = (line: string): DirectorHeaderTokens | null => {
  const match = String(line || '').trim().match(MAINAPP_SPEAKER_LINE_REGEX);
  if (!match) return null;
  const speaker = normalizeSpeakerName(match[1] || match[2] || match[3] || '');
  if (!speaker) return null;
  const { primaryEmotion, cueTags } = parseDirectorTagTokens(String(match[4] || ''));
  return {
    speaker,
    primaryEmotion,
    cueTags,
  };
};

const composeHeaderTagBlock = (primaryEmotion: string, cueTags: readonly string[]): string => {
  const normalizedPrimaryEmotion = normalizeEmotionTag(primaryEmotion) || String(primaryEmotion || '').trim() || 'Neutral';
  const cleanedCueTags = cueTags
    .map((token) => String(token || '').trim())
    .filter((token) => token.length > 0 && token.toLowerCase() !== normalizedPrimaryEmotion.toLowerCase());
  const tags = [normalizedPrimaryEmotion, ...cleanedCueTags];
  return ` (${tags.join(', ')})`;
};

export const injectDirectorTagsPreservingFormat = (sourceText: string, directedText: string): { text: string; patchedLineCount: number } => {
  const sourceLines = String(sourceText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const normalizedDirectedText = normalizeDirectedTitleMetaStrict(sourceText, directedText);
  const directedHeaders = String(normalizedDirectedText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => parseDirectorHeaderTokensFromLine(line))
    .filter((header): header is DirectorHeaderTokens => Boolean(header));

  if (String(directedText || '').trim() && directedHeaders.length <= 0) {
    logAiDirectorDebug('no parseable speaker headers found in directed text; using source fallback.');
  }

  if (sourceLines.length <= 0) {
    return { text: '', patchedLineCount: 0 };
  }

  const lastDirectedHeader = directedHeaders.length > 0 ? directedHeaders[directedHeaders.length - 1] : null;
  let headerCursor = 0;
  let patchedLineCount = 0;

  const mergedLines = sourceLines.map((rawLine) => {
    const sourceLine = String(rawLine || '');
    const trimmedSourceLine = sourceLine.trim();
    if (!trimmedSourceLine) return sourceLine;
    if (MAINAPP_SFX_REGEX.test(trimmedSourceLine)) return sourceLine;

    const sourceMatch = trimmedSourceLine.match(MAINAPP_SPEAKER_LINE_REGEX);
    const sourceSpeaker = sourceMatch ? normalizeSpeakerName(sourceMatch[1] || sourceMatch[2] || sourceMatch[3] || '') : '';
    const sourceDialogue = sourceMatch ? String(sourceMatch[5] || '').trim() : trimmedSourceLine;
    const sourceTagTokens = sourceMatch ? parseDirectorTagTokens(String(sourceMatch[4] || '')) : { primaryEmotion: '', cueTags: [] };

    const directedHeader = directedHeaders[headerCursor] || lastDirectedHeader;
    if (headerCursor < directedHeaders.length) headerCursor += 1;

    const nextSpeaker = sourceSpeaker || directedHeader?.speaker || 'Narrator';
    const nextPrimaryEmotion = directedHeader?.primaryEmotion || sourceTagTokens.primaryEmotion || 'Neutral';
    const nextCueTags = directedHeader?.cueTags?.length ? directedHeader.cueTags : sourceTagTokens.cueTags;
    const nextTagBlock = composeHeaderTagBlock(nextPrimaryEmotion, nextCueTags);
    const nextLine = sourceDialogue ? `${nextSpeaker}${nextTagBlock}: ${sourceDialogue}` : `${nextSpeaker}${nextTagBlock}:`;

    if (nextLine !== sourceLine) {
      patchedLineCount += 1;
    }
    return nextLine;
  });

  return {
    text: mergedLines.join('\n'),
    patchedLineCount,
  };
};

export const getStaticVoiceFallback = (engine: GenerationSettings['engine']): VoiceOption[] => (
  VOICES.map((voice) => ({ ...voice, engine }))
);

export const resolveMediaBackendUrl = (settings: Pick<GenerationSettings, 'mediaBackendUrl'>): string => (
  sanitizeConfiguredApiBaseUrl(settings.mediaBackendUrl, getDefaultApiBaseUrl()).value
);

export const COUNTRY_TAG_BY_NAME: Record<string, string> = {
  'united states': 'US',
  'united kingdom': 'UK',
  india: 'IN',
  canada: 'CA',
  australia: 'AU',
  japan: 'JP',
  brazil: 'BR',
  spain: 'ES',
  ireland: 'IE',
  france: 'FR',
  germany: 'DE',
  russia: 'RU',
  'united arab emirates': 'UAE',
};

export const TOKEN_PACK_MATRIX: Record<TokenPackKey, { label: string; vf: number; baseInr: number }> = {
  micro: { label: 'Micro', vf: 50000, baseInr: 550 },
  standard: { label: 'Standard', vf: 150000, baseInr: 1450 },
  mega: { label: 'Mega', vf: 300000, baseInr: 2900 },
  ultra: { label: 'Ultra', vf: 600000, baseInr: 5200 },
};

export const WORKSPACE_TAB_DETAILS: Record<Tab, string> = {
  [Tab.WRITING]: 'Write, browse, publish, and manage your novels',
  [Tab.STUDIO]: 'Write, direct, and preview your next scene',
  [Tab.VOICE_CLONING]: 'Manage voices, cloning, and cast-ready voice assets',
  [Tab.HISTORY]: 'Rendered previews, exports, and runs history',
  [Tab.BILLING]: 'Manage plans, credits, and billing',
  [Tab.ADMIN]: 'Staff controls, moderation, and audits',
};

export const formatInr = (amount: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.max(0, Number(amount || 0)));

export type AdminOpsTab = 'usage' | 'tokens' | 'guardian' | 'alerts' | 'scheduler' | 'audit' | 'analytics' | 'accounting';

const WORKSPACE_PATH_TO_TAB: Array<{ prefix: string; tab: Tab }> = [
  { prefix: '/app/writing', tab: Tab.WRITING },
  { prefix: '/app/novel', tab: Tab.WRITING },
  { prefix: '/app/studio', tab: Tab.STUDIO },
  { prefix: '/app/voices', tab: Tab.VOICE_CLONING },
  { prefix: '/app/runs', tab: Tab.HISTORY },
  { prefix: '/app/billing', tab: Tab.BILLING },
  { prefix: '/app/admin', tab: Tab.ADMIN },
];

export const resolveWorkspaceTabFromPathname = (pathnameInput: string | null | undefined): Tab | null => {
  const pathname = String(pathnameInput || '').trim().toLowerCase();
  if (!pathname) return null;
  for (const entry of WORKSPACE_PATH_TO_TAB) {
    if (pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)) {
      return entry.tab;
    }
  }
  if (pathname === '/app') return Tab.STUDIO;
  return null;
};

export const resolveWorkspaceRoutePath = (tab: Tab): string => {
  switch (tab) {
    case Tab.WRITING:
      return '/app/writing';
    case Tab.VOICE_CLONING:
      return '/app/voices';
    case Tab.HISTORY:
      return '/app/runs';
    case Tab.BILLING:
      return '/app/billing';
    case Tab.ADMIN:
      return '/app/admin';
    case Tab.STUDIO:
    default:
      return '/app/studio';
  }
};

export const normalizeWorkspaceTabCandidate = (candidate: Tab | null | undefined): Tab => (
  candidate || Tab.STUDIO
);

export const buildWorkspaceTabNavigationHref = (
  currentHref: string,
  candidate: Tab | null | undefined
): { tab: Tab; href: string; changed: boolean } => {
  const nextTab = normalizeWorkspaceTabCandidate(candidate);
  const fallbackOrigin = 'https://v-flow-ai.local';
  const currentUrl = new URL(String(currentHref || fallbackOrigin), fallbackOrigin);
  const desiredPath = resolveWorkspaceRoutePath(nextTab);
  const desiredPathToken = desiredPath.toLowerCase();
  const currentPathToken = String(currentUrl.pathname || '').trim().toLowerCase();
  let changed = false;

  if (currentPathToken !== desiredPathToken) {
    currentUrl.pathname = desiredPath;
    changed = true;
  }
  if (currentUrl.searchParams.has('vf-tab')) {
    currentUrl.searchParams.delete('vf-tab');
    changed = true;
  }

  return {
    tab: nextTab,
    href: `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
    changed,
  };
};

export const resolveWorkspaceTabFromUrl = (): Tab | null => {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  return resolveWorkspaceTabFromPathname(url.pathname);
};

export const resolveWorkspaceTabFromStorage = (): Tab | null => {
  const persisted = String(readStorageString(STORAGE_KEYS.workspaceActiveTab) || '').trim().toUpperCase();
  if (persisted === 'NOVEL') return Tab.WRITING;
  if (persisted === 'WRITING') return Tab.WRITING;
  if (persisted === 'LIBRARY') return Tab.WRITING;
  return Object.values(Tab).includes(persisted as Tab) ? (persisted as Tab) : null;
};

export const resolveInitialWorkspaceTab = (): Tab => {
  const fromUrl = resolveWorkspaceTabFromUrl();
  if (fromUrl) return fromUrl;
  return resolveWorkspaceTabFromStorage() || Tab.STUDIO;
};

export const resolveInitialStudioDraftText = (hardCap: number): string => (
  String(readStorageString(STORAGE_KEYS.studioDraftText) || '').slice(0, Math.max(0, Math.floor(Number(hardCap || 0))))
);

export const resolveAdminOpsTabFromUrl = (): AdminOpsTab => {
  if (typeof window === 'undefined') return 'usage';
  const token = String(new URLSearchParams(window.location.search).get('vf-admin-tab') || '').trim().toLowerCase();
  return ['usage', 'tokens', 'guardian', 'alerts', 'scheduler', 'audit', 'analytics', 'accounting'].includes(token)
    ? (token as AdminOpsTab)
    : 'usage';
};

export const normalizePlanToken = (planName: unknown): 'free' | 'launcher' | 'starter' | 'creator' | 'pro' | 'scale' => {
  const token = String(planName || '').trim().toLowerCase();
  if (token === 'launch' || token === 'launcher') return 'launcher';
  if (token === 'starter') return 'starter';
  if (token === 'creator') return 'creator';
  if (token === 'pro') return 'pro';
  if (token === 'scale' || token === 'plus' || token === 'pro_plus' || token === 'pro-plus') return 'scale';
  return 'free';
};

export const resolveTokenPackDiscountPercent = (
  planToken: ReturnType<typeof normalizePlanToken>,
  entitlementDiscount: number
): number => {
  if (Number.isFinite(entitlementDiscount) && entitlementDiscount > 0) {
    return Math.max(0, Math.round(entitlementDiscount));
  }
  if (planToken === 'launcher') return 0;
  if (planToken === 'starter') return 5;
  if (planToken === 'creator') return 5;
  if (planToken === 'pro') return 10;
  if (planToken === 'scale') return 15;
  return 0;
};

export const applyTokenPackDiscount = (baseAmountInr: number, discountPercent: number): number =>
  Math.max(1, Math.round(Math.max(0, Number(baseAmountInr || 0)) * (1 - (Math.max(0, Number(discountPercent || 0)) / 100))));

export const formatMobileAvailableCreditsPercent = (input: {
  hasUnlimitedAccess: boolean;
  monthlyFreeRemaining: number;
  monthlyFreeLimit: number;
  paidVfBalance?: number;
}): string => {
  if (input.hasUnlimitedAccess) return '100%';
  const freeRemaining = Math.max(0, Number(input.monthlyFreeRemaining || 0));
  const freeLimit = Math.max(0, Number(input.monthlyFreeLimit || 0));
  const paidBalance = Math.max(0, Number(input.paidVfBalance || 0));
  const available = Math.max(0, freeRemaining + paidBalance);
  const totalCapacity = Math.max(available, freeLimit + paidBalance);
  if (totalCapacity <= 0) return '0%';
  const percent = Math.max(0, Math.min(100, Math.round((available / totalCapacity) * 100)));
  return `${percent}%`;
};

const CANONICAL_ENGINE_TOKENS = new Set<GenerationSettings['engine']>(['VECTOR', 'PRIME']);
const LEGACY_ENGINE_TOKEN_MAP: Record<string, GenerationSettings['engine']> = {
  BASIC: 'VECTOR',
  GEMINI: 'PRIME',
  GEMINI_RUNTIME: 'PRIME',
  GEMINI_PRO: 'PRIME',
  GEMINI_V2: 'PRIME',
};

const normalizeEngineTokenKey = (value: unknown): string => (
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
);

export const resolveEngineToken = (value: unknown): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const canonical = normalizeEngineTokenKey(raw);
  const legacy = LEGACY_ENGINE_TOKEN_MAP[canonical];
  if (legacy) return legacy;
  return CANONICAL_ENGINE_TOKENS.has(canonical as GenerationSettings['engine'])
    ? canonical
    : raw;
};

export const normalizeEngineToken = (
  value: unknown,
  fallback: GenerationSettings['engine'] = 'PRIME'
): GenerationSettings['engine'] => {
  const token = resolveEngineToken(value);
  if (token === 'VECTOR' || token === 'PRIME') return token;
  return fallback;
};

export const normalizeAllowedEngines = (value: unknown): GenerationSettings['engine'][] => {
  if (!Array.isArray(value)) return [];
  const out = new Set<GenerationSettings['engine']>();
  value.forEach((item) => {
    const normalized = resolveEngineToken(item);
    if (normalized === 'VECTOR' || normalized === 'PRIME') {
      out.add(normalized);
    }
  });
  return Array.from(out);
};

export const PRIME_ACCESS_LOCK_MESSAGE = 'Prime is available on paid subscriptions or with paid token balance.';

export const isPrimeAccessUnlocked = (input: {
  hasUnlimitedAccess?: boolean;
  isPaidBillingPlan?: boolean;
  paidVfBalance?: number;
}): boolean => (
  Boolean(input.hasUnlimitedAccess) ||
  Boolean(input.isPaidBillingPlan) ||
  Math.max(0, Number(input.paidVfBalance || 0)) > 0
);

export const resolvePrimeAllowedEngines = (input: {
  hasUnlimitedAccess?: boolean;
  isPaidBillingPlan?: boolean;
  paidVfBalance?: number;
}): GenerationSettings['engine'][] => (
  isPrimeAccessUnlocked(input) ? ['VECTOR', 'PRIME'] : ['VECTOR']
);

export interface EngineSelectorCopy {
  title: string;
  description: string;
}

export const getEngineSelectorCopy = (engine: GenerationSettings['engine']): EngineSelectorCopy =>
  ({
    title: getEngineDisplayName(engine),
    description: engine === 'VECTOR'
      ? 'Balanced quality with reliable performance.'
      : engine === 'PRIME'
        ? 'Premium synthesis for natural, polished output.'
        : 'Voice engine',
  } as EngineSelectorCopy);

const cleanDubbingLine = (line: string): string => (
  String(line || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*([,:;!?])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim()
);

export const runDubbingEditorTool = (
  script: string,
  mode: 'clean' | 'speakerize' | 'dedupe' | 'compact'
): string => {
  const lines = String(script || '')
    .split(/\r?\n/)
    .map((line) => cleanDubbingLine(line));

  if (mode === 'clean') {
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  if (mode === 'speakerize') {
    return normalizeSpeakerHeaderScript(
      lines
        .map((line) => {
          if (!line) return '';
          if (/^(?:\[[^\]\n]+\]|\([^)]*\))(?:\s+[\(\[][^\)\]]*[\)\]])?\s*:\s+/i.test(line)) {
            return line;
          }
          if (/^[^:\[\(]{1,40}(?:\s+[\(\[][^\)\]]*[\)\]])?\s*:\s+/i.test(line)) {
            const match = line.match(/^([^:\[\(]{1,40}?)(?:\s+[\(\[]([^\)\]]*)[\)\]])?\s*:\s*(.+)$/);
            if (!match) return line;
            const speaker = String(match[1] || '').trim();
            const tagBlock = String(match[2] || '').trim();
            const dialogue = String(match[3] || '').trim();
            return tagBlock
              ? `[${speaker}] (${tagBlock}): ${dialogue}`
              : `[${speaker}]: ${dialogue}`;
          }
          if (/^(?:\([^)]*\)|\[[^\]]*\])\s+/.test(line)) {
            return line.replace(/^((?:\([^)]*\)|\[[^\]]*\])\s+)/, '$1[Speaker 1]: ');
          }
          return `[Speaker 1]: ${line}`;
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    );
  }

  if (mode === 'dedupe') {
    const deduped: string[] = [];
    for (const line of lines) {
      if (!line) {
        if (deduped.length > 0 && deduped[deduped.length - 1] !== '') deduped.push('');
        continue;
      }
      if (deduped.length > 0 && deduped[deduped.length - 1] === line) continue;
      deduped.push(line);
    }
    return deduped.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  return lines.filter(Boolean).join('\n').trim();
};

const buildDubbingClipId = (): string => `dub_clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const createDubbingClip = (file: File, objectUrl: string, durationMs: number = 0): DubbingClip => ({
  id: buildDubbingClipId(),
  file,
  objectUrl,
  durationMs: Math.max(0, Math.round(durationMs || 0)),
  trimInMs: 0,
  trimOutMs: Math.max(240, Math.round(durationMs || 0)),
  layer: 'V1',
  script: '',
  status: 'idle',
  jobId: '',
  resultUrl: null,
  reportUrl: null,
  error: '',
});
