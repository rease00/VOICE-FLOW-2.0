import type {
  ReaderCatalogItem,
  ReaderCatalogRegion,
  ReaderLegalAck,
  ReaderLibrary,
  ReaderSession,
  ReaderSessionProgress,
} from '../../../../types';
import { authFetch } from '../../../../services/authHttpClient';
import { resolveApiUrl } from '../../../shared/api/config';

type ReaderSurface = 'all' | 'books' | 'comics' | 'uploads';

const readErrorDetail = async (response: Response): Promise<string> => {
  const clone = response.clone();
  const payload = await clone.json().catch(async () => ({ detail: await clone.text().catch(() => '') }));
  return String((payload as { detail?: unknown }).detail || 'Reader request failed.').trim();
};

const readerFetchJson = async <T>(input: string, init?: RequestInit): Promise<T> => {
  const response = await authFetch(input, init);
  if (!response.ok) {
    const error = new Error(await readErrorDetail(response)) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
};

export const getReaderLegalAck = async (backendBaseUrl: string): Promise<{
  ack: ReaderLegalAck;
  billing: { vfPerChar: number; rule: string; label: string };
}> => {
  const payload = await readerFetchJson<{
    ack: ReaderLegalAck;
    billing: { vfPerChar: number; rule: string; label: string };
  }>(resolveApiUrl('/reader/legal/ack', backendBaseUrl));
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
    resolveApiUrl(`/reader/catalog/regions?surface=${encodeURIComponent(surface)}`, backendBaseUrl)
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
    resolveApiUrl(`/reader/catalog/items?${search.toString()}`, backendBaseUrl)
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
    resolveApiUrl(`/reader/library?${search.toString()}`, backendBaseUrl)
  );
  return payload.library;
};

export const createReaderUpload = async (
  backendBaseUrl: string,
  payload: {
    files: File[];
    title: string;
    contentType?: 'book' | 'comic';
    ownershipBasis: string;
    regionId: string;
    directionOverride?: string;
  }
): Promise<ReaderCatalogItem> => {
  const formData = new FormData();
  payload.files.forEach((file) => formData.append('files', file));
  formData.append('title', payload.title);
  if (payload.contentType) formData.append('contentType', payload.contentType);
  formData.append('ownershipBasis', payload.ownershipBasis);
  formData.append('regionId', payload.regionId);
  if (payload.directionOverride) formData.append('directionOverride', payload.directionOverride);
  const response = await authFetch(resolveApiUrl('/reader/uploads', backendBaseUrl), {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const error = new Error(await readErrorDetail(response)) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  const data = (await response.json()) as { upload: ReaderCatalogItem };
  return data.upload;
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
    multiSpeakerEnabled?: boolean;
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
    multiSpeakerEnabled?: boolean;
    musicTrackId?: string;
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
    const error = new Error(await readErrorDetail(response)) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.blob();
};

export const deleteReaderSession = async (backendBaseUrl: string, sessionId: string): Promise<void> => {
  const response = await authFetch(resolveApiUrl(`/reader/sessions/${encodeURIComponent(sessionId)}`, backendBaseUrl), {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = new Error(await readErrorDetail(response)) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
};

export const getReaderTtsJobAudio = async (
  backendBaseUrl: string,
  jobId: string
): Promise<{ status: string; audioBase64?: string; mediaType?: string }> => {
  const payload = await readerFetchJson<{
    status: string;
    result?: { audioBase64?: string; mediaType?: string };
  }>(resolveApiUrl(`/tts/jobs/${encodeURIComponent(jobId)}?includeResult=true`, backendBaseUrl));
  const result: { status: string; audioBase64?: string; mediaType?: string } = {
    status: payload.status,
  };
  if (payload.result?.audioBase64) result.audioBase64 = payload.result.audioBase64;
  if (payload.result?.mediaType) result.mediaType = payload.result.mediaType;
  return result;
};
