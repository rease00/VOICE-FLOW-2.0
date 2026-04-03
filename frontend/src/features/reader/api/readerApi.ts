import type {
  ReaderCatalogItem,
  ReaderCatalogRegion,
  ReaderCommercialPolicy,
  ReaderDashboardPayload,
  ReaderLegalAck,
  ReaderLibrary,
  ReaderOwnershipBasis,
  ReaderSession,
  ReaderSessionProgress,
} from '../../../../types';
import { authFetch } from '../../../../services/authHttpClient';
import { resolveApiUrl } from '../../../shared/api/config';
import { fetchTtsJobResult, getTtsJob } from '../../../shared/api/gatewayClient';
import { buildReaderDashboardPayloadFromLibrary, normalizeReaderDashboardPayload } from '../model/dashboard';
import type { ReaderHomeTab, ReaderTab } from '../model/tabs';

type ReaderSurface = 'all' | 'books' | 'comics' | 'uploads';
const READER_BOOTSTRAP_TIMEOUT_MS = 10_000;
const READER_LIBRARY_BOOTSTRAP_TIMEOUT_MS = 30_000;

export type ReaderCommercialResult = 'allowed' | 'review' | 'blocked';

export interface ReaderCommercialCheckRequest {
  provider?: string;
  license?: string;
  attributionUrl?: string;
  ownershipBasis?: ReaderOwnershipBasis;
  intendedUse?: 'tts_transform_only' | 'private_accessibility' | 'public_distribution' | 'resale';
  isSellingOriginalText?: boolean;
}

export interface ReaderCommercialCheckResponse {
  result: ReaderCommercialResult;
  reason: string;
  provider: string;
  licenseToken: string;
  ownershipBasis: ReaderOwnershipBasis;
  intendedUse: string;
  isSellingOriginalText: boolean;
  catalogAllowed: boolean;
  notes: string[];
  nextSteps: string[];
}

const extractReaderErrorMessage = (detail: unknown): string => {
  if (typeof detail === 'string') return detail.trim();
  if (detail && typeof detail === 'object') {
    const payload = detail as Record<string, unknown>;
    for (const key of ['error', 'message', 'reason', 'detail']) {
      const candidate = payload[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    if (typeof payload.code === 'string' && payload.code.trim()) return payload.code.trim();
    try {
      return JSON.stringify(detail);
    } catch {
      return '';
    }
  }
  return '';
};

const readErrorPayload = async (response: Response): Promise<{ message: string; code?: string; detail?: unknown }> => {
  const payload = await response
    .clone()
    .json()
    .catch(async () => ({ detail: await response.clone().text().catch(() => '') }));
  const detail = (payload as { detail?: unknown }).detail;
  const message = extractReaderErrorMessage(detail) || 'Reader request failed.';
  const code = detail && typeof detail === 'object' && typeof (detail as { code?: unknown }).code === 'string'
    ? String((detail as { code?: unknown }).code || '').trim()
    : '';
  return { message, ...(code ? { code } : {}), detail };
};

const captureResponseHeaders = (response: Response): Record<string, string> => {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    const safeKey = String(key || '').trim().toLowerCase();
    if (!safeKey) return;
    headers[safeKey] = String(value ?? '');
  });
  return headers;
};

const isReaderMetadataSyncUnavailable = (error: unknown): boolean => {
  const status = Number((error as { status?: number } | null | undefined)?.status || 0);
  return status === 404 || status === 501;
};

const readerFetchJson = async <T>(
  input: string,
  init?: RequestInit,
  options?: { timeoutMs?: number }
): Promise<T> => {
  const response = await authFetch(input, init, {
    ...(Number.isFinite(options?.timeoutMs) ? { timeoutMs: Number(options?.timeoutMs) } : {}),
  });
  if (!response.ok) {
    const payload = await readErrorPayload(response);
    const error = new Error(payload.message) as Error & { status?: number; code?: string; detail?: unknown };
    error.status = response.status;
    if (payload.code) error.code = payload.code;
    if (typeof payload.detail !== 'undefined') error.detail = payload.detail;
    throw error;
  }
  return response.json() as Promise<T>;
};

const isDashboardUnavailableError = (error: unknown): boolean => {
  const status = Number((error as { status?: number } | null | undefined)?.status || 0);
  return status === 404 || status === 501;
};

