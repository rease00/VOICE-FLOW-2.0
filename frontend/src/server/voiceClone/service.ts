import { createHash, randomUUID } from 'node:crypto';
import { getCloudflareContext } from '@opennextjs/cloudflare';

import type { NextRequest } from 'next/server';

import { proxyBackendRequest } from '../../../app/api/backend/proxy';
import type {
  VoiceCloneBenchmarkArtifact,
  VoiceCloneBenchmarkResponse,
  VoiceCloneBenchmarkStatusResponse,
} from '../../features/voice-cloning/openvoiceTypes';
import type {
  VoiceCloneJobStatusResponse,
  VoiceCloneRenderRequest,
  VoiceCloneStemSeparationResponse,
} from '../../features/voice-cloning/api';
import {
  createDomainJobRecordIfAbsent,
  createDomainJobRecord,
  getDomainJobRecord,
  saveDomainJobRecord,
  type DomainJobRecord,
} from '../jobs/domainJobStore';
import { requireServerUser } from '../auth/requestAuth.ts';
import { readEnvNumber, readEnvValue } from '../../shared/runtime/env';
import { hasLegacyVoiceCloneProxyConfigured, isVoiceCloneProxyMode } from './mode';

const VOICE_CLONE_DOMAIN = 'voiceClone';
const VOICE_CLONE_ARTIFACT_D1_TABLE = 'voice_clone_artifacts';
const VOICE_CLONE_JOBS_D1_TABLE = 'voice_clone_jobs';
const VOICE_CLONE_D1_SCHEMA = `
CREATE TABLE IF NOT EXISTS ${VOICE_CLONE_ARTIFACT_D1_TABLE} (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  download_url TEXT NOT NULL,
  file_name TEXT,
  content_type TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ${VOICE_CLONE_JOBS_D1_TABLE} (
  id TEXT PRIMARY KEY NOT NULL,
  owner_uid TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;
const DEFAULT_PROVIDER_LABEL = 'hosted-runtime';
const DEFAULT_RUNTIME_TIMEOUT_MS = 120_000;
const VOICE_CLONE_ROUTE_BASE = '/api/v1/voice-clone';

type VoiceCloneJobProgress = {
  percent?: number;
  stage?: string;
  detail?: string;
};

type VoiceCloneJobPayload = {
  requestId: string;
  traceId: string;
  mode: string;
  runKind: string;
  sourceVoiceId: string;
  sourceVoiceName: string;
  sourceVoiceEngine: string;
  language: string;
  textChars: number;
  referenceAudioName?: string | undefined;
  sourceAudioName?: string | undefined;
};

type VoiceCloneArtifactRecord = {
  id: string;
  ownerUid: string;
  downloadUrl: string;
  fileName?: string | undefined;
  contentType?: string | undefined;
  createdAt: string;
};

type RuntimeConfig = {
  cloneBaseUrl: string;
  cloneToken: string;
  separationBaseUrl: string;
  separationToken: string;
  watermarkBaseUrl: string;
  watermarkToken: string;
  watermarkPath: string;
  providerLabel: string;
};

type VoiceCloneArtifactD1Statement = {
  bind: (...values: unknown[]) => VoiceCloneArtifactD1Statement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  run: () => Promise<unknown>;
};

type VoiceCloneArtifactD1Database = {
  prepare: (sql: string) => VoiceCloneArtifactD1Statement;
  exec: (sql: string) => Promise<unknown>;
};

const activeVoiceCloneJobs = new Map<string, AbortController>();
const memoryArtifacts = new Map<string, VoiceCloneArtifactRecord>();
let voiceCloneArtifactD1DatabasePromise: Promise<VoiceCloneArtifactD1Database | null> | null = null;
let voiceCloneArtifactD1SchemaPromise: Promise<void> | null = null;

const normalizeBaseUrl = (value: string): string => String(value || '').trim().replace(/\/+$/, '');

const normalizeRuntimePath = (value: string, fallback: string): string => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return fallback;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
};

const readRuntimeConfig = (): RuntimeConfig => {
  const cloneBaseUrl = normalizeBaseUrl(readEnvValue(
    process.env.VF_VOICE_CLONE_RUNTIME_URL,
    process.env.VF_VOICE_CLONE_MODAL_RUNTIME_URL,
    process.env.VF_OPENVOICE_RUNTIME_URL,
  ));
  const cloneToken = String(readEnvValue(
    process.env.VF_VOICE_CLONE_RUNTIME_TOKEN,
    process.env.VF_VOICE_CLONE_MODAL_RUNTIME_TOKEN,
    process.env.VF_OPENVOICE_RUNTIME_TOKEN,
  )).trim();
  const separationBaseUrl = normalizeBaseUrl(readEnvValue(
    process.env.VF_VOICE_CLONE_SEPARATION_MODAL_RUNTIME_URL,
    process.env.VF_VOICE_CLONE_RUNTIME_URL,
    process.env.VF_VOICE_CLONE_MODAL_RUNTIME_URL,
    process.env.VF_OPENVOICE_RUNTIME_URL,
  ));
  const separationToken = String(readEnvValue(
    process.env.VF_VOICE_CLONE_SEPARATION_MODAL_RUNTIME_TOKEN,
    process.env.VF_VOICE_CLONE_RUNTIME_TOKEN,
    process.env.VF_VOICE_CLONE_MODAL_RUNTIME_TOKEN,
    process.env.VF_OPENVOICE_RUNTIME_TOKEN,
  )).trim();
  const watermarkBaseUrl = normalizeBaseUrl(readEnvValue(
    process.env.VF_VOICE_WATERMARK_RUNTIME_URL,
    process.env.VF_VOICE_CLONE_RUNTIME_URL,
    process.env.VF_VOICE_CLONE_MODAL_RUNTIME_URL,
    process.env.VF_OPENVOICE_RUNTIME_URL,
  ));
  const watermarkToken = String(readEnvValue(
    process.env.VF_VOICE_WATERMARK_RUNTIME_TOKEN,
    process.env.VF_VOICE_CLONE_RUNTIME_TOKEN,
    process.env.VF_VOICE_CLONE_MODAL_RUNTIME_TOKEN,
    process.env.VF_OPENVOICE_RUNTIME_TOKEN,
  )).trim();
  const watermarkPath = normalizeRuntimePath(
    readEnvValue(
      process.env.VF_VOICE_WATERMARK_RUNTIME_PATH,
      process.env.VF_VOICE_WATERMARK_PATH,
    ),
    '/api/v2/extract-watermark',
  );

  return {
    cloneBaseUrl,
    cloneToken,
    separationBaseUrl,
    separationToken,
    watermarkBaseUrl,
    watermarkToken,
    watermarkPath,
    providerLabel: String(readEnvValue(
      process.env.VF_VOICE_CLONE_PROVIDER_DEFAULT,
      process.env.VF_VOICE_CLONE_PROVIDER,
    )).trim() || DEFAULT_PROVIDER_LABEL,
  };
};

const toIsoNow = (): string => new Date().toISOString();

const buildHashId = (prefix: string, ...parts: string[]): string => (
  `${prefix}_${createHash('sha256').update(parts.join('::')).digest('hex').slice(0, 24)}`
);

const buildVoiceCloneJobId = (ownerUid: string, requestId: string): string => (
  buildHashId('vc', ownerUid, requestId)
);

const buildArtifactId = (ownerUid: string, url: string): string => (
  buildHashId('vca', ownerUid, url)
);

const getVoiceCloneArtifactD1Database = async (): Promise<VoiceCloneArtifactD1Database | null> => {
  if (!voiceCloneArtifactD1DatabasePromise) {
    voiceCloneArtifactD1DatabasePromise = (async () => {
      try {
        const { env } = await getCloudflareContext({ async: true });
        const db = (env as { DB?: VoiceCloneArtifactD1Database }).DB;
        return db && typeof db.prepare === 'function' ? db : null;
      } catch {
        return null;
      }
    })();
  }
  return voiceCloneArtifactD1DatabasePromise;
};

const ensureVoiceCloneArtifactD1Schema = async (db: VoiceCloneArtifactD1Database): Promise<void> => {
  if (!voiceCloneArtifactD1SchemaPromise) {
    voiceCloneArtifactD1SchemaPromise = db.exec(VOICE_CLONE_D1_SCHEMA).then(() => undefined).catch((error: unknown) => {
      voiceCloneArtifactD1SchemaPromise = null;
      throw error;
    });
  }
  await voiceCloneArtifactD1SchemaPromise;
};

const readVoiceCloneArtifactD1Record = async (artifactId: string): Promise<VoiceCloneArtifactRecord | null> => {
  const db = await getVoiceCloneArtifactD1Database();
  if (!db) return null;
  await ensureVoiceCloneArtifactD1Schema(db);
  const row = await db.prepare(`SELECT * FROM ${VOICE_CLONE_ARTIFACT_D1_TABLE} WHERE id = ? LIMIT 1`)
    .bind(artifactId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: String(row.id || '').trim(),
    ownerUid: String(row.owner_uid || row.ownerUid || '').trim(),
    downloadUrl: String(row.download_url || row.downloadUrl || '').trim(),
    ...(String(row.file_name || row.fileName || '').trim() ? { fileName: String(row.file_name || row.fileName || '').trim() } : {}),
    ...(String(row.content_type || row.contentType || '').trim() ? { contentType: String(row.content_type || row.contentType || '').trim() } : {}),
    createdAt: String(row.created_at || row.createdAt || '').trim(),
  };
};

const writeVoiceCloneArtifactD1Record = async (record: VoiceCloneArtifactRecord): Promise<void> => {
  const db = await getVoiceCloneArtifactD1Database();
  if (!db) return;
  await ensureVoiceCloneArtifactD1Schema(db);
  await db.prepare(`
    INSERT INTO ${VOICE_CLONE_ARTIFACT_D1_TABLE} (id, owner_uid, download_url, file_name, content_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      owner_uid = excluded.owner_uid,
      download_url = excluded.download_url,
      file_name = excluded.file_name,
      content_type = excluded.content_type,
      created_at = excluded.created_at
  `).bind(
    record.id,
    record.ownerUid,
    record.downloadUrl,
    record.fileName || null,
    record.contentType || null,
    record.createdAt,
  ).run();
};

const readVoiceCloneJobD1Record = async (
  jobId: string,
): Promise<DomainJobRecord<VoiceCloneJobPayload, VoiceCloneBenchmarkResponse, VoiceCloneJobProgress> | null> => {
  const db = await getVoiceCloneArtifactD1Database();
  if (!db) return null;
  await ensureVoiceCloneArtifactD1Schema(db);
  const row = await db.prepare(`SELECT payload_json FROM ${VOICE_CLONE_JOBS_D1_TABLE} WHERE id = ? LIMIT 1`)
    .bind(jobId)
    .first<{ payload_json?: string }>();
  if (!row?.payload_json) return null;
  try {
    return JSON.parse(row.payload_json) as DomainJobRecord<VoiceCloneJobPayload, VoiceCloneBenchmarkResponse, VoiceCloneJobProgress>;
  } catch {
    return null;
  }
};

const writeVoiceCloneJobD1Record = async (
  record: DomainJobRecord<VoiceCloneJobPayload, VoiceCloneBenchmarkResponse, VoiceCloneJobProgress>,
): Promise<void> => {
  const db = await getVoiceCloneArtifactD1Database();
  if (!db) return;
  await ensureVoiceCloneArtifactD1Schema(db);
  await db.prepare(`
    INSERT INTO ${VOICE_CLONE_JOBS_D1_TABLE} (id, owner_uid, payload_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      owner_uid = excluded.owner_uid,
      payload_json = excluded.payload_json,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).bind(
    record.id,
    record.ownerUid || '',
    JSON.stringify(record),
    record.status,
    record.createdAt,
    record.updatedAt,
  ).run();
};

