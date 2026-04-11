'use client';
import React, { useState } from 'react';
import { BookOpen, Plus, Clock, AlignLeft, ChevronRight, Trash2 } from 'lucide-react';
import { useNovelEditor } from '../contexts/NovelEditorContext';

interface ProjectListPageProps {
  onOpenProject: (projectId: string) => void;
}

const formatRelativeTime = (iso: string | undefined): string => {
  if (!iso) return 'Unknown';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

const adaptedPercent = (chapters: { adaptationStatus?: string }[]): number => {
  if (chapters.length === 0) return 0;
  const done = chapters.filter((c) => c.adaptationStatus === 'done').length;
  return Math.round((done / chapters.length) * 100);
};

export const ProjectListPage: React.FC<ProjectListPageProps> = ({ onOpenProject }) => {
  const { projects, chaptersByProjectId, createProject, deleteProject } = useNovelEditor();
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleCreate = () => {
    const name = newName.trim() || 'Untitled Novel';
    const id = createProject(name);
    setNewName('');
    setIsCreating(false);
    onOpenProject(id);
  };

  const sortedProjects = [...projects].sort((a, b) => {
    const aTime = new Date(a.modifiedTime || a.createdTime || 0).getTime();
    const bTime = new Date(b.modifiedTime || b.createdTime || 0).getTime();
    return bTime - aTime;
  });

  return (
    <div className="flex flex-col min-h-full p-4 sm:p-6 max-w-4xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">My Novels</h1>
          <p className="text-sm text-slate-400 mt-0.5">{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-xl transition-colors"
        >
          <Plus size={14} />
          New Novel
        </button>
      </div>

      {/* Create form */}
      {isCreating && (
        <div className="mb-6 p-4 bg-slate-800/60 border border-white/10 rounded-2xl flex items-center gap-3">
          <BookOpen size={16} className="text-blue-400 shrink-0" />
          <input
            autoFocus
            placeholder="Novel title"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') setIsCreating(false);
            }}
            className="flex-1 bg-transparent text-white placeholder-slate-500 focus:outline-none text-sm"
          />
          <button
            onClick={handleCreate}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            Create
          </button>
          <button
            onClick={() => setIsCreating(false)}
            className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Empty state */}
      {sortedProjects.length === 0 && !isCreating && (
        <div className="flex-1 flex flex-col items-center justify-center py-20 text-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-slate-800/60 border border-white/10 flex items-center justify-center">
            <BookOpen size={28} className="text-slate-500" />
          </div>
          <div>
            <p className="text-slate-300 font-medium">Start your first novel</p>
            <p className="text-sm text-slate-500 mt-1">Create a project to begin writing and adapting</p>
          </div>
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-xl transition-colors"
          >
            <Plus size={14} />
            Create Novel
          </button>
        </div>
      )}

      {/* Projects grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedProjects.map((project) => {
          const projectChapters = chaptersByProjectId[project.id] || [];
          const pct = adaptedPercent(projectChapters);
          const wordCount = projectChapters.reduce((sum, c) => {
            const words = c.text?.trim() ? c.text.trim().split(/\s+/).length : 0;
            return sum + words;
          }, 0);

          return (
            <div
              key={project.id}
              className="group relative flex flex-col gap-3 p-4 bg-slate-800/50 hover:bg-slate-800/80 border border-white/10 rounded-2xl transition-colors cursor-pointer"
              onClick={() => onOpenProject(project.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center shrink-0">
                    <BookOpen size={14} className="text-blue-400" />
                  </div>
                  <span className="text-sm font-semibold text-white truncate">{project.name}</span>
                </div>
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0"
                >
                  {confirmDeleteId === project.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => { deleteProject(project.id); setConfirmDeleteId(null); }}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-red-600 text-white"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-200"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(project.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-all"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span className="flex items-center gap-1"><AlignLeft size={10} /> {projectChapters.length} chapter{projectChapters.length !== 1 ? 's' : ''}</span>
                  <span className="flex items-center gap-1"><Clock size={10} /> {formatRelativeTime(project.modifiedTime)}</span>
                </div>
                {wordCount > 0 && (
                  <span className="text-[11px] text-slate-500">{wordCount.toLocaleString()} words</span>
                )}
              </div>

              {/* Adaptation progress bar */}
              {projectChapters.length > 0 && (
                <div>
                  <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-violet-600 to-blue-500 transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">{pct}% adapted</p>
                </div>
              )}

              <ChevronRight
                size={14}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 group-hover:text-slate-400 opacity-0 group-hover:opacity-100 transition-all"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
