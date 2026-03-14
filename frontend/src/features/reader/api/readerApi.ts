import type {
  ReaderCatalogItem,
  ReaderCatalogRegion,
  ReaderCommercialPolicy,
  ReaderLegalAck,
  ReaderLibrary,
  ReaderOwnershipBasis,
  ReaderSession,
  ReaderSessionProgress,
} from '../../../../types';
import { authFetch } from '../../../../services/authHttpClient';
import { resolveApiUrl } from '../../../shared/api/config';

type ReaderSurface = 'all' | 'books' | 'comics' | 'uploads';
const READER_BOOTSTRAP_TIMEOUT_MS = 20_000;
const READER_LIBRARY_TIMEOUT_MS = 30_000;

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
  const search = new URLSearchParams();
  search.set('surface', params.surface);
  if (params.regionId) search.set('regionId', params.regionId);
  if (params.search) search.set('search', params.search);
  const payload = await readerFetchJson<{ items: ReaderCatalogItem[] }>(
    resolveApiUrl(`/reader/catalog/items?${search.toString()}`, backendBaseUrl),
    undefined,
    { timeoutMs: READER_BOOTSTRAP_TIMEOUT_MS }
  );
  return payload.items || [];
};

export const getReaderLibrary = async (
  backendBaseUrl: string,
  params: { surface?: ReaderSurface; regionId?: string; search?: string }
): Promise<ReaderLibrary> => {
  const search = new URLSearchParams();
  if (params.surface) search.set('surface', params.surface);
  if (params.regionId) search.set('regionId', params.regionId);
  if (params.search) search.set('search', params.search);
  const payload = await readerFetchJson<{ library: ReaderLibrary }>(
    resolveApiUrl(`/reader/library?${search.toString()}`, backendBaseUrl),
    undefined,
    { timeoutMs: READER_LIBRARY_TIMEOUT_MS }
  );
  return payload.library;
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
    const payload = await readErrorPayload(response);
    const error = new Error(payload.message) as Error & { status?: number; code?: string; detail?: unknown };
    error.status = response.status;
    if (payload.code) error.code = payload.code;
    if (typeof payload.detail !== 'undefined') error.detail = payload.detail;
    throw error;
  }
  const data = (await response.json()) as { upload: ReaderCatalogItem };
  return data.upload;
};

export interface ReaderPreferencesPayload {
  regionId?: string;
  targetLanguage?: string;
  pageViewMode?: 'original' | 'translated';
  ttsLanguageMode?: 'auto' | 'source' | 'target';
  autoAdvanceProfile?: string;
  multiSpeakerEnabled?: boolean;
  audioEngine?: 'tts_hd' | 'native_audio_dialog';
  narratorVoiceId?: string;
  readingMode?: string;
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
    audioEngine?: 'tts_hd' | 'native_audio_dialog';
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
    audioEngine?: 'tts_hd' | 'native_audio_dialog';
    multiSpeakerEnabled?: boolean;
    voiceMode?: 'single' | 'multi';
    narratorVoiceId?: string;
    unitOverrides?: Record<string, string>;
    musicTrackId?: string;
    restoreState?: {
      activeItemIndex?: number;
      activeUnitId?: string;
      viewportAnchor?: string;
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

export const exportReaderSessionAudio = async (backendBaseUrl: string, sessionId: string): Promise<Blob> => {
  const response = await authFetch(resolveApiUrl(`/reader/sessions/${encodeURIComponent(sessionId)}/export`, backendBaseUrl));
  if (!response.ok) {
    const payload = await readErrorPayload(response);
    const error = new Error(payload.message) as Error & { status?: number; code?: string; detail?: unknown };
    error.status = response.status;
    if (payload.code) error.code = payload.code;
    if (typeof payload.detail !== 'undefined') error.detail = payload.detail;
    throw error;
  }
  return response.blob();
};

export const deleteReaderSession = async (backendBaseUrl: string, sessionId: string): Promise<void> => {
  const response = await authFetch(resolveApiUrl(`/reader/sessions/${encodeURIComponent(sessionId)}`, backendBaseUrl), {
    method: 'DELETE',
  });
  if (!response.ok) {
    const payload = await readErrorPayload(response);
    const error = new Error(payload.message) as Error & { status?: number; code?: string; detail?: unknown };
    error.status = response.status;
    if (payload.code) error.code = payload.code;
    if (typeof payload.detail !== 'undefined') error.detail = payload.detail;
    throw error;
  }
};

export const getReaderTtsJobAudio = async (
  backendBaseUrl: string,
  jobId: string
): Promise<{ status: string; audioBase64?: string; mediaType?: string; blob?: Blob }> => {
  const payload = await readerFetchJson<{
    status: string;
    result?: { audioBase64?: string; mediaType?: string };
  }>(resolveApiUrl(`/tts/jobs/${encodeURIComponent(jobId)}?includeResult=true`, backendBaseUrl));
  const result: { status: string; audioBase64?: string; mediaType?: string; blob?: Blob } = {
    status: payload.status,
  };
  if (payload.status === 'completed') {
    const audioResponse = await authFetch(resolveApiUrl(`/tts/jobs/${encodeURIComponent(jobId)}/audio`, backendBaseUrl));
    if (audioResponse.ok) {
      result.blob = await audioResponse.blob();
      result.mediaType = audioResponse.headers.get('content-type') || payload.result?.mediaType || 'audio/wav';
      return result;
    }
  }
  if (payload.result?.audioBase64) result.audioBase64 = payload.result.audioBase64;
  if (payload.result?.mediaType) result.mediaType = payload.result.mediaType;
  return result;
};
