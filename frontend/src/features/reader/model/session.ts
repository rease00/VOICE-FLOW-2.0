import type { ReaderPanelManifest, ReaderSession } from '../../../../types';
import type { ReaderMode } from './tabs';

export const READER_TEXT_PREFETCH_THRESHOLD_CHARS = 1000;
export const READER_PANEL_BATCH_SIZE = 10;
export const READER_PANEL_PREFETCH_TRIGGER_INDEX = 5;

export const resolveReaderBillingDisplay = (session: ReaderSession | null | undefined): {
  vfPerChar: number;
  rule: string;
  label: string;
} => {
  const billing = session?.billing;
  return {
    vfPerChar: Math.max(0, Number(billing?.vfPerChar || 0)),
    rule: String(billing?.rule || '').trim(),
    label: String(billing?.label || '').trim(),
  };
};

export interface ReaderBillingEstimate {
  vfPerChar: number;
  consumedChars: number;
  totalChars: number;
  liveChars: number;
  consumedVf: number;
  totalVf: number;
  remainingVf: number;
  label: string;
  detail: string;
}

const formatDecimal = (value: number): string => {
  const safe = Math.max(0, Number(value || 0));
  const rounded = Math.round(safe * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

const formatInteger = (value: number): string => (
  Math.max(0, Math.round(Number(value || 0))).toLocaleString()
);

const normalizeScriptStatus = (value: string | undefined): 'pending' | 'processing' | 'ready' => {
  const token = normalizeStatus(value);
  if (
    token === 'ready'
    || token === 'completed'
    || token === 'complete'
    || token === 'done'
    || token === 'finished'
    || token === 'available'
    || token === 'exported'
  ) {
    return 'ready';
  }
  if (
    token === 'running'
    || token === 'processing'
    || token === 'generating'
    || token === 'active'
    || token === 'warming'
    || token === 'preparing'
    || token === 'in_progress'
    || token === 'progress'
  ) {
    return 'processing';
  }
  return 'pending';
};

export const resolveReaderBillingEstimate = (
  session: ReaderSession | null | undefined,
  input?: {
    progressPct?: number;
  }
): ReaderBillingEstimate => {
  const billing = session?.billing;
  const vfPerChar = Math.max(0, Number(billing?.vfPerChar || 0));
  const consumedChars = Math.max(0, Number(session?.consumedChars || 0));
  const totalChars = Math.max(0, Number(session?.totalChars || 0));
  const progressPct = Math.max(0, Math.min(100, Number(input?.progressPct ?? session?.progressPct ?? 0)));
  const progressChars = totalChars > 0
    ? Math.max(0, Math.min(totalChars, Math.round(totalChars * (progressPct / 100))))
    : consumedChars;
  const cappedConsumedChars = totalChars > 0 ? Math.min(consumedChars, totalChars) : consumedChars;
  const liveChars = totalChars > 0
    ? Math.max(cappedConsumedChars, progressChars)
    : consumedChars;
  const consumedVf = liveChars * vfPerChar;
  const totalVf = totalChars > 0 ? totalChars * vfPerChar : consumedVf;
  const remainingVf = Math.max(0, totalVf - consumedVf);
  return {
    vfPerChar,
    consumedChars,
    totalChars,
    liveChars,
    consumedVf,
    totalVf,
    remainingVf,
    label: totalVf > 0
      ? `VF est ${formatDecimal(consumedVf)} / ${formatDecimal(totalVf)}`
      : `VF est ${formatDecimal(consumedVf)}`,
    detail: totalChars > 0
      ? `${formatInteger(liveChars)} chars tracked`
      : `${formatInteger(liveChars)} chars tracked`,
  };
};

export const resolveReaderProgressLabel = (session: ReaderSession | null | undefined): string => {
  const progressPct = Math.max(0, Math.round(Number(session?.progressPct || 0)));
  return `${progressPct}% complete`;
};

export const shouldTriggerReaderWindowPrefetch = (input: {
  consumedChars: number;
  scheduledWindowEndChar: number;
  thresholdChars?: number;
}): boolean => {
  const threshold = Math.max(0, input.thresholdChars ?? READER_TEXT_PREFETCH_THRESHOLD_CHARS);
  const consumedChars = Math.max(0, input.consumedChars || 0);
  const scheduledWindowEndChar = Math.max(0, input.scheduledWindowEndChar || 0);
  if (scheduledWindowEndChar <= 0) return false;
  return consumedChars >= Math.max(0, scheduledWindowEndChar - threshold);
};

export const shouldTriggerReaderPanelPrefetch = (input: {
  currentPanelIndex: number;
  scheduledPanelCount: number;
  batchSize?: number;
  triggerIndex?: number;
}): boolean => {
  const batchSize = Math.max(1, input.batchSize ?? READER_PANEL_BATCH_SIZE);
  const triggerIndex = Math.max(0, Math.min(batchSize - 1, input.triggerIndex ?? READER_PANEL_PREFETCH_TRIGGER_INDEX));
  const currentPanelIndex = Math.max(0, input.currentPanelIndex || 0);
  const scheduledPanelCount = Math.max(0, input.scheduledPanelCount || 0);
  if (scheduledPanelCount <= 0) return false;
  const currentBatchStart = Math.floor(currentPanelIndex / batchSize) * batchSize;
  const thresholdIndex = currentBatchStart + triggerIndex;
  return currentPanelIndex >= thresholdIndex && scheduledPanelCount <= currentBatchStart + batchSize;
};

export const getReaderDeleteCountdownLabel = (deleteAtMs: number, nowMs: number = Date.now()): string => {
  const remainingMs = Math.max(0, (deleteAtMs || 0) - nowMs);
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export const shouldRunReaderBackgroundPolling = (input: {
  sessionId?: string | null | undefined;
  workspaceMode: 'browse' | 'playback';
  visibilityState?: DocumentVisibilityState | undefined;
}): boolean => {
  const sessionId = String(input.sessionId || '').trim();
  if (!sessionId) return false;
  if (input.workspaceMode !== 'playback') return false;
  return String(input.visibilityState || 'visible') !== 'hidden';
};

const normalizeStatus = (value: string | undefined): string =>
  String(value || '').trim().toLowerCase();

export const resolveReaderMode = (session: ReaderSession | null | undefined): ReaderMode =>
  session?.contentKind === 'comic' ? 'comic' : 'novel';

export const isLowConfidenceSession = (session: ReaderSession | null | undefined): boolean => {
  if (!session) return false;
  if (session.lowConfidence) return true;
  if (session.windows.some((window) => window.lowConfidence)) return true;
  if (session.panels.some((panel) => panel.lowConfidence)) return true;
  return normalizeStatus(session.prep?.state) === 'degraded' || normalizeStatus(session.prep?.state) === 'error';
};

export const resolveReaderStatusLabel = (session: ReaderSession | null | undefined): string => {
  if (!session) return 'Idle';
  const prepState = normalizeStatus(session.prep?.state);
  if (prepState === 'queued') return 'Preparing';
  if (prepState === 'running') return 'Detecting Text';
  if (prepState === 'error') return 'Preparation Failed';
  if (prepState === 'degraded') return 'Needs Review';
  const readiness = normalizeStatus(session.readiness?.state);
  if (readiness === 'blocked') return 'Blocked';
  if (readiness === 'ready') return 'Ready';
  return 'Generating Audio';
};

export interface ReaderPlayableUnit {
  id: string;
  title: string;
  body: string;
  jobId: string;
  status: string;
  mode: ReaderMode;
  index: number;
  confidenceLow: boolean;
  charCount: number;
}

const resolvePanelBody = (panel: ReaderPanelManifest): string =>
  String(panel.displayText || panel.translatedText || panel.sourceText || panel.text || '').trim();

export interface ReaderScriptSegment {
  id: string;
  title: string;
  body: string;
  status: 'pending' | 'processing' | 'ready';
  index: number;
  charCount: number;
  speaker?: string;
}

const resolveUnitStatus = (unitStatus: string | undefined, jobId: string, body: string): 'pending' | 'processing' | 'ready' => {
  const token = normalizeStatus(unitStatus);
  const isReady = normalizeScriptStatus(token) === 'ready';
  if (isReady) return 'ready';
  const isProcessing = normalizeScriptStatus(token) === 'processing';
  if (isProcessing) return 'processing';
  if (token === 'queued' || token === 'pending') return 'pending';
  if (jobId && body) return 'processing';
  return 'pending';
};

export const getReaderPlayableUnits = (session: ReaderSession | null | undefined): ReaderPlayableUnit[] => {
  if (!session) return [];
  if (session.contentKind === 'comic') {
    return session.panels.map((panel) => ({
      id: panel.panelId || `panel-${panel.index}`,
      title: `Panel ${panel.index + 1}`,
      body: resolvePanelBody(panel),
      jobId: String(panel.audioJob?.jobId || panel.audioJobId || '').trim(),
      status: String(panel.audioJob?.status || panel.audioStatus || panel.translationStatus || 'queued'),
      mode: 'comic',
      index: panel.index,
      confidenceLow: Boolean(panel.lowConfidence),
      charCount: Math.max(0, Number(panel.text?.trim().length || panel.displayText?.trim().length || panel.sourceText?.trim().length || 0)),
    }));
  }
  return session.windows.map((window) => ({
    id: `window-${window.index}`,
    title: `Chapter ${window.index + 1}`,
    body: String(window.displayText || window.translatedText || window.sourceText || window.text || '').trim(),
    jobId: String(window.job?.jobId || window.jobId || '').trim(),
    status: String(window.job?.status || window.translationStatus || window.status || 'queued'),
    mode: 'novel',
    index: window.index,
    confidenceLow: Boolean(window.lowConfidence),
    charCount: Math.max(0, Number(window.charCount || String(window.displayText || window.translatedText || window.sourceText || window.text || '').trim().length || 0)),
  }));
};

export const resolveReaderPlayableUnits = getReaderPlayableUnits;

export const resolveReaderScriptSegments = (session: ReaderSession | null | undefined): ReaderScriptSegment[] => {
  if (!session) return [];
  return getReaderPlayableUnits(session).map((unit) => {
    const panelSpeaker = session.contentKind === 'comic'
      ? String(session.panels[unit.index]?.speaker || '').trim()
      : '';
    return {
      id: unit.id,
      title: unit.title,
      body: unit.body,
      status: resolveUnitStatus(unit.status, unit.jobId, unit.body),
      index: unit.index,
      charCount: unit.charCount,
      ...(panelSpeaker ? { speaker: panelSpeaker } : {}),
    };
  });
};
