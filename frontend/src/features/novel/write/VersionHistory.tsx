'use client';
import React, { useState } from 'react';
import { Clock, RotateCcw } from 'lucide-react';
import type { ChapterVersionSnapshot } from '../../../../types';

interface VersionHistoryProps {
  versions: ChapterVersionSnapshot[];
  onRevert: (snapshot: ChapterVersionSnapshot) => void;
}

export const VersionHistory: React.FC<VersionHistoryProps> = ({ versions, onRevert }) => {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (versions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center text-slate-400 gap-2">
        <Clock size={28} className="opacity-40" />
        <p className="text-sm">No versions saved yet.</p>
        <p className="text-xs opacity-70">Versions are saved when you adapt a chapter.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-white/10">
      {[...versions].reverse().map((snap) => (
        <div key={snap.id} className="flex flex-col gap-1 py-3 px-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-medium text-slate-200 truncate">
                {snap.label || new Date(snap.timestamp).toLocaleString()}
              </span>
              {snap.reason && (
                <span className="text-[10px] text-slate-400 truncate">{snap.reason}</span>
              )}
            </div>
            {confirmId === snap.id ? (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => {
                    onRevert(snap);
                    setConfirmId(null);
                  }}
                  className="text-[11px] px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-white transition-colors"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmId(null)}
                  className="text-[11px] px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmId(snap.id)}
                className="shrink-0 flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              >
                <RotateCcw size={10} />
                Revert
              </button>
            )}
          </div>
          {snap.sourceText && (
            <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2">
              {snap.sourceText.slice(0, 120)}…
            </p>
          )}
        </div>
      ))}
    </div>
  );
};
