import type {
  LivePodcastJobRequest,
  PodcastCastMember,
  PodcastMode,
  StandardPodcastJobRequest,
} from './podcast';
import { LANGUAGES } from '../../../../constants';
import type { GenerationSettings } from '../../../../types';
import type { TtsEngineCapabilitiesResponse } from '../../../shared/api/contracts';

export const PODCAST_DIRECTOR_DEFAULT_MODEL = 'gemini-3.1-flash-lite-preview';
export const PODCAST_DEFAULT_LANGUAGE = 'en';

export interface PodcastLanguageOption {
  value: string;
  label: string;
}

export const PODCAST_LANGUAGE_OPTIONS: PodcastLanguageOption[] = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'ja', label: 'Japanese' },
];

export type PodcastRefreshReason = 'accepted' | 'completed' | 'failed' | 'cancelled';

const REFRESH_REASONS = new Set<PodcastRefreshReason>([
  'accepted',
  'completed',
  'failed',
  'cancelled',
]);
const LANGUAGE_TOKEN_REGEX = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i;
const MULTILINGUAL_LANGUAGE_TOKENS = new Set<string>(['multilingual', 'multi', 'all', '*']);

const compactText = (value: unknown): string => String(value || '').replace(/\s+/g, ' ').trim();
const normalizeLanguageToken = (value: unknown): string => {
  const token = compactText(value).toLowerCase();
  if (!token) return '';
  return LANGUAGE_TOKEN_REGEX.test(token) ? token : '';
};
const resolveLanguageLabel = (normalizedCode: string): string => (
  LANGUAGES.find((item) => normalizeLanguageToken(item.code) === normalizedCode)?.name ||
  normalizedCode.toUpperCase()
);
const dedupeLanguageOptions = (options: PodcastLanguageOption[]): PodcastLanguageOption[] => {
  const deduped = new Map<string, PodcastLanguageOption>();
  for (const option of options) {
    const value = normalizeLanguageToken(option.value);
    if (!value || deduped.has(value)) continue;
    deduped.set(value, { value, label: compactText(option.label) || resolveLanguageLabel(value) });
  }
  return Array.from(deduped.values());
};

export const resolvePodcastLanguageOptions = (
  capabilities: Pick<TtsEngineCapabilitiesResponse, 'engines'> | null | undefined,
  engine: GenerationSettings['engine'],
  fallbackOptions: PodcastLanguageOption[] = PODCAST_LANGUAGE_OPTIONS
): PodcastLanguageOption[] => {
  const safeFallback = dedupeLanguageOptions(fallbackOptions);
  const engineLanguages = capabilities?.engines?.[engine]?.languages;
  if (!Array.isArray(engineLanguages) || engineLanguages.length === 0) {
    return safeFallback.length ? safeFallback : [...PODCAST_LANGUAGE_OPTIONS];
  }

  const hasMultilingualFlag = engineLanguages.some((value) => (
    MULTILINGUAL_LANGUAGE_TOKENS.has(compactText(value).toLowerCase())
  ));
  if (hasMultilingualFlag) {
    const fullLanguageOptions = dedupeLanguageOptions(
      LANGUAGES.map((item) => ({
        value: normalizePodcastLanguage(item.code),
        label: item.name,
      }))
    );
    return fullLanguageOptions.length ? fullLanguageOptions : (safeFallback.length ? safeFallback : [...PODCAST_LANGUAGE_OPTIONS]);
  }

  const declaredLanguageOptions = dedupeLanguageOptions(
    engineLanguages.map((code) => {
      const normalizedCode = normalizeLanguageToken(code);
      return {
        value: normalizedCode,
        label: resolveLanguageLabel(normalizedCode),
      };
    })
  );
  return declaredLanguageOptions.length ? declaredLanguageOptions : (safeFallback.length ? safeFallback : [...PODCAST_LANGUAGE_OPTIONS]);
};

export const normalizePodcastLanguage = (
  value: unknown,
  fallback: string = PODCAST_DEFAULT_LANGUAGE
): string => {
  const fallbackToken = normalizeLanguageToken(fallback) || PODCAST_DEFAULT_LANGUAGE;
  const token = normalizeLanguageToken(value);
  return token || fallbackToken;
};

export const shouldAutoRunDirectorAtStart = (script: unknown): boolean => !compactText(script);

