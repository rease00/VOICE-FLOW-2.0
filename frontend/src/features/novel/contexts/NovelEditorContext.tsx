import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  NovelProject,
  NovelChapter,
  ProjectMemoryLedger,
  ChapterAdaptationState,
  ChapterMemorySummary,
  ChapterVersionSnapshot,
  ChapterAdaptationStatus,
} from '../../../../types';
import {
  persistNovelWorkspaceMeta,
  readNovelWorkspaceMeta,
  readNovelWorkspaceSnapshot,
  writeNovelWorkspaceSnapshot,
} from '../services/localSnapshotStorage';

// ─── Local Types ───────────────────────────────────────────────────────────────

export interface LocalNovelChapter extends NovelChapter {
  text: string;
  adaptedText?: string;
  adaptationStatus?: ChapterAdaptationStatus;
  adaptationError?: string;
  lastAdaptedAt?: string;
}

export type ChaptersByProjectId = Record<string, LocalNovelChapter[]>;
export type MemoryLedgerByProjectId = Record<string, ProjectMemoryLedger>;
export type AdaptationStateByProjectId = Record<string, ChapterAdaptationState[]>;
export type ChapterSummariesByProjectId = Record<string, ChapterMemorySummary[]>;
export type ChapterVersionsByProjectId = Record<string, Record<string, ChapterVersionSnapshot[]>>;