const buildReaderQueryString = (params: { surface?: ReaderSurface; regionId?: string; search?: string }): string => {
  const search = new URLSearchParams();
  if (params.surface) search.set('surface', params.surface);
  if (params.regionId) search.set('regionId', params.regionId);
  if (params.search) search.set('search', params.search);
  return search.toString();
};

export const getReaderLegalAck = async (backendBaseUrl: string): Promise<{
  ack: ReaderLegalAck;
  billing: { vfPerChar: number; rule: string; label: string };
  commercial?: ReaderCommercialPolicy;
}> => {
  const payload = await readerFetchJson<{
    ack: ReaderLegalAck;
    billing: { vfPerChar: number; rule: string; label: string };
    commercial?: ReaderCommercialPolicy;
  }>(resolveApiUrl('/reader/legal/ack', backendBaseUrl), undefined, { timeoutMs: READER_BOOTSTRAP_TIMEOUT_MS });
  return payload;
};

export const acceptReaderLegalAck = async (backendBaseUrl: string): Promise<ReaderLegalAck> => {
  const payload = await readerFetchJson<{ ack: ReaderLegalAck }>(resolveApiUrl('/reader/legal/ack', backendBaseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accepted: true }),
  });
  return payload.ack;
};

export const checkReaderCommercialUse = async (
  backendBaseUrl: string,
  payload: ReaderCommercialCheckRequest
): Promise<ReaderCommercialCheckResponse> => {
  const data = await readerFetchJson<{ check: ReaderCommercialCheckResponse }>(
    resolveApiUrl('/reader/commercial/check', backendBaseUrl),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    { timeoutMs: READER_BOOTSTRAP_TIMEOUT_MS }
  );
  return data.check;
};

export const listReaderRegions = async (
  backendBaseUrl: string,
  surface: Exclude<ReaderSurface, 'uploads'>
): Promise<ReaderCatalogRegion[]> => {
  const payload = await readerFetchJson<{ regions: ReaderCatalogRegion[] }>(
    resolveApiUrl(`/reader/catalog/regions?surface=${encodeURIComponent(surface)}`, backendBaseUrl),
    undefined,
    { timeoutMs: READER_BOOTSTRAP_TIMEOUT_MS }
  );
  return payload.regions || [];
};

export const listReaderItems = async (
  backendBaseUrl: string,
  params: { surface: Exclude<ReaderSurface, 'all'>; regionId?: string; search?: string }
): Promise<ReaderCatalogItem[]> => {
  const query = buildReaderQueryString(params);
  const payload = await readerFetchJson<{ items: ReaderCatalogItem[] }>(
    resolveApiUrl(`/reader/catalog/items?${query}`, backendBaseUrl),
    undefined,
    { timeoutMs: READER_BOOTSTRAP_TIMEOUT_MS }
  );
  return payload.items || [];
};

export const getReaderCatalogItem = async (
  backendBaseUrl: string,
  itemId: string
): Promise<ReaderCatalogItem> => {
  const payload = await readerFetchJson<{ item: ReaderCatalogItem }>(
    resolveApiUrl(`/reader/catalog/items/${encodeURIComponent(itemId)}`, backendBaseUrl),
    undefined,
    { timeoutMs: READER_BOOTSTRAP_TIMEOUT_MS }
  );
  return payload.item;
};

export const getReaderLibrary = async (
  backendBaseUrl: string,
  params: { surface?: ReaderSurface; regionId?: string; search?: string }
): Promise<ReaderLibrary> => {
  const query = buildReaderQueryString(params);
  const payload = await readerFetchJson<{ library: ReaderLibrary }>(
    resolveApiUrl(`/reader/library?${query}`, backendBaseUrl),
    undefined,
    { timeoutMs: READER_LIBRARY_BOOTSTRAP_TIMEOUT_MS }
  );
  return payload.library;
};

export const getReaderDashboard = async (
  backendBaseUrl: string,
  params: { surface?: ReaderSurface; regionId?: string; search?: string }
): Promise<ReaderDashboardPayload> => {
  const query = buildReaderQueryString(params);
  const dashboardUrl = resolveApiUrl(`/reader/dashboard${query ? `?${query}` : ''}`, backendBaseUrl);
  try {
    const payload = await readerFetchJson<unknown>(dashboardUrl, undefined, { timeoutMs: READER_LIBRARY_BOOTSTRAP_TIMEOUT_MS });
    const normalized = normalizeReaderDashboardPayload(payload);
    if (!normalized) {
      throw new Error('Reader dashboard payload was invalid.');
    }
    return normalized;
  } catch (error) {
    if (!isDashboardUnavailableError(error)) {
      throw error;
    }
    const library = await getReaderLibrary(backendBaseUrl, params);
    return buildReaderDashboardPayloadFromLibrary(library);
  }
};

