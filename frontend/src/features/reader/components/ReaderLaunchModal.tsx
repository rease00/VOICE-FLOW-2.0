import React from 'react';
import type {
  ReaderCatalogItem,
  ReaderNovelEntitlementView,
  ReaderPublishConfig,
  ReaderPublisherKycStatus,
} from '../../../../types';
import type { ReaderCommercialCheckResponse } from '../api/readerApi';
import { ReaderCover } from './ReaderCover';

interface ReaderLaunchModalProps {
  item: ReaderCatalogItem;
  isLoading?: boolean;
  commercialCheck?: ReaderCommercialCheckResponse | null;
  isCheckingCommercial?: boolean;
  resolveMediaUrl: (url: string | undefined) => string;
  publisherStatus?: ReaderPublisherKycStatus | null;
  publishConfig?: ReaderPublishConfig | null;
  isLoadingPublishConfig?: boolean;
  isSavingPublishConfig?: boolean;
  isPublishingUpload?: boolean;
  publisherKycSessionMode?: string;
  entitlement?: ReaderNovelEntitlementView | null;
  isLoadingEntitlement?: boolean;
  isUnlockingNovel?: boolean;
  unlockingChapterId?: string;
  onPublishConfigChange?: (patch: Partial<ReaderPublishConfig>) => void;
  onSavePublishConfig?: () => void;
  onStartPublisherKyc?: () => void;
  onPublishUpload?: () => void;
  onUnlockNovel?: () => void;
  onUnlockChapter?: (chapterId: string) => void;
  onClose: () => void;
  onRead: () => void;
}

const resolveSummary = (item: ReaderCatalogItem): string =>
  String(item.summary || item.excerpt || 'No summary available yet for this title.').trim();

const toNumericFieldValue = (value: number | string | undefined): string =>
  Number.isFinite(Number(value)) && Number(value) > 0 ? String(Number(value)) : '';