const readArtifactRecord = async (artifactId: string): Promise<VoiceCloneArtifactRecord | null> => {
  const safeArtifactId = String(artifactId || '').trim();
  if (!safeArtifactId) return null;
  return (await readVoiceCloneArtifactD1Record(safeArtifactId)) || memoryArtifacts.get(safeArtifactId) || null;
};

const saveArtifactRecord = async (record: VoiceCloneArtifactRecord): Promise<void> => {
  const safeRecord = {
    ...record,
    id: String(record.id || '').trim(),
    ownerUid: String(record.ownerUid || '').trim(),
    downloadUrl: String(record.downloadUrl || '').trim(),
    createdAt: record.createdAt || toIsoNow(),
  };

  await writeVoiceCloneArtifactD1Record(safeRecord);
  memoryArtifacts.set(safeRecord.id, safeRecord);
};

const buildArtifactRoute = (artifactId: string): string => (
  `${VOICE_CLONE_ROUTE_BASE}/artifacts/${encodeURIComponent(String(artifactId || '').trim())}`
);

const registerArtifact = async (
  ownerUid: string,
  artifact: VoiceCloneBenchmarkArtifact | null | undefined,
): Promise<VoiceCloneBenchmarkArtifact | undefined> => {
  if (!artifact || typeof artifact !== 'object') return undefined;
  const downloadUrl = String(artifact.downloadUrl || '').trim();
  if (!downloadUrl) return artifact;
  if (downloadUrl.startsWith(VOICE_CLONE_ROUTE_BASE)) return artifact;

  const artifactId = String(artifact.artifactId || '').trim() || buildArtifactId(ownerUid, downloadUrl);
  await saveArtifactRecord({
    id: artifactId,
    ownerUid,
    downloadUrl,
    fileName: artifact.fileName ? String(artifact.fileName).trim() : undefined,
    contentType: artifact.contentType ? String(artifact.contentType).trim() : undefined,
    createdAt: toIsoNow(),
  });

  return {
    ...artifact,
    artifactId,
    downloadUrl: buildArtifactRoute(artifactId),
  };
};

