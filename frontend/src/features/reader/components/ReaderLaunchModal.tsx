import React from 'react';
import type { ReaderCatalogItem } from '../../../../types';
import type { ReaderCommercialCheckResponse } from '../api/readerApi';

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
  const isBlocked = commercialCheck?.result === 'blocked';

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
          {coverUrl ? (
            <img src={coverUrl} alt={item.title} />
          ) : (
            <div className="vf-reader-v2-modal__cover-fallback">{item.title}</div>
          )}
        </div>

        <div className="vf-reader-v2-modal__content">
          <div className="vf-reader-v2-eyebrow">Before You Read</div>
          <h3>{item.title}</h3>
          <p className="vf-reader-v2-modal__author">{item.author}</p>
          <p className="vf-reader-v2-modal__summary">{summary}</p>
          {isLoading ? <p className="vf-reader-v2-modal__loading">Refreshing details from backend...</p> : null}
          {isCheckingCommercial ? <p className="vf-reader-v2-modal__loading">Checking commercial usage policy...</p> : null}
          {commercialCheck ? (
            <div className={`vf-reader-v2-modal__policy vf-reader-v2-modal__policy--${commercialCheck.result}`}>
              <strong>Commercial: {commercialCheck.result.toUpperCase()}</strong>
              <p>{commercialCheck.reason || 'No policy warnings detected for this intent.'}</p>
              {commercialCheck.nextSteps.length > 0 ? (
                <ul>
                  {commercialCheck.nextSteps.slice(0, 2).map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              ) : null}
            </div>
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
            <button type="button" className="vf-reader-v2-primary" onClick={onRead} disabled={isBlocked}>
              {isBlocked ? 'Use Licensed Import' : 'Read'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