const normalizeTagsDraft = (value: string): string[] =>
  String(value || '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);

export const ReaderLaunchModal: React.FC<ReaderLaunchModalProps> = ({
  item,
  isLoading = false,
  commercialCheck = null,
  isCheckingCommercial = false,
  resolveMediaUrl,
  publisherStatus = null,
  publishConfig = null,
  isLoadingPublishConfig = false,
  isSavingPublishConfig = false,
  isPublishingUpload = false,
  publisherKycSessionMode = '',
  entitlement = null,
  isLoadingEntitlement = false,
  isUnlockingNovel = false,
  unlockingChapterId = '',
  onPublishConfigChange,
  onSavePublishConfig,
  onStartPublisherKyc,
  onPublishUpload,
  onUnlockNovel,
  onUnlockChapter,
  onClose,
  onRead,
}) => {
  const coverUrl = resolveMediaUrl(item.coverUrl);
  const progress = Math.round(Number(item.resume?.progressPct || 0));
  const summary = resolveSummary(item);
  const fullNovelPrice = Number(publishConfig?.fullNovelUnlockVf ?? item.pricingSummary?.fullNovelUnlockVf ?? 0);
  const defaultChapterPrice = Number(publishConfig?.defaultChapterUnlockVf ?? item.pricingSummary?.defaultChapterUnlockVf ?? 0);
  const canPublish = Boolean(publisherStatus?.canPublish || publisherStatus?.verified);
  const isUpload = item.surface === 'uploads';
  const chapterList = entitlement?.chapters || item.chapters || [];
  const firstLockedChapter = chapterList.find((chapter) => !chapter.effectiveAccess && Number(chapter.unlockVf || 0) > 0) || null;
  const readDisabled = !isUpload && fullNovelPrice > 0 && !entitlement?.effectiveAccess?.fullNovel;

  return (
    <div className="vf-reader-v2-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Open ${item.title}`}
        className="vf-reader-v2-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="vf-reader-v2-modal__cover">
          <ReaderCover
            src={coverUrl}
            title={item.title}
            subtitle={item.author}
            eyebrow={isUpload ? 'Your Upload' : 'Admin Upload'}
            alt={item.title}
            variant="modal"
            loading="eager"
            fetchPriority="high"
            className="vf-reader-v2-modal__cover-shell"
          />
        </div>

        <div className="vf-reader-v2-modal__content">
          <div className="vf-reader-v2-eyebrow">Novels</div>
          <h3>{item.title}</h3>
          <p className="vf-reader-v2-modal__author">{item.author}</p>
          <p className="vf-reader-v2-modal__summary">{summary}</p>
          {isLoading ? <p className="vf-reader-v2-modal__loading" role="status" aria-live="polite">Refreshing details from backend...</p> : null}
          {isCheckingCommercial ? <p className="vf-reader-v2-modal__loading" role="status" aria-live="polite">Checking commercial policy...</p> : null}
          {commercialCheck ? (
            <p className="vf-reader-v2-modal__loading" role="status" aria-live="polite">
              Policy: {commercialCheck.result.toUpperCase()} {commercialCheck.reason ? `- ${commercialCheck.reason}` : ''}
            </p>
          ) : null}

          <div className="vf-reader-v2-modal__meta">
            <span>{item.contentKind === 'comic' ? 'Comic' : 'Novel'}</span>
            <span>{item.provider}</span>
            <span>{progress}% progress</span>
            {item.publishStateBadge ? <span>{item.publishStateBadge}</span> : null}
          </div>

          {isUpload ? (
            <div className="vf-reader-v2-settings-grid">
              <article className="vf-reader-v2-settings-card">
                <header className="vf-reader-v2-settings-card__head">
                  <h4>Creator Verification</h4>
                  <p>One-time verification unlocks publishing across your uploaded novels.</p>
                </header>
                <p className="vf-reader-v2-panel__status" role="status" aria-live="polite">
                  Status: {publisherStatus?.kycStatus || 'not_started'}
                  {publisherKycSessionMode ? ` (${publisherKycSessionMode})` : ''}
                </p>
                <small>
                  Published: {Number(publisherStatus?.publishedNovelCount || 0).toLocaleString()} | Drafts: {Number(publisherStatus?.draftNovelCount || 0).toLocaleString()}
                </small>
                <div className="vf-reader-v2-panel__actions">
                  <button type="button" className="vf-reader-v2-secondary" onClick={onStartPublisherKyc} disabled={Boolean(publisherStatus?.verified)}>
                    {publisherStatus?.verified ? 'Verified' : 'Verify Creator'}
                  </button>
                </div>
              </article>

              <article className="vf-reader-v2-settings-card">
                <header className="vf-reader-v2-settings-card__head">
                  <h4>Publish Setup</h4>
                  <p>Set your shelf metadata, unlock pricing, and move this upload into the managed catalog.</p>
                </header>
                {isLoadingPublishConfig ? <p className="vf-reader-v2-modal__loading">Loading publish setup...</p> : null}
                <div className="vf-reader-v2-settings-form-grid">
                  <div className="vf-reader-v2-field vf-reader-v2-field--full">
                    <label htmlFor="novels-publish-title">Title</label>
                    <input
                      id="novels-publish-title"
                      type="text"
                      value={String(publishConfig?.title || item.title || '')}
                      onChange={(event) => onPublishConfigChange?.({ title: event.target.value })}
                    />
                  </div>
                  <div className="vf-reader-v2-field vf-reader-v2-field--full">
                    <label htmlFor="novels-publish-summary">Summary</label>
                    <textarea
                      id="novels-publish-summary"
                      value={String(publishConfig?.summary || item.summary || '')}
                      onChange={(event) => onPublishConfigChange?.({ summary: event.target.value })}
                    />
                  </div>
                  <div className="vf-reader-v2-field">
                    <label htmlFor="novels-publish-price">Full Novel Unlock (VF)</label>
                    <input
                      id="novels-publish-price"
                      type="number"
                      min={0}
                      step={1}
                      value={toNumericFieldValue(fullNovelPrice)}
                      onChange={(event) => onPublishConfigChange?.({ fullNovelUnlockVf: Math.max(0, Number(event.target.value || 0)) })}
                    />
                  </div>
                  <div className="vf-reader-v2-field">
                    <label htmlFor="novels-publish-chapter-price">Default Chapter Unlock (VF)</label>
                    <input
                      id="novels-publish-chapter-price"
                      type="number"
                      min={0}
                      step={1}
                      value={toNumericFieldValue(defaultChapterPrice)}
                      onChange={(event) => onPublishConfigChange?.({ defaultChapterUnlockVf: Math.max(0, Number(event.target.value || 0)) })}
                    />
                  </div>
                  <div className="vf-reader-v2-field">
                    <label htmlFor="novels-publish-collection">Collection</label>
                    <input
                      id="novels-publish-collection"
                      type="text"
                      value={String(publishConfig?.collectionLabel || item.collectionLabel || 'Novels')}
                      onChange={(event) => onPublishConfigChange?.({ collectionLabel: event.target.value })}
                    />
                  </div>
                  <div className="vf-reader-v2-field">
                    <label htmlFor="novels-publish-tags">Tags</label>
                    <input
                      id="novels-publish-tags"
                      type="text"
                      value={Array.isArray(publishConfig?.tags) ? publishConfig?.tags.join(', ') : ''}
                      onChange={(event) => onPublishConfigChange?.({ tags: normalizeTagsDraft(event.target.value) })}
                      placeholder="fantasy, romance"
                    />
                  </div>
                </div>
                <div className="vf-reader-v2-panel__actions">
                  <button type="button" className="vf-reader-v2-secondary" onClick={onSavePublishConfig} disabled={isSavingPublishConfig}>
                    {isSavingPublishConfig ? 'Saving...' : 'Save Setup'}
                  </button>
                  <button type="button" className="vf-reader-v2-primary" onClick={onPublishUpload} disabled={!canPublish || isPublishingUpload}>
                    {isPublishingUpload ? 'Publishing...' : 'Publish Novel'}
                  </button>
                </div>
              </article>
            </div>
          ) : (
            <div className="vf-reader-v2-settings-grid">
              <article className="vf-reader-v2-settings-card">
                <header className="vf-reader-v2-settings-card__head">
                  <h4>Unlock Status</h4>
                  <p>Unlock the full novel to read every chapter and listen from the dock.</p>
                </header>
                {isLoadingEntitlement ? <p className="vf-reader-v2-modal__loading">Loading unlock state...</p> : null}
                <p className="vf-reader-v2-panel__status" role="status" aria-live="polite">
                  {entitlement?.effectiveAccess?.fullNovel ? 'Full novel unlocked.' : fullNovelPrice > 0 ? `Full unlock: ${fullNovelPrice.toLocaleString()} VF` : 'Free to read.'}
                </p>
                <div className="vf-reader-v2-panel__actions">
                  {fullNovelPrice > 0 ? (
                    <button type="button" className="vf-reader-v2-primary" onClick={onUnlockNovel} disabled={Boolean(entitlement?.effectiveAccess?.fullNovel) || isUnlockingNovel}>
                      {isUnlockingNovel ? 'Unlocking...' : entitlement?.effectiveAccess?.fullNovel ? 'Unlocked' : 'Unlock Novel'}
                    </button>
                  ) : null}
                  {firstLockedChapter ? (
                    <button
                      type="button"
                      className="vf-reader-v2-secondary"
                      onClick={() => onUnlockChapter?.(firstLockedChapter.id)}
                      disabled={unlockingChapterId === firstLockedChapter.id}
                    >
                      {unlockingChapterId === firstLockedChapter.id ? 'Unlocking Chapter...' : `Unlock ${firstLockedChapter.title}`}
                    </button>
                  ) : null}
                </div>
              </article>

              <article className="vf-reader-v2-settings-card">
                <header className="vf-reader-v2-settings-card__head">
                  <h4>Chapters</h4>
                  <p>Chapter pricing follows the novel entitlement and stays consistent for dock listening.</p>
                </header>
                <div style={{ display: 'grid', gap: 10 }}>
                  {chapterList.slice(0, 4).map((chapter) => (
                    <article key={chapter.id} className="vf-reader-v2-panel" style={{ margin: 0 }}>
                      <div className="vf-reader-v2-panel__meta">
                        <strong>{chapter.title}</strong>
                        <span>{chapter.effectiveAccess ? 'Unlocked' : `${Number(chapter.unlockVf || 0).toLocaleString()} VF`}</span>
                      </div>
                      <small>{Number(chapter.wordCount || 0).toLocaleString()} words</small>
                    </article>
                  ))}
                  {chapterList.length === 0 ? <p>No chapter metadata yet.</p> : null}
                </div>
              </article>
            </div>
          )}

          <div className="vf-reader-v2-modal__actions">
            <button type="button" className="vf-reader-v2-secondary" onClick={onClose}>
              Back
            </button>
            <button type="button" className="vf-reader-v2-primary" onClick={onRead} disabled={readDisabled}>
              {readDisabled ? 'Unlock To Read' : 'Read'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
