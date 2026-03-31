import React from 'react';
import { Button } from '../../../components/Button';

type VoiceCloneTaskTone = 'clone' | 'separate';

export interface VoiceCloneTaskProgressCardProps {
  title: string;
  stage: string;
  detail: string;
  progress: number;
  tone?: VoiceCloneTaskTone;
  onCancel: () => void;
  isCancelling?: boolean;
}

const clampProgress = (value: number): number => Math.max(0, Math.min(100, Number(value) || 0));

export const VoiceCloneTaskProgressCard: React.FC<VoiceCloneTaskProgressCardProps> = ({
  title,
  stage,
  detail,
  progress,
  tone = 'clone',
  onCancel,
  isCancelling = false,
}) => {
  const safeProgress = clampProgress(progress);
  const progressLabel = `${Math.round(safeProgress)}%`;

  return (
    <section className={`vf-voice-clone-task vf-voice-clone-task--${tone}`} aria-busy="true">
      <div className="vf-voice-clone-task__header">
        <div className="vf-voice-clone-task__copy">
          <p className="vf-voices-kicker">Live progress</p>
          <h3 className="vf-voice-clone-task__title">{title}</h3>
          <p className="vf-voice-clone-task__detail">{detail}</p>
        </div>
        <span className="vf-voice-clone-status-chip">{progressLabel}</span>
      </div>

      <div
        className="vf-voice-clone-task__progress"
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(safeProgress)}
        aria-valuetext={`${title} ${progressLabel}`}
      >
        <div className="vf-voice-clone-task__track">
          <div className="vf-voice-clone-task__fill" style={{ width: `${safeProgress}%` }} />
          <div className="vf-voice-clone-task__sweep" />
        </div>
      </div>

      <div className="vf-voice-clone-task__footer">
        <div className="vf-voice-clone-task__stage-wrap">
          <div className="vf-voice-clone-task__stage">{stage}</div>
          <div className="vf-voice-clone-task__hint">Cancel stops the root request and clears the live run.</div>
        </div>
        <Button
          type="button"
          variant="danger"
          size="sm"
          className="sm:min-w-28"
          isLoading={isCancelling}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </section>
  );
};
