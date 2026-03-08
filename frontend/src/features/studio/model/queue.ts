import type { GenerationSettings, StudioQueueItem, StudioQueueState } from '../../../../types';
import { buildSentenceAlignedCharWindows } from '../../../../services/ttsLongTextService';

export const canUseStudioQueue = (text: string, maxCharsPerGeneration: number): boolean => (
  String(text || '').trim().length > Math.max(1, Number(maxCharsPerGeneration) || 1)
);

export const hashStudioQueueSource = (text: string): string => {
  const safe = String(text || '');
  let hash = 0;
  for (let index = 0; index < safe.length; index += 1) {
    hash = ((hash << 5) - hash) + safe.charCodeAt(index);
    hash |= 0;
  }
  return `studio_${Math.abs(hash)}`;
};

export const computeStudioQueueMasterOrder = (items: StudioQueueItem[]): string => {
  const visible = [...items]
    .sort((left, right) => left.order - right.order)
    .map((item) => String(item.label || '').replace(/^Part\s+/i, '').trim())
    .filter(Boolean);
  return visible.join('+');
};

export const buildStudioQueueItems = (
  text: string,
  maxCharsPerGeneration: number,
  settings: GenerationSettings
): StudioQueueItem[] => {
  const chunks = buildSentenceAlignedCharWindows(text, maxCharsPerGeneration);
  return chunks.map((chunk, index) => ({
    id: crypto.randomUUID(),
    order: index,
    label: `Part ${index + 1}`,
    status: 'queued',
    sourceText: chunk.text,
    charCount: chunk.charCount,
    audioCacheKey: '',
    settingsSnapshot: JSON.parse(JSON.stringify(settings)) as GenerationSettings,
    createdAt: Date.now(),
  }));
};

export const createStudioQueueState = (
  text: string,
  maxCharsPerGeneration: number,
  settings: GenerationSettings,
  queueModeEnabled: boolean
): StudioQueueState => {
  const items = buildStudioQueueItems(text, maxCharsPerGeneration, settings);
  return {
    items,
    activeItemId: items[0]?.id,
    masterOrder: computeStudioQueueMasterOrder(items),
    masterStatus: 'idle',
    queueModeEnabled,
    sourceHash: hashStudioQueueSource(text),
  };
};

export const getNextQueuedStudioQueueItem = (state: StudioQueueState | null | undefined): StudioQueueItem | null => {
  if (!state) return null;
  const next = [...state.items]
    .sort((left, right) => left.order - right.order)
    .find((item) => item.status === 'queued');
  return next || null;
};

export const normalizeStoredStudioQueueState = (value: unknown): StudioQueueState | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StudioQueueState>;
  if (!Array.isArray(candidate.items)) return null;
  const items = candidate.items
    .filter((item): item is StudioQueueItem => Boolean(item && typeof item === 'object' && item.id))
    .map((item, index) => ({
      ...item,
      order: Number.isFinite(item.order) ? Number(item.order) : index,
      label: String(item.label || `Part ${index + 1}`),
      status: item.status || 'queued',
      sourceText: String(item.sourceText || ''),
      charCount: Number.isFinite(item.charCount) ? Number(item.charCount) : String(item.sourceText || '').length,
      audioCacheKey: typeof item.audioCacheKey === 'string' ? item.audioCacheKey : '',
      settingsSnapshot: item.settingsSnapshot || {
        voiceId: '',
        speed: 1,
        pitch: 'Medium',
        language: 'Auto',
        engine: 'GEM',
        helperProvider: 'GEMINI',
      },
      createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : Date.now(),
      completedAt: Number.isFinite(item.completedAt) ? Number(item.completedAt) : undefined,
    }));
  const normalized: StudioQueueState = {
    items,
    activeItemId: typeof candidate.activeItemId === 'string' ? candidate.activeItemId : items[0]?.id,
    masterOrder: typeof candidate.masterOrder === 'string'
      ? candidate.masterOrder
      : computeStudioQueueMasterOrder(items),
    masterStatus: candidate.masterStatus === 'building' || candidate.masterStatus === 'ready'
      ? candidate.masterStatus
      : 'idle',
    queueModeEnabled: candidate.queueModeEnabled !== false,
    sourceHash: String(candidate.sourceHash || ''),
  };
  return normalized;
};
