import type { LabExportFormat, LabExportJobState, LabRuntimeDefaults, LabSeparationJobState } from '../../../../types';
import type { LabExportJobStatusResponse, LabRuntimeDefaultsResponse, LabSeparationJobStatusResponse } from '../../../shared/api/contracts';
import { resolveApiBaseUrl } from '../../../shared/api/config';
import { requestBlob, requestJson } from '../../../shared/api/httpClient';

const withBaseUrl = (baseUrl?: string): { baseUrl?: string } => (baseUrl ? { baseUrl: resolveApiBaseUrl(baseUrl) } : {});

export const fetchLabRuntimeDefaults = async (baseUrl?: string): Promise<LabRuntimeDefaults> => {
  const payload = await requestJson<LabRuntimeDefaultsResponse>(
    '/lab/runtime-defaults',
    undefined,
    withBaseUrl(baseUrl)
  );
  return payload.defaults;
};

export const createLabSeparationJob = async (
  file: File,
  options?: { modelName?: string; baseUrl?: string }
): Promise<LabSeparationJobState> => {
  const body = new FormData();
  body.append('file', file);
  if (options?.modelName) body.append('modelName', options.modelName);
  const payload = await requestJson<LabSeparationJobStatusResponse>(
    '/lab/separation/jobs',
    {
      method: 'POST',
      body,
    },
    { ...withBaseUrl(options?.baseUrl), requireAuth: true }
  );
  return payload.job;
};

export const fetchLabSeparationJob = async (
  jobId: string,
  options?: { baseUrl?: string }
): Promise<LabSeparationJobState> => {
  const payload = await requestJson<LabSeparationJobStatusResponse>(
    `/lab/separation/jobs/${encodeURIComponent(String(jobId || '').trim())}`,
    undefined,
    { ...withBaseUrl(options?.baseUrl), requireAuth: true }
  );
  return payload.job;
};

export const fetchLabSeparationArtifact = async (
  jobId: string,
  stemKind: 'vocals' | 'instrumental',
  options?: { baseUrl?: string }
): Promise<Blob> => {
  return requestBlob(
    `/lab/separation/jobs/${encodeURIComponent(String(jobId || '').trim())}/artifacts/${encodeURIComponent(stemKind)}`,
    undefined,
    { ...withBaseUrl(options?.baseUrl), requireAuth: true }
  );
};

export const createLabExportJob = async (
  file: File,
  options?: {
    format?: LabExportFormat;
    sourceMediaType?: string;
    browserMode?: string;
    baseUrl?: string;
  }
): Promise<LabExportJobState> => {
  const body = new FormData();
  body.append('file', file);
  body.append('format', options?.format || 'mp4');
  if (options?.sourceMediaType) body.append('sourceMediaType', options.sourceMediaType);
  if (options?.browserMode) body.append('browserMode', options.browserMode);
  const payload = await requestJson<LabExportJobStatusResponse>(
    '/lab/export/jobs',
    {
      method: 'POST',
      body,
    },
    { ...withBaseUrl(options?.baseUrl), requireAuth: true }
  );
  return payload.job;
};

export const fetchLabExportJob = async (
  jobId: string,
  options?: { baseUrl?: string }
): Promise<LabExportJobState> => {
  const payload = await requestJson<LabExportJobStatusResponse>(
    `/lab/export/jobs/${encodeURIComponent(String(jobId || '').trim())}`,
    undefined,
    { ...withBaseUrl(options?.baseUrl), requireAuth: true }
  );
  return payload.job;
};

export const fetchLabExportArtifact = async (
  jobId: string,
  options?: { baseUrl?: string }
): Promise<Blob> => {
  return requestBlob(
    `/lab/export/jobs/${encodeURIComponent(String(jobId || '').trim())}/artifact`,
    undefined,
    { ...withBaseUrl(options?.baseUrl), requireAuth: true }
  );
};

export const cancelLabExportJob = async (
  jobId: string,
  options?: { baseUrl?: string }
): Promise<LabExportJobState> => {
  const payload = await requestJson<LabExportJobStatusResponse>(
    `/lab/export/jobs/${encodeURIComponent(String(jobId || '').trim())}`,
    { method: 'DELETE' },
    { ...withBaseUrl(options?.baseUrl), requireAuth: true }
  );
  return payload.job;
};
