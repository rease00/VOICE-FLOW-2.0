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
  const progressWidth = Math.max(10, normalizedProgress);
  const isCompact = size === 'compact';
  const buttonSizeClass = isCompact ? 'px-3.5 py-2.5 text-[13px]' : 'px-4 py-3 text-sm';
  const contentSizeClass = isCompact ? 'min-h-7 gap-1.5' : 'min-h-8 gap-2';
  const contentEndPaddingClass = canCancel ? (isCompact ? 'pr-9' : 'pr-10') : '';
  const iconSize = isCompact ? 15 : 16;
  const progressTextClass = isCompact ? 'text-[10px]' : 'text-[11px]';
  const stageClass = isCompact
    ? `bottom-1 left-2.5 text-[9px] ${canCancel ? 'right-10' : 'right-2.5'}`
    : `bottom-1.5 left-3 text-[10px] ${canCancel ? 'right-12' : 'right-3'}`;
  const cancelButtonClass = isCompact ? 'right-2 top-1/2 h-7 w-7 -translate-y-1/2' : 'right-2.5 top-1/2 h-8 w-8 -translate-y-1/2';

  return (
    <div className={`relative w-full ${className}`}>
      <button
        type="button"
        onClick={onClick}
        disabled={actionDisabled}
        className={`vf-morph-generate ${isGenerating ? 'vf-morph-generate--active' : ''} ${isCompact ? 'vf-morph-generate--compact' : ''} relative inline-flex w-full items-center justify-center overflow-hidden rounded-2xl border border-indigo-300/35 font-bold text-white transition-all duration-300 ${buttonSizeClass} ${
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

      {canCancel && (
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel generation"
          title="Cancel generation"
          className={`vf-morph-cancel absolute z-20 inline-flex items-center justify-center rounded-full border border-red-300/75 bg-red-500/90 text-white shadow-lg shadow-red-900/40 transition-all duration-200 hover:bg-red-500 active:scale-95 ${cancelButtonClass}`}
        >
          <X size={isCompact ? 13 : 14} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
};
