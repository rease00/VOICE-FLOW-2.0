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
}) => {
  const normalizedProgress = clamp(progress);
  const stageLabel = String(stage || '').trim();
  const actionDisabled = Boolean(disabled || isGenerating);
  const canCancel = Boolean(isGenerating && onCancel);
  const progressWidth = Math.max(10, normalizedProgress);

  return (
    <div className={`relative w-full ${className}`}>
      <button
        type="button"
        onClick={onClick}
        disabled={actionDisabled}
        className={`vf-morph-generate ${isGenerating ? 'vf-morph-generate--active' : ''} relative inline-flex w-full items-center justify-center overflow-hidden rounded-2xl border border-indigo-300/35 px-4 py-3 text-sm font-bold text-white transition-all duration-300 ${
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

        <span className={`relative z-10 flex min-h-8 w-full items-center justify-between gap-2 ${canCancel ? 'pr-10' : ''}`}>
          <span className="inline-flex items-center gap-2">
            {isGenerating ? <Loader2 size={16} className="vf-morph-generate__spinner" /> : <Play size={16} fill="currentColor" />}
            <span>{isGenerating ? 'Generating Audio' : 'Generate Audio'}</span>
          </span>
          {isGenerating && !canCancel && (
            <span className="text-[11px] font-semibold text-white/90 tabular-nums">
              {normalizedProgress}%
            </span>
          )}
        </span>

        {isGenerating && stageLabel && (
          <span className={`vf-morph-generate__stage absolute bottom-1.5 left-3 z-10 truncate text-[10px] font-medium text-white/80 ${canCancel ? 'right-12' : 'right-3'}`}>
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
          className="vf-morph-cancel absolute right-2.5 top-1/2 z-20 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-300/75 bg-red-500/90 text-white shadow-lg shadow-red-900/40 transition-all duration-200 hover:bg-red-500 active:scale-95"
        >
          <X size={14} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
};
