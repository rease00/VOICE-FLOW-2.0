import React from 'react';
import { Loader2, Play } from 'lucide-react';

interface MorphingGenerateButtonProps {
  onClick: () => void;
  disabled?: boolean;
  isGenerating: boolean;
  progress?: number;
  stage?: string;
  className?: string;
}

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

export const MorphingGenerateButton: React.FC<MorphingGenerateButtonProps> = ({
  onClick,
  disabled = false,
  isGenerating,
  progress = 0,
  stage = '',
  className = '',
}) => {
  const normalizedProgress = clamp(progress);
  const stageLabel = String(stage || '').trim();
  const actionDisabled = Boolean(disabled || isGenerating);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={actionDisabled}
      className={`vf-morph-generate relative inline-flex w-full items-center justify-center overflow-hidden rounded-2xl border border-indigo-300/35 px-4 py-3 text-sm font-bold text-white transition-all duration-300 ${className} ${
        actionDisabled ? 'cursor-not-allowed opacity-75' : 'hover:translate-y-[-1px] active:translate-y-[0px]'
      }`}
    >
      <span className="vf-morph-generate__base absolute inset-0" />
      {isGenerating && (
        <span
          className="vf-morph-generate__progress absolute inset-0"
          style={{ width: `${Math.max(8, normalizedProgress)}%` }}
        />
      )}
      {isGenerating && <span className="vf-morph-generate__sweep absolute inset-0" />}

      <span className="relative z-10 flex min-h-8 w-full items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2">
          {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} fill="currentColor" />}
          <span>{isGenerating ? 'Generating Audio' : 'Generate Audio'}</span>
        </span>
        {isGenerating && (
          <span className="text-[11px] font-semibold text-white/90">
            {normalizedProgress}%
          </span>
        )}
      </span>

      {isGenerating && stageLabel && (
        <span className="absolute bottom-1.5 left-3 right-3 z-10 truncate text-[10px] font-medium text-white/80">
          {stageLabel}
        </span>
      )}
    </button>
  );
};