const normalizeRenderResponse = async (
  ownerUid: string,
  payload: VoiceCloneBenchmarkResponse,
): Promise<VoiceCloneBenchmarkResponse> => {
  const normalizedArtifact = await registerArtifact(ownerUid, payload.artifact);
  return {
    ...payload,
    ...(normalizedArtifact ? { artifact: normalizedArtifact } : {}),
  };
};

const normalizeSeparationResponse = async (
  ownerUid: string,
  payload: VoiceCloneStemSeparationResponse,
): Promise<VoiceCloneStemSeparationResponse> => {
  const vocalsArtifact = await registerArtifact(ownerUid, payload.vocalsArtifact);
  const backgroundArtifact = await registerArtifact(ownerUid, payload.backgroundArtifact);
  return {
    ...payload,
    ...(vocalsArtifact ? { vocalsArtifact } : {}),
    ...(backgroundArtifact ? { backgroundArtifact } : {}),
  };
};

const buildRuntimeHeaders = (token: string, requestHeaders?: HeadersInit): Headers => {
  const headers = new Headers(requestHeaders || {});
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }
  headers.set('ngrok-skip-browser-warning', 'true');
  return headers;
};

const buildAuthHeaders = (token: string, requestHeaders?: HeadersInit): Headers => {
  const headers = buildRuntimeHeaders(token, requestHeaders);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return headers;
};

