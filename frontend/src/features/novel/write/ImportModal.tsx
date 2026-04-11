'use client';
import React from 'react';
import { X, FileText, AlertCircle, ChevronRight, Loader2 } from 'lucide-react';
import { UploadDropzone } from '../../../../components/ui/UploadDropzone';
import { useImportFlow, type EditableImportChapter } from '../hooks/useImportFlow';
import type { GenerationSettings } from '../../../../types';

interface ImportModalProps {
  mediaBackendUrl: string;
  onToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  triggerRef?: React.RefObject<HTMLButtonElement>;
}

const ChapterPreviewCard: React.FC<{
  chapter: EditableImportChapter;
  onToggle: (id: string) => void;
  onTitleChange: (id: string, title: string) => void;
}> = ({ chapter, onToggle, onTitleChange }) => (
  <div
    className={`rounded-lg border transition-colors ${
      chapter.selected ? 'border-blue-500/50 bg-blue-500/5' : 'border-white/10 bg-slate-900/50 opacity-60'
    }`}
  >
    <div className="flex items-start gap-2 p-3">
      <input
        type="checkbox"
        checked={chapter.selected}
        onChange={() => onToggle(chapter.id)}
        className="mt-0.5 accent-blue-500 cursor-pointer"
        aria-label={`Include chapter: ${chapter.title}`}
      />
      <div className="flex-1 min-w-0">
        <input
          value={chapter.title}
          onChange={(e) => onTitleChange(chapter.id, e.target.value)}
          className="w-full bg-transparent text-sm font-medium text-slate-100 focus:outline-none border-b border-transparent focus:border-blue-500 pb-0.5"
          placeholder="Chapter title"
        />
        <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">
          {chapter.text.slice(0, 200)}
          {chapter.text.length > 200 ? '…' : ''}
        </p>
        <p className="text-[10px] text-slate-600 mt-1">{chapter.text.length.toLocaleString()} chars</p>
      </div>
    </div>
  </div>
);

export const ImportModal: React.FC<ImportModalProps> = ({ mediaBackendUrl, onToast }) => {
  const {
    isImportModalOpen,
    importFiles,
    isExtracting,
    isSplitting,
    isApplying,
    extractDiagnostics,
    splitWarnings,
    editableChapters,
    importStep,
    openImportModal,
    closeImportModal,
    addFiles,
    removeFile,
    extractAndSplit,
    updateEditableChapter,
    toggleSelectAll,
    applyImport,
    setImportStep,
  } = useImportFlow(mediaBackendUrl, onToast);

  if (!isImportModalOpen) {
    return (
      <button
        onClick={openImportModal}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 transition-colors"
      >
        <FileText size={12} />
        Import
      </button>
    );
  }

  const isBusy = isExtracting || isSplitting || isApplying;
  const selectedCount = editableChapters.filter((c) => c.selected).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) closeImportModal(); }}
    >
      <div
        className="w-full max-w-lg bg-slate-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-white">Import Novel</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {importStep === 'files' ? 'Select files to import' : `${editableChapters.length} chapters detected`}
            </p>
          </div>
          <button
            onClick={closeImportModal}
            disabled={isBusy}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0 p-5">
          {importStep === 'files' ? (
            <div className="space-y-4">
              <UploadDropzone
                accept=".txt,.pdf,.epub,.docx,.md"
                multiple
                files={importFiles}
                label="Drop novel files here"
                hint="Supported: TXT, PDF, EPUB, DOCX, MD"
                onFilesSelected={addFiles}
              />
              {importFiles.length > 0 && (
                <div className="space-y-1.5">
                  {importFiles.map((f) => (
                    <div key={f.name} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/60 border border-white/10">
                      <FileText size={12} className="shrink-0 text-slate-400" />
                      <span className="flex-1 text-xs text-slate-200 truncate">{f.name}</span>
                      <span className="text-[10px] text-slate-500">{(f.size / 1024).toFixed(1)} KB</span>
                      <button
                        onClick={() => removeFile(f.name)}
                        className="text-slate-500 hover:text-red-400 transition-colors"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {extractDiagnostics?.warnings && extractDiagnostics.warnings.length > 0 && (
                <div className="flex gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                  <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-300 space-y-0.5">
                    {extractDiagnostics.warnings.map((w, i) => <p key={i}>{w}</p>)}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {splitWarnings.length > 0 && (
                <div className="flex gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                  <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-300 space-y-0.5">
                    {splitWarnings.map((w, i) => <p key={i}>{w}</p>)}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => toggleSelectAll(true)}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Select all
                </button>
                <button
                  onClick={() => toggleSelectAll(false)}
                  className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Deselect all
                </button>
              </div>
              <div className="space-y-2">
                {editableChapters.map((ch) => (
                  <ChapterPreviewCard
                    key={ch.id}
                    chapter={ch}
                    onToggle={(id) => updateEditableChapter(id, { selected: !ch.selected })}
                    onTitleChange={(id, title) => updateEditableChapter(id, { title, titleEdited: true })}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="shrink-0 flex items-center justify-between gap-2 px-5 py-4 border-t border-white/10">
          {importStep === 'confirm' ? (
            <button
              onClick={() => setImportStep('files')}
              className="text-xs text-slate-400 hover:text-white transition-colors"
            >
              ← Back
            </button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <button
              onClick={closeImportModal}
              disabled={isBusy}
              className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40 transition-colors"
            >
              Cancel
            </button>
            {importStep === 'files' ? (
              <button
                onClick={extractAndSplit}
                disabled={isBusy || importFiles.length === 0}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
              >
                {isBusy ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <ChevronRight size={12} />
                )}
                {isExtracting ? 'Extracting…' : isSplitting ? 'Splitting…' : 'Extract & Split'}
              </button>
            ) : (
              <button
                onClick={applyImport}
                disabled={isApplying || selectedCount === 0}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
              >
                {isApplying ? <Loader2 size={12} className="animate-spin" /> : null}
                {isApplying ? 'Importing…' : `Import ${selectedCount} Chapter${selectedCount !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
