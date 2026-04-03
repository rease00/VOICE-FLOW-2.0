import type { ReaderSession } from '../../../../types';
import { parseMultiSpeakerScript } from '../../../../services/geminiService';

export type ReaderEffectiveMultiSpeakerMode = 'single' | 'line_map' | 'studio_pair_groups';

interface ResolveReaderDraftMultiSpeakerModeOptions {
  multiSpeakerEnabled: boolean;
  previewText?: string;
  castMemory?: Record<string, string>;
  fallbackToLineMap?: boolean;
}

const countDraftSpeakers = (castMemory: Record<string, string> | undefined): number => {
  const speakers = Object.keys(castMemory || {})
    .map((speaker) => String(speaker || '').trim())
    .filter((speaker) => speaker && speaker.toLowerCase() !== 'narrator');
  return new Set(speakers.map((speaker) => speaker.toLowerCase())).size;
};

export const resolveReaderDraftMultiSpeakerMode = ({
  multiSpeakerEnabled,
  previewText,
  castMemory,
  fallbackToLineMap = false,
}: ResolveReaderDraftMultiSpeakerModeOptions): ReaderEffectiveMultiSpeakerMode => {
  if (!multiSpeakerEnabled) return 'single';

  const parsed = parseMultiSpeakerScript(String(previewText || ''));
  const detectedCount = parsed.speakersList.filter((speaker) => String(speaker || '').trim()).length;
  const castCount = countDraftSpeakers(castMemory);
  const speakerCount = Math.max(detectedCount, castCount);

  if (speakerCount < 2) return 'single';
  return fallbackToLineMap ? 'line_map' : 'studio_pair_groups';
};

export const normalizeReaderEffectiveMultiSpeakerMode = (
  mode: string | undefined | null,
): ReaderEffectiveMultiSpeakerMode => {
  const token = String(mode || '').trim().toLowerCase();
  if (token === 'studio_pair_groups') return 'studio_pair_groups';
  if (token === 'line_map') return 'line_map';
  return 'single';
};

export const getReaderEffectiveMultiSpeakerMode = (
  session: Pick<ReaderSession, 'effectiveMultiSpeakerMode' | 'multiSpeakerEnabled'> | null | undefined,
  fallback: ResolveReaderDraftMultiSpeakerModeOptions,
): ReaderEffectiveMultiSpeakerMode => {
  if (session?.effectiveMultiSpeakerMode) {
    return normalizeReaderEffectiveMultiSpeakerMode(session.effectiveMultiSpeakerMode);
  }
  if (session && session.multiSpeakerEnabled === false) return 'single';
  return resolveReaderDraftMultiSpeakerMode(fallback);
};

export const formatReaderMultiSpeakerMode = (mode: ReaderEffectiveMultiSpeakerMode): string => {
  if (mode === 'studio_pair_groups') return 'Studio grouped';
  if (mode === 'line_map') return 'Reader line map';
  return 'Single narrator';
};

export const resolveReaderCastDraft = (input: {
  castDraft?: Record<string, string>;
  detectedSpeakers: string[];
  narratorVoiceId: string;
  multiSpeakerEnabled: boolean;
}): Record<string, string> => {
  const resolvedDraft = Object.entries(input.castDraft || {}).reduce<Record<string, string>>((accumulator, [speaker, voiceId]) => {
    const normalizedSpeaker = String(speaker || '').trim();
    if (!normalizedSpeaker) return accumulator;
    const normalizedVoiceId = String(voiceId || '').trim();
    if (normalizedVoiceId) accumulator[normalizedSpeaker] = normalizedVoiceId;
    return accumulator;
  }, {});

  if (!input.multiSpeakerEnabled) {
    return resolvedDraft;
  }

  const narratorVoiceId = String(input.narratorVoiceId || '').trim();
  input.detectedSpeakers
    .map((speaker) => String(speaker || '').trim())
    .filter((speaker) => Boolean(speaker) && speaker.toLowerCase() !== 'narrator')
    .forEach((speaker) => {
      if (!resolvedDraft[speaker]) {
        resolvedDraft[speaker] = narratorVoiceId;
      }
    });

  return resolvedDraft;
};