interface LocalNovelWorkspaceSnapshot {
  version: number;
  projects: NovelProject[];
  chaptersByProjectId: ChaptersByProjectId;
  selectedProjectId: string;
  selectedChapterId: string;
  memoryLedgerByProjectId: MemoryLedgerByProjectId;
  adaptationStateByProjectId: AdaptationStateByProjectId;
  chapterSummariesByProjectId: ChapterSummariesByProjectId;
  chapterVersionsByProjectId: ChapterVersionsByProjectId;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const LOCAL_NOVEL_STORAGE_KEYS = [
  'vf_novel_workspace_v3',
  'vf_novel_workspace_v2',
  'vf_novel_workspace_v1',
  'vf_novel_workspace',
];

const chapterSort = (a: NovelChapter, b: NovelChapter): number =>
  a.index - b.index || a.name.localeCompare(b.name);

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const sanitizeLabel = (value: string, fallback: string): string => {
  const cleaned = collapseWhitespace(String(value || '').replace(/[\\/:*?"<>|]/g, ''));
  return cleaned.slice(0, 120) || fallback;
};

export const createLocalId = (prefix: 'project' | 'chapter' | 'memory' | 'import'): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const buildChapterName = (index: number, title: string): string =>
  `Chapter ${String(index).padStart(3, '0')} - ${title}`;

export const emptyLedger = (): ProjectMemoryLedger => ({ characters: [], places: [], chapterSummaries: [] });

const buildUniqueProjectName = (existing: NovelProject[], baseName: string): string => {
  const normalized = sanitizeLabel(baseName, 'Imported Novel');
  const used = new Set(existing.map((p) => p.name.toLowerCase()));
  if (!used.has(normalized.toLowerCase())) return normalized;
  let suffix = 2;
  while (used.has(`${normalized} (${suffix})`.toLowerCase())) suffix += 1;
  return `${normalized} (${suffix})`;
};

const parseLocalSnapshot = (raw: string | null): LocalNovelWorkspaceSnapshot | null => {
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    if (!payload || typeof payload !== 'object') return null;
    const rawProjects = Array.isArray(payload.projects) ? payload.projects : [];
    const projects: NovelProject[] = [];
    const chaptersByProjectId: ChaptersByProjectId = {};
    const memoryLedgerByProjectId: MemoryLedgerByProjectId = {};
    const adaptationStateByProjectId: AdaptationStateByProjectId = {};
    const chapterSummariesByProjectId: ChapterSummariesByProjectId = {};
    const chapterVersionsByProjectId: ChapterVersionsByProjectId = {};

    rawProjects.forEach((rawProject: Record<string, unknown>) => {
      const nowIso = new Date().toISOString();
      const projectId = typeof rawProject?.id === 'string' && rawProject.id ? rawProject.id : createLocalId('project');
      const createdTime = typeof rawProject?.createdTime === 'string' ? rawProject.createdTime : nowIso;
      const modifiedTime = typeof rawProject?.modifiedTime === 'string' ? rawProject.modifiedTime : createdTime;
      projects.push({
        id: projectId,
        name: sanitizeLabel(rawProject?.name as string, 'Untitled Novel'),
        rootFolderId: typeof rawProject?.rootFolderId === 'string' && rawProject.rootFolderId ? rawProject.rootFolderId : 'local',
        createdTime,
        modifiedTime,
      });

      const chaptersPayload = payload as Record<string, Record<string, unknown[]>>;
      const sourceChapters = (Array.isArray(chaptersPayload?.chaptersByProjectId?.[projectId])
        ? chaptersPayload.chaptersByProjectId[projectId]
        : (rawProject as Record<string, unknown>)?.chapters) || [];
      chaptersByProjectId[projectId] = (Array.isArray(sourceChapters) ? sourceChapters : []).map((rawChapter: Record<string, unknown>, ci: number) => {
        const parsedIndex = Number(rawChapter?.index);
        const index = Number.isFinite(parsedIndex) && parsedIndex > 0 ? parsedIndex : ci + 1;
        const title = sanitizeLabel(rawChapter?.title as string || rawChapter?.name as string || `Chapter ${index}`, `Chapter ${index}`);
        return {
          id: typeof rawChapter?.id === 'string' && rawChapter.id ? rawChapter.id : createLocalId('chapter'),
          projectId,
          title,
          name: sanitizeLabel(rawChapter?.name as string || buildChapterName(index, title), buildChapterName(index, title)),
          index,
          text: typeof rawChapter?.text === 'string' ? rawChapter.text : '',
          adaptedText: typeof rawChapter?.adaptedText === 'string' ? rawChapter.adaptedText : '',
          adaptationStatus: (['queued', 'running', 'done', 'failed'] as string[]).includes(rawChapter?.adaptationStatus as string) ? rawChapter.adaptationStatus as ChapterAdaptationStatus : 'idle',
          adaptationError: typeof rawChapter?.adaptationError === 'string' ? rawChapter.adaptationError : '',
          lastAdaptedAt: typeof rawChapter?.lastAdaptedAt === 'string' ? rawChapter.lastAdaptedAt : undefined,
          createdTime: typeof rawChapter?.createdTime === 'string' ? rawChapter.createdTime : createdTime,
          modifiedTime: typeof rawChapter?.modifiedTime === 'string' ? rawChapter.modifiedTime : modifiedTime,
        } as LocalNovelChapter;
      }).sort(chapterSort);

      const ledgerPayload = payload as Record<string, Record<string, Record<string, unknown[]>>>;
      memoryLedgerByProjectId[projectId] = {
        characters: Array.isArray(ledgerPayload?.memoryLedgerByProjectId?.[projectId]?.characters)
          ? ledgerPayload.memoryLedgerByProjectId[projectId].characters as unknown as import('../../../../types').MemoryEntry[]
          : [],
        places: Array.isArray(ledgerPayload?.memoryLedgerByProjectId?.[projectId]?.places)
          ? ledgerPayload.memoryLedgerByProjectId[projectId].places as unknown as import('../../../../types').MemoryEntry[]
          : [],
        chapterSummaries: Array.isArray((chaptersPayload?.chapterSummariesByProjectId as Record<string, unknown[]>)?.[projectId])
          ? (chaptersPayload.chapterSummariesByProjectId as Record<string, unknown[]>)[projectId] as unknown as ChapterMemorySummary[]
          : [],
      };
      adaptationStateByProjectId[projectId] = Array.isArray((chaptersPayload?.adaptationStateByProjectId as Record<string, unknown[]>)?.[projectId])
        ? (chaptersPayload.adaptationStateByProjectId as Record<string, unknown[]>)[projectId] as unknown as ChapterAdaptationState[]
        : [];
      chapterSummariesByProjectId[projectId] = Array.isArray((chaptersPayload?.chapterSummariesByProjectId as Record<string, unknown[]>)?.[projectId])
        ? (chaptersPayload.chapterSummariesByProjectId as Record<string, unknown[]>)[projectId] as unknown as ChapterMemorySummary[]
        : [];

      const rawVersionsByChapter = (payload as Record<string, Record<string, Record<string, unknown[]>>>)?.chapterVersionsByProjectId?.[projectId];
      const versionsByChapter: Record<string, ChapterVersionSnapshot[]> = {};
      if (rawVersionsByChapter && typeof rawVersionsByChapter === 'object') {
        Object.entries(rawVersionsByChapter).forEach(([chapterId, rows]) => {
          if (!Array.isArray(rows)) return;
          versionsByChapter[chapterId] = rows.filter(Boolean).map((rowRaw: unknown, index: number) => {
            const row = rowRaw as Record<string, unknown>;
            return {
              id: typeof row?.id === 'string' && row.id ? row.id : `${chapterId}_${index}_${Date.now()}`,
              chapterId: typeof row?.chapterId === 'string' && row.chapterId ? row.chapterId : chapterId,
              timestamp: typeof row?.timestamp === 'string' && row.timestamp ? row.timestamp : new Date().toISOString(),
              sourceText: typeof row?.sourceText === 'string' ? row.sourceText : '',
              adaptedText: typeof row?.adaptedText === 'string' ? row.adaptedText : '',
              label: typeof row?.label === 'string' && row.label ? row.label : 'snapshot',
              reason: typeof row?.reason === 'string' ? row.reason : '',
            };
          });
        });
      }
      chapterVersionsByProjectId[projectId] = versionsByChapter;
    });

    const selectedProjectIdRaw = typeof payload.selectedProjectId === 'string' ? payload.selectedProjectId : '';
    const resolvedSelectedProjectId = selectedProjectIdRaw && projects.some((p) => p.id === selectedProjectIdRaw)
      ? selectedProjectIdRaw
      : projects[0]?.id || '';
    const selChapters = chaptersByProjectId[resolvedSelectedProjectId] || [];
    const selectedChapterIdRaw = typeof payload.selectedChapterId === 'string' ? payload.selectedChapterId : '';
    const resolvedSelectedChapterId = selectedChapterIdRaw && selChapters.some((c) => c.id === selectedChapterIdRaw)
      ? selectedChapterIdRaw
      : selChapters[0]?.id || '';

    return {
      version: 4,
      projects,
      chaptersByProjectId,
      selectedProjectId: resolvedSelectedProjectId,
      selectedChapterId: resolvedSelectedChapterId,
      memoryLedgerByProjectId,
      adaptationStateByProjectId,
      chapterSummariesByProjectId,
      chapterVersionsByProjectId,
    };
  } catch {
    return null;
  }
};

const createEmptyLocalSnapshot = (): LocalNovelWorkspaceSnapshot => ({
  version: 4,
  projects: [],
  chaptersByProjectId: {},
  selectedProjectId: '',
  selectedChapterId: '',
  memoryLedgerByProjectId: {},
  adaptationStateByProjectId: {},
  chapterSummariesByProjectId: {},
  chapterVersionsByProjectId: {},
});

const applyWorkspaceMetaSelection = (snapshot: LocalNovelWorkspaceSnapshot): LocalNovelWorkspaceSnapshot => {
  const meta = readNovelWorkspaceMeta();
  if (!meta) return snapshot;
  const nextProjectId = String(meta.selectedProjectId || '').trim();
  const resolvedProjectId = nextProjectId && snapshot.projects.some((p) => p.id === nextProjectId)
    ? nextProjectId
    : snapshot.selectedProjectId;
  const projectChapters = snapshot.chaptersByProjectId[resolvedProjectId] || [];
  const nextChapterId = String(meta.selectedChapterId || '').trim();
  const resolvedChapterId = nextChapterId && projectChapters.some((c) => c.id === nextChapterId)
    ? nextChapterId
    : snapshot.selectedChapterId;
  return { ...snapshot, selectedProjectId: resolvedProjectId, selectedChapterId: resolvedChapterId };
};

const readLocalSnapshot = async (): Promise<LocalNovelWorkspaceSnapshot> => {
  const snapshot = await readNovelWorkspaceSnapshot<LocalNovelWorkspaceSnapshot>({
    legacyKeys: LOCAL_NOVEL_STORAGE_KEYS,
    parseLegacy: parseLocalSnapshot,
    createEmpty: createEmptyLocalSnapshot,
  });
  return applyWorkspaceMetaSelection(snapshot);
};

const writeLocalSnapshot = async (snapshot: LocalNovelWorkspaceSnapshot): Promise<void> => {
  try {
    await writeNovelWorkspaceSnapshot(snapshot);
    persistNovelWorkspaceMeta({
      selectedProjectId: snapshot.selectedProjectId,
      selectedChapterId: snapshot.selectedChapterId,
    });
  } catch (error) {
    console.warn('Failed to persist local novel snapshot.', error);
  }
};

// ─── Context Value ─────────────────────────────────────────────────────────────

interface NovelEditorContextValue {
  // Data
  projects: NovelProject[];
  chaptersByProjectId: ChaptersByProjectId;
  memoryLedgerByProjectId: MemoryLedgerByProjectId;
  adaptationStateByProjectId: AdaptationStateByProjectId;
  chapterSummariesByProjectId: ChapterSummariesByProjectId;
  chapterVersionsByProjectId: ChapterVersionsByProjectId;
  selectedProjectId: string;
  selectedChapterId: string;
  isHydrating: boolean;

  // Derived
  selectedProject: NovelProject | null;
  chapters: LocalNovelChapter[];
  selectedChapter: LocalNovelChapter | null;
  selectedLedger: ProjectMemoryLedger;

  // Mutators
  setProjects: React.Dispatch<React.SetStateAction<NovelProject[]>>;
  setChaptersByProjectId: React.Dispatch<React.SetStateAction<ChaptersByProjectId>>;
  setMemoryLedgerByProjectId: React.Dispatch<React.SetStateAction<MemoryLedgerByProjectId>>;
  setAdaptationStateByProjectId: React.Dispatch<React.SetStateAction<AdaptationStateByProjectId>>;
  setChapterSummariesByProjectId: React.Dispatch<React.SetStateAction<ChapterSummariesByProjectId>>;
  setChapterVersionsByProjectId: React.Dispatch<React.SetStateAction<ChapterVersionsByProjectId>>;

  // Actions
  selectProject: (projectId: string) => void;
  selectChapter: (chapterId: string) => void;
  createProject: (name: string) => string;
  deleteProject: (projectId: string) => void;
  renameProject: (projectId: string, name: string) => void;
  createChapterLocal: (projectId: string, title: string) => string;
  deleteChapterLocal: (projectId: string, chapterId: string) => void;
  reorderChapters: (projectId: string, fromId: string, toId: string) => void;
  duplicateChapter: (projectId: string, chapterId: string) => string;
  persistSnapshot: () => void;
}

const NovelEditorContext = createContext<NovelEditorContextValue | null>(null);

export const useNovelEditor = (): NovelEditorContextValue => {
  const ctx = useContext(NovelEditorContext);
  if (!ctx) throw new Error('useNovelEditor must be used within NovelEditorProvider');
  return ctx;
};

// ─── Provider ──────────────────────────────────────────────────────────────────

export const NovelEditorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [projects, setProjects] = useState<NovelProject[]>([]);
  const [chaptersByProjectId, setChaptersByProjectId] = useState<ChaptersByProjectId>({});
  const [memoryLedgerByProjectId, setMemoryLedgerByProjectId] = useState<MemoryLedgerByProjectId>({});
  const [adaptationStateByProjectId, setAdaptationStateByProjectId] = useState<AdaptationStateByProjectId>({});
  const [chapterSummariesByProjectId, setChapterSummariesByProjectId] = useState<ChapterSummariesByProjectId>({});
  const [chapterVersionsByProjectId, setChapterVersionsByProjectId] = useState<ChapterVersionsByProjectId>({});
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedChapterId, setSelectedChapterId] = useState('');
  const [isHydrating, setIsHydrating] = useState(true);

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate from IndexedDB on mount
  useEffect(() => {
    let cancelled = false;
    readLocalSnapshot().then((snapshot) => {
      if (cancelled) return;
      setProjects(snapshot.projects);
      setChaptersByProjectId(snapshot.chaptersByProjectId);
      setMemoryLedgerByProjectId(snapshot.memoryLedgerByProjectId);
      setAdaptationStateByProjectId(snapshot.adaptationStateByProjectId);
      setChapterSummariesByProjectId(snapshot.chapterSummariesByProjectId);
      setChapterVersionsByProjectId(snapshot.chapterVersionsByProjectId);
      setSelectedProjectId(snapshot.selectedProjectId);
      setSelectedChapterId(snapshot.selectedChapterId);
      setIsHydrating(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Debounced autosave
  const persistSnapshot = useCallback(() => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      // Read all state refs in the closure at the time the timeout fires — we pass the current setter values
      // We can't directly access state here, so we use a small workaround via an intermediate write call.
      // The actual effect below watches for changes and persists.
    }, 300);
  }, []);

  // Watch for any data changes and persist
  const snapshotRef = useRef<LocalNovelWorkspaceSnapshot | null>(null);
  useEffect(() => {
    if (isHydrating) return;
    const snapshot: LocalNovelWorkspaceSnapshot = {
      version: 4,
      projects,
      chaptersByProjectId,
      selectedProjectId,
      selectedChapterId,
      memoryLedgerByProjectId,
      adaptationStateByProjectId,
      chapterSummariesByProjectId,
      chapterVersionsByProjectId,
    };
    // Skip if identical to last written snapshot
    if (snapshotRef.current && JSON.stringify(snapshot) === JSON.stringify(snapshotRef.current)) return;
    snapshotRef.current = snapshot;

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void writeLocalSnapshot(snapshot);
    }, 300);
  }, [isHydrating, projects, chaptersByProjectId, selectedProjectId, selectedChapterId, memoryLedgerByProjectId, adaptationStateByProjectId, chapterSummariesByProjectId, chapterVersionsByProjectId]);

  // Derived
  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );
  const chapters = useMemo(
    () => [...(chaptersByProjectId[selectedProjectId] || [])].sort(chapterSort),
    [chaptersByProjectId, selectedProjectId]
  );
  const selectedChapter = useMemo(
    () => chapters.find((c) => c.id === selectedChapterId) || null,
    [chapters, selectedChapterId]
  );
  const selectedLedger = useMemo(
    () => memoryLedgerByProjectId[selectedProjectId] || emptyLedger(),
    [memoryLedgerByProjectId, selectedProjectId]
  );

