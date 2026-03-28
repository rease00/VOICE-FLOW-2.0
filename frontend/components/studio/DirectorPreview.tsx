import React, { useMemo } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import { buildDirectorPreviewDiff } from './directorPreviewDiff';

interface DirectorPreviewProps {
  sourceText: string;
  previewText: string;
  modeLabel: string;
  mood?: string;
  speakerCount: number;
  patchedLineCount: number;
  onApply: () => void;
  onDiscard: () => void;
}

const pluralize = (count: number, singular: string, plural: string = `${singular}s`): string => (
  `${count} ${count === 1 ? singular : plural}`
);

export const DirectorPreview: React.FC<DirectorPreviewProps> = ({
  sourceText,
  previewText,
  modeLabel,
  mood,
  speakerCount,
  patchedLineCount,
  onApply,
  onDiscard,
}) => {
  const diff = useMemo(() => buildDirectorPreviewDiff(sourceText, previewText), [previewText, sourceText]);

  const renderPaneRows = (side: 'source' | 'preview') => (
    diff.rows.map((row) => {
      const textValue = side === 'source' ? row.sourceText : row.previewText;
      const hasText = textValue.length > 0;
      let tone: 'unchanged' | 'added' | 'removed' | 'modified' | 'placeholder' = 'unchanged';

      if (row.status === 'modified') {
        tone = 'modified';
      } else if (row.status === 'added') {
        tone = side === 'preview' ? 'added' : 'placeholder';
      } else if (row.status === 'removed') {
        tone = side === 'source' ? 'removed' : 'placeholder';
      }

      return (
        <div
          key={`${side}-${row.key}`}
          className={`vf-director-preview__line vf-director-preview__line--${tone}${hasText ? '' : ' vf-director-preview__line--empty'}`}
        >
          <span className="vf-director-preview__line-rail" aria-hidden="true" />
          <span className="vf-director-preview__line-text">{hasText ? textValue : ' '}</span>
        </div>
      );
    })
  );

  return (
    <div className="vf-director-preview animate-in fade-in duration-200">
      <div className="vf-director-preview__header">
        <div className="vf-director-preview__intro">
          <div className="vf-director-preview__eyebrow">
            <Sparkles size={13} />
            <span>AI Director Preview</span>
          </div>
          <div className="vf-director-preview__title">Review the pass before replacing the script.</div>
          <p className="vf-director-preview__subtitle">
            Compare the current script with the directed pass, then apply only if it feels right. Changed lines stay softly highlighted so the review stays quick.
          </p>
        </div>

        <div className="vf-director-preview__meta">
          <span className="vf-director-preview__chip vf-director-preview__chip--accent">{modeLabel}</span>
          <span className="vf-director-preview__chip vf-director-preview__chip--strong">
            {pluralize(diff.summary.totalChanged, 'changed line')}
          </span>
          {diff.summary.modified > 0 ? (
            <span className="vf-director-preview__chip">{pluralize(diff.summary.modified, 'modified line')}</span>
          ) : null}
          {diff.summary.added > 0 ? (
            <span className="vf-director-preview__chip">{pluralize(diff.summary.added, 'added line')}</span>
          ) : null}
          {diff.summary.removed > 0 ? (
            <span className="vf-director-preview__chip">{pluralize(diff.summary.removed, 'removed line')}</span>
          ) : null}
          {speakerCount > 0 ? (
            <span className="vf-director-preview__chip">{pluralize(speakerCount, 'speaker')}</span>
          ) : null}
          {patchedLineCount > 0 ? (
            <span className="vf-director-preview__chip">{pluralize(patchedLineCount, 'line')} adjusted</span>
          ) : null}
          {mood ? <span className="vf-director-preview__chip">Mood: {mood}</span> : null}
        </div>
      </div>

      <div className="vf-director-preview__grid">
        <section className="vf-director-preview__pane" aria-label="Current script preview">
          <div className="vf-director-preview__pane-header">
            <div>
              <p className="vf-director-preview__pane-label">Before</p>
              <p className="vf-director-preview__pane-title">Current Script</p>
            </div>
          </div>
          <div className="vf-director-preview__pane-body vf-director-preview__pane-body--diff">
            {renderPaneRows('source')}
          </div>
        </section>

        <section className="vf-director-preview__pane vf-director-preview__pane--accent" aria-label="AI Director pass preview">
          <div className="vf-director-preview__pane-header">
            <div>
              <p className="vf-director-preview__pane-label">After</p>
              <p className="vf-director-preview__pane-title">AI Director Pass</p>
            </div>
          </div>
          <div className="vf-director-preview__pane-body vf-director-preview__pane-body--diff">
            {renderPaneRows('preview')}
          </div>
        </section>
      </div>

      <div className="vf-director-preview__actions">
        <button type="button" className="vf-director-preview__ghost" onClick={onDiscard}>
          <span className="vf-director-preview__action-copy">
            <X size={15} />
            <span>Discard</span>
          </span>
          <span className="vf-director-preview__shortcut" aria-hidden="true">Esc</span>
        </button>
        <button type="button" className="vf-director-preview__primary" onClick={onApply}>
          <span className="vf-director-preview__action-copy">
            <Check size={15} />
            <span>Apply To Editor</span>
          </span>
          <span className="vf-director-preview__shortcut" aria-hidden="true">Ctrl/Cmd + Enter</span>
        </button>
      </div>
    </div>
  );
};
