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
    <div className="vf-proofread-cluster">
      <button
        onClick={() => onProofread('grammar')}
        disabled={isBusy}
        className="vf-proofread-action"
        title="Strict Grammar Check"
      >
        <SpellCheck size={14} />
        <span className="hidden md:inline">Grammar</span>
      </button>
      <div className="vf-proofread-divider" />
      <button
        onClick={() => onProofread('flow')}
        disabled={isBusy}
        className="vf-proofread-action"
        title="Optimize Flow & Naturalness"
      >
        <BookOpenCheck size={14} />
        <span>Flow</span>
      </button>
      <div className="vf-proofread-divider" />
      <button
        onClick={() => onProofread('novel')}
        disabled={isBusy}
        className="vf-proofread-action"
        title="Enhance for Audio Novel"
      >
        <Book size={14} />
        <span>{novelLabel}</span>
      </button>
    </div>
  );
};