const callRuntimeJson = async <TResult>(
  baseUrl: string,
  token: string,
  path: string,
  init?: RequestInit,
): Promise<TResult> => {
  const safeBaseUrl = normalizeBaseUrl(baseUrl);
  if (!safeBaseUrl) {
    throw new Error('Hosted voice clone runtime URL is not configured.');
  }

  const response = await fetch(`${safeBaseUrl}${path}`, {
    ...init,
    headers: buildAuthHeaders(token, init?.headers),
    cache: 'no-store',
    signal: init?.signal || AbortSignal.timeout(readEnvNumber(process.env.VF_VOICE_CLONE_RUNTIME_TIMEOUT_MS) || DEFAULT_RUNTIME_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = String(
      (payload as Record<string, unknown>)?.detail ||
      (payload as Record<string, unknown>)?.error ||
      response.statusText ||
      'Voice clone runtime request failed.'
    ).trim();
    throw new Error(detail || `Voice clone runtime request failed (${response.status}).`);
  }
  return payload as TResult;
};

const SUPPORTED_WATERMARK_FILE_TYPES = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
]);

const isSupportedWatermarkFile = (file: File): boolean => {
  const fileName = String(file.name || '').trim().toLowerCase();
  const fileType = String(file.type || '').trim().toLowerCase();
  return fileName.endsWith('.wav') || SUPPORTED_WATERMARK_FILE_TYPES.has(fileType);
};

const handleWatermarkCheck = async (request: Request): Promise<Response> => {
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ detail: 'file is required.' }, { status: 400 });
  }
  if (!isSupportedWatermarkFile(file)) {
    return Response.json(
      { detail: 'Upload a 16-bit PCM WAV file to run the Voice-Flow authenticity check.' },
      { status: 400 },
    );
  }

  const runtimeConfig = readRuntimeConfig();
  if (!runtimeConfig.watermarkBaseUrl) {
    return Response.json(
      { ok: false, error: 'Voice authenticity check is not configured.' },
      { status: 503 },
    );
  }

  const payload = new FormData();
  payload.append('file', file, file.name || 'proof.wav');

  const response = await fetch(`${runtimeConfig.watermarkBaseUrl}${runtimeConfig.watermarkPath}`, {
    method: 'POST',
    headers: buildRuntimeHeaders(runtimeConfig.watermarkToken),
    body: payload,
    cache: 'no-store',
    signal: AbortSignal.timeout(
      readEnvNumber(process.env.VF_VOICE_CLONE_RUNTIME_TIMEOUT_MS) || DEFAULT_RUNTIME_TIMEOUT_MS,
    ),
  });

  const data = await response.json().catch(() => ({}));
  return Response.json(data, { status: response.status });
};

const stripJobAudioBase64 = (payload: VoiceCloneBenchmarkResponse): VoiceCloneBenchmarkResponse => {
  const next = { ...payload };
  delete (next as { audioBase64?: string }).audioBase64;
  return next;
};

