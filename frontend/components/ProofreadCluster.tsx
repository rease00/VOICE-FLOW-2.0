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
    <div className="vf-proofread-cluster">
      <button
        onClick={() => onProofread('grammar')}
        disabled={isBusy}
        className="vf-proofread-action"
        title="Strict Grammar Check"
      >
        <SpellCheck size={12} />
        <span>Grammar</span>
      </button>
      <button
        onClick={() => onProofread('flow')}
        disabled={isBusy}
        className="vf-proofread-action"
        title="Optimize Flow & Naturalness"
      >
        <BookOpenCheck size={12} />
        <span>Flow</span>
      </button>
      <button
        onClick={() => onProofread('novel')}
        disabled={isBusy}
        className="vf-proofread-action"
        title="Enhance for AI Audio Novel"
      >
        <Book size={12} />
        <span>{novelLabel}</span>
      </button>
    </div>
  );
};

