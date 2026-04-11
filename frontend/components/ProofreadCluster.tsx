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
  novelLabel = 'AI Audio Novel',
}) => {
  return (
    <div className="vf-proofread-cluster flex items-center p-1 gap-0.5 bg-slate-900/40 backdrop-blur-xl border border-white/10 rounded-full shadow-lg">
      <button
        onClick={() => onProofread('grammar')}
        disabled={isBusy}
        className="vf-proofread-action group relative inline-flex items-center justify-center gap-2 px-2.5 py-1.5 sm:px-3 sm:py-1.5 rounded-full bg-transparent hover:bg-white/10 text-slate-300 hover:text-white transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
        title="Strict Grammar Check"
      >
        <SpellCheck size={14} className="group-hover:text-amber-400 transition-colors" />
        <span className="text-[11px] font-medium hidden sm:inline tracking-wide">Grammar</span>
      </button>
      
      <div className="w-px h-3.5 bg-white/10 hidden sm:block mx-0.5"></div>
      
      <button
        onClick={() => onProofread('flow')}
        disabled={isBusy}
        className="vf-proofread-action group relative inline-flex items-center justify-center gap-2 px-2.5 py-1.5 sm:px-3 sm:py-1.5 rounded-full bg-transparent hover:bg-white/10 text-slate-300 hover:text-white transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
        title="Optimize Flow & Naturalness"
      >
        <BookOpenCheck size={14} className="group-hover:text-blue-400 transition-colors" />
        <span className="text-[11px] font-medium hidden sm:inline tracking-wide">Flow</span>
      </button>

      <div className="w-px h-3.5 bg-white/10 hidden sm:block mx-0.5"></div>
      
      <button
        onClick={() => onProofread('novel')}
        disabled={isBusy}
        className="vf-proofread-action group relative inline-flex items-center justify-center gap-2 px-2.5 py-1.5 sm:px-3 sm:py-1.5 rounded-full bg-transparent hover:bg-white/10 text-slate-300 hover:text-white transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
        title="Enhance for AI Audio Novel"
      >
        <Book size={14} className="group-hover:text-purple-400 transition-colors" />
        <span className="text-[11px] font-medium hidden sm:inline tracking-wide">{novelLabel}</span>
      </button>
    </div>
  );
};