const toJobStatusResponse = (
  record: DomainJobRecord<VoiceCloneJobPayload, VoiceCloneBenchmarkResponse, VoiceCloneJobProgress>,
): VoiceCloneJobStatusResponse => {
  const requestId = String(record.payload?.requestId || '').trim();
  const toMs = (value?: string | undefined): number => {
    const parsed = value ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    ok: true,
    jobId: record.id,
    requestId,
    kind: 'voice_clone',
    status: record.status,
    createdAtMs: toMs(record.createdAt),
    updatedAtMs: toMs(record.updatedAt),
    ...(record.startedAt ? { startedAtMs: toMs(record.startedAt), startedAt: record.startedAt } : {}),
    ...(record.completedAt ? { finishedAtMs: toMs(record.completedAt), finishedAt: record.completedAt } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.progress ? { progress: record.progress } : {}),
    ...(record.result ? { result: record.result } : {}),
    ...(record.error ? { error: { message: record.error } } : {}),
  };
};

const saveVoiceCloneJobRecord = async (
  record: DomainJobRecord<VoiceCloneJobPayload, VoiceCloneBenchmarkResponse, VoiceCloneJobProgress>,
): Promise<DomainJobRecord<VoiceCloneJobPayload, VoiceCloneBenchmarkResponse, VoiceCloneJobProgress>> => {
  await saveDomainJobRecord<VoiceCloneJobPayload, VoiceCloneBenchmarkResponse, VoiceCloneJobProgress>(record);
  await writeVoiceCloneJobD1Record(record).catch(() => {});
  return record;
};

const buildQueuedVoiceCloneRecord = (
  ownerUid: string,
  payload: VoiceCloneRenderRequest,
): DomainJobRecord<VoiceCloneJobPayload, VoiceCloneBenchmarkResponse, VoiceCloneJobProgress> => {
  const requestId = String(payload.requestId || '').trim() || randomUUID();
  const traceId = String(payload.traceId || '').trim() || requestId;
  const record = createDomainJobRecord<VoiceCloneJobPayload>({
    id: buildVoiceCloneJobId(ownerUid, requestId),
    domain: VOICE_CLONE_DOMAIN,
    ownerUid,
    payload: {
      requestId,
      traceId,
      mode: String(payload.mode || 'vc').trim() || 'vc',
      runKind: String(payload.runKind || 'warm').trim() || 'warm',
      sourceVoiceId: String(payload.sourceVoiceId || '').trim(),
      sourceVoiceName: String(payload.sourceVoiceName || '').trim(),
      sourceVoiceEngine: String(payload.sourceVoiceEngine || '').trim(),
      language: String(payload.language || '').trim(),
      textChars: String(payload.text || '').length,
      ...(payload.referenceAudioName ? { referenceAudioName: String(payload.referenceAudioName).trim() } : {}),
      ...(payload.sourceAudioName ? { sourceAudioName: String(payload.sourceAudioName).trim() } : {}),
    },
  });
  return {
    ...record,
    progress: {
      percent: 8,
      stage: 'Queued',
      detail: 'Voice clone request accepted.',
    },
  };
};

const updateJobStatus = async (
  jobId: string,
  mutator: (
    record: DomainJobRecord<VoiceCloneJobPayload, VoiceCloneBenchmarkResponse, VoiceCloneJobProgress>,
  ) => DomainJobRecord<VoiceCloneJobPayload, VoiceCloneBenchmarkResponse, VoiceCloneJobProgress>,
): Promise<DomainJobRecord<VoiceCloneJobPayload, VoiceCloneBenchmarkResponse, VoiceCloneJobProgress> | null> => {
  const existing = await getDomainJobRecord<VoiceCloneJobPayload, VoiceCloneBenchmarkResponse, VoiceCloneJobProgress>(jobId);
  if (!existing) return null;
  const next = mutator(existing);
  await saveVoiceCloneJobRecord(next);
  return next;
};

