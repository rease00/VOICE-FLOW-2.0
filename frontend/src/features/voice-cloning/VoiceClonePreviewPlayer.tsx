import React from 'react';
import { Download, FileAudio } from 'lucide-react';

type VoiceClonePreviewTone = 'source' | 'output' | 'stem';

interface VoiceClonePreviewPlayerProps {
  label: string;
  name: string;
  meta?: string;
  previewUrl?: string | null;
  fallback: string;
  chipLabel?: string;
  tone?: VoiceClonePreviewTone;
  downloadUrl?: string | null;
  downloadFileName?: string;
  downloadLabel?: string;
}

const DEFAULT_CHIP_LABELS: Record<VoiceClonePreviewTone, string> = {
  source: 'Source',
  output: 'Rendered',
  stem: 'Stem',
};

export const VoiceClonePreviewPlayer: React.FC<VoiceClonePreviewPlayerProps> = ({
  label,
  name,
  meta,
  previewUrl,
  fallback,
  chipLabel,
  tone = 'source',
  downloadUrl,
  downloadFileName,
  downloadLabel,
}) => {
  const safeName = String(name || '').trim() || 'Not selected';
  const safeChipLabel = String(chipLabel || DEFAULT_CHIP_LABELS[tone] || '').trim();
  const showDownload = Boolean(downloadLabel);

  return (
    <div className={`vf-voice-clone-player vf-voice-clone-player--${tone}`}>
      <div className="vf-voice-clone-player__header">
        <div className="vf-voice-clone-player__copy">
          <div className="vf-voice-clone-preview-label">{label}</div>
          <div className="vf-voice-clone-preview-name">{safeName}</div>
          {meta ? <div className="vf-voice-clone-player__meta">{meta}</div> : null}
        </div>
        {safeChipLabel ? <span className="vf-voice-clone-player__chip">{safeChipLabel}</span> : null}
      </div>

      {previewUrl ? (
        <div className="vf-voice-clone-player__media">
          <audio
            className="vf-voice-clone-player__audio"
            controls
            controlsList="nodownload noplaybackrate noremoteplayback"
            preload="metadata"
            src={previewUrl}
            aria-label={`${label} preview`}
          />
        </div>
      ) : (
        <div className="vf-voice-clone-player__empty">
          <FileAudio size={15} className="vf-voice-clone-player__empty-icon" />
          <p className="vf-voice-clone-preview-copy">{fallback}</p>
        </div>
      )}

      {showDownload ? (
        downloadUrl ? (
          <a className="vf-voice-clone-download vf-voice-clone-download--wide" download={downloadFileName} href={downloadUrl}>
            <Download size={14} />
            {downloadLabel}
          </a>
        ) : (
          <span className="vf-voice-clone-download vf-voice-clone-download--wide vf-voice-clone-download--disabled" aria-disabled="true">
            <Download size={14} />
            {downloadLabel || 'Download unavailable'}
          </span>
        )
      ) : null}
    </div>
  );
};
