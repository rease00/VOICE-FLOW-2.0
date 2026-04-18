'use client';
import React, { useState, useCallback, useRef } from 'react';
import { Plus, BookOpen, ChevronRight, GripVertical, Copy, Split, Merge, MoreHorizontal } from 'lucide-react';
import type { LocalNovelChapter } from '../contexts/NovelEditorContext';
import { useNovelEditor } from '../contexts/NovelEditorContext';

type AdaptationStatus = LocalNovelChapter['adaptationStatus'];
type ChapterWritingStatus = 'draft' | 'revised' | 'final' | 'adapted';

const wordCount = (text: string) => text.trim() ? text.trim().split(/\s+/).length : 0;

const adaptationBadge = (status: AdaptationStatus | undefined) => {
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

const writingStatusBadge = (chapter: LocalNovelChapter) => {
  if (chapter.adaptationStatus === 'done') return { label: 'Adapted', className: 'text-emerald-400' };
  if (!chapter.text?.trim()) return { label: 'Empty', className: 'text-slate-600' };
  if (chapter.adaptedText?.trim()) return { label: 'Revised', className: 'text-blue-400' };
  return { label: 'Draft', className: 'text-amber-400' };
};

const WRITING_STATUS_DOT: Record<string, string> = {
  Empty: 'bg-slate-600',
  Draft: 'bg-amber-400',
  Revised: 'bg-blue-400',
  Adapted: 'bg-emerald-400',
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
    reorderChapters,
    duplicateChapter,
  } = useNovelEditor();

  const [newTitle, setNewTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ chapterId: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [draggedChapterId, setDraggedChapterId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const dragCounterRef = useRef(0);

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

  const handleDragStart = (e: React.DragEvent, chapterId: string) => {
    setDraggedChapterId(chapterId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', chapterId);
  };

  const handleDragOver = (e: React.DragEvent, chapterId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetId(chapterId);
  };

  const handleDragLeave = () => {
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      setDropTargetId(null);
      dragCounterRef.current = 0;
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current += 1;
  };

  const handleDrop = (e: React.DragEvent, targetChapterId: string) => {
    e.preventDefault();
    setDropTargetId(null);
    dragCounterRef.current = 0;

    if (draggedChapterId && draggedChapterId !== targetChapterId && reorderChapters) {
      reorderChapters(selectedProjectId, draggedChapterId, targetChapterId);
    }
    setDraggedChapterId(null);
  };

  const handleDragEnd = () => {
    setDraggedChapterId(null);
    setDropTargetId(null);
    dragCounterRef.current = 0;
  };

  const handleDuplicate = (chapterId: string) => {
    if (duplicateChapter) {
      duplicateChapter(selectedProjectId, chapterId);
    }
    closeContextMenu();
  };

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
        <div className="flex items-center justify-between mt-0.5">
          <p className="text-[10px] text-slate-500">{chapters.length} chapter{chapters.length !== 1 ? 's' : ''}</p>
          <p className="text-[10px] text-slate-600">
            {chapters.reduce((sum, c) => sum + wordCount(c.text), 0).toLocaleString()} total words
          </p>
        </div>
      </div>

      {/* Chapter list */}
      <div className="flex-1 overflow-y-auto min-h-0 py-1">
        {chapters.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-6">No chapters yet</p>
        ) : (
          chapters.map((ch) => {
            const wc = wordCount(ch.text);
            const ws = writingStatusBadge(ch);
            const isDragOver = dropTargetId === ch.id;
            const isDragging = draggedChapterId === ch.id;
            const isSelected = ch.id === selectedChapterId;

            return (
              <div
                key={ch.id}
                draggable
                onDragStart={(e) => handleDragStart(e, ch.id)}
                onDragOver={(e) => handleDragOver(e, ch.id)}
                onDragLeave={handleDragLeave}
                onDragEnter={handleDragEnter}
                onDrop={(e) => handleDrop(e, ch.id)}
                onDragEnd={handleDragEnd}
                className={`group relative flex items-center gap-1 px-1 transition-all ${
                  isDragOver ? 'border-t-2 border-t-blue-500' : ''
                } ${isDragging ? 'opacity-30' : ''}`}
              >
                {/* Drag handle */}
                <div className="shrink-0 cursor-grab active:cursor-grabbing p-0.5 opacity-0 group-hover:opacity-40 hover:!opacity-80 transition-opacity">
                  <GripVertical size={10} className="text-slate-500" />
                </div>

                <button
                  onClick={() => selectChapter(ch.id)}
                  onContextMenu={(e) => handleContextMenu(e, ch.id)}
                  className={`flex-1 flex items-center gap-2 px-2 py-2.5 text-left rounded-lg transition-colors ${
                    isSelected
                      ? 'bg-blue-600/20 border border-blue-500/30'
                      : 'hover:bg-white/5 border border-transparent'
                  }`}
                >
                  {/* Status dot */}
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${WRITING_STATUS_DOT[ws.label]}`} title={ws.label} />

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
                      <span className={`text-xs truncate block ${isSelected ? 'text-white font-medium' : 'text-slate-300'}`}>
                        {ch.title}
                      </span>
                    )}
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {wc > 0 && (
                        <span className="text-[9px] text-slate-600">{wc.toLocaleString()} words</span>
                      )}
                      {adaptationBadge(ch.adaptationStatus)}
                    </div>
                  </div>

                  {isSelected && <ChevronRight size={10} className="text-blue-400 shrink-0" />}
                </button>
              </div>
            );
          })
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
          className="fixed z-50 bg-slate-800 border border-white/10 rounded-lg shadow-xl py-1 min-w-[160px] text-sm"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {onSendToStudio && (
            <button
              onClick={() => { onSendToStudio(contextMenu.chapterId); closeContextMenu(); }}
              className="w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition-colors flex items-center gap-2"
            >
              <ChevronRight size={10} /> Send to Studio
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
            onClick={() => handleDuplicate(contextMenu.chapterId)}
            className="w-full text-left px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10 transition-colors flex items-center gap-2"
          >
            <Copy size={10} /> Duplicate
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
