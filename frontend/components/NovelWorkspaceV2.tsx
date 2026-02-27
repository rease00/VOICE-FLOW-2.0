import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  CloudDownload,
  CloudUpload,
  FileUp,
  FolderOpen,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Unlock,
  Wand2,
} from 'lucide-react';
import { Button } from './Button';
import { LANGUAGES } from '../constants';
import { useUser } from '../contexts/UserContext';
import {
  ChapterMemorySummary,
  ChapterVersionSnapshot,
  ChapterAdaptationState,
  ChapterAdaptationStatus,
  DriveConnectionState,
  GenerationSettings,
  MemoryEntry,
  MemoryEntryKind,
  NovelChapter,
  NovelImportChapterPreview,
  NovelImportExtractDiagnostics,
  NovelProject,
  ProjectMemoryLedger,
} from '../types';
import {
  connectDriveIdentity,
  getDriveProviderToken,
  reconsentDriveScopes,
} from '../services/driveAuthService';
import {
  createChapter,
  createNovelProject,
  listChapters,
  listNovelProjects,
  loadChapterText,
  verifyDriveAccess,
} from '../services/novelDriveService';
import { extractNovelTextFromFile, splitImportedTextToChapters } from '../services/novelImportService';
import { generateTextContent } from '../services/geminiService';
import { UploadDropzone } from './ui/UploadDropzone';
import {
  getNovelRootFolder,
  isNovelLocalFsSupported,
  pickNovelRootFolder,
  syncNovelProjectToFolder,
} from '../services/novelLocalFsService';

type ToastKind = 'success' | 'error' | 'info';
type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

interface NovelWorkspaceV2Props {
  settings: GenerationSettings;
  mediaBackendUrl: string;
  onSendToStudio: (text: string) => void;
  onToast: (message: string, type?: ToastKind) => void;
}

interface LocalNovelChapter extends NovelChapter {
  text: string;
  adaptedText?: string;
  adaptationStatus?: ChapterAdaptationStatus;
  adaptationError?: string;
  lastAdaptedAt?: string;
}

interface EditableImportChapter extends NovelImportChapterPreview {
  id: string;
  sourceFileName?: string;
}

type ChaptersByProjectId = Record<string, LocalNovelChapter[]>;
type MemoryLedgerByProjectId = Record<string, ProjectMemoryLedger>;
type AdaptationStateByProjectId = Record<string, ChapterAdaptationState[]>;
type ChapterSummariesByProjectId = Record<string, ChapterMemorySummary[]>;
type ChapterVersionsByProjectId = Record<string, Record<string, ChapterVersionSnapshot[]>>;

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

const LOCAL_NOVEL_STORAGE_KEYS = [
  'vf_novel_workspace_v3',
  'vf_novel_workspace_v2',
  'vf_novel_workspace_v1',
  'vf_novel_workspace',
];
const ACTIVE_LOCAL_NOVEL_STORAGE_KEY = LOCAL_NOVEL_STORAGE_KEYS[0];

