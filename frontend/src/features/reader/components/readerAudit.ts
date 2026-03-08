import type { ReaderAudioWindow, ReaderCatalogItem, ReaderPanelManifest, ReaderSession } from '../../../../types';

export type ReaderAuditSeverity = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface ReaderAuditMetric {
  id: string;
  label: string;
  value: string;
  detail?: string | undefined;
  tone: ReaderAuditSeverity;
}

export interface ReaderAuditAlert {
  id: string;
  label: string;
  detail: string;
  tone: ReaderAuditSeverity;
}

export interface ReaderAuditRow {
  id: string;
  label: string;
  status: string;
  summary: string;
  detail?: string | undefined;
  meta?: string | undefined;
  tone: ReaderAuditSeverity;
}

export interface ReaderAuditModel {
  headline: string;
  subhead: string;
  metrics: ReaderAuditMetric[];
  alerts: ReaderAuditAlert[];
  rows: ReaderAuditRow[];
}

interface DeriveReaderAuditModelParams {
  selectedItem: ReaderCatalogItem | null;
  session: ReaderSession | null;
  billingLabel: string;
  warningCountdown: string;
  targetLanguageLabel: string;
  pageViewModeLabel: string;
  ttsLanguageModeLabel: string;
  multiSpeakerLabel: string;
}

const toneFromStatus = (rawStatus: string, fallback: ReaderAuditSeverity = 'neutral'): ReaderAuditSeverity => {
  const status = String(rawStatus || '').trim().toLowerCase();
  if (!status) return fallback;
  if (['completed', 'ready', 'playable', 'exported'].includes(status)) return 'success';
  if (['error', 'failed', 'blocked'].includes(status)) return 'danger';
  if (['warming', 'warning', 'preparing', 'queued', 'running', 'pending'].includes(status)) return 'warning';
  if (['translated', 'original', 'idle'].includes(status)) return 'info';
  return fallback;
};

const truncate = (value: string | undefined, max = 120): string => {
  const safe = String(value || '').trim();
  if (!safe) return 'No text available yet.';
  if (safe.length <= max) return safe;
  return `${safe.slice(0, Math.max(0, max - 3))}...`;
};

