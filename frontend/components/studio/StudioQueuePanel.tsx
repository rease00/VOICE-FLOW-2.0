import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical, Play, RefreshCw, Trash2, Waves } from 'lucide-react';
import type { StudioQueueState } from '../../types';

interface StudioQueuePanelProps {
  queueState: StudioQueueState | null;
  draftPartCount: number;
  planCap: number;
  queueEligible: boolean;
  isQueueModeEnabled: boolean;
  isGenerating: boolean;
  audioUrls: Record<string, string>;
  isDarkUi?: boolean;
  visualVariant?: 'default' | 'embedded';
  isPhone?: boolean;
  isOpen?: boolean;
  onToggleOpen?: () => void;
  onResumeQueue: () => void;
  onClearQueue: () => void;
  onDeleteItem: (itemId: string) => void;
  onRetryItem: (itemId: string) => void;
  onReorderItems: (sourceIndex: number, targetIndex: number) => void;
}

export const StudioQueuePanel: React.FC<StudioQueuePanelProps> = ({
  queueState,
  draftPartCount,
  planCap,
  queueEligible,
  isQueueModeEnabled,
  isGenerating,
  audioUrls,
  isDarkUi = false,
  visualVariant = 'default',
  isPhone = false,
  isOpen = true,
  onToggleOpen,
  onResumeQueue,
  onClearQueue,
  onDeleteItem,
  onRetryItem,
  onReorderItems,
}) => {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const sortedItems = useMemo(() => (
    [...(queueState?.items || [])].sort((left, right) => left.order - right.order)
  ), [queueState?.items]);

  const completedCount = sortedItems.filter((item) => item.status === 'completed').length;
  const failedCount = sortedItems.filter((item) => item.status === 'failed').length;
  const hasItems = sortedItems.length > 0;
  const summaryLabel = queueState?.masterOrder || (draftPartCount > 0
    ? Array.from({ length: draftPartCount }, (_, index) => String(index + 1)).join('+')
    : '');
  const isEmbedded = visualVariant === 'embedded';
  const panelToneClass = isDarkUi
    ? 'border-cyan-500/20 bg-slate-900/75'
    : 'border-cyan-100/70 bg-cyan-50/60';
  const headingToneClass = isDarkUi ? 'text-cyan-300' : 'text-cyan-600';
  const summaryToneClass = isDarkUi ? 'text-cyan-100/80' : 'text-cyan-700';
  const surfaceClass = isDarkUi ? 'border-slate-700 bg-slate-950/80' : 'border-cyan-200 bg-white';
  const mutedSurfaceClass = isDarkUi ? 'border-slate-700 bg-slate-950/90 text-slate-300' : 'border-cyan-200 bg-white/90 text-cyan-800';
  const queueModeBadgeClass = isQueueModeEnabled
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : (isDarkUi ? 'border-slate-700 bg-slate-950 text-slate-400' : 'border-gray-200 bg-white text-gray-500');
  const variantClass = visualVariant === 'embedded' ? '' : 'shadow-sm';

  return (
    <div className={isEmbedded ? '' : `${isPhone ? 'p-4 rounded-2xl' : 'p-5 rounded-3xl'} border ${panelToneClass}`}>
      {isPhone && !isEmbedded ? (
        <button
          type="button"
          onClick={onToggleOpen}
          className="mb-3 flex w-full items-center justify-between gap-3 text-left"
        >
          <div>
            <h3 className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${headingToneClass}`}>
              <Waves size={14} /> Queue
            </h3>
            <p className={`mt-1 text-[10px] font-semibold uppercase tracking-wide ${summaryToneClass}`}>
              {summaryLabel || (queueEligible ? `${draftPartCount || 0} parts ready` : 'Single-run mode')}
            </p>
          </div>
          {isOpen ? <ChevronUp size={16} className={headingToneClass} /> : <ChevronDown size={16} className={headingToneClass} />}
        </button>
      ) : (
        <div className={isEmbedded ? 'mb-4 flex items-center justify-between gap-3 border-b pb-3' : 'mb-3 flex items-center justify-between gap-3'}>
          <div>
            <h3 className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${headingToneClass}`}>
              <Waves size={14} /> Queue
            </h3>
            <p className={`mt-1 text-[10px] font-semibold uppercase tracking-wide ${summaryToneClass}`}>
              {summaryLabel || (queueEligible ? `${draftPartCount || 0} parts ready` : 'Single-run mode')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-md border px-2 py-1 text-[10px] font-bold ${isDarkUi ? 'border-cyan-500/30 bg-slate-950 text-cyan-200' : 'border-cyan-200 bg-white text-cyan-700'}`}>
              {hasItems ? `${completedCount}/${sortedItems.length} done` : `${planCap.toLocaleString()} cap`}
            </span>
            {failedCount > 0 && (
              <span className={`rounded-md border px-2 py-1 text-[10px] font-bold ${isDarkUi ? 'border-rose-500/30 bg-slate-950 text-rose-300' : 'border-rose-200 bg-white text-rose-600'}`}>
                {failedCount} failed
              </span>
            )}
          </div>
        </div>
      )}

      {(!isPhone || isOpen || isEmbedded) && (
        <div className={isPhone ? 'space-y-3' : 'space-y-3'}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${queueModeBadgeClass}`}>
              {isQueueModeEnabled ? 'Queue mode on' : 'Queue mode off'}
            </span>
            {hasItems && failedCount > 0 && (
              <button
                type="button"
                onClick={onResumeQueue}
                disabled={isGenerating}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide disabled:opacity-60 ${
                  isDarkUi
                    ? 'border-cyan-500/30 bg-slate-950 text-cyan-200'
                    : 'border-cyan-200 bg-white text-cyan-700'
                }`}
              >
                <RefreshCw size={11} />
                Resume Queue
              </button>
            )}
            {hasItems && (
              <button
                type="button"
                onClick={onClearQueue}
                disabled={isGenerating}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide disabled:opacity-60 ${
                  isDarkUi
                    ? 'border-rose-500/30 bg-slate-950 text-rose-300'
                    : 'border-rose-200 bg-white text-rose-600'
                }`}
              >
                <Trash2 size={11} />
                Clear
              </button>
            )}
          </div>

          {!queueEligible && !hasItems && (
            <div className={`rounded-2xl border border-dashed px-3 py-4 text-[11px] ${mutedSurfaceClass}`}>
              Queue mode is intended for scripts above the per-generation cap. Short scripts still use the normal single-run flow.
            </div>
          )}

          {queueEligible && !hasItems && (
            <div className={`rounded-2xl border border-dashed px-3 py-4 text-[11px] ${mutedSurfaceClass}`}>
              This script will split into approximately <span className="font-bold">{draftPartCount}</span> parts at the current plan cap of <span className="font-bold">{planCap.toLocaleString()}</span> chars.
            </div>
          )}

          {hasItems && (
            <div className="space-y-2">
              {sortedItems.map((item, index) => {
                const audioUrl = audioUrls[item.id];
                const isFailed = item.status === 'failed';
                const isCompleted = item.status === 'completed';
                const isRunning = item.status === 'running';

                return (
                  <div
                    key={item.id}
                    draggable={hasItems}
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (dragIndex === null || dragIndex === index) return;
                      onReorderItems(dragIndex, index);
                      setDragIndex(null);
                    }}
                    className={`rounded-2xl border p-3 shadow-sm ${
                      isRunning
                        ? (isDarkUi ? 'border-cyan-500/40 bg-slate-950' : 'border-cyan-300 bg-white')
                        : isFailed
                          ? (isDarkUi ? 'border-rose-500/30 bg-rose-950/20' : 'border-rose-200 bg-rose-50/70')
                          : (isDarkUi ? 'border-slate-700 bg-slate-950/90' : 'border-cyan-100 bg-white/90')
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2">
                        <GripVertical size={14} className={`mt-0.5 shrink-0 ${isDarkUi ? 'text-cyan-300' : 'text-cyan-500'}`} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${isDarkUi ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200' : 'border-cyan-200 bg-cyan-50 text-cyan-700'}`}>
                              {item.label}
                            </span>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                              isCompleted
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : isFailed
                                  ? 'border-rose-200 bg-rose-50 text-rose-600'
                                  : isRunning
                                    ? 'border-cyan-200 bg-cyan-50 text-cyan-700'
                                    : isDarkUi
                                      ? 'border-slate-700 bg-slate-900 text-slate-300'
                                      : 'border-gray-200 bg-gray-50 text-gray-600'
                            }`}>
                              {item.status}
                            </span>
                            <span className={`text-[10px] font-semibold ${isDarkUi ? 'text-slate-400' : 'text-gray-500'}`}>
                              {item.charCount.toLocaleString()} chars
                            </span>
                          </div>
                          <p className={`mt-2 line-clamp-2 text-[11px] ${isDarkUi ? 'text-slate-300' : 'text-gray-600'}`}>
                            {item.sourceText}
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {isFailed && (
                          <button
                            type="button"
                            onClick={() => onRetryItem(item.id)}
                            disabled={isGenerating}
                            className={`rounded-md border p-1.5 disabled:opacity-60 ${isDarkUi ? 'border-cyan-500/30 bg-slate-950 text-cyan-200' : 'border-cyan-200 bg-white text-cyan-700'}`}
                            title="Retry part"
                          >
                            <RefreshCw size={12} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onDeleteItem(item.id)}
                          disabled={isGenerating && isRunning}
                          className={`rounded-md border p-1.5 disabled:opacity-60 ${isDarkUi ? 'border-rose-500/30 bg-slate-950 text-rose-300' : 'border-rose-200 bg-white text-rose-600'}`}
                          title="Delete part"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {audioUrl && (
                      <div className={`mt-3 flex items-center gap-2 rounded-xl border px-2 py-2 ${isDarkUi ? 'border-cyan-500/20 bg-cyan-500/10' : 'border-cyan-100 bg-cyan-50/40'}`}>
                        <Play size={13} className={`shrink-0 ${isDarkUi ? 'text-cyan-200' : 'text-cyan-700'}`} />
                        <audio controls preload="none" src={audioUrl} className="h-8 w-full" />
                      </div>
                    )}

                    {item.error && (
                      <div className="mt-2 text-[10px] font-medium text-rose-600">
                        {item.error}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
