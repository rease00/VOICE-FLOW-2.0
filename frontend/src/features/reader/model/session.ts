export const READER_TEXT_PREFETCH_THRESHOLD_CHARS = 500;
export const READER_PANEL_BATCH_SIZE = 10;
export const READER_PANEL_PREFETCH_TRIGGER_INDEX = 5;
export const READER_BILLING_RULE = '1 char = 1.5 VF';

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