const formatEstimatedRead = (estimatedReadMs: number | undefined): string => {
  const safe = Number(estimatedReadMs || 0);
  if (safe <= 0) return '';
  const seconds = Math.max(1, Math.round(safe / 1000));
  if (seconds < 60) return `${seconds}s read`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toString().padStart(2, '0')}s read`;
};

const buildWindowRow = (item: ReaderAudioWindow): ReaderAuditRow => {
  const status = String(item.job?.status || item.translationStatus || item.status || 'pending');
  const parts = [
    typeof item.startChar === 'number' && typeof item.endChar === 'number' ? `${item.startChar}-${item.endChar} chars` : '',
    formatEstimatedRead(item.estimatedReadMs),
    item.exported ? 'Exported' : '',
    item.purged ? 'Purged' : '',
  ].filter(Boolean);
  return {
    id: `window-${item.index}`,
    label: `Window ${item.index + 1}`,
    status,
    summary: truncate(item.displayText || item.translatedText || item.sourceText || item.text, 140),
    detail: parts.join(' | '),
    meta: item.translationStatus ? `Translation ${item.translationStatus}` : undefined,
    tone: toneFromStatus(status),
  };
};

const buildPanelRow = (item: ReaderPanelManifest): ReaderAuditRow => {
  const status = String(item.audioJob?.status || item.audioStatus || item.translationStatus || 'pending');
  const parts = [
    item.emotion ? `Emotion ${item.emotion}` : '',
    Array.isArray(item.sfx) && item.sfx.length > 0 ? `SFX ${item.sfx.join(', ')}` : '',
    formatEstimatedRead(item.estimatedReadMs),
    item.purged ? 'Purged' : '',
  ].filter(Boolean);
  return {
    id: item.panelId || `panel-${item.index}`,
    label: `Panel ${item.index + 1}`,
    status,
    summary: truncate(item.displayText || item.translatedText || item.sourceText || item.text, 120),
    detail: parts.join(' | '),
    meta: item.translationStatus ? `Translation ${item.translationStatus}` : undefined,
    tone: toneFromStatus(status),
  };
};

export const deriveReaderAuditModel = ({
  selectedItem,
  session,
  billingLabel,
  warningCountdown,
  targetLanguageLabel,
  pageViewModeLabel,
  ttsLanguageModeLabel,
  multiSpeakerLabel,
}: DeriveReaderAuditModelParams): ReaderAuditModel => {
  if (!session) {
    const readiness = selectedItem?.readiness?.label || 'Ready to prepare';
    const progressLabel = selectedItem?.resume?.hasProgress ? `${Math.round(Number(selectedItem.resume?.progressPct || 0))}% complete` : 'Not started';
    const statsLabel = selectedItem?.contentKind === 'comic'
      ? `${Number(selectedItem?.stats?.totalPanels || selectedItem?.stats?.pageCount || 0) || 0} panels`
      : `${Number(selectedItem?.stats?.totalChars || 0) || 0} chars`;
    const prep = selectedItem?.prep;
    return {
      headline: selectedItem?.title || 'Reader audit idle',
      subhead: selectedItem
        ? 'Previewing preparation state and shelf metadata before playback begins.'
        : 'Select a title to inspect preparation status, translation settings, and billing context.',
      metrics: [
        { id: 'readiness', label: 'Readiness', value: readiness, tone: toneFromStatus(selectedItem?.readiness?.state || 'ready', 'info') },
        { id: 'prep', label: 'Preparation', value: prep ? `${prep.completedItems}/${prep.totalItems}` : 'Not started', detail: prep ? `${prep.stage} | ${prep.state}` : 'No active session yet', tone: toneFromStatus(prep?.state || 'idle', 'neutral') },
        { id: 'progress', label: 'Progress', value: progressLabel, tone: selectedItem?.resume?.hasProgress ? 'info' : 'neutral' },
        { id: 'stats', label: 'Collection Stats', value: statsLabel, tone: 'neutral' },
        { id: 'billing', label: 'Billing', value: billingLabel, tone: 'info' },
        { id: 'translation', label: 'Translation', value: `${targetLanguageLabel} / ${pageViewModeLabel}`, detail: `TTS ${ttsLanguageModeLabel}`, tone: 'info' },
        { id: 'multi-speaker', label: 'Multi-Speaker', value: multiSpeakerLabel, tone: multiSpeakerLabel === 'Single narrator' ? 'neutral' : 'info' },
      ],
      alerts: [
        ...(selectedItem?.readiness?.state === 'blocked'
          ? [{
            id: 'blocked',
            label: 'Playback blocked',
            detail: selectedItem.readiness?.reason || 'This title cannot be prepared in the current state.',
            tone: 'danger',
          } satisfies ReaderAuditAlert]
          : []),
        ...(prep?.state === 'error' || prep?.state === 'degraded'
          ? [{
              id: 'prep-state',
              label: prep.state === 'error' ? 'Preparation failed' : 'Preparation degraded',
              detail: prep.message || 'The last active preparation attempt did not complete cleanly.',
              tone: prep.state === 'error' ? 'danger' : 'warning',
            } satisfies ReaderAuditAlert]
          : []),
      ],
      rows: selectedItem
        ? [{
            id: `item-${selectedItem.id}`,
            label: selectedItem.contentKind === 'comic' ? 'Series snapshot' : 'Text snapshot',
            status: selectedItem.readiness?.state || 'idle',
            summary: truncate(selectedItem.summary || selectedItem.excerpt || selectedItem.sampleText, 180),
            detail: [selectedItem.provider, selectedItem.collectionLabel || '', selectedItem.license, prep ? `${prep.completedItems}/${prep.totalItems} prepared` : ''].filter(Boolean).join(' | '),
            meta: selectedItem.sourceLanguage ? `Source ${selectedItem.sourceLanguage}` : undefined,
            tone: toneFromStatus(selectedItem.readiness?.state || 'idle', 'neutral'),
          }]
        : [],
    };
  }

  const fallbackCount = Object.keys(session.voiceFallbacks || {}).length;
  const prep = session.prep;
  const rowItems = session.contentKind === 'comic'
    ? session.panels.map(buildPanelRow)
    : session.windows.map(buildWindowRow);
  const playableCount = rowItems.filter((item) => item.tone === 'success').length;
  const totalCount = rowItems.length;
  const alerts: ReaderAuditAlert[] = [];

  if (session.warningActive) {
    alerts.push({
      id: 'cache-warning',
      label: 'Cache expiry warning',
      detail: `Unsaved audio expires in ${warningCountdown}. Export or savepoint the session to preserve playback state.`,
      tone: 'warning',
    });
  }
  if (session.readiness?.state === 'blocked') {
    alerts.push({
      id: 'blocked',
      label: 'Playback blocked',
      detail: session.readiness?.reason || 'The current session has been blocked.',
      tone: 'danger',
    });
  }
  if (session.translationState === 'error') {
    alerts.push({
      id: 'translation-error',
      label: 'Translation pipeline error',
      detail: 'Translated page or speech output is currently degraded for this session.',
      tone: 'danger',
    });
  }
  if (fallbackCount > 0) {
    alerts.push({
      id: 'voice-fallbacks',
      label: 'Voice fallback bindings active',
      detail: `${fallbackCount} speaker binding${fallbackCount === 1 ? '' : 's'} resolved to fallback voices.`,
      tone: 'warning',
    });
  }
  if (prep?.state === 'running' || prep?.state === 'queued') {
    alerts.push({
      id: 'prep-running',
      label: 'Preparation in progress',
      detail: prep.message || `Stage ${prep.stage} is preparing ${prep.completedItems}/${prep.totalItems} item(s).`,
      tone: 'warning',
    });
  }
  if (prep?.state === 'degraded') {
    alerts.push({
      id: 'prep-degraded',
      label: 'Preparation completed with failures',
      detail: prep.message || `${prep.failedItems} item(s) failed during preparation.`,
      tone: 'warning',
    });
  }
  if (prep?.state === 'error') {
    alerts.push({
      id: 'prep-error',
      label: 'Preparation failed',
      detail: prep.message || 'Reader could not prepare a playable session.',
      tone: 'danger',
    });
  }

  return {
    headline: session.title,
    subhead: session.contentKind === 'comic'
      ? 'Panel-by-panel readiness, translation, and audio generation audit.'
      : 'Window-by-window narration readiness, translation, and cache audit.',
    metrics: [
      { id: 'readiness', label: 'Readiness', value: session.readiness?.label || 'Preparing playback', tone: toneFromStatus(session.readiness?.state || 'preparing', 'warning') },
      { id: 'prep', label: 'Preparation', value: prep ? `${prep.completedItems}/${prep.totalItems}` : 'N/A', detail: prep ? `${prep.stage} | ${prep.state} | ${prep.failedItems} failed` : 'No preparation telemetry', tone: toneFromStatus(prep?.state || 'idle', 'neutral') },
      { id: 'progress', label: 'Progress', value: `${Math.round(session.progressPct)}%`, detail: `${session.contentKind === 'comic' ? session.currentPanelIndex : session.consumedChars} consumed`, tone: 'info' },
      { id: 'cache', label: 'Cache Safety', value: session.warningActive ? `Expires in ${warningCountdown}` : 'Protected', detail: `${session.cachedChars}/${session.cacheLimitChars} chars cached`, tone: session.warningActive ? 'warning' : 'success' },
      { id: 'billing', label: 'Billing', value: session.billing?.label || billingLabel, tone: 'info' },
      { id: 'translation', label: 'Translation', value: `${targetLanguageLabel} / ${pageViewModeLabel}`, detail: `${session.translationState} | TTS ${ttsLanguageModeLabel}`, tone: toneFromStatus(session.translationState || 'idle', 'info') },
      { id: 'multi-speaker', label: 'Multi-Speaker', value: multiSpeakerLabel, tone: multiSpeakerLabel === 'Studio grouped' ? 'success' : multiSpeakerLabel === 'Reader line map' ? 'info' : 'neutral' },
      { id: 'fallbacks', label: 'Voice Fallbacks', value: `${fallbackCount}`, detail: fallbackCount > 0 ? 'Fallback voices are currently in use.' : 'No fallback bindings', tone: fallbackCount > 0 ? 'warning' : 'success' },
      { id: 'coverage', label: 'Playable Coverage', value: `${playableCount}/${totalCount}`, detail: totalCount > 0 ? 'Completed audio items' : 'No playable items yet', tone: playableCount === totalCount && totalCount > 0 ? 'success' : playableCount > 0 ? 'warning' : 'neutral' },
    ],
    alerts,
    rows: rowItems,
  };
};
