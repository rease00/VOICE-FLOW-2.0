'use client';
import React, { useState } from 'react';
import { Plus, BookOpen, ChevronRight, Loader2 } from 'lucide-react';
import type { LocalNovelChapter } from '../contexts/NovelEditorContext';
import { useNovelEditor } from '../contexts/NovelEditorContext';

type AdaptationStatus = LocalNovelChapter['adaptationStatus'];

const statusBadge = (status: AdaptationStatus | undefined) => {
  if (!status || status === 'idle') return null;
  const map: Record<string, { label: string; className: string }> = {
    done: { label: 'Adapted', className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
    running: { label: 'Running', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    queued: { label: 'Queued', className: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
    failed: { label: 'Failed', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
  };
  const info = map[status];
  if (!info) return null;
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded border ${info.className}`}>
      {info.label}
    </span>
  );
};

interface ChapterSidebarProps {
  onSendToStudio?: ((chapterId: string) => void) | undefined;
}

export const ChapterSidebar: React.FC<ChapterSidebarProps> = ({ onSendToStudio }) => {
  const {
    selectedProject,
    chapters,
    selectedChapterId,
    selectedProjectId,
    selectChapter,
    createChapterLocal,
    deleteChapterLocal,
  } = useNovelEditor();

  const [newTitle, setNewTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ chapterId: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleCreate = () => {
    const title = newTitle.trim() || `Chapter ${chapters.length + 1}`;
    createChapterLocal(selectedProjectId, title);
    setNewTitle('');
    setIsCreating(false);
  };

  const handleContextMenu = (e: React.MouseEvent, chapterId: string) => {
    e.preventDefault();
    setContextMenu({ chapterId, x: e.clientX, y: e.clientY });
  };

  const closeContextMenu = () => setContextMenu(null);

  if (!selectedProject) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-10 text-slate-500 gap-2">
        <BookOpen size={24} className="opacity-30" />
        <p className="text-xs">No project selected</p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full bg-slate-900/60 border-r border-white/10"
      onClick={closeContextMenu}
    >
      {/* Header */}
      <div className="px-3 py-3 border-b border-white/10 shrink-0">
        <p className="text-xs font-semibold text-slate-200 truncate" title={selectedProject.name}>
          {selectedProject.name}
        </p>
        <p className="text-[10px] text-slate-500 mt-0.5">{chapters.length} chapter{chapters.length !== 1 ? 's' : ''}</p>
      </div>

      {/* Chapter list */}
      <div className="flex-1 overflow-y-auto min-h-0 py-1">
        {chapters.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-6">No chapters yet</p>
        ) : (
          chapters.map((ch) => (
            <button
              key={ch.id}
              onClick={() => selectChapter(ch.id)}
              onContextMenu={(e) => handleContextMenu(e, ch.id)}
              className={`w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-white/5 transition-colors border-b border-white/5 last:border-0 ${
                ch.id === selectedChapterId ? 'bg-blue-600/20 border-l-2 border-l-blue-500' : 'border-l-2 border-l-transparent'
              }`}
            >
              <span className="text-[10px] text-slate-500 font-mono shrink-0 w-5 text-right">{ch.index}</span>
              <div className="flex-1 min-w-0">
                {renamingId === ch.id ? (
                  <input
                    autoFocus
                    className="w-full bg-slate-700 rounded px-1 py-0.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => setRenamingId(null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setRenamingId(null);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className={`text-xs truncate block ${ch.id === selectedChapterId ? 'text-white font-medium' : 'text-slate-300'}`}>
                    {ch.title}
                  </span>
                )}
                {statusBadge(ch.adaptationStatus)}
              </div>
              {ch.id === selectedChapterId && <ChevronRight size={10} className="text-blue-400 shrink-0" />}
            </button>
          ))
        )}
      </div>

      {/* Add chapter */}
      <div className="shrink-0 border-t border-white/10 p-2">
        {isCreating ? (
          <div className="flex gap-1.5">
            <input
              autoFocus
              placeholder="Chapter title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') setIsCreating(false);
              }}
              className="flex-1 min-w-0 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <button onClick={handleCreate} className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors">
              Add
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsCreating(true)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-white/5 rounded transition-colors"
          >
            <Plus size={12} />
            Add Chapter
          </button>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-slate-800 border border-white/10 rounded-lg shadow-xl py-1 min-w-[140px] text-sm"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {onSendToStudio && (
            <button
              onClick={() => { onSendToStudio(contextMenu.chapterId); closeContextMenu(); }}
              className="w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition-colors"
            >
              Send to Studio
            </button>
          )}
          <button
            onClick={() => {
              const ch = chapters.find((c) => c.id === contextMenu.chapterId);
              if (ch) { setRenamingId(ch.id); setRenameValue(ch.title); }
              closeContextMenu();
            }}
            className="w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition-colors"
          >
            Rename
          </button>
          <button
            onClick={() => {
              deleteChapterLocal(selectedProjectId, contextMenu.chapterId);
              closeContextMenu();
            }}
            className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
};
