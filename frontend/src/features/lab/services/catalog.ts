import type { LabCatalogImportResult, LabCatalogItem, LabCatalogKind, LabCatalogProvider, LabCatalogSearchResult } from '../../../../types';
import type { LabCatalogImportResponse, LabCatalogSearchResponse } from '../../../shared/api/contracts';
import { resolveApiBaseUrl } from '../../../shared/api/config';
import { requestBlob, requestJson, requestPublicJson } from '../../../shared/api/httpClient';

const withBaseUrl = (baseUrl?: string): { baseUrl?: string } => (baseUrl ? { baseUrl: resolveApiBaseUrl(baseUrl) } : {});

interface SearchCatalogOptions {
  q?: string;
  tag?: string;
  page?: number;
  provider?: LabCatalogProvider | 'all';
  baseUrl?: string;
}

export const searchLabCatalog = async (
  kind: LabCatalogKind,
  options?: SearchCatalogOptions
): Promise<LabCatalogSearchResult> => {
  const params = new URLSearchParams();
  params.set('kind', kind);
  if (options?.q) params.set('q', options.q);
  if (options?.tag) params.set('tag', options.tag);
  if (options?.page) params.set('page', String(options.page));
  if (options?.provider && options.provider !== 'all') params.set('provider', options.provider);
  const payload = await requestPublicJson<LabCatalogSearchResponse>(
    `/lab/catalog/search?${params.toString()}`,
    undefined,
    withBaseUrl(options?.baseUrl)
  );
  return payload.result;
};

export const fetchLabCatalogAsset = async (
  provider: LabCatalogProvider,
  id: string,
  options?: { kind?: LabCatalogKind; baseUrl?: string }
): Promise<LabCatalogItem> => {
  const params = new URLSearchParams({
    provider,
    id,
  });
  if (options?.kind) params.set('kind', options.kind);
  const payload = await requestPublicJson<LabCatalogSearchResponse>(
    `/lab/catalog/asset?${params.toString()}`,
    undefined,
    withBaseUrl(options?.baseUrl)
  );
  return payload.result.items[0]!;
};

export const importLabCatalogItem = async (
  item: LabCatalogItem,
  options?: { baseUrl?: string }
): Promise<LabCatalogImportResult> => {
  const payload = await requestJson<LabCatalogImportResponse>(
    '/lab/catalog/import',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ item }),
    },
    { ...withBaseUrl(options?.baseUrl), requireAuth: true }
  );
  return payload.imported;
};

export const fetchImportedLabCatalogBlob = async (
  importId: string,
  options?: { baseUrl?: string }
): Promise<Blob> => {
  return requestBlob(
    `/lab/catalog/imports/${encodeURIComponent(importId)}`,
    undefined,
    { ...withBaseUrl(options?.baseUrl), requireAuth: true }
  );
};