const executeVoiceCloneJob = async (
  ownerUid: string,
  record: DomainJobRecord<VoiceCloneJobPayload, VoiceCloneBenchmarkResponse, VoiceCloneJobProgress>,
  inputPayload: VoiceCloneRenderRequest,
): Promise<void> => {
  const runtimeConfig = readRuntimeConfig();
  const controller = new AbortController();
  activeVoiceCloneJobs.set(record.id, controller);

  await updateJobStatus(record.id, (existing) => ({
    ...existing,
    status: 'running',
    startedAt: existing.startedAt || toIsoNow(),
    updatedAt: toIsoNow(),
    progress: {
      percent: 24,
      stage: 'Running',
      detail: 'Hosted runtime is processing the voice clone request.',
    },
  }));

  try {
    const runtimePayload = await callRuntimeJson<VoiceCloneBenchmarkResponse>(
      runtimeConfig.cloneBaseUrl,
      runtimeConfig.cloneToken,
      '/v1/vc',
      {
        method: 'POST',
        body: JSON.stringify({
          ...inputPayload,
          mode: String(inputPayload.mode || 'vc').trim() || 'vc',
          runKind: String(inputPayload.runKind || 'warm').trim() || 'warm',
          requestId: record.payload?.requestId || inputPayload.requestId || randomUUID(),
          traceId: record.payload?.traceId || inputPayload.traceId || record.payload?.requestId || randomUUID(),
        }),
        signal: controller.signal,
      },
    );

    const latest = await getDomainJobRecord(record.id) as DomainJobRecord<VoiceCloneJobPayload, VoiceCloneBenchmarkResponse, VoiceCloneJobProgress> | null;
    if (latest?.status === 'cancelled') {
      return;
    }

    const normalized = await normalizeRenderResponse(ownerUid, stripJobAudioBase64(runtimePayload));
    await saveVoiceCloneJobRecord({
      ...(latest || record),
      status: 'completed',
      updatedAt: toIsoNow(),
      completedAt: toIsoNow(),
      progress: {
        percent: 100,
        stage: 'Completed',
        detail: 'Voice clone is ready.',
      },
      result: normalized,
      error: undefined,
    });
  } catch (error) {
    const latest = await getDomainJobRecord(record.id) as DomainJobRecord<VoiceCloneJobPayload, VoiceCloneBenchmarkResponse, VoiceCloneJobProgress> | null;
    if (latest?.status === 'cancelled') {
      return;
    }
    const detail = error instanceof Error ? error.message : String(error || 'Voice clone job failed.');
    await saveVoiceCloneJobRecord({
      ...(latest || record),
      status: 'failed',
      updatedAt: toIsoNow(),
      completedAt: toIsoNow(),
      progress: {
        percent: 100,
        stage: 'Failed',
        detail,
      },
      error: detail,
    });
  } finally {
    activeVoiceCloneJobs.delete(record.id);
  }
};

const startVoiceCloneJob = async (
  request: Request,
  payload: VoiceCloneRenderRequest,
): Promise<Response> => {
  const user = await requireServerUser(request);
  const record = buildQueuedVoiceCloneRecord(user.uid, payload);
  const claimed = await createDomainJobRecordIfAbsent(record);
  const claimedRecord = claimed.record as DomainJobRecord<VoiceCloneJobPayload, VoiceCloneBenchmarkResponse, VoiceCloneJobProgress>;
  if (!claimed.created && claimedRecord.ownerUid === user.uid) {
    return Response.json(toJobStatusResponse(claimedRecord), { status: 202 });
  }

  queueMicrotask(() => {
    void executeVoiceCloneJob(user.uid, claimedRecord, {
      ...payload,
      requestId: claimedRecord.payload?.requestId || payload.requestId,
      traceId: claimedRecord.payload?.traceId || payload.traceId,
    });
  });

  return Response.json(toJobStatusResponse(claimedRecord), { status: 202 });
};

const getVoiceCloneJob = async (request: Request, jobId: string): Promise<Response> => {
  const user = await requireServerUser(request);
  const record = await getDomainJobRecord(jobId) as DomainJobRecord<VoiceCloneJobPayload, VoiceCloneBenchmarkResponse, VoiceCloneJobProgress> | null;
  if (!record || record.domain !== VOICE_CLONE_DOMAIN) {
    return Response.json({ error: 'Voice clone job not found.' }, { status: 404 });
  }
  if (record.ownerUid && record.ownerUid !== user.uid) {
    return Response.json({ error: 'Voice clone job not found.' }, { status: 404 });
  }
  return Response.json(toJobStatusResponse(record));
};

const getVoiceCloneJobByRequest = async (request: Request, requestId: string): Promise<Response> => {
  const user = await requireServerUser(request);
  const safeRequestId = String(requestId || '').trim();
  if (!safeRequestId) {
    return Response.json({ error: 'requestId is required.' }, { status: 400 });
  }
  return getVoiceCloneJob(request, buildVoiceCloneJobId(user.uid, safeRequestId));
};

