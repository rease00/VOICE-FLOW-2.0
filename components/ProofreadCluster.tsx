import React from 'react';
import { Book, BookOpenCheck, SpellCheck } from 'lucide-react';

interface ProofreadClusterProps {
  isBusy: boolean;
  onProofread: (mode: 'grammar' | 'flow' | 'novel') => void;
  novelLabel?: string;
}

export const ProofreadCluster: React.FC<ProofreadClusterProps> = ({
  isBusy,
  onProofread,
  novelLabel = 'Novel',
}) => {
  return (
    <div className="flex items-center gap-1 bg-teal-50 rounded-lg border border-teal-100 p-1">
      <button
        onClick={() => onProofread('grammar')}
        disabled={isBusy}
        className="h-8 px-2 text-[11px] font-bold text-teal-700 hover:bg-white hover:shadow-sm rounded-md transition-all flex items-center gap-1 disabled:opacity-60"
        title="Strict Grammar Check"
      >
        <SpellCheck size={14} />
        <span className="hidden md:inline">Grammar</span>
      </button>
      <div className="w-px h-4 bg-teal-200" />
      <button
        onClick={() => onProofread('flow')}
        disabled={isBusy}
        className="h-8 px-2 text-[11px] font-bold text-teal-700 hover:bg-white hover:shadow-sm rounded-md transition-all flex items-center gap-1 disabled:opacity-60"
        title="Optimize Flow & Naturalness"
      >
        <BookOpenCheck size={14} />
        <span>Flow</span>
      </button>
      <div className="w-px h-4 bg-teal-200" />
      <button
        onClick={() => onProofread('novel')}
        disabled={isBusy}
        className="h-8 px-2 text-[11px] font-bold text-teal-700 hover:bg-white hover:shadow-sm rounded-md transition-all flex items-center gap-1 disabled:opacity-60"
        title="Enhance for Audio Novel"
      >
        <Book size={14} />
        <span>{novelLabel}</span>
      </button>
    </div>
  );
};

