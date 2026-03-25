import type { ReaderOwnershipBasis } from '../../../../types';

export type AdminReaderCatalogContentType = 'novel' | 'manga';
export type AdminReaderCatalogPublishState = 'published' | 'draft';

export interface AdminReaderCatalogDraft {
  title: string;
  author: string;
  contentType: AdminReaderCatalogContentType;
  ownershipBasis: ReaderOwnershipBasis;
  regionId: string;
  license: string;
  summary: string;
  collectionLabel: string;
  directionOverride: string;
  publishState: AdminReaderCatalogPublishState;
}

export interface AdminReaderCatalogSubmission extends AdminReaderCatalogDraft {
  files: File[];
}

export const ADMIN_READER_CATALOG_CONTENT_TYPES: readonly AdminReaderCatalogContentType[] = ['novel', 'manga'] as const;

export const ADMIN_READER_CATALOG_PUBLISH_STATES: readonly AdminReaderCatalogPublishState[] = ['published', 'draft'] as const;

export const createAdminReaderCatalogDraft = (): AdminReaderCatalogDraft => ({
  title: '',
  author: '',
  contentType: 'novel',
  ownershipBasis: 'licensed',
  regionId: 'english',
  license: '',
  summary: '',
  collectionLabel: 'Reader Library',
  directionOverride: '',
  publishState: 'published',
});

export const getAdminReaderCatalogContentTypeLabel = (contentType: AdminReaderCatalogContentType): string =>
  contentType === 'manga' ? 'Manga / Comic' : 'Novel';

export const getAdminReaderCatalogPublishStateLabel = (state: AdminReaderCatalogPublishState): string =>
  state === 'draft' ? 'Draft' : 'Published';

export const resolveAdminReaderCatalogDirectionOverride = (
  contentType: AdminReaderCatalogContentType,
  directionOverride: string
): string => {
  if (contentType !== 'manga') return '';
  const safeDirection = String(directionOverride || '').trim();
  return safeDirection || 'manga';
};

export const normalizeAdminReaderCatalogDraft = (draft: Partial<AdminReaderCatalogDraft>): AdminReaderCatalogDraft => {
  const contentType = ADMIN_READER_CATALOG_CONTENT_TYPES.includes(draft.contentType as AdminReaderCatalogContentType)
    ? (draft.contentType as AdminReaderCatalogContentType)
    : 'novel';
  const publishState = ADMIN_READER_CATALOG_PUBLISH_STATES.includes(draft.publishState as AdminReaderCatalogPublishState)
    ? (draft.publishState as AdminReaderCatalogPublishState)
    : 'published';
  return {
    ...createAdminReaderCatalogDraft(),
    ...draft,
    contentType,
    publishState,
    directionOverride: resolveAdminReaderCatalogDirectionOverride(contentType, String(draft.directionOverride || '')),
  };
};