const cancelVoiceCloneJob = async (request: Request, jobId: string): Promise<Response> => {
  const user = await requireServerUser(request);
  const record = await getDomainJobRecord(jobId) as DomainJobRecord<VoiceCloneJobPayload, VoiceCloneBenchmarkResponse, VoiceCloneJobProgress> | null;
  if (!record || record.domain !== VOICE_CLONE_DOMAIN) {
    return Response.json({ error: 'Voice clone job not found.' }, { status: 404 });
  }
  if (record.ownerUid && record.ownerUid !== user.uid) {
    return Response.json({ error: 'Voice clone job not found.' }, { status: 404 });
  }

  const controller = activeVoiceCloneJobs.get(jobId);
  controller?.abort();
  const cancelled = await updateJobStatus(jobId, (existing) => ({
    ...existing,
    status: 'cancelled',
    updatedAt: toIsoNow(),
    cancelledAt: toIsoNow(),
    completedAt: existing.completedAt || toIsoNow(),
    progress: {
      percent: Math.max(0, Number(existing.progress?.percent || 0)),
      stage: 'Cancelled',
      detail: 'Voice clone job cancelled.',
    },
    error: undefined,
  }));
  return Response.json(cancelled ? toJobStatusResponse(cancelled) : { error: 'Voice clone job not found.' }, {
    status: cancelled ? 200 : 404,
  });
};

const handleProviderStatus = async (): Promise<Response> => {
  const runtimeConfig = readRuntimeConfig();
  if (!runtimeConfig.cloneBaseUrl) {
    const payload: VoiceCloneBenchmarkStatusResponse = {
      ok: true,
      configured: false,
      ready: false,
      state: 'not_configured',
      detail: 'Hosted voice clone runtime is not configured.',
      provider: runtimeConfig.providerLabel,
      activeProvider: runtimeConfig.providerLabel,
      providerLabel: runtimeConfig.providerLabel,
      providerStatus: {
        key: runtimeConfig.providerLabel,
        configured: false,
        ready: false,
        detail: 'Hosted voice clone runtime is not configured.',
        activeProvider: runtimeConfig.providerLabel,
        defaultProvider: runtimeConfig.providerLabel,
      },
    };
    return Response.json(payload);
  }

  try {
    const [healthPayload, capabilitiesPayload] = await Promise.all([
      callRuntimeJson<Record<string, unknown>>(runtimeConfig.cloneBaseUrl, runtimeConfig.cloneToken, '/health', {
        method: 'GET',
        headers: { accept: 'application/json' },
      }),
      callRuntimeJson<Record<string, unknown>>(runtimeConfig.cloneBaseUrl, runtimeConfig.cloneToken, '/v1/capabilities', {
        method: 'GET',
        headers: { accept: 'application/json' },
      }).catch(() => ({})),
    ]);

    const healthRuntime = (healthPayload?.runtime as Record<string, unknown> | undefined) || undefined;
    const capabilitiesRecord: Record<string, unknown> = (
      capabilitiesPayload && typeof capabilitiesPayload === 'object'
        ? capabilitiesPayload
        : {}
    ) as Record<string, unknown>;
    const capabilityDevice = typeof capabilitiesRecord.device === 'string'
      ? String(capabilitiesRecord.device).trim()
      : '';
    const ready = Boolean(healthPayload?.ok ?? true);
    const device = String(
      healthPayload?.device ||
      healthRuntime?.['device'] ||
      capabilityDevice ||
      ''
    ).trim();

    const payload: VoiceCloneBenchmarkStatusResponse = {
      ok: true,
      configured: true,
      ready,
      state: ready ? 'ready' : 'degraded',
      detail: String(healthPayload?.detail || healthPayload?.message || (ready ? 'Ready' : 'Runtime not ready')).trim(),
      device,
      supportsVC: true,
      provider: runtimeConfig.providerLabel,
      activeProvider: runtimeConfig.providerLabel,
      providerLabel: runtimeConfig.providerLabel,
      capabilities: capabilitiesRecord,
      providerStatus: {
        key: runtimeConfig.providerLabel,
        configured: true,
        ready,
        detail: String(healthPayload?.detail || healthPayload?.message || (ready ? 'Ready' : 'Runtime not ready')).trim(),
        device,
        activeProvider: runtimeConfig.providerLabel,
        defaultProvider: runtimeConfig.providerLabel,
      },
    };
    return Response.json(payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Voice clone runtime is unavailable.';
    const payload: VoiceCloneBenchmarkStatusResponse = {
      ok: true,
      configured: true,
      ready: false,
      state: 'unavailable',
      detail,
      provider: runtimeConfig.providerLabel,
      activeProvider: runtimeConfig.providerLabel,
      providerLabel: runtimeConfig.providerLabel,
      providerStatus: {
        key: runtimeConfig.providerLabel,
        configured: true,
        ready: false,
        detail,
        activeProvider: runtimeConfig.providerLabel,
        defaultProvider: runtimeConfig.providerLabel,
      },
    };
    return Response.json(payload);
  }
};

const handleRender = async (request: Request): Promise<Response> => {
  const user = await requireServerUser(request);
  const payload = await request.json() as VoiceCloneRenderRequest;
  const runtimeConfig = readRuntimeConfig();
  const runtimePayload = await callRuntimeJson<VoiceCloneBenchmarkResponse>(
    runtimeConfig.cloneBaseUrl,
    runtimeConfig.cloneToken,
    '/v1/vc',
    {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        mode: String(payload.mode || 'vc').trim() || 'vc',
        runKind: String(payload.runKind || 'warm').trim() || 'warm',
        requestId: String(payload.requestId || '').trim() || randomUUID(),
        traceId: String(payload.traceId || '').trim() || randomUUID(),
      }),
    },
  );
  return Response.json(await normalizeRenderResponse(user.uid, runtimePayload));
};

