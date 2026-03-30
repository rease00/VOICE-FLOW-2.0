import React from 'react';
import { Loader2, Play, X } from 'lucide-react';

interface MorphingGenerateButtonProps {
  onClick: () => void;
  onCancel?: () => void;
  disabled?: boolean;
  isGenerating: boolean;
  progress?: number;
  stage?: string;
  className?: string;
  size?: 'default' | 'compact';
}

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

export const MorphingGenerateButton: React.FC<MorphingGenerateButtonProps> = ({
  onClick,
  onCancel,
  disabled = false,
  isGenerating,
  progress = 0,
  stage = '',
  className = '',
  size = 'default',
}) => {
  const normalizedProgress = clamp(progress);
  const stageLabel = String(stage || '').trim();
  const actionDisabled = Boolean(disabled || isGenerating);
  const canCancel = Boolean(isGenerating && onCancel);
  const [cancelCoolingDown, setCancelCoolingDown] = React.useState(false);
  const cancelResetTimerRef = React.useRef<number | null>(null);
  const progressWidth = Math.max(10, normalizedProgress);
  const isCompact = size === 'compact';
  const buttonSizeClass = isCompact ? 'px-3 py-2 text-[12px]' : 'px-4 py-3 text-sm';
  const contentSizeClass = isCompact ? 'min-h-6 gap-1.5' : 'min-h-8 gap-2';
  const contentEndPaddingClass = canCancel ? (isCompact ? 'pr-9' : 'pr-24') : '';
  const iconSize = isCompact ? 15 : 16;
  const progressTextClass = isCompact ? 'text-[10px]' : 'text-[11px]';
  const stageClass = isCompact
    ? `bottom-1 left-2.5 text-[9px] ${canCancel ? 'right-10' : 'right-2.5'}`
    : `bottom-1.5 left-3 text-[10px] ${canCancel ? 'right-24' : 'right-3'}`;
  const cancelButtonClass = isCompact
    ? 'right-2 top-1/2 h-7 min-w-7 -translate-y-1/2 px-1.5'
    : 'right-2 top-1/2 h-8 min-w-[5.9rem] -translate-y-1/2 px-2.5';
  const showCancelHint = Boolean(canCancel && normalizedProgress < 10 && !cancelCoolingDown);
  const cancelLabel = cancelCoolingDown ? 'Canceling...' : 'Cancel';
  const cancelTitle = cancelCoolingDown ? 'Cancelling generation' : 'Cancel generation';
  const cancelAriaLabel = cancelCoolingDown ? 'Cancelling generation' : 'Cancel generation';

  React.useEffect(() => {
    if (!isGenerating) setCancelCoolingDown(false);
  }, [isGenerating]);

  React.useEffect(() => () => {
    if (cancelResetTimerRef.current !== null) {
      window.clearTimeout(cancelResetTimerRef.current);
      cancelResetTimerRef.current = null;
    }
  }, []);

  const handleCancelClick = React.useCallback(() => {
    if (!canCancel || cancelCoolingDown) return;

    setCancelCoolingDown(true);
    onCancel?.();

    if (cancelResetTimerRef.current !== null) {
      window.clearTimeout(cancelResetTimerRef.current);
    }

    cancelResetTimerRef.current = window.setTimeout(() => {
      setCancelCoolingDown(false);
      cancelResetTimerRef.current = null;
    }, 700);
  }, [canCancel, cancelCoolingDown, onCancel]);

  return (
    <div className={`relative w-full ${className}`}>
      <button
        type="button"
        onClick={onClick}
        disabled={actionDisabled}
        className={`vf-morph-generate ${isGenerating ? 'vf-morph-generate--active' : ''} ${isCompact ? 'vf-morph-generate--compact' : ''} relative inline-flex w-full items-center justify-center overflow-hidden rounded-2xl border border-indigo-300/35 font-bold text-white transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] duration-300 ${buttonSizeClass} ${
          isGenerating
            ? 'cursor-default'
            : disabled
              ? 'cursor-not-allowed opacity-70 saturate-75'
              : 'hover:translate-y-[-1px] active:translate-y-[0px]'
        }`}
      >
        <span className="vf-morph-generate__base absolute inset-0" />
        {isGenerating && (
          <span
            className="vf-morph-generate__progress absolute inset-0"
            style={{ width: `${progressWidth}%` }}
          />
        )}
        {isGenerating && <span className="vf-morph-generate__sweep absolute inset-0" />}

        <span className={`relative z-10 flex w-full items-center justify-between ${contentSizeClass} ${contentEndPaddingClass}`}>
          <span className={`inline-flex items-center ${isCompact ? 'gap-1.5' : 'gap-2'}`}>
            {isGenerating ? <Loader2 size={iconSize} className="vf-morph-generate__spinner" /> : <Play size={iconSize} fill="currentColor" />}
            <span>{isGenerating ? 'Generating Audio' : 'Generate Audio'}</span>
          </span>
          {isGenerating && !canCancel && (
            <span className={`${progressTextClass} font-semibold text-white/90 tabular-nums`}>
              {normalizedProgress}%
            </span>
          )}
        </span>

        {isGenerating && stageLabel && (
          <span className={`vf-morph-generate__stage absolute z-10 truncate font-medium text-white/80 ${stageClass}`}>
            {stageLabel}
          </span>
        )}
      </button>

      {showCancelHint && (
        <span
          className={`vf-morph-cancel-hint absolute z-20 select-none rounded-full border border-white/20 bg-slate-950/55 px-2 py-0.5 font-medium text-white/75 backdrop-blur-sm ${
            isCompact ? 'right-10 top-1/2 -translate-y-1/2 text-[9px]' : 'right-24 top-1/2 -translate-y-1/2 text-[10px]'
          }`}
        >
          Tap to cancel
        </span>
      )}

      {canCancel && (
        <button
          type="button"
          onClick={handleCancelClick}
          disabled={cancelCoolingDown}
          aria-label={cancelAriaLabel}
          title={cancelTitle}
          className={`vf-morph-cancel absolute z-20 inline-flex items-center justify-center gap-1 rounded-full border border-rose-200/45 bg-slate-950/45 text-rose-100 shadow-[0_8px_16px_rgba(2,6,23,0.42)] backdrop-blur-sm transition-[background-color,border-color,color,box-shadow,transform,opacity,filter] duration-200 hover:border-rose-200/70 hover:bg-rose-500/25 hover:text-rose-50 active:scale-95 disabled:cursor-wait disabled:opacity-90 ${cancelButtonClass}`}
        >
          {cancelCoolingDown ? <Loader2 size={isCompact ? 12 : 13} className="animate-spin" strokeWidth={2.2} /> : <X size={isCompact ? 12 : 13} strokeWidth={2.3} />}
          {!isCompact ? <span className="text-[11px] font-semibold tracking-[0.01em]">{cancelLabel}</span> : null}
        </button>
      )}
    </div>
  );
};