  // Actions
  const selectProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setChaptersByProjectId((prev) => {
      const projectChapters = (prev[projectId] || []).sort(chapterSort);
      setSelectedChapterId(projectChapters[0]?.id || '');
      return prev;
    });
  }, []);

  const selectChapter = useCallback((chapterId: string) => {
    setSelectedChapterId(chapterId);
  }, []);

  const createProject = useCallback((name: string): string => {
    const projectId = createLocalId('project');
    const nowIso = new Date().toISOString();
    const resolved = buildUniqueProjectName(projects, name);
    const project: NovelProject = {
      id: projectId,
      name: resolved,
      rootFolderId: 'local',
      createdTime: nowIso,
      modifiedTime: nowIso,
    };
    const firstChapterId = createLocalId('chapter');
    const firstChapter: LocalNovelChapter = {
      id: firstChapterId,
      projectId,
      title: 'Chapter 1',
      name: buildChapterName(1, 'Chapter 1'),
      index: 1,
      text: '',
      createdTime: nowIso,
      modifiedTime: nowIso,
    };
    setProjects((prev) => [...prev, project]);
    setChaptersByProjectId((prev) => ({ ...prev, [projectId]: [firstChapter] }));
    setMemoryLedgerByProjectId((prev) => ({ ...prev, [projectId]: emptyLedger() }));
    setAdaptationStateByProjectId((prev) => ({ ...prev, [projectId]: [] }));
    setChapterSummariesByProjectId((prev) => ({ ...prev, [projectId]: [] }));
    setChapterVersionsByProjectId((prev) => ({ ...prev, [projectId]: {} }));
    setSelectedProjectId(projectId);
    setSelectedChapterId(firstChapterId);
    return projectId;
  }, [projects]);

  const deleteProject = useCallback((projectId: string) => {
    setProjects((prev) => {
      const next = prev.filter((p) => p.id !== projectId);
      if (selectedProjectId === projectId) {
        const fallback = next[0]?.id || '';
        setSelectedProjectId(fallback);
        setChaptersByProjectId((cPrev) => {
          setSelectedChapterId((cPrev[fallback] || [])[0]?.id || '');
          return cPrev;
        });
      }
      return next;
    });
    setChaptersByProjectId((prev) => {
      const { [projectId]: _, ...rest } = prev;
      return rest;
    });
    setMemoryLedgerByProjectId((prev) => {
      const { [projectId]: _, ...rest } = prev;
      return rest;
    });
    setAdaptationStateByProjectId((prev) => {
      const { [projectId]: _, ...rest } = prev;
      return rest;
    });
    setChapterSummariesByProjectId((prev) => {
      const { [projectId]: _, ...rest } = prev;
      return rest;
    });
    setChapterVersionsByProjectId((prev) => {
      const { [projectId]: _, ...rest } = prev;
      return rest;
    });
  }, [selectedProjectId]);

  const renameProject = useCallback((projectId: string, name: string) => {
    const resolved = sanitizeLabel(name, 'Untitled Novel');
    setProjects((prev) =>
      prev.map((p) => p.id === projectId ? { ...p, name: resolved, modifiedTime: new Date().toISOString() } : p)
    );
  }, []);

  const createChapterLocal = useCallback((projectId: string, title: string): string => {
    const chapterId = createLocalId('chapter');
    const nowIso = new Date().toISOString();
    setChaptersByProjectId((prev) => {
      const existing = prev[projectId] || [];
      const nextIndex = existing.length > 0 ? Math.max(...existing.map((c) => c.index)) + 1 : 1;
      const resolved = sanitizeLabel(title, `Chapter ${nextIndex}`);
      const chapter: LocalNovelChapter = {
        id: chapterId,
        projectId,
        title: resolved,
        name: buildChapterName(nextIndex, resolved),
        index: nextIndex,
        text: '',
        createdTime: nowIso,
        modifiedTime: nowIso,
      };
      return { ...prev, [projectId]: [...existing, chapter].sort(chapterSort) };
    });
    setSelectedChapterId(chapterId);
    return chapterId;
  }, []);

  const deleteChapterLocal = useCallback((projectId: string, chapterId: string) => {
    setChaptersByProjectId((prev) => {
      const chapters = (prev[projectId] || []).filter((c) => c.id !== chapterId);
      if (selectedChapterId === chapterId) {
        setSelectedChapterId(chapters[0]?.id || '');
      }
      return { ...prev, [projectId]: chapters };
    });
  }, [selectedChapterId]);

  const reorderChapters = useCallback((projectId: string, fromId: string, toId: string) => {
    setChaptersByProjectId((prev) => {
      const chapters = [...(prev[projectId] || [])];
      const fromIndex = chapters.findIndex((c) => c.id === fromId);
      const toIndex = chapters.findIndex((c) => c.id === toId);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return prev;
      const moved = chapters.splice(fromIndex, 1)[0];
      if (!moved) return prev;
      chapters.splice(toIndex, 0, moved);
      return {
        ...prev,
        [projectId]: chapters.map((c, i) => ({ ...c, index: i + 1 })).sort(chapterSort),
      };
    });
  }, []);

  const duplicateChapter = useCallback((projectId: string, chapterId: string): string => {
    const newChapterId = createLocalId('chapter');
    const nowIso = new Date().toISOString();
    setChaptersByProjectId((prev) => {
      const existing = prev[projectId] || [];
      const source = existing.find((c) => c.id === chapterId);
      if (!source) return prev;
      const nextIndex = existing.length > 0 ? Math.max(...existing.map((c) => c.index)) + 1 : 1;
      const duplicate: LocalNovelChapter = {
        id: newChapterId,
        projectId,
        title: `${source.title} (copy)`,
        name: buildChapterName(nextIndex, `${source.title} (copy)`),
        index: nextIndex,
        text: source.text,
        adaptedText: source.adaptedText || '',
        adaptationStatus: 'idle',
        createdTime: nowIso,
        modifiedTime: nowIso,
      };
      return { ...prev, [projectId]: [...existing, duplicate].sort(chapterSort) };
    });
    setSelectedChapterId(newChapterId);
    return newChapterId;
  }, []);

  const value = useMemo<NovelEditorContextValue>(() => ({
    projects,
    chaptersByProjectId,
    memoryLedgerByProjectId,
    adaptationStateByProjectId,
    chapterSummariesByProjectId,
    chapterVersionsByProjectId,
    selectedProjectId,
    selectedChapterId,
    isHydrating,
    selectedProject,
    chapters,
    selectedChapter,
    selectedLedger,
    setProjects,
    setChaptersByProjectId,
    setMemoryLedgerByProjectId,
    setAdaptationStateByProjectId,
    setChapterSummariesByProjectId,
    setChapterVersionsByProjectId,
    selectProject,
    selectChapter,
    createProject,
    deleteProject,
    renameProject,
    createChapterLocal,
    deleteChapterLocal,
    reorderChapters,
    duplicateChapter,
    persistSnapshot,
  }), [
    projects, chaptersByProjectId, memoryLedgerByProjectId, adaptationStateByProjectId,
    chapterSummariesByProjectId, chapterVersionsByProjectId, selectedProjectId, selectedChapterId,
    isHydrating, selectedProject, chapters, selectedChapter, selectedLedger,
    selectProject, selectChapter, createProject, deleteProject, renameProject,
    createChapterLocal, deleteChapterLocal, reorderChapters, duplicateChapter, persistSnapshot,
  ]);

  return (
    <NovelEditorContext.Provider value={value}>
      {children}
    </NovelEditorContext.Provider>
  );
};