const chapterSort = (a: NovelChapter, b: NovelChapter): number => a.index - b.index || a.name.localeCompare(b.name);
const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();
const sanitizeLabel = (value: string, fallback: string): string => {
  const cleaned = collapseWhitespace(String(value || '').replace(/[\\/:*?"<>|]/g, ''));
  return cleaned.slice(0, 120) || fallback;
};
const createLocalId = (prefix: 'project' | 'chapter' | 'memory' | 'import'): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const buildChapterName = (index: number, title: string): string =>
  `Chapter ${String(index).padStart(3, '0')} - ${title}`;
const buildDriveState = (status: DriveConnectionState['status'], message: string): DriveConnectionState => ({ status, message });
const normalizeError = (error: any): string => String(error?.message || 'Unknown error');
const emptyLedger = (): ProjectMemoryLedger => ({ characters: [], places: [], chapterSummaries: [] });

const buildUniqueProjectName = (existing: NovelProject[], baseName: string): string => {
  const normalized = sanitizeLabel(baseName, 'Imported Novel');
  const used = new Set(existing.map((project) => project.name.toLowerCase()));
  if (!used.has(normalized.toLowerCase())) return normalized;
  let suffix = 2;
  while (used.has(`${normalized} (${suffix})`.toLowerCase())) suffix += 1;
  return `${normalized} (${suffix})`;
};

const parseLocalSnapshot = (raw: string | null): LocalNovelWorkspaceSnapshot | null => {
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as any;
    if (!payload || typeof payload !== 'object') return null;
    const rawProjects = Array.isArray(payload.projects) ? payload.projects : [];
    const projects: NovelProject[] = [];
    const chaptersByProjectId: ChaptersByProjectId = {};
    const memoryLedgerByProjectId: MemoryLedgerByProjectId = {};
    const adaptationStateByProjectId: AdaptationStateByProjectId = {};
    const chapterSummariesByProjectId: ChapterSummariesByProjectId = {};
    const chapterVersionsByProjectId: ChapterVersionsByProjectId = {};

    rawProjects.forEach((rawProject: any) => {
      const nowIso = new Date().toISOString();
      const projectId = typeof rawProject?.id === 'string' && rawProject.id ? rawProject.id : createLocalId('project');
      const createdTime = typeof rawProject?.createdTime === 'string' ? rawProject.createdTime : nowIso;
      const modifiedTime = typeof rawProject?.modifiedTime === 'string' ? rawProject.modifiedTime : createdTime;
      projects.push({
        id: projectId,
        name: sanitizeLabel(rawProject?.name, 'Untitled Novel'),
        rootFolderId: typeof rawProject?.rootFolderId === 'string' && rawProject.rootFolderId ? rawProject.rootFolderId : 'local',
        createdTime,
        modifiedTime,
      });

      const sourceChapters = (Array.isArray(payload?.chaptersByProjectId?.[projectId]) ? payload.chaptersByProjectId[projectId] : rawProject?.chapters) || [];
      chaptersByProjectId[projectId] = (Array.isArray(sourceChapters) ? sourceChapters : []).map((rawChapter: any, chapterIndex: number) => {
        const parsedIndex = Number(rawChapter?.index);
        const index = Number.isFinite(parsedIndex) && parsedIndex > 0 ? parsedIndex : chapterIndex + 1;
        const title = sanitizeLabel(rawChapter?.title || rawChapter?.name || `Chapter ${index}`, `Chapter ${index}`);
        return {
          id: typeof rawChapter?.id === 'string' && rawChapter.id ? rawChapter.id : createLocalId('chapter'),
          projectId,
          title,
          name: sanitizeLabel(rawChapter?.name || buildChapterName(index, title), buildChapterName(index, title)),
          index,
          text: typeof rawChapter?.text === 'string' ? rawChapter.text : '',
          adaptedText: typeof rawChapter?.adaptedText === 'string' ? rawChapter.adaptedText : '',
          adaptationStatus: ['queued', 'running', 'done', 'failed'].includes(rawChapter?.adaptationStatus) ? rawChapter.adaptationStatus : 'idle',
          adaptationError: typeof rawChapter?.adaptationError === 'string' ? rawChapter.adaptationError : '',
          lastAdaptedAt: typeof rawChapter?.lastAdaptedAt === 'string' ? rawChapter.lastAdaptedAt : undefined,
          createdTime: typeof rawChapter?.createdTime === 'string' ? rawChapter.createdTime : createdTime,
          modifiedTime: typeof rawChapter?.modifiedTime === 'string' ? rawChapter.modifiedTime : modifiedTime,
        } as LocalNovelChapter;
      }).sort(chapterSort);

      memoryLedgerByProjectId[projectId] = {
        characters: Array.isArray(payload?.memoryLedgerByProjectId?.[projectId]?.characters) ? payload.memoryLedgerByProjectId[projectId].characters : [],
        places: Array.isArray(payload?.memoryLedgerByProjectId?.[projectId]?.places) ? payload.memoryLedgerByProjectId[projectId].places : [],
        chapterSummaries: Array.isArray(payload?.chapterSummariesByProjectId?.[projectId])
          ? payload.chapterSummariesByProjectId[projectId]
          : Array.isArray(payload?.memoryLedgerByProjectId?.[projectId]?.chapterSummaries)
            ? payload.memoryLedgerByProjectId[projectId].chapterSummaries
            : [],
      };
      adaptationStateByProjectId[projectId] = Array.isArray(payload?.adaptationStateByProjectId?.[projectId]) ? payload.adaptationStateByProjectId[projectId] : [];
      chapterSummariesByProjectId[projectId] = Array.isArray(payload?.chapterSummariesByProjectId?.[projectId])
        ? payload.chapterSummariesByProjectId[projectId]
        : [];

      const rawVersionsByChapter = payload?.chapterVersionsByProjectId?.[projectId];
      const versionsByChapter: Record<string, ChapterVersionSnapshot[]> = {};
      if (rawVersionsByChapter && typeof rawVersionsByChapter === 'object') {
        Object.entries(rawVersionsByChapter as Record<string, any>).forEach(([chapterId, rows]) => {
          if (!Array.isArray(rows)) return;
          versionsByChapter[chapterId] = rows.filter(Boolean).map((row: any, index: number) => ({
            id: typeof row?.id === 'string' && row.id ? row.id : `${chapterId}_${index}_${Date.now()}`,
            chapterId: typeof row?.chapterId === 'string' && row.chapterId ? row.chapterId : chapterId,
            timestamp: typeof row?.timestamp === 'string' && row.timestamp ? row.timestamp : new Date().toISOString(),
            sourceText: typeof row?.sourceText === 'string' ? row.sourceText : '',
            adaptedText: typeof row?.adaptedText === 'string' ? row.adaptedText : '',
            label: typeof row?.label === 'string' && row.label ? row.label : 'snapshot',
            reason: typeof row?.reason === 'string' ? row.reason : '',
          }));
        });
      }
      chapterVersionsByProjectId[projectId] = versionsByChapter;
    });

    const selectedProjectIdRaw = typeof payload.selectedProjectId === 'string' ? payload.selectedProjectId : '';
    const selectedProjectId = selectedProjectIdRaw && projects.some((project) => project.id === selectedProjectIdRaw)
      ? selectedProjectIdRaw
      : projects[0]?.id || '';
    const selectedProjectChapters = chaptersByProjectId[selectedProjectId] || [];
    const selectedChapterIdRaw = typeof payload.selectedChapterId === 'string' ? payload.selectedChapterId : '';
    const selectedChapterId = selectedChapterIdRaw && selectedProjectChapters.some((chapter) => chapter.id === selectedChapterIdRaw)
      ? selectedChapterIdRaw
      : selectedProjectChapters[0]?.id || '';

    return {
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
  } catch {
    return null;
  }
};

const readLocalSnapshot = (): LocalNovelWorkspaceSnapshot => {
  for (const key of LOCAL_NOVEL_STORAGE_KEYS) {
    const parsed = parseLocalSnapshot(window.localStorage.getItem(key));
    if (parsed) return parsed;
  }
  return {
    version: 4,
    projects: [],
    chaptersByProjectId: {},
    selectedProjectId: '',
    selectedChapterId: '',
    memoryLedgerByProjectId: {},
    adaptationStateByProjectId: {},
    chapterSummariesByProjectId: {},
    chapterVersionsByProjectId: {},
  };
};

const writeLocalSnapshot = (snapshot: LocalNovelWorkspaceSnapshot): void => {
  window.localStorage.setItem(ACTIVE_LOCAL_NOVEL_STORAGE_KEY, JSON.stringify(snapshot));
};

const patchChapterText = (
  previous: ChaptersByProjectId,
  projectId: string,
  chapterId: string,
  text: string
): ChaptersByProjectId => ({
  ...previous,
  [projectId]: (previous[projectId] || []).map((chapter) =>
    chapter.id === chapterId ? { ...chapter, text, modifiedTime: new Date().toISOString() } : chapter
  ),
});

const patchChapterMeta = (
  previous: ChaptersByProjectId,
  projectId: string,
  chapterId: string,
  patch: Partial<LocalNovelChapter>
): ChaptersByProjectId => ({
  ...previous,
  [projectId]: (previous[projectId] || []).map((chapter) =>
    chapter.id === chapterId ? { ...chapter, ...patch, modifiedTime: new Date().toISOString() } : chapter
  ),
});

const normalizeMemoryKey = (value: string): string => collapseWhitespace(value).toLowerCase();
const upsertMemoryEntries = (existing: MemoryEntry[], incoming: MemoryEntry[], kind: MemoryEntryKind): MemoryEntry[] => {
  const byKey = new Map<string, MemoryEntry>();
  existing.forEach((row) => byKey.set(normalizeMemoryKey(row.sourceName), row));
  incoming.forEach((row) => {
    const key = normalizeMemoryKey(row.sourceName);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { ...row, kind, updatedAt: new Date().toISOString() });
      return;
    }
    if (current.locked) return;
    byKey.set(key, {
      ...current,
      adaptedName: row.adaptedName || current.adaptedName,
      confidence: typeof row.confidence === 'number' ? row.confidence : current.confidence,
      updatedAt: new Date().toISOString(),
    });
  });
  return Array.from(byKey.values()).sort((a, b) => a.sourceName.localeCompare(b.sourceName));
};

const extractJsonObject = (raw: string): any | null => {
  const stripped = String(raw || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
};

const buildMemoryInstruction = (ledger: ProjectMemoryLedger): string => {
  const chars = ledger.characters.filter((item) => item.locked);
  const places = ledger.places.filter((item) => item.locked);
  const render = (rows: MemoryEntry[], label: string): string =>
    rows.length === 0
      ? `${label}: none`
      : `${label}:\n${rows.map((row) => `- ${row.sourceName} -> ${row.adaptedName}`).join('\n')}`;
  return [render(chars, 'Locked character mappings'), render(places, 'Locked place mappings')].join('\n');
};

export const NovelWorkspaceV2: React.FC<NovelWorkspaceV2Props> = ({ settings, mediaBackendUrl, onToast }) => {
  const { user } = useUser();
  const [driveState, setDriveState] = useState<DriveConnectionState>(buildDriveState('checking', 'Checking Google Drive access...'));
  const [driveToken, setDriveToken] = useState('');
  const [isConnectingDrive, setIsConnectingDrive] = useState(false);
  const [isUploadingToDrive, setIsUploadingToDrive] = useState(false);
  const [isDownloadingFromDrive, setIsDownloadingFromDrive] = useState(false);
  const [showAdvancedDrive, setShowAdvancedDrive] = useState(false);

  const [projects, setProjects] = useState<NovelProject[]>([]);
  const [chaptersByProjectId, setChaptersByProjectId] = useState<ChaptersByProjectId>({});
  const [memoryLedgerByProjectId, setMemoryLedgerByProjectId] = useState<MemoryLedgerByProjectId>({});
  const [adaptationStateByProjectId, setAdaptationStateByProjectId] = useState<AdaptationStateByProjectId>({});
  const [chapterSummariesByProjectId, setChapterSummariesByProjectId] = useState<ChapterSummariesByProjectId>({});
  const [chapterVersionsByProjectId, setChapterVersionsByProjectId] = useState<ChapterVersionsByProjectId>({});
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedChapterId, setSelectedChapterId] = useState('');
  const [isHydratingLocal, setIsHydratingLocal] = useState(true);
  const [chapterText, setChapterText] = useState('');
  const [adaptedOutput, setAdaptedOutput] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [targetLang, setTargetLang] = useState('Hinglish');
  const [targetCulture, setTargetCulture] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [isAdapting, setIsAdapting] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchMessage, setBatchMessage] = useState('');
  const [memoryTab, setMemoryTab] = useState<MemoryEntryKind>('character');
  const [memoryFilter, setMemoryFilter] = useState('');
  const [memoryDraftSource, setMemoryDraftSource] = useState('');
  const [memoryDraftAdapted, setMemoryDraftAdapted] = useState('');
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importRawText, setImportRawText] = useState('');
  const [importDiagnostics, setImportDiagnostics] = useState<NovelImportExtractDiagnostics | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importPreviewChapters, setImportPreviewChapters] = useState<EditableImportChapter[]>([]);
  const [isImportExtracting, setIsImportExtracting] = useState(false);
  const [isImportSplitting, setIsImportSplitting] = useState(false);
  const [boundLocalFolderName, setBoundLocalFolderName] = useState('');
  const [isBindingLocalFolder, setIsBindingLocalFolder] = useState(false);
  const [localFolderStatus, setLocalFolderStatus] = useState('');

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedTextRef = useRef('');
  const activeSelectionKeyRef = useRef('');
  const batchCancelRef = useRef(false);
  const chaptersRef = useRef(chaptersByProjectId);
  const ledgerRef = useRef(memoryLedgerByProjectId);
  const chapterSummariesRef = useRef(chapterSummariesByProjectId);
  const chapterVersionsRef = useRef(chapterVersionsByProjectId);
  const importModalRef = useRef<HTMLDivElement>(null);
  const importTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { chaptersRef.current = chaptersByProjectId; }, [chaptersByProjectId]);
  useEffect(() => { ledgerRef.current = memoryLedgerByProjectId; }, [memoryLedgerByProjectId]);
  useEffect(() => { chapterSummariesRef.current = chapterSummariesByProjectId; }, [chapterSummariesByProjectId]);
  useEffect(() => { chapterVersionsRef.current = chapterVersionsByProjectId; }, [chapterVersionsByProjectId]);

  const selectedProject = useMemo(() => projects.find((project) => project.id === selectedProjectId) || null, [projects, selectedProjectId]);
  const chapters = useMemo(() => [...(chaptersByProjectId[selectedProjectId] || [])].sort(chapterSort), [chaptersByProjectId, selectedProjectId]);
  const selectedChapter = useMemo(() => chapters.find((chapter) => chapter.id === selectedChapterId) || null, [chapters, selectedChapterId]);
  const selectedLedger = useMemo(() => memoryLedgerByProjectId[selectedProjectId] || emptyLedger(), [memoryLedgerByProjectId, selectedProjectId]);
  const selectedChapterSummaries = useMemo(
    () => chapterSummariesByProjectId[selectedProjectId] || [],
    [chapterSummariesByProjectId, selectedProjectId]
  );
  const selectedChapterVersions = useMemo(
    () => (chapterVersionsByProjectId[selectedProjectId]?.[selectedChapterId] || []).slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [chapterVersionsByProjectId, selectedProjectId, selectedChapterId]
  );
  const selectedChapterSummary = useMemo(
    () => selectedChapterSummaries.find((row) => row.chapterId === selectedChapterId) || null,
    [selectedChapterSummaries, selectedChapterId]
  );
  const selectedStateMap = useMemo(() => {
    const map = new Map<string, ChapterAdaptationState>();
    (adaptationStateByProjectId[selectedProjectId] || []).forEach((row) => map.set(row.chapterId, row));
    return map;
  }, [adaptationStateByProjectId, selectedProjectId]);
  const filteredMemoryRows = useMemo(() => {
    const rows = memoryTab === 'character' ? selectedLedger.characters : selectedLedger.places;
    const needle = memoryFilter.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => row.sourceName.toLowerCase().includes(needle) || row.adaptedName.toLowerCase().includes(needle));
  }, [memoryTab, memoryFilter, selectedLedger]);
  const sourceAndAdaptedSame = useMemo(() => {
    const source = collapseWhitespace(chapterText);
    const adapted = collapseWhitespace(adaptedOutput);
    if (!source || !adapted) return false;
    return source === adapted;
  }, [chapterText, adaptedOutput]);

  const refreshDriveSession = useCallback(async () => {
    setDriveState(buildDriveState('checking', 'Checking Google Drive access...'));
    const auth = await getDriveProviderToken();
    if (!auth.ok || !auth.token) {
      setDriveToken('');
      if (auth.status === 'needs_google_identity') setDriveState(buildDriveState('needs_google_identity', auth.message));
      else if (auth.status === 'needs_consent') setDriveState(buildDriveState('needs_consent', auth.message));
      else if (auth.status === 'needs_login' || auth.status === 'guest') setDriveState(buildDriveState('needs_login', auth.message));
      else setDriveState(buildDriveState('error', auth.message));
      return;
    }
    const accessProbe = await verifyDriveAccess(auth.token);
    if (!accessProbe.ok) {
      setDriveToken('');
      setDriveState(buildDriveState('needs_consent', accessProbe.message));
      return;
    }
    setDriveToken(auth.token);
    setDriveState(buildDriveState('connected', 'Google Drive connected for folder upload/download.'));
  }, [user.googleId]);

  useEffect(() => {
    const snapshot = readLocalSnapshot();
    setProjects(snapshot.projects);
    setChaptersByProjectId(snapshot.chaptersByProjectId);
    setMemoryLedgerByProjectId(snapshot.memoryLedgerByProjectId);
    setAdaptationStateByProjectId(snapshot.adaptationStateByProjectId);
    setChapterSummariesByProjectId(snapshot.chapterSummariesByProjectId || {});
    setChapterVersionsByProjectId(snapshot.chapterVersionsByProjectId || {});
    setSelectedProjectId(snapshot.selectedProjectId);
    setSelectedChapterId(snapshot.selectedChapterId);
    setIsHydratingLocal(false);
  }, []);
  useEffect(() => { void refreshDriveSession(); }, [refreshDriveSession]);
  useEffect(() => {
    if (!isNovelLocalFsSupported()) {
      setLocalFolderStatus('Local folder sync is unavailable in this browser.');
      return;
    }
    void (async () => {
      try {
        const handle = await getNovelRootFolder();
        if (!handle) {
          setBoundLocalFolderName('');
          setLocalFolderStatus('No local folder bound.');
          return;
        }
        setBoundLocalFolderName(handle.name);
        setLocalFolderStatus(`Bound to ${handle.name}`);
      } catch {
        setBoundLocalFolderName('');
        setLocalFolderStatus('Local folder permission needs rebind.');
      }
    })();
  }, []);

  const bindLocalFolder = useCallback(async (): Promise<void> => {
    if (!isNovelLocalFsSupported()) {
      onToast('Local folder sync is unavailable in this browser.', 'error');
      return;
    }
    setIsBindingLocalFolder(true);
    try {
      const handle = await pickNovelRootFolder();
      setBoundLocalFolderName(handle.name);
      setLocalFolderStatus(`Bound to ${handle.name}`);
      onToast(`Local folder bound: ${handle.name}`, 'success');
    } catch (error: any) {
      const message = normalizeError(error);
      setLocalFolderStatus(message);
      onToast(message, 'error');
    } finally {
      setIsBindingLocalFolder(false);
    }
  }, [onToast]);

  const syncProjectToLocalFolder = useCallback(
    async (projectId: string): Promise<void> => {
      if (!projectId || !isNovelLocalFsSupported()) return;
      const project = projects.find((item) => item.id === projectId);
      if (!project) return;
      const handle = await getNovelRootFolder();
      if (!handle) return;
      const chapters = (chaptersRef.current[projectId] || []).map((chapter) => ({
        id: chapter.id,
        index: chapter.index,
        title: chapter.title,
        text: chapter.text,
        adaptedText: chapter.adaptedText || '',
      }));
      await syncNovelProjectToFolder(handle, {
        projectName: project.name,
        chapters,
        ledger: memoryLedgerByProjectId[projectId] || emptyLedger(),
        chapterSummaries: chapterSummariesRef.current[projectId] || [],
        chapterVersions: chapterVersionsRef.current[projectId] || {},
      });
      setBoundLocalFolderName(handle.name);
      setLocalFolderStatus(`Synced to ${handle.name} at ${new Date().toLocaleTimeString()}`);
    },
    [memoryLedgerByProjectId, projects]
  );
  useEffect(() => {
    if (!isImportModalOpen) return;
    const modal = importModalRef.current;
    const previousActive = document.activeElement as HTMLElement | null;
    const focusableSelector = [
      'button:not([disabled])',
      '[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    const getFocusable = (): HTMLElement[] => {
      if (!modal) return [];
      return (Array.from(modal.querySelectorAll(focusableSelector)) as HTMLElement[])
        .filter((element) => element.offsetParent !== null);
    };
    const focusable = getFocusable();
    (focusable[0] || modal)?.focus();

    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsImportModalOpen(false);
        setImportFiles([]);
        setImportRawText('');
        setImportDiagnostics(null);
        setImportWarnings([]);
        setImportPreviewChapters([]);
        return;
      }
      if (event.key !== 'Tab') return;
      const current = getFocusable();
      if (current.length === 0) return;
      const first = current[0];
      const last = current[current.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    };
    window.addEventListener('keydown', onKeydown);
    return () => {
      window.removeEventListener('keydown', onKeydown);
      if (previousActive && typeof previousActive.focus === 'function') {
        previousActive.focus();
      } else if (importTriggerRef.current) {
        importTriggerRef.current.focus();
      }
    };
  }, [isImportModalOpen]);

  useEffect(() => {
    if (isHydratingLocal) return;
    writeLocalSnapshot({
      version: 4,
      projects,
      chaptersByProjectId,
      selectedProjectId,
      selectedChapterId,
      memoryLedgerByProjectId,
      adaptationStateByProjectId,
      chapterSummariesByProjectId,
      chapterVersionsByProjectId,
    });
  }, [
    projects,
    chaptersByProjectId,
    selectedProjectId,
    selectedChapterId,
    memoryLedgerByProjectId,
    adaptationStateByProjectId,
    chapterSummariesByProjectId,
    chapterVersionsByProjectId,
    isHydratingLocal,
  ]);

  useEffect(() => {
    if (isHydratingLocal || !selectedProjectId) return;
    const timer = window.setTimeout(() => {
      void syncProjectToLocalFolder(selectedProjectId).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    isHydratingLocal,
    selectedProjectId,
    chaptersByProjectId,
    memoryLedgerByProjectId,
    chapterSummariesByProjectId,
    chapterVersionsByProjectId,
    syncProjectToLocalFolder,
  ]);

  useEffect(() => {
    if (isHydratingLocal) return;
    setSelectedProjectId((previous) => previous && projects.some((project) => project.id === previous) ? previous : projects[0]?.id || '');
  }, [projects, isHydratingLocal]);
  useEffect(() => {
    if (isHydratingLocal) return;
    const projectChapters = chaptersByProjectId[selectedProjectId] || [];
    setSelectedChapterId((previous) => previous && projectChapters.some((chapter) => chapter.id === previous) ? previous : projectChapters[0]?.id || '');
  }, [chaptersByProjectId, selectedProjectId, isHydratingLocal]);

  useEffect(() => {
    const nextSelectionKey = selectedProjectId && selectedChapterId ? `${selectedProjectId}:${selectedChapterId}` : '';
    if (activeSelectionKeyRef.current === nextSelectionKey) return;
    activeSelectionKeyRef.current = nextSelectionKey;
    if (!nextSelectionKey) {
      setChapterText('');
      setAdaptedOutput('');
      lastSavedTextRef.current = '';
      return;
    }
    const chapter = (chaptersByProjectId[selectedProjectId] || []).find((item) => item.id === selectedChapterId);
    const text = chapter?.text || '';
    setChapterText(text);
    setAdaptedOutput(chapter?.adaptedText || '');
    lastSavedTextRef.current = text;
    setSaveState('idle');
  }, [selectedProjectId, selectedChapterId, chaptersByProjectId]);

  useEffect(() => {
    if (isHydratingLocal || !selectedProjectId || !selectedChapterId) return;
    if (chapterText === lastSavedTextRef.current) return;
    setSaveState('pending');
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      setSaveState('saving');
      setChaptersByProjectId((previous) => patchChapterText(previous, selectedProjectId, selectedChapterId, chapterText));
      lastSavedTextRef.current = chapterText;
      setSaveState('saved');
    }, 1100);
    return () => { if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current); };
  }, [chapterText, selectedProjectId, selectedChapterId, isHydratingLocal]);

  const setChapterState = useCallback((projectId: string, chapterId: string, next: ChapterAdaptationState) => {
    setAdaptationStateByProjectId((previous) => {
      const rows = [...(previous[projectId] || [])];
      const index = rows.findIndex((row) => row.chapterId === chapterId);
      if (index >= 0) rows[index] = next;
      else rows.push(next);
      return { ...previous, [projectId]: rows };
    });
  }, []);

  const appendChapterVersion = useCallback((
    projectId: string,
    chapterId: string,
    sourceText: string,
    adaptedText: string,
    label: string,
    reason?: string
  ) => {
    const snapshot: ChapterVersionSnapshot = {
      id: `${chapterId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      chapterId,
      timestamp: new Date().toISOString(),
      sourceText: String(sourceText || ''),
      adaptedText: String(adaptedText || ''),
      label: String(label || 'snapshot'),
      reason: String(reason || ''),
    };
    setChapterVersionsByProjectId((previous) => {
      const projectVersions = { ...(previous[projectId] || {}) };
      const rows = [...(projectVersions[chapterId] || []), snapshot];
      projectVersions[chapterId] = rows.slice(-20);
      return { ...previous, [projectId]: projectVersions };
    });
  }, []);

  const extractMemoryMappings = useCallback(async (source: string, adapted: string): Promise<ProjectMemoryLedger> => {
    const prompt = [
      'Extract character and place mappings from source and adapted chapter text.',
      'Return strict JSON: {"characters":[{"sourceName":"","adaptedName":"","confidence":0.0}],"places":[{"sourceName":"","adaptedName":"","confidence":0.0}]}',
      `SOURCE:\n${source}`,
      `ADAPTED:\n${adapted}`,
    ].join('\n\n');
    const raw = await generateTextContent(prompt, undefined, settings);
    const parsed = extractJsonObject(raw);
    const mapRows = (rows: any[], kind: MemoryEntryKind): MemoryEntry[] => {
      if (!Array.isArray(rows)) return [];
      return rows.map((row) => ({
        id: createLocalId('memory'),
        kind,
        sourceName: String(row?.sourceName || '').trim(),
        adaptedName: String(row?.adaptedName || '').trim(),
        locked: false,
        confidence: typeof row?.confidence === 'number' ? Math.max(0, Math.min(1, row.confidence)) : undefined,
        updatedAt: new Date().toISOString(),
      })).filter((row) => row.sourceName && row.adaptedName);
    };
    return { characters: mapRows(parsed?.characters || [], 'character'), places: mapRows(parsed?.places || [], 'place') };
  }, [settings]);

  const mergeLedger = useCallback((projectId: string, incoming: ProjectMemoryLedger): void => {
    setMemoryLedgerByProjectId((previous) => {
      const current = previous[projectId] || emptyLedger();
      return {
        ...previous,
        [projectId]: {
          characters: upsertMemoryEntries(current.characters, incoming.characters, 'character'),
          places: upsertMemoryEntries(current.places, incoming.places, 'place'),
          chapterSummaries: current.chapterSummaries || [],
        },
      };
    });
  }, []);

  const extractChapterSummary = useCallback(
    async (
      source: string,
      adapted: string,
      chapterId: string,
      chapterTitle: string,
      ledger: ProjectMemoryLedger
    ): Promise<ChapterMemorySummary> => {
      const knownCharacters = new Set((ledger.characters || []).map((item) => item.sourceName.toLowerCase()));
      const knownPlaces = new Set((ledger.places || []).map((item) => item.sourceName.toLowerCase()));
      const prompt = [
        'Create a concise chapter memory summary and detect newly introduced entities.',
        'Return strict JSON: {"summary":"","newCharacters":[],"newPlaces":[]}.',
        `Chapter title: ${chapterTitle}`,
        `Source:\n${source}`,
        `Adapted:\n${adapted}`,
      ].join('\n\n');
      const raw = await generateTextContent(prompt, undefined, settings);
      const parsed = extractJsonObject(raw) || {};
      const normalizeNames = (values: any[], known: Set<string>) =>
        (Array.isArray(values) ? values : [])
          .map((item) => String(item || '').trim())
          .filter((item) => item && !known.has(item.toLowerCase()));
      return {
        chapterId,
        chapterTitle: chapterTitle || chapterId,
        summary: String(parsed?.summary || '').trim().slice(0, 1200),
        newCharacters: Array.from(new Set(normalizeNames(parsed?.newCharacters, knownCharacters))),
        newPlaces: Array.from(new Set(normalizeNames(parsed?.newPlaces, knownPlaces))),
        updatedAt: new Date().toISOString(),
      };
    },
    [settings]
  );

  const adaptSingleChapter = useCallback(async (projectId: string, chapterId: string): Promise<void> => {
    const chapter = (chaptersRef.current[projectId] || []).find((item) => item.id === chapterId);
    if (!chapter || !chapter.text.trim()) throw new Error('Chapter text is empty.');
    if (!targetCulture.trim()) throw new Error('Target culture is required.');
    const ledger = ledgerRef.current[projectId] || emptyLedger();
    const prompt = [
      `Adapt this chapter into ${targetLang}.`,
      `Target culture/setting: ${targetCulture}.`,
      'Preserve core plot and emotional beats.',
      buildMemoryInstruction(ledger),
      'Output only adapted text.',
    ].join('\n\n');
    setChapterState(projectId, chapterId, { chapterId, status: 'running' });
    setChaptersByProjectId((previous) => patchChapterMeta(previous, projectId, chapterId, { adaptationStatus: 'running', adaptationError: '' }));
    const adapted = String(await generateTextContent(prompt, chapter.text, settings) || '').trim();
    if (!adapted) throw new Error('Adaptation returned empty output.');
    const now = new Date().toISOString();
    setChaptersByProjectId((previous) => patchChapterMeta(previous, projectId, chapterId, {
      adaptedText: adapted,
      adaptationStatus: 'done',
      adaptationError: '',
      lastAdaptedAt: now,
    }));
    setChapterState(projectId, chapterId, { chapterId, status: 'done', lastAdaptedAt: now });
    const extracted = await extractMemoryMappings(chapter.text, adapted);
    mergeLedger(projectId, extracted);
    const summary = await extractChapterSummary(chapter.text, adapted, chapterId, chapter.title, ledger);
    setChapterSummariesByProjectId((previous) => {
      const rows = [...(previous[projectId] || [])];
      const idx = rows.findIndex((row) => row.chapterId === chapterId);
      if (idx >= 0) rows[idx] = summary;
      else rows.push(summary);
      return { ...previous, [projectId]: rows };
    });
    setMemoryLedgerByProjectId((previous) => {
      const current = previous[projectId] || emptyLedger();
      const rows = [...(current.chapterSummaries || [])];
      const idx = rows.findIndex((row) => row.chapterId === chapterId);
      if (idx >= 0) rows[idx] = summary;
      else rows.push(summary);
      return {
        ...previous,
        [projectId]: {
          ...current,
          chapterSummaries: rows,
        },
      };
    });
    appendChapterVersion(projectId, chapterId, chapter.text, adapted, 'adapted', 'ai_adaptation');
    if (selectedProjectId === projectId && selectedChapterId === chapterId) setAdaptedOutput(adapted);
  }, [
    appendChapterVersion,
    extractChapterSummary,
    extractMemoryMappings,
    mergeLedger,
    selectedChapterId,
    selectedProjectId,
    setChapterState,
    settings,
    targetCulture,
    targetLang,
  ]);

  const handleAdaptSelected = async (): Promise<void> => {
    if (!selectedProjectId || !selectedChapterId) {
      onToast('Select a chapter first.', 'info');
      return;
    }
    setIsAdapting(true);
    try {
      await adaptSingleChapter(selectedProjectId, selectedChapterId);
      onToast('Chapter adaptation complete.', 'success');
    } catch (error: any) {
      const message = normalizeError(error);
      setChapterState(selectedProjectId, selectedChapterId, { chapterId: selectedChapterId, status: 'failed', error: message });
      setChaptersByProjectId((previous) => patchChapterMeta(previous, selectedProjectId, selectedChapterId, { adaptationStatus: 'failed', adaptationError: message }));
      onToast(`Adaptation failed: ${message}`, 'error');
    } finally {
      setIsAdapting(false);
    }
  };

  const runBatchFrom = async (startChapterId?: string): Promise<void> => {
    if (!selectedProjectId) return;
    const sourceChapters = [...(chaptersRef.current[selectedProjectId] || [])].sort(chapterSort);
    if (sourceChapters.length === 0) return;
    const startIndex = startChapterId
      ? Math.max(0, sourceChapters.findIndex((chapter) => chapter.id === startChapterId))
      : Math.max(0, sourceChapters.findIndex((chapter) => chapter.id === selectedChapterId));
    const queue = sourceChapters.slice(startIndex >= 0 ? startIndex : 0);
    batchCancelRef.current = false;
    setIsBatchRunning(true);
    setBatchMessage(`Running batch for ${queue.length} chapter(s)...`);
    for (let index = 0; index < queue.length; index += 1) {
      if (batchCancelRef.current) break;
      const chapter = queue[index];
      setBatchMessage(`Adapting ${index + 1}/${queue.length}: ${chapter.title}`);
      try {
        await adaptSingleChapter(selectedProjectId, chapter.id);
      } catch (error: any) {
        const message = normalizeError(error);
        setChapterState(selectedProjectId, chapter.id, { chapterId: chapter.id, status: 'failed', error: message });
        setChaptersByProjectId((previous) => patchChapterMeta(previous, selectedProjectId, chapter.id, { adaptationStatus: 'failed', adaptationError: message }));
      }
    }
    setIsBatchRunning(false);
    setBatchMessage('Batch run finished.');
  };

  const handleRunBatch = async (): Promise<void> => {
    if (isBatchRunning) {
      batchCancelRef.current = true;
      setBatchMessage('Stopping batch after current chapter...');
      return;
    }
    if (!selectedChapterId) {
      onToast('Select a starting chapter.', 'info');
      return;
    }
    if (!targetCulture.trim()) {
      onToast('Target culture is required.', 'info');
      return;
    }
    void runBatchFrom();
  };

  const handleResumeFailedBatch = async (): Promise<void> => {
    if (!selectedProjectId) return;
    const failed = (adaptationStateByProjectId[selectedProjectId] || []).find((row) => row.status === 'failed');
    if (!failed) {
      onToast('No failed chapter found.', 'info');
      return;
    }
    void runBatchFrom(failed.chapterId);
  };

  const handleCreateNovel = (): void => {
    const novelName = sanitizeLabel(newProjectName, '');
    if (!novelName) {
      onToast('Enter a novel name first.', 'info');
      return;
    }
    const now = new Date().toISOString();
    const createdProject: NovelProject = { id: createLocalId('project'), name: novelName, rootFolderId: 'local', createdTime: now, modifiedTime: now };
    setProjects((previous) => [createdProject, ...previous]);
    setChaptersByProjectId((previous) => ({ ...previous, [createdProject.id]: [] }));
    setMemoryLedgerByProjectId((previous) => ({ ...previous, [createdProject.id]: emptyLedger() }));
    setAdaptationStateByProjectId((previous) => ({ ...previous, [createdProject.id]: [] }));
    setChapterSummariesByProjectId((previous) => ({ ...previous, [createdProject.id]: [] }));
    setChapterVersionsByProjectId((previous) => ({ ...previous, [createdProject.id]: {} }));
    setSelectedProjectId(createdProject.id);
    setSelectedChapterId('');
    setChapterText('');
    setAdaptedOutput('');
    lastSavedTextRef.current = '';
    setNewProjectName('');
    onToast('Novel created.', 'success');
  };

  const handleRenameNovel = (project: NovelProject): void => {
    const nextName = window.prompt('Rename novel', project.name);
    const safeName = sanitizeLabel(nextName, '');
    if (!safeName || safeName === project.name) return;
    const now = new Date().toISOString();
    setProjects((previous) => previous.map((item) => item.id === project.id ? { ...item, name: safeName, modifiedTime: now } : item));
    onToast('Novel renamed.', 'success');
  };

  const handleDeleteNovel = (project: NovelProject): void => {
    if (!window.confirm(`Delete "${project.name}" and all chapters?`)) return;
    setProjects((previous) => previous.filter((item) => item.id !== project.id));
    setChaptersByProjectId((previous) => { const next = { ...previous }; delete next[project.id]; return next; });
    setMemoryLedgerByProjectId((previous) => { const next = { ...previous }; delete next[project.id]; return next; });
    setAdaptationStateByProjectId((previous) => { const next = { ...previous }; delete next[project.id]; return next; });
    setChapterSummariesByProjectId((previous) => { const next = { ...previous }; delete next[project.id]; return next; });
    setChapterVersionsByProjectId((previous) => { const next = { ...previous }; delete next[project.id]; return next; });
    if (selectedProjectId === project.id) {
      setSelectedProjectId('');
      setSelectedChapterId('');
      setChapterText('');
      setAdaptedOutput('');
      lastSavedTextRef.current = '';
    }
    onToast('Novel deleted.', 'success');
  };

  const handleCreateChapter = (): void => {
    if (!selectedProjectId) {
      onToast('Select a novel first.', 'info');
      return;
    }
    const existing = chaptersByProjectId[selectedProjectId] || [];
    const nextIndex = Math.max(1, ...existing.map((chapter) => chapter.index + 1));
    const title = sanitizeLabel(newChapterTitle || `Chapter ${nextIndex}`, `Chapter ${nextIndex}`);
    const now = new Date().toISOString();
    const created: LocalNovelChapter = {
      id: createLocalId('chapter'),
      projectId: selectedProjectId,
      title,
      name: buildChapterName(nextIndex, title),
      index: nextIndex,
      text: '',
      adaptedText: '',
      adaptationStatus: 'idle',
      createdTime: now,
      modifiedTime: now,
    };
    setChaptersByProjectId((previous) => ({ ...previous, [selectedProjectId]: [...(previous[selectedProjectId] || []), created].sort(chapterSort) }));
    setSelectedChapterId(created.id);
    setChapterText('');
    setAdaptedOutput('');
    lastSavedTextRef.current = '';
    setNewChapterTitle('');
    onToast('Chapter created.', 'success');
  };

  const handleDeleteChapter = (chapter: NovelChapter): void => {
    if (!selectedProjectId) return;
    if (!window.confirm(`Delete "${chapter.name}"?`)) return;
    setChaptersByProjectId((previous) => ({ ...previous, [selectedProjectId]: (previous[selectedProjectId] || []).filter((item) => item.id !== chapter.id) }));
    setAdaptationStateByProjectId((previous) => ({ ...previous, [selectedProjectId]: (previous[selectedProjectId] || []).filter((item) => item.chapterId !== chapter.id) }));
    setChapterSummariesByProjectId((previous) => ({ ...previous, [selectedProjectId]: (previous[selectedProjectId] || []).filter((item) => item.chapterId !== chapter.id) }));
    setChapterVersionsByProjectId((previous) => {
      const projectRows = { ...(previous[selectedProjectId] || {}) };
      delete projectRows[chapter.id];
      return { ...previous, [selectedProjectId]: projectRows };
    });
    if (selectedChapterId === chapter.id) {
      setSelectedChapterId('');
      setChapterText('');
      setAdaptedOutput('');
      lastSavedTextRef.current = '';
    }
    onToast('Chapter deleted.', 'success');
  };

  const handleManualSave = (): void => {
    if (!selectedProjectId || !selectedChapterId) return;
    setSaveState('saving');
    setChaptersByProjectId((previous) => patchChapterText(previous, selectedProjectId, selectedChapterId, chapterText));
    lastSavedTextRef.current = chapterText;
    appendChapterVersion(selectedProjectId, selectedChapterId, chapterText, adaptedOutput, 'manual_save', 'manual_edit');
    setSaveState('saved');
    onToast('Chapter saved.', 'success');
  };

  const applyAdaptedToEditor = (): void => {
    if (!adaptedOutput.trim()) return;
    setChapterText(adaptedOutput);
  };

  const saveAdaptedAsNewChapter = (): void => {
    if (!selectedProjectId || !adaptedOutput.trim()) return;
    const existing = chaptersByProjectId[selectedProjectId] || [];
    const nextIndex = Math.max(1, ...existing.map((chapter) => chapter.index + 1));
    const baseTitle = selectedChapter?.title || 'Adapted Chapter';
    const title = sanitizeLabel(`${baseTitle} (adapted)`, `Chapter ${nextIndex}`);
    const now = new Date().toISOString();
    const sourceText = chapterText.trim() ? chapterText : (selectedChapter?.text || '');
    const created: LocalNovelChapter = {
      id: createLocalId('chapter'),
      projectId: selectedProjectId,
      title,
      name: buildChapterName(nextIndex, title),
      index: nextIndex,
      text: sourceText,
      adaptedText: adaptedOutput,
      adaptationStatus: 'done',
      lastAdaptedAt: now,
      createdTime: now,
      modifiedTime: now,
    };
    setChaptersByProjectId((previous) => ({ ...previous, [selectedProjectId]: [...(previous[selectedProjectId] || []), created].sort(chapterSort) }));
    setChapterState(selectedProjectId, created.id, { chapterId: created.id, status: 'done', lastAdaptedAt: now });
    appendChapterVersion(selectedProjectId, created.id, sourceText, adaptedOutput, 'adapted_copy', 'save_adapted_as_chapter');
    setSelectedChapterId(created.id);
    setChapterText(sourceText);
    setAdaptedOutput(created.adaptedText || '');
    onToast('Adapted chapter saved.', 'success');
  };

  const handleRevertVersion = (version: ChapterVersionSnapshot): void => {
    if (!selectedProjectId || !selectedChapterId) return;
    if (!window.confirm(`Revert chapter to snapshot "${version.label}"?`)) return;
    const now = new Date().toISOString();
    setChaptersByProjectId((previous) => patchChapterMeta(previous, selectedProjectId, selectedChapterId, {
      text: version.sourceText,
      adaptedText: version.adaptedText,
      modifiedTime: now,
    } as Partial<LocalNovelChapter>));
    setChapterText(version.sourceText);
    setAdaptedOutput(version.adaptedText);
    lastSavedTextRef.current = version.sourceText;
    appendChapterVersion(selectedProjectId, selectedChapterId, version.sourceText, version.adaptedText, `revert:${version.label}`, 'revert');
    onToast('Chapter reverted to selected snapshot.', 'success');
  };

  const updateMemoryRow = (kind: MemoryEntryKind, rowId: string, patch: Partial<MemoryEntry>): void => {
    if (!selectedProjectId) return;
    setMemoryLedgerByProjectId((previous) => {
      const current = previous[selectedProjectId] || emptyLedger();
      const key = kind === 'character' ? 'characters' : 'places';
      return {
        ...previous,
        [selectedProjectId]: {
          ...current,
          [key]: current[key].map((row) => row.id === rowId ? { ...row, ...patch, updatedAt: new Date().toISOString() } : row),
        },
      };
    });
  };

  const removeMemoryRow = (kind: MemoryEntryKind, rowId: string): void => {
    if (!selectedProjectId) return;
    setMemoryLedgerByProjectId((previous) => {
      const current = previous[selectedProjectId] || emptyLedger();
      const key = kind === 'character' ? 'characters' : 'places';
      return { ...previous, [selectedProjectId]: { ...current, [key]: current[key].filter((row) => row.id !== rowId) } };
    });
  };

  const addMemoryRow = (kind: MemoryEntryKind): void => {
    if (!selectedProjectId) return;
    const next: MemoryEntry = {
      id: createLocalId('memory'),
      kind,
      sourceName: '',
      adaptedName: '',
      locked: false,
      updatedAt: new Date().toISOString(),
    };
    setMemoryLedgerByProjectId((previous) => {
      const current = previous[selectedProjectId] || emptyLedger();
      const key = kind === 'character' ? 'characters' : 'places';
      return { ...previous, [selectedProjectId]: { ...current, [key]: [next, ...current[key]] } };
    });
  };

  const addMemoryTagRow = (): void => {
    if (!selectedProjectId) return;
    const sourceName = memoryDraftSource.trim();
    const adaptedName = memoryDraftAdapted.trim();
    if (!sourceName && !adaptedName) {
      addMemoryRow(memoryTab);
      return;
    }
    const next: MemoryEntry = {
      id: createLocalId('memory'),
      kind: memoryTab,
      sourceName,
      adaptedName,
      locked: false,
      updatedAt: new Date().toISOString(),
    };
    setMemoryLedgerByProjectId((previous) => {
      const current = previous[selectedProjectId] || emptyLedger();
      const key = memoryTab === 'character' ? 'characters' : 'places';
      return { ...previous, [selectedProjectId]: { ...current, [key]: [next, ...current[key]] } };
    });
    setMemoryDraftSource('');
    setMemoryDraftAdapted('');
  };

  const handleDriveConnectAction = async (): Promise<void> => {
    setIsConnectingDrive(true);
    try {
      if (driveState.status === 'needs_google_identity') await connectDriveIdentity();
      else await reconsentDriveScopes();
    } catch (error: any) {
      onToast(`Drive connection failed: ${normalizeError(error)}`, 'error');
    } finally {
      setIsConnectingDrive(false);
      void refreshDriveSession();
    }
  };

  const handleUploadCurrentNovelToDrive = async (): Promise<void> => {
    if (driveState.status !== 'connected' || !driveToken || !selectedProjectId || !selectedProject) return;
    setIsUploadingToDrive(true);
    try {
      const driveProject = await createNovelProject(driveToken, selectedProject.name);
      const chaptersToUpload = [...(chaptersByProjectId[selectedProjectId] || [])].sort(chapterSort);
      for (const chapter of chaptersToUpload) await createChapter(driveToken, driveProject.id, chapter.title, chapter.text);
      onToast('Uploaded selected novel to Drive.', 'success');
    } catch (error: any) {
      onToast(`Upload failed: ${normalizeError(error)}`, 'error');
    } finally {
      setIsUploadingToDrive(false);
    }
  };

  const handleDownloadNovelFromDrive = async (): Promise<void> => {
    if (driveState.status !== 'connected' || !driveToken) return;
    setIsDownloadingFromDrive(true);
    try {
      const driveProjects = await listNovelProjects(driveToken);
      if (driveProjects.length === 0) {
        onToast('No Google Drive novel folders found.', 'info');
        return;
      }
      const selectedIndexRaw = window.prompt(driveProjects.map((project, index) => `${index + 1}. ${project.name}`).join('\n'), '1');
      if (!selectedIndexRaw) return;
      const selectedIndex = Number(selectedIndexRaw) - 1;
      if (!Number.isFinite(selectedIndex) || selectedIndex < 0 || selectedIndex >= driveProjects.length) return;
      const driveProject = driveProjects[selectedIndex];
      const driveChapters = (await listChapters(driveToken, driveProject.id)).sort(chapterSort);
      const localProjectId = createLocalId('project');
      const now = new Date().toISOString();
      const localChapters: LocalNovelChapter[] = [];
      for (const driveChapter of driveChapters) {
        const text = await loadChapterText(driveToken, driveChapter.id);
        localChapters.push({
          id: createLocalId('chapter'),
          projectId: localProjectId,
          title: sanitizeLabel(driveChapter.title, 'Untitled Chapter'),
          name: sanitizeLabel(driveChapter.name, driveChapter.title || 'Untitled Chapter'),
          index: driveChapter.index,
          text,
          adaptedText: '',
          adaptationStatus: 'idle',
          createdTime: now,
          modifiedTime: now,
        });
      }
      setProjects((previous) => [{ id: localProjectId, name: buildUniqueProjectName(previous, driveProject.name), rootFolderId: 'local', createdTime: now, modifiedTime: now }, ...previous]);
      setChaptersByProjectId((previous) => ({ ...previous, [localProjectId]: localChapters }));
      setMemoryLedgerByProjectId((previous) => ({ ...previous, [localProjectId]: emptyLedger() }));
      setAdaptationStateByProjectId((previous) => ({ ...previous, [localProjectId]: [] }));
      setChapterSummariesByProjectId((previous) => ({ ...previous, [localProjectId]: [] }));
      setChapterVersionsByProjectId((previous) => ({ ...previous, [localProjectId]: {} }));
      setSelectedProjectId(localProjectId);
      setSelectedChapterId(localChapters[0]?.id || '');
      onToast('Downloaded novel from Drive.', 'success');
    } catch (error: any) {
      onToast(`Download failed: ${normalizeError(error)}`, 'error');
    } finally {
      setIsDownloadingFromDrive(false);
    }
  };

  const addImportFiles = useCallback((incoming: FileList | File[] | null | undefined): void => {
    if (!incoming) return;
    const next = Array.from(incoming);
    if (next.length === 0) return;
    setImportFiles((previous) => {
      const seen = new Set(previous.map((file) => `${file.name}::${file.size}::${file.lastModified}`));
      const merged = [...previous];
      next.forEach((file) => {
        const key = `${file.name}::${file.size}::${file.lastModified}`;
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(file);
      });
      return merged;
    });
  }, []);

  const resetImportState = (): void => {
    setImportFiles([]);
    setImportRawText('');
    setImportWarnings([]);
    setImportDiagnostics(null);
    setImportPreviewChapters([]);
  };

  const handleExtractImport = async (): Promise<void> => {
    if (importFiles.length === 0) return;
    setIsImportExtracting(true);
    try {
      const collectedRawText: string[] = [];
      const collectedWarnings: string[] = [];
      const collectedChapters: EditableImportChapter[] = [];
      let primaryDiagnostics: NovelImportExtractDiagnostics | null = null;

      setIsImportSplitting(true);
      for (const file of importFiles) {
        const extracted = await extractNovelTextFromFile(mediaBackendUrl, file, 'auto');
        if (!primaryDiagnostics) primaryDiagnostics = extracted.diagnostics;
        collectedWarnings.push(
          ...extracted.diagnostics.warnings.map((warning) => `${file.name}: ${warning}`)
        );
        collectedRawText.push(`\n\n===== ${file.name} =====\n${extracted.rawText}`);
        const split = await splitImportedTextToChapters(mediaBackendUrl, extracted.rawText, 'auto');
        collectedWarnings.push(
          ...split.warnings.map((warning) => `${file.name}: ${warning}`)
        );
        split.chapters.forEach((chapter) => {
          collectedChapters.push({
            ...chapter,
            id: createLocalId('import'),
            sourceFileName: file.name,
          });
        });
      }

      setImportRawText(collectedRawText.join('\n'));
      setImportDiagnostics(primaryDiagnostics);
      setImportWarnings(collectedWarnings);
      setImportPreviewChapters(collectedChapters);
      onToast(
        `Prepared ${collectedChapters.length} chapter(s) from ${importFiles.length} file(s).`,
        'success'
      );
    } catch (error: any) {
      onToast(`Import failed: ${normalizeError(error)}`, 'error');
    } finally {
      setIsImportExtracting(false);
      setIsImportSplitting(false);
    }
  };

  const handleApplyImportChapters = (): void => {
    if (!selectedProjectId) return;
    const valid = importPreviewChapters.filter((chapter) => chapter.text.trim());
    if (valid.length === 0) return;
    const existing = chaptersByProjectId[selectedProjectId] || [];
    let nextIndex = Math.max(1, ...existing.map((chapter) => chapter.index + 1));
    const now = new Date().toISOString();
    const created = valid.map((row) => {
      const title = sanitizeLabel(row.title || `Chapter ${nextIndex}`, `Chapter ${nextIndex}`);
      const chapter: LocalNovelChapter = {
        id: createLocalId('chapter'),
        projectId: selectedProjectId,
        title,
        name: buildChapterName(nextIndex, title),
        index: nextIndex,
        text: row.text,
        adaptedText: '',
        adaptationStatus: 'idle',
        createdTime: now,
        modifiedTime: now,
      };
      nextIndex += 1;
      return chapter;
    });
    setChaptersByProjectId((previous) => ({ ...previous, [selectedProjectId]: [...(previous[selectedProjectId] || []), ...created].sort(chapterSort) }));
    setSelectedChapterId(created[0]?.id || '');
    setIsImportModalOpen(false);
    resetImportState();
  };

  const canConnectDrive = driveState.status !== 'checking' && driveState.status !== 'connected';
  const connectLabel = driveState.status === 'needs_google_identity' ? 'Link Google Account' : driveState.status === 'needs_login' ? 'Login with Google' : 'Reconnect Google Drive';

  return (
    <div className="max-w-[1280px] mx-auto animate-in fade-in h-full flex flex-col pb-8">
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Novel Workspace</h2>
          <p className="text-sm text-gray-500">Chapter-by-chapter adaptation with lockable memory and import flow.</p>
        </div>
        <div className="flex gap-2">
          <button
            ref={importTriggerRef}
            onClick={() => setIsImportModalOpen(true)}
            className="px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 flex items-center gap-2"
          >
            <FileUp size={14} />Import File
          </button>
          <button
            onClick={() => { void bindLocalFolder(); }}
            disabled={isBindingLocalFolder}
            className="px-3 py-2 rounded-xl border border-indigo-200 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {isBindingLocalFolder ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} />}
            Bind Local Folder
          </button>
          <button onClick={() => { void refreshDriveSession(); }} className="px-3 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 bg-white hover:bg-gray-50"><RefreshCw size={14} className={driveState.status === 'checking' ? 'animate-spin inline mr-2' : 'inline mr-2'} />Refresh Drive</button>
        </div>
      </div>
      <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-700">
        {boundLocalFolderName ? `Local folder: ${boundLocalFolderName}` : 'No local folder bound'}.
        {localFolderStatus ? ` ${localFolderStatus}` : ''}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 min-h-[650px]">
        <div className="xl:col-span-3 bg-white rounded-2xl border border-gray-200 p-4 space-y-4">
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Create Novel</label>
            <div className="flex gap-2">
              <input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="Novel name" className="flex-1 p-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 outline-none" />
              <button onClick={handleCreateNovel} className="px-3 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700" aria-label="Create novel"><Plus size={16} /></button>
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto custom-scrollbar space-y-1.5">
            {projects.length === 0 && <p className="text-xs text-gray-500">No local novels yet.</p>}
            {projects.map((project) => (
              <div key={project.id} className={`p-2.5 rounded-xl border ${selectedProjectId === project.id ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedProjectId(project.id)}
                    className="min-w-0 flex-1 text-left text-sm font-semibold text-gray-800 truncate"
                  >
                    {project.name}
                  </button>
                  <div className="flex gap-1">
                    <button onClick={() => handleRenameNovel(project)} className="text-[10px] px-2 py-1 rounded-lg bg-gray-100 text-gray-600">Rename</button>
                    <button onClick={() => handleDeleteNovel(project)} className="text-[10px] px-2 py-1 rounded-lg bg-red-50 text-red-700" aria-label={`Delete novel ${project.name}`}><Trash2 size={11} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Create Chapter</label>
            <div className="flex gap-2">
              <input value={newChapterTitle} onChange={(e) => setNewChapterTitle(e.target.value)} placeholder="Chapter title" className="flex-1 p-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 outline-none" />
              <button onClick={handleCreateChapter} className="px-3 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700" aria-label="Create chapter"><Plus size={16} /></button>
            </div>
            <div className="mt-3 max-h-44 overflow-y-auto custom-scrollbar space-y-1.5">
              {chapters.map((chapter) => {
                const state = selectedStateMap.get(chapter.id)?.status || chapter.adaptationStatus || 'idle';
                return (
                  <div key={chapter.id} className="flex items-center gap-1.5">
                    <button onClick={() => setSelectedChapterId(chapter.id)} className={`flex-1 text-left p-2 rounded-lg border text-xs font-semibold ${chapter.id === selectedChapterId ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-700'}`}>
                      <div className="truncate">{chapter.name}</div>
                      <div className="text-[10px] text-gray-500 mt-1">{state}</div>
                    </button>
                    <button onClick={() => handleDeleteChapter(chapter)} className="px-2.5 py-2 rounded-lg border border-red-100 bg-red-50 text-red-700" aria-label={`Delete chapter ${chapter.name}`}><Trash2 size={12} /></button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="xl:col-span-6 bg-white rounded-2xl border border-gray-200 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-gray-100 flex items-center justify-between gap-2 bg-gray-50">
            <div className="min-w-0">
              <p className="text-xs font-bold text-gray-500 uppercase">Editor</p>
              <p className="text-sm font-semibold text-gray-800 truncate">{selectedProject?.name || 'No novel selected'} {selectedChapter ? ` / ${selectedChapter.title}` : ''}</p>
            </div>
            <button onClick={handleManualSave} disabled={!selectedChapterId} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1"><Save size={12} />Save</button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 min-h-0 flex-1">
            <div className="flex min-h-0 flex-col border-r border-gray-100">
              <div className="border-b border-gray-100 bg-gray-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-gray-500">Source</div>
              <textarea value={chapterText} onChange={(e) => setChapterText(e.target.value)} placeholder="Source chapter..." className="min-h-[260px] flex-1 p-4 resize-none outline-none text-[15px] leading-relaxed text-gray-800 font-serif" />
            </div>
            <div className="flex min-h-0 flex-col">
              <div className="border-b border-gray-100 bg-gray-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-gray-500">Adapted</div>
              <textarea value={adaptedOutput} onChange={(e) => setAdaptedOutput(e.target.value)} placeholder="Adapted output..." className="min-h-[260px] flex-1 p-4 resize-none outline-none text-[15px] leading-relaxed text-gray-800 font-serif" />
            </div>
          </div>
          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 flex flex-wrap gap-2 justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">{saveState}</span>
              {sourceAndAdaptedSame && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                  Source and adapted panes currently match
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={applyAdaptedToEditor} disabled={!adaptedOutput.trim()} className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 disabled:opacity-50">Replace Source</button>
              <button onClick={saveAdaptedAsNewChapter} disabled={!adaptedOutput.trim()} className="px-3 py-1.5 rounded-lg border border-emerald-200 text-xs font-semibold text-emerald-700 disabled:opacity-50">Save Adapted as Chapter</button>
            </div>
          </div>
        </div>

        <div className="xl:col-span-3 space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-2"><Wand2 size={16} className="text-indigo-600" /><h3 className="text-sm font-bold text-gray-800">Adaptation</h3></div>
            <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)} className="w-full p-2.5 border border-gray-200 rounded-xl text-xs bg-gray-50 mb-2">
              <option value="Hinglish">Hinglish</option>
              <option value="English">English</option>
              <option value="Hindi">Hindi</option>
              {LANGUAGES.map((lang) => <option key={lang.code} value={lang.name}>{lang.name}</option>)}
            </select>
            <input value={targetCulture} onChange={(e) => setTargetCulture(e.target.value)} placeholder="Target culture" className="w-full p-2.5 border border-gray-200 rounded-xl text-xs bg-gray-50 mb-2" />
            <button onClick={() => { void handleAdaptSelected(); }} disabled={isAdapting || isBatchRunning || !selectedChapterId} className="w-full px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 mb-2">{isAdapting ? 'Adapting...' : 'Adapt Chapter'}</button>
            <button onClick={() => { void handleRunBatch(); }} disabled={isAdapting || !selectedChapterId} className="w-full px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold disabled:opacity-50 mb-2">{isBatchRunning ? 'Stop Batch' : 'Run Batch'}</button>
            <button onClick={() => { void handleResumeFailedBatch(); }} disabled={isBatchRunning} className="w-full px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-xs font-bold disabled:opacity-50">Resume Failed</button>
            {batchMessage && <p className="text-[11px] text-gray-600 mt-2">{batchMessage}</p>}
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <h3 className="text-sm font-bold text-gray-800 mb-2">Chapter Memory</h3>
            {selectedChapterSummary ? (
              <div className="space-y-2 text-xs text-gray-700">
                <p className="rounded-lg border border-gray-200 bg-gray-50 p-2">{selectedChapterSummary.summary || 'No summary generated yet.'}</p>
                <div>
                  <p className="text-[11px] font-semibold text-gray-600 mb-1">New Characters</p>
                  <p className="text-[11px] text-gray-700">{selectedChapterSummary.newCharacters.length > 0 ? selectedChapterSummary.newCharacters.join(', ') : 'None'}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-gray-600 mb-1">New Places</p>
                  <p className="text-[11px] text-gray-700">{selectedChapterSummary.newPlaces.length > 0 ? selectedChapterSummary.newPlaces.join(', ') : 'None'}</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-500">Run adaptation to generate chapter summary.</p>
            )}
            <div className="mt-3 border-t border-gray-100 pt-3">
              <p className="text-xs font-bold text-gray-600 mb-2">Versions (Revert)</p>
              <div className="max-h-44 overflow-y-auto custom-scrollbar space-y-1.5">
                {selectedChapterVersions.length === 0 && <p className="text-[11px] text-gray-500">No snapshots yet.</p>}
                {selectedChapterVersions.slice(0, 12).map((row) => (
                  <div key={row.id} className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-semibold text-gray-700">{row.label}</p>
                        <p className="text-[10px] text-gray-500">{new Date(row.timestamp).toLocaleString()}</p>
                      </div>
                      <button
                        onClick={() => handleRevertVersion(row)}
                        className="rounded-md border border-indigo-200 bg-white px-2 py-1 text-[10px] font-semibold text-indigo-700"
                      >
                        Revert
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-800">Memory Ledger</h3>
              <button onClick={addMemoryTagRow} className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">+ Add Tag</button>
            </div>
            <div className="flex gap-2 mb-2">
              <button onClick={() => setMemoryTab('character')} className={`flex-1 px-2 py-1.5 rounded text-xs ${memoryTab === 'character' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>Characters</button>
              <button onClick={() => setMemoryTab('place')} className={`flex-1 px-2 py-1.5 rounded text-xs ${memoryTab === 'place' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>Places</button>
            </div>
            <div className="mb-2 rounded-xl border border-gray-200 bg-gray-50 p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  value={memoryDraftSource}
                  onChange={(event) => setMemoryDraftSource(event.target.value)}
                  placeholder="Source name"
                  className="min-w-[110px] flex-1 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] outline-none focus:border-indigo-400"
                />
                <ArrowRight size={12} className="text-gray-400" />
                <input
                  value={memoryDraftAdapted}
                  onChange={(event) => setMemoryDraftAdapted(event.target.value)}
                  placeholder="Adapted name"
                  className="min-w-[110px] flex-1 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] outline-none focus:border-indigo-400"
                />
                <button
                  onClick={addMemoryTagRow}
                  className="rounded-full border border-indigo-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50"
                >
                  Add
                </button>
              </div>
            </div>
            <input value={memoryFilter} onChange={(e) => setMemoryFilter(e.target.value)} placeholder="Filter" className="w-full p-2 border border-gray-200 rounded text-xs bg-gray-50 mb-2" />
            <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar">
              {filteredMemoryRows.map((row) => (
                <div key={row.id} className="vf-card-lift rounded-xl border border-gray-200 bg-gray-50 p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      value={row.sourceName}
                      onChange={(e) => updateMemoryRow(memoryTab, row.id, { sourceName: e.target.value })}
                      className="min-w-[110px] flex-1 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium text-gray-700 outline-none focus:border-indigo-400"
                    />
                    <ArrowRight size={12} className="text-gray-400" />
                    <input
                      value={row.adaptedName}
                      onChange={(e) => updateMemoryRow(memoryTab, row.id, { adaptedName: e.target.value })}
                      className="min-w-[110px] flex-1 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-indigo-700 outline-none focus:border-indigo-400"
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium text-gray-500">
                      {row.locked ? 'Locked mapping' : 'Editable mapping'}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateMemoryRow(memoryTab, row.id, { locked: !row.locked })}
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                          row.locked ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-600'
                        }`}
                      >
                        {row.locked ? <Lock size={11} className="inline mr-1" /> : <Unlock size={11} className="inline mr-1" />}
                        {row.locked ? 'Locked' : 'Open'}
                      </button>
                      <button onClick={() => removeMemoryRow(memoryTab, row.id)} className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700">
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <button onClick={() => setShowAdvancedDrive((prev) => !prev)} className="w-full flex justify-between items-center text-sm font-bold text-gray-800"><span>Advanced: Google Drive</span>{showAdvancedDrive ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
            {showAdvancedDrive && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-gray-600">{driveState.message}</p>
                <Button onClick={handleDriveConnectAction} disabled={!canConnectDrive || isConnectingDrive} className="w-full bg-indigo-600 hover:bg-indigo-700">{isConnectingDrive ? <Loader2 size={14} className="animate-spin mr-2" /> : <FolderOpen size={14} className="mr-2" />}{driveState.status === 'connected' ? 'Drive Connected' : connectLabel}</Button>
                <button onClick={() => { void handleUploadCurrentNovelToDrive(); }} disabled={driveState.status !== 'connected' || isUploadingToDrive || !selectedProjectId} className="w-full px-3 py-2 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-2">{isUploadingToDrive ? <Loader2 size={12} className="animate-spin" /> : <CloudUpload size={12} />}Upload Selected Folder</button>
                <button onClick={() => { void handleDownloadNovelFromDrive(); }} disabled={driveState.status !== 'connected' || isDownloadingFromDrive} className="w-full px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold disabled:opacity-50 flex items-center justify-center gap-2">{isDownloadingFromDrive ? <Loader2 size={12} className="animate-spin" /> : <CloudDownload size={12} />}Download Folder to Local</button>
              </div>
            )}
          </div>
        </div>
      </div>
      {isImportModalOpen && (
        <div
          className="fixed inset-0 md:left-64 z-[90] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 md:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Import novel files"
        >
          <div ref={importModalRef} tabIndex={-1} className="w-full max-w-3xl bg-white rounded-2xl border border-gray-200 shadow-xl p-4">
            <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold text-gray-800">Import Novel File(s)</h3>
                  <button onClick={() => { setIsImportModalOpen(false); resetImportState(); }} className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50" aria-label="Close import dialog">Close</button>
                </div>
            <div className="mb-2">
              <UploadDropzone
                accept=".txt,.pdf,.png,.jpg,.jpeg,.webp"
                multiple
                files={importFiles}
                onFilesSelected={(incoming) => addImportFiles(incoming)}
                label="Drag and drop files here"
                hint="TXT, PDF, PNG, JPG, JPEG, WEBP"
                dragLabel="Drop files to import"
                className="min-h-[96px] flex items-center justify-center"
              />
              {importFiles.length > 0 && (
                <div className="mt-2 max-h-24 space-y-1 overflow-y-auto custom-scrollbar">
                  {importFiles.map((file) => (
                    <div key={`${file.name}_${file.size}_${file.lastModified}`} className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-2 py-1">
                      <span className="truncate text-[11px] text-gray-700">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => setImportFiles((previous) => previous.filter((item) => !(item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)))}
                        className="ml-2 text-[11px] font-semibold text-red-600 hover:text-red-700"
                        aria-label={`Remove ${file.name}`}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-2 mb-2">
              <button onClick={() => { void handleExtractImport(); }} disabled={importFiles.length === 0 || isImportExtracting || isImportSplitting} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50">{isImportExtracting ? 'Extracting...' : 'Extract + Auto Split'}</button>
              <button onClick={handleApplyImportChapters} disabled={importPreviewChapters.length === 0 || !selectedProjectId} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50">Create Chapters</button>
            </div>
            {importFiles.length > 0 && <div className="text-[11px] text-gray-500 mb-2">{importFiles.length} file(s) selected</div>}
            {importDiagnostics && <div className="text-xs text-indigo-700 mb-2">Mode: {importDiagnostics.mode} | AI fallback: {importDiagnostics.usedAiFallback ? 'Yes' : 'No'}</div>}
            <textarea value={importRawText} onChange={(e) => setImportRawText(e.target.value)} className="w-full h-40 p-2 border border-gray-200 rounded-xl text-xs mb-2" />
            <div className="space-y-2 max-h-44 overflow-y-auto custom-scrollbar">
              {importPreviewChapters.map((chapter) => (
                <div key={chapter.id} className="p-2 border border-gray-200 rounded-lg bg-gray-50">
                  {chapter.sourceFileName && <div className="mb-1 text-[10px] font-semibold text-gray-500">{chapter.sourceFileName}</div>}
                  <input value={chapter.title} onChange={(e) => setImportPreviewChapters((prev) => prev.map((row) => row.id === chapter.id ? { ...row, title: e.target.value } : row))} className="w-full p-1.5 border border-gray-200 rounded text-xs mb-1" />
                  <textarea value={chapter.text} onChange={(e) => setImportPreviewChapters((prev) => prev.map((row) => row.id === chapter.id ? { ...row, text: e.target.value } : row))} className="w-full h-20 p-1.5 border border-gray-200 rounded text-xs" />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
