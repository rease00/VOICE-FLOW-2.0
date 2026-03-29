import React from 'react';
import type { ReaderCatalogItem } from '../../../../types';
import type { ReaderCommercialCheckResponse } from '../api/readerApi';
import { ReaderCover } from './ReaderCover';

interface ReaderLaunchModalProps {
  item: ReaderCatalogItem;
  isLoading?: boolean;
  commercialCheck?: ReaderCommercialCheckResponse | null;
  isCheckingCommercial?: boolean;
  resolveMediaUrl: (url: string | undefined) => string;
  onClose: () => void;
  onRead: () => void;
}

const resolveSummary = (item: ReaderCatalogItem): string =>
  String(item.summary || item.excerpt || 'No summary available yet for this title.').trim();

export const ReaderLaunchModal: React.FC<ReaderLaunchModalProps> = ({
  item,
  isLoading = false,
  commercialCheck = null,
  isCheckingCommercial = false,
  resolveMediaUrl,
  onClose,
  onRead,
}) => {
  const coverUrl = resolveMediaUrl(item.coverUrl);
  const progress = Math.round(Number(item.resume?.progressPct || 0));
  const summary = resolveSummary(item);

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
            eyebrow={item.surface === 'uploads' ? 'Imported' : (item.contentKind === 'comic' ? 'Comic' : 'Novel')}
            alt={item.title}
            variant="modal"
            loading="eager"
            fetchPriority="high"
            className="vf-reader-v2-modal__cover-shell"
          />
        </div>

        <div className="vf-reader-v2-modal__content">
          <div className="vf-reader-v2-eyebrow">Before You Read</div>
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
          </div>

          <div className="vf-reader-v2-modal__actions">
            <button type="button" className="vf-reader-v2-secondary" onClick={onClose}>
              Back
            </button>
            <button type="button" className="vf-reader-v2-primary" onClick={onRead}>
              Read
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