export const createReaderUpload = async (
  backendBaseUrl: string,
  payload: {
    files: File[];
    title: string;
    contentType?: 'book' | 'comic';
    ownershipBasis?: ReaderOwnershipBasis;
    regionId: string;
    directionOverride?: string;
  }
): Promise<ReaderCatalogItem> => {
  const formData = new FormData();
  payload.files.forEach((file) => formData.append('files', file));
  formData.append('title', payload.title);
  if (payload.contentType) formData.append('contentType', payload.contentType);
  formData.append('ownershipBasis', payload.ownershipBasis || 'user_responsible');
  formData.append('regionId', payload.regionId);
  if (payload.directionOverride) formData.append('directionOverride', payload.directionOverride);
  const response = await authFetch(resolveApiUrl('/reader/uploads', backendBaseUrl), {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const errorPayload = await readErrorPayload(response);
    const error = new Error(errorPayload.message) as Error & { status?: number; code?: string; detail?: unknown };
    error.status = response.status;
    if (errorPayload.code) error.code = errorPayload.code;
    if (typeof errorPayload.detail !== 'undefined') error.detail = errorPayload.detail;
    throw error;
  }
  const data = (await response.json()) as { upload: ReaderCatalogItem };
  return data.upload;
};

export interface ReaderPreferencesPayload {
  uid?: string;
  regionId?: string;
  targetLanguage?: string;
  pageViewMode?: 'original' | 'translated';
  ttsLanguageMode?: 'auto' | 'source' | 'target';
  autoAdvanceProfile?: string;
  multiSpeakerEnabled?: boolean;
  audioEngine?: 'tts_hd';
  narratorVoiceId?: string;
  readingMode?: string;
  homeTab?: ReaderHomeTab;
  updatedAt?: string;
}

export const getReaderPreferences = async (
  backendBaseUrl: string
): Promise<ReaderPreferencesPayload> => {
  const data = await readerFetchJson<{ preferences: ReaderPreferencesPayload }>(
    resolveApiUrl('/reader/preferences', backendBaseUrl),
    undefined,
    { timeoutMs: READER_BOOTSTRAP_TIMEOUT_MS }
  );
  return data.preferences || {};
};

export const updateReaderPreferences = async (
  backendBaseUrl: string,
  payload: ReaderPreferencesPayload
): Promise<ReaderPreferencesPayload> => {
  const data = await readerFetchJson<{ preferences: ReaderPreferencesPayload }>(
    resolveApiUrl('/reader/preferences', backendBaseUrl),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  return data.preferences || {};
};

export const createReaderSession = async (
  backendBaseUrl: string,
  payload: {
    itemId?: string;
    uploadId?: string;
    directionOverride?: string;
    readingModeOverride?: string;
    autoAdvanceProfile?: string;
    sourceLanguageOverride?: string;
    targetLanguage?: string;
    pageViewMode?: 'original' | 'translated';
    ttsLanguageMode?: 'auto' | 'source' | 'target';
    audioEngine?: 'tts_hd';
    multiSpeakerEnabled?: boolean;
    voiceMode?: 'single' | 'multi';
    narratorVoiceId?: string;
    forceNew?: boolean;
  }
): Promise<ReaderSession> => {
  const data = await readerFetchJson<{ session: ReaderSession }>(resolveApiUrl('/reader/sessions', backendBaseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return data.session;
};

export const getReaderSession = async (backendBaseUrl: string, sessionId: string): Promise<ReaderSession> => {
  const data = await readerFetchJson<{ session: ReaderSession }>(
    resolveApiUrl(`/reader/sessions/${encodeURIComponent(sessionId)}`, backendBaseUrl)
  );
  return data.session;
};

export const updateReaderProgress = async (
  backendBaseUrl: string,
  sessionId: string,
  progress: ReaderSessionProgress
): Promise<ReaderSession> => {
  const data = await readerFetchJson<{ session: ReaderSession }>(
    resolveApiUrl(`/reader/sessions/${encodeURIComponent(sessionId)}/progress`, backendBaseUrl),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(progress),
    }
  );
  return data.session;
};

export const saveReaderSession = async (
  backendBaseUrl: string,
  sessionId: string,
  payload: {
    castOverrides?: Record<string, string>;
    directionOverride?: string;
    readingModeOverride?: string;
    autoAdvanceProfile?: string;
    targetLanguage?: string;
    pageViewMode?: 'original' | 'translated';
    ttsLanguageMode?: 'auto' | 'source' | 'target';
    audioEngine?: 'tts_hd';
    multiSpeakerEnabled?: boolean;
    voiceMode?: 'single' | 'multi';
    narratorVoiceId?: string;
    unitOverrides?: Record<string, string>;
    musicTrackId?: string;
    restoreState?: {
      activeItemIndex?: number;
      activeUnitId?: string;
      viewportAnchor?: string;
      activeReaderTab?: ReaderTab;
    };
  }
): Promise<ReaderSession> => {
  const data = await readerFetchJson<{ session: ReaderSession }>(
    resolveApiUrl(`/reader/sessions/${encodeURIComponent(sessionId)}/savepoint`, backendBaseUrl),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  return data.session;
};

export const resolveReaderQueuePrimeMode = (mode: 'novel' | 'comic'): 'book_paragraph' | 'comic_panel' =>
  mode === 'comic' ? 'comic_panel' : 'book_paragraph';

export const primeReaderQueue = async (
  backendBaseUrl: string,
  payload: {
    sessionId: string;
    mode: 'book_paragraph' | 'comic_panel';
    lookaheadUnits: number;
    fromActiveIndex: number;
  }
): Promise<ReaderSession | null> => {
  const sessionId = String(payload.sessionId || '').trim();
  if (!sessionId) return null;
  const requestBody = {
    mode: payload.mode,
    lookaheadUnits: Math.max(0, Math.trunc(Number(payload.lookaheadUnits || 0))),
    fromActiveIndex: Math.max(0, Math.trunc(Number(payload.fromActiveIndex || 0))),
  };
  try {
    const data = await readerFetchJson<{ session: ReaderSession }>(
      resolveApiUrl(`/reader/sessions/${encodeURIComponent(sessionId)}/queue/prime`, backendBaseUrl),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      },
      { timeoutMs: READER_BOOTSTRAP_TIMEOUT_MS }
    );
    return data.session;
  } catch (error) {
    if (isDashboardUnavailableError(error)) return null;
    throw error;
  }
};

export const exportReaderSessionAudio = async (backendBaseUrl: string, sessionId: string): Promise<{
  blob: Blob;
  headers: Record<string, string>;
  watermarkId: string;
}> => {
  const response = await authFetch(resolveApiUrl(`/reader/sessions/${encodeURIComponent(sessionId)}/export`, backendBaseUrl));
  if (!response.ok) {
    const errorPayload = await readErrorPayload(response);
    const error = new Error(errorPayload.message) as Error & { status?: number; code?: string; detail?: unknown };
    error.status = response.status;
    if (errorPayload.code) error.code = errorPayload.code;
    if (typeof errorPayload.detail !== 'undefined') error.detail = errorPayload.detail;
    throw error;
  }
  const headers = captureResponseHeaders(response);
  return {
    blob: await response.blob(),
    headers,
    watermarkId: String(headers['x-vf-watermark-id'] || '').trim(),
  };
};

export const deleteReaderSession = async (backendBaseUrl: string, sessionId: string): Promise<void> => {
  const response = await authFetch(resolveApiUrl(`/reader/sessions/${encodeURIComponent(sessionId)}`, backendBaseUrl), {
    method: 'DELETE',
  });
  if (!response.ok) {
    const errorPayload = await readErrorPayload(response);
    const error = new Error(errorPayload.message) as Error & { status?: number; code?: string; detail?: unknown };
    error.status = response.status;
    if (errorPayload.code) error.code = errorPayload.code;
    if (typeof errorPayload.detail !== 'undefined') error.detail = errorPayload.detail;
    throw error;
  }
};

export const getReaderTtsJobAudio = async (
  backendBaseUrl: string,
  jobId: string
): Promise<{ status: string; audioBase64?: string; mediaType?: string; blob?: Blob; headers: Record<string, string>; watermarkId: string }> => {
  const payload = await getTtsJob(jobId, { baseUrl: backendBaseUrl });
  const result: { status: string; audioBase64?: string; mediaType?: string; blob?: Blob; headers: Record<string, string>; watermarkId: string } = {
    status: payload.status,
    headers: payload.result?.headers ? Object.entries(payload.result.headers).reduce<Record<string, string>>((accumulator, [key, value]) => {
      const safeKey = String(key || '').trim().toLowerCase();
      if (!safeKey) return accumulator;
      accumulator[safeKey] = String(value ?? '');
      return accumulator;
    }, {}) : {},
    watermarkId: String(payload.result?.headers?.['x-vf-watermark-id'] || payload.result?.headers?.['X-VF-Watermark-Id'] || '').trim(),
  };
  if (payload.status === 'completed') {
    const audioResponse = await fetchTtsJobResult(jobId, { baseUrl: backendBaseUrl });
    result.blob = new Blob([audioResponse.audioBytes], { type: audioResponse.mediaType || 'audio/wav' });
    result.mediaType = audioResponse.mediaType || 'audio/wav';
    result.headers = audioResponse.headers || result.headers;
    result.watermarkId = String(audioResponse.headers['x-vf-watermark-id'] || result.watermarkId || '').trim();
    return result;
  }
  return result;
};

export interface ReaderOfflineLibrarySnapshotEntry {
  id: string;
  saveScope: 'chapter' | 'book';
  title: string;
  unitLabel: string;
  sessionId: string;
  unitId: string;
  sourceJobId: string;
  bookId?: string;
  bookTitle?: string;
  chapterIndex?: number;
  chapterCount?: number;
  chapterTextSnapshot?: string;
  speakerMode: 'single-speaker' | 'multi-speaker';
  mediaType: string;
  sizeBytes: number;
  watermarkId: string;
  watermarkMetadata: Record<string, unknown>;
  createdAtMs: number;
}

export interface ReaderOfflineLibrarySnapshotPayload {
  sessionId?: string;
  reason: 'chapter-save' | 'book-save' | 'delete' | 'bootstrap';
  updatedAtMs: number;
  entries: ReaderOfflineLibrarySnapshotEntry[];
}

interface ReaderOfflineMetadataRecord {
  entryId?: string;
  contentId?: string;
  bookId?: string;
}

interface ReaderOfflineMetadataUpsertPayload {
  contentId: string;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  chapterTitle: string;
  speakerMode: string;
  watermarkId: string;
  watermarkVersion: string;
  sizeBytes: number;
  hash: string;
  durationMs: number;
  deviceId: string;
  deviceType: string;
  deviceLabel: string;
  deviceMarker: string;
}

const READER_OFFLINE_DEVICE_ID_STORAGE_KEY = 'vf_reader_offline_device_id_v1';

const getReaderOfflineDeviceId = (): string => {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return '';
  const existing = String(localStorage.getItem(READER_OFFLINE_DEVICE_ID_STORAGE_KEY) || '').trim();
  if (existing) return existing;
  const generated = (
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `reader-device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
  try {
    localStorage.setItem(READER_OFFLINE_DEVICE_ID_STORAGE_KEY, generated);
  } catch {
    // no-op
  }
  return generated;
};

const getReaderOfflineDeviceMetadata = (): {
  deviceId: string;
  deviceType: string;
  deviceLabel: string;
  deviceMarker: string;
} => {
  if (typeof navigator === 'undefined') {
    return {
      deviceId: '',
      deviceType: '',
      deviceLabel: '',
      deviceMarker: '',
    };
  }
  const userAgent = String(navigator.userAgent || '').toLowerCase();
  const isMobile = /iphone|ipad|android|mobile/.test(userAgent);
  const deviceType = isMobile ? 'mobile' : 'desktop';
  return {
    deviceId: getReaderOfflineDeviceId(),
    deviceType,
    deviceLabel: String(navigator.platform || navigator.userAgent || '').trim(),
    deviceMarker: String(navigator.userAgent || '').slice(0, 180),
  };
};

const readNumericMetadata = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed));
  }
  return 0;
};

const toReaderOfflineMetadataUpsertPayload = (
  entry: ReaderOfflineLibrarySnapshotEntry,
  sessionId: string
): ReaderOfflineMetadataUpsertPayload => {
  const watermarkMetadata = entry.watermarkMetadata && typeof entry.watermarkMetadata === 'object'
    ? entry.watermarkMetadata as Record<string, unknown>
    : {};
  const watermarkVersion = String(
    watermarkMetadata['watermarkVersion']
    || watermarkMetadata['x-vf-watermark-version']
    || ''
  ).trim();
  const hash = String(
    watermarkMetadata.hash
    || watermarkMetadata.contentHash
    || watermarkMetadata['x-vf-watermark-hash']
    || ''
  ).trim();
  const durationMs = readNumericMetadata(
    watermarkMetadata.durationMs
    || watermarkMetadata.duration
    || watermarkMetadata['x-vf-duration-ms']
  );
  const device = getReaderOfflineDeviceMetadata();
  const contentId = String(entry.bookId || sessionId || entry.sessionId || '').trim();
  return {
    contentId,
    bookId: contentId,
    chapterId: String(entry.unitId || '').trim(),
    chapterIndex: Math.max(0, Number(entry.chapterIndex || 0)),
    chapterTitle: String(entry.unitLabel || entry.title || '').trim(),
    speakerMode: String(entry.speakerMode || 'single-speaker').trim(),
    watermarkId: String(entry.watermarkId || '').trim(),
    watermarkVersion,
    sizeBytes: Math.max(0, Number(entry.sizeBytes || 0)),
    hash,
    durationMs,
    deviceId: device.deviceId,
    deviceType: device.deviceType,
    deviceLabel: device.deviceLabel,
    deviceMarker: device.deviceMarker,
  };
};

const syncReaderOfflineMetadata = async (
  backendBaseUrl: string,
  payload: ReaderOfflineLibrarySnapshotPayload
): Promise<ReaderOfflineLibrarySnapshotPayload | null> => {
  try {
    const listPayload = await readerFetchJson<{ metadata?: ReaderOfflineMetadataRecord[] }>(
      resolveApiUrl('/reader/offline/metadata', backendBaseUrl),
      undefined,
      { timeoutMs: READER_BOOTSTRAP_TIMEOUT_MS }
    );
    const remoteEntries = Array.isArray(listPayload.metadata) ? listPayload.metadata : [];
    const safeSessionId = String(payload.sessionId || '').trim();
    const localEntries = Array.isArray(payload.entries) ? payload.entries.filter((entry) => String(entry.id || '').trim()) : [];
    const localEntryIds = new Set(localEntries.map((entry) => String(entry.id || '').trim()).filter(Boolean));
    await Promise.all(localEntries.map((entry) => (
      readerFetchJson(
        resolveApiUrl(`/reader/offline/metadata/${encodeURIComponent(String(entry.id || '').trim())}`, backendBaseUrl),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(toReaderOfflineMetadataUpsertPayload(entry, safeSessionId)),
        },
        { timeoutMs: READER_BOOTSTRAP_TIMEOUT_MS }
      )
    )));
    if (safeSessionId) {
      const staleRemoteIds = remoteEntries
        .filter((entry) => {
          const entryId = String(entry.entryId || '').trim();
          if (!entryId || localEntryIds.has(entryId)) return false;
          const remoteContentId = String(entry.contentId || entry.bookId || '').trim();
          return remoteContentId === safeSessionId;
        })
        .map((entry) => String(entry.entryId || '').trim())
        .filter(Boolean);
      await Promise.all(staleRemoteIds.map(async (entryId) => {
        try {
          await readerFetchJson<{ deleted?: boolean }>(
            resolveApiUrl(`/reader/offline/metadata/${encodeURIComponent(entryId)}`, backendBaseUrl),
            { method: 'DELETE' },
            { timeoutMs: READER_BOOTSTRAP_TIMEOUT_MS }
          );
        } catch (error) {
          if (!isReaderMetadataSyncUnavailable(error)) throw error;
        }
      }));
    }
    return payload;
  } catch (error) {
    if (isReaderMetadataSyncUnavailable(error)) return null;
    throw error;
  }
};

export const syncReaderOfflineLibrarySnapshot = (
  backendBaseUrl: string,
  payload: ReaderOfflineLibrarySnapshotPayload
): Promise<ReaderOfflineLibrarySnapshotPayload | null> => syncReaderOfflineMetadata(backendBaseUrl, payload);