export const buildLivePodcastSubmitRequest = (input: {
  topic: string;
  durationSec: number;
  speakerCount: 2 | 3 | 4;
  cast: PodcastCastMember[];
  pacingStyle: string;
  language?: string;
  seedScript?: string;
  directorModel?: string;
  limits?: LivePodcastJobRequest['limits'];
  recovery?: LivePodcastJobRequest['recovery'];
  output?: LivePodcastJobRequest['output'];
}): LivePodcastJobRequest => {
  const seedScript = compactText(input.seedScript);
  const directorModel =
    compactText(input.directorModel) || PODCAST_DIRECTOR_DEFAULT_MODEL;
  const payload: LivePodcastJobRequest = {
    topic: compactText(input.topic),
    durationSec: Math.max(60, Math.floor(Number(input.durationSec || 0))),
    speakerCount: input.speakerCount,
    cast: Array.isArray(input.cast) ? [...input.cast] : [],
    pacingStyle: compactText(input.pacingStyle),
    language: normalizePodcastLanguage(input.language),
    directorModel,
  };
  if (input.limits) payload.limits = input.limits;
  if (input.recovery) payload.recovery = input.recovery;
  if (input.output) payload.output = input.output;
  if (seedScript) payload.seedScript = seedScript;
  return payload;
};

export const buildStandardPodcastSubmitRequest = (input: {
  engine: 'GEM' | 'NEURAL2';
  topic: string;
  durationSec: number;
  speakerCount: 2 | 3 | 4 | 5 | 6;
  cast: PodcastCastMember[];
  pacingStyle: string;
  language?: string;
  seedScript?: string;
  directorModel?: string;
  autoSave?: boolean;
  includeTranscript?: boolean;
  audioFormat?: 'wav';
  scriptWindowChars?: number;
}): StandardPodcastJobRequest => {
  const seedScript = compactText(input.seedScript);
  const directorModel =
    compactText(input.directorModel) || PODCAST_DIRECTOR_DEFAULT_MODEL;
  const payload: StandardPodcastJobRequest = {
    engine: input.engine,
    topic: compactText(input.topic),
    durationSec: Math.max(60, Math.floor(Number(input.durationSec || 0))),
    speakerCount: input.speakerCount,
    cast: Array.isArray(input.cast) ? [...input.cast] : [],
    pacingStyle: compactText(input.pacingStyle),
    language: normalizePodcastLanguage(input.language),
    directorModel,
  };
  if (typeof input.autoSave === 'boolean') payload.autoSave = input.autoSave;
  if (typeof input.includeTranscript === 'boolean') payload.includeTranscript = input.includeTranscript;
  if (input.audioFormat) payload.audioFormat = input.audioFormat;
  if (typeof input.scriptWindowChars === 'number' && Number.isFinite(input.scriptWindowChars)) {
    payload.scriptWindowChars = input.scriptWindowChars;
  }
  if (seedScript) payload.seedScript = seedScript;
  return payload;
};

const extractErrorFromObject = (value: Record<string, unknown>): string => {
  const detail = value.detail;
  if (typeof detail === 'string' && compactText(detail)) return compactText(detail);
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    return extractErrorFromObject(detail as Record<string, unknown>);
  }

  const message = compactText(value.message);
  const summary = compactText(value.summary);
  const error = compactText(value.error);
  const reason = compactText(value.reason);
  const errorCode = compactText(value.errorCode);
  const primary = summary || error || message;
  const tags = [errorCode, reason].filter(Boolean);
  if (primary && tags.length > 0) return `${primary} (${tags.join(': ')})`;
  if (primary) return primary;
  if (tags.length > 0) return tags.join(': ');
  return '';
};

export const resolvePodcastErrorMessage = (
  error: unknown,
  fallback: string
): string => {
  const fallbackText = compactText(fallback) || 'Podcast generation failed.';
  if (typeof error === 'string') return compactText(error) || fallbackText;
  if (error instanceof Error) {
    const message = compactText(error.message);
    if (message && message !== '[object Object]') return message;
  }
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const extracted = extractErrorFromObject(error as Record<string, unknown>);
    if (extracted && extracted !== '[object Object]') return extracted;
  }
  return fallbackText;
};

export const createPodcastEntitlementRefreshInvoker = (
  refreshEntitlements?: (() => Promise<void>) | null,
  cooldownMs: number = 1500
): ((reason: PodcastRefreshReason) => Promise<void>) => {
  const safeCooldownMs = Math.max(0, Math.floor(Number(cooldownMs) || 0));
  let lastRunMs = 0;
  let inFlight: Promise<void> | null = null;

  return async (reason: PodcastRefreshReason): Promise<void> => {
    if (!refreshEntitlements) return;
    if (!REFRESH_REASONS.has(reason)) return;
    const now = Date.now();
    if ((now - lastRunMs) < safeCooldownMs) return;
    if (inFlight) return;
    lastRunMs = now;
    inFlight = Promise.resolve(refreshEntitlements())
      .catch(() => undefined)
      .finally(() => {
        inFlight = null;
      });
    await inFlight;
  };
};

export const modeLabel = (mode: PodcastMode): string =>
  mode === 'live' ? 'Podcast Live' : 'Podcast Standard';