const handleSeparation = async (request: Request): Promise<Response> => {
  const user = await requireServerUser(request);
  const payload = await request.json();
  const runtimeConfig = readRuntimeConfig();
  const runtimePayload = await callRuntimeJson<VoiceCloneStemSeparationResponse>(
    runtimeConfig.separationBaseUrl,
    runtimeConfig.separationToken,
    '/v1/separate',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
  return Response.json(await normalizeSeparationResponse(user.uid, runtimePayload));
};

const handleArtifactRequest = async (request: Request, artifactId: string): Promise<Response> => {
  const user = await requireServerUser(request);
  const record = await readArtifactRecord(artifactId);
  if (!record || record.ownerUid !== user.uid) {
    return Response.json({ error: 'Voice clone artifact not found.' }, { status: 404 });
  }
  return Response.redirect(record.downloadUrl, 307);
};

const proxyVoiceCloneRequest = async (request: NextRequest, pathSegments: string[]): Promise<Response> => {
  return proxyBackendRequest(request, ['voice-clone', ...pathSegments]);
};

const isGetMethod = (request: Request): boolean => request.method.toUpperCase() === 'GET';
const isPostMethod = (request: Request): boolean => request.method.toUpperCase() === 'POST';

export const handleVoiceCloneRoute = async (
  request: NextRequest,
  pathSegments: string[],
): Promise<Response> => {
  const safePath = Array.isArray(pathSegments) ? pathSegments.map((segment) => String(segment || '').trim()).filter(Boolean) : [];

  if (isVoiceCloneProxyMode()) {
    return proxyVoiceCloneRequest(request, safePath);
  }

  try {
    if (safePath.length === 0 || (safePath.length === 1 && (safePath[0] === 'provider' || safePath[0] === 'status') && isGetMethod(request))) {
      return handleProviderStatus();
    }

    if (safePath.length === 1 && (safePath[0] === 'render' || safePath[0] === 'openvoice') && isPostMethod(request)) {
      return handleRender(request);
    }

    if (safePath.length === 1 && safePath[0] === 'watermark' && isPostMethod(request)) {
      return handleWatermarkCheck(request);
    }

    if (safePath.length === 1 && safePath[0] === 'separate' && isPostMethod(request)) {
      return handleSeparation(request);
    }

    if (safePath.length === 1 && safePath[0] === 'jobs' && isPostMethod(request)) {
      return startVoiceCloneJob(request, await request.json() as VoiceCloneRenderRequest);
    }

    if (safePath.length === 2 && safePath[0] === 'jobs' && safePath[1] === 'render' && isPostMethod(request)) {
      return startVoiceCloneJob(request, await request.json() as VoiceCloneRenderRequest);
    }

    if (safePath.length === 3 && safePath[0] === 'jobs' && safePath[1] === 'by-request' && isGetMethod(request)) {
      return getVoiceCloneJobByRequest(request, safePath[2] || '');
    }

    if (safePath.length === 2 && safePath[0] === 'jobs' && isGetMethod(request)) {
      return getVoiceCloneJob(request, safePath[1] || '');
    }

    if (safePath.length === 3 && safePath[0] === 'jobs' && safePath[2] === 'cancel' && isPostMethod(request)) {
      return cancelVoiceCloneJob(request, safePath[1] || '');
    }

    if (safePath.length === 2 && safePath[0] === 'artifacts' && isGetMethod(request)) {
      return handleArtifactRequest(request, safePath[1] || '');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voice clone request failed.';
    return Response.json({ error: message }, { status: 500 });
  }

  if (hasLegacyVoiceCloneProxyConfigured()) {
    return proxyVoiceCloneRequest(request, safePath);
  }

  return Response.json({ error: 'Voice clone route not found.' }, { status: 404 });
};
