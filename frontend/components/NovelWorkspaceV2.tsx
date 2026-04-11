import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CloudDownload,
  CloudUpload,
  FileUp,
  FolderOpen,
  Loader2,
  Lock,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Unlock,
  Wand2,
} from 'lucide-react';
import { Button } from './Button';
import { ProofreadCluster } from './ProofreadCluster';
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
import { useWorkspaceViewport } from '../src/shared/ui/useWorkspaceViewport';
import { hasAdminConsoleAccess } from '../src/shared/auth/adminAccess';
import { formatFrontendError } from '../src/shared/errors/formatFrontendError';
import {
  getNovelRootFolder,
  isNovelLocalFsSupported,
  pickNovelRootFolder,
  syncNovelProjectToFolder,
} from '../services/novelLocalFsService';
import {
  persistNovelWorkspaceMeta,
  readNovelWorkspaceMeta,
  readNovelWorkspaceSnapshot,
  writeNovelWorkspaceSnapshot,
} from '../src/features/novel/services/localSnapshotStorage';
import { PublishingPanel } from '../src/features/publishing/components/PublishingPanel';

type ToastKind = 'success' | 'error' | 'info';

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
  const resolvedProjectId = nextProjectId && snapshot.projects.some((project) => project.id === nextProjectId)
    ? nextProjectId
    : snapshot.selectedProjectId;
  const projectChapters = snapshot.chaptersByProjectId[resolvedProjectId] || [];
  const nextChapterId = String(meta.selectedChapterId || '').trim();
  const resolvedChapterId = nextChapterId && projectChapters.some((chapter) => chapter.id === nextChapterId)
    ? nextChapterId
    : snapshot.selectedChapterId;
  return {
    ...snapshot,
    selectedProjectId: resolvedProjectId,
    selectedChapterId: resolvedChapterId,
  };
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
    // Ignore local persistence failures (quota/private mode) so editor interactions keep working.
    console.warn('Failed to persist local novel snapshot.', error);
  }
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

type NovelCreateMode = 'novel' | 'chapter';
type MobileToolsTab = 'adaptation' | 'memory' | 'settings' | 'publish';

export const NovelWorkspaceV2: React.FC<NovelWorkspaceV2Props> = ({ settings, mediaBackendUrl, onToast, onSendToStudio }) => {
  const { width, isPhone, isTablet, isDesktop } = useWorkspaceViewport();
  const layoutMode = isPhone ? 'phone' : isTablet ? 'tablet' : 'desktop';
  const isTightPhone = isPhone && width < 460;
  const [mobileEditorPane, setMobileEditorPane] = useState<'source' | 'adapted'>('source');
  const [mobilePanelOpen, setMobilePanelOpen] = useState({
    library: true,
  });
  const [mobileLibraryTab, setMobileLibraryTab] = useState<NovelCreateMode>('novel');
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [mobileToolsTab, setMobileToolsTab] = useState<MobileToolsTab>('adaptation');
  const { user } = useUser();
  const canSeeAdminDiagnostics = hasAdminConsoleAccess(user);
  const [driveState, setDriveState] = useState<DriveConnectionState>(buildDriveState('checking', 'Checking Google Drive access...'));
  const [driveToken, setDriveToken] = useState('');
  const [isConnectingDrive, setIsConnectingDrive] = useState(false);
  const [isUploadingToDrive, setIsUploadingToDrive] = useState(false);
  const [isDownloadingFromDrive, setIsDownloadingFromDrive] = useState(false);

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

  const [isLibraryCollapsed, setIsLibraryCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('novel-v2-library-collapsed');
      return saved === 'true';
    }
    return false;
  });
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('novel-v2-inspector-collapsed');
      return saved === 'true';
    }
    return false;
  });

  useEffect(() => {
    localStorage.setItem('novel-v2-library-collapsed', String(isLibraryCollapsed));
  }, [isLibraryCollapsed]);

  useEffect(() => {
    localStorage.setItem('novel-v2-inspector-collapsed', String(isInspectorCollapsed));
  }, [isInspectorCollapsed]);

  const toggleMobilePanel = (panel: keyof typeof mobilePanelOpen) => {
    setMobilePanelOpen((prev) => ({ ...prev, [panel]: !prev[panel] }));
  };

  const toNovelPublicError = useCallback((errorLike: unknown, fallback: string, context: 'auth' | 'media' | 'runtime' = 'media'): string => (
    formatFrontendError(errorLike, {
      fallback,
      context,
      isAdmin: canSeeAdminDiagnostics,
    }).publicMessage
  ), [canSeeAdminDiagnostics]);

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
  const selectedChapterIndex = useMemo(
    () => chapters.findIndex((chapter) => chapter.id === selectedChapterId),
    [chapters, selectedChapterId]
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
  const hasPreviousChapter = selectedChapterIndex > 0;
  const hasNextChapter = selectedChapterIndex >= 0 && selectedChapterIndex < chapters.length - 1;
  const goToPreviousChapter = useCallback(() => {
    if (!hasPreviousChapter) return;
    const previousChapter = chapters[selectedChapterIndex - 1];
    if (!previousChapter) return;
    setSelectedChapterId(previousChapter.id);
  }, [chapters, hasPreviousChapter, selectedChapterIndex]);
  const goToNextChapter = useCallback(() => {
    if (!hasNextChapter) return;
    const nextChapter = chapters[selectedChapterIndex + 1];
    if (!nextChapter) return;
    setSelectedChapterId(nextChapter.id);
  }, [chapters, hasNextChapter, selectedChapterIndex]);

  const refreshDriveSession = useCallback(async () => {
    setDriveState(buildDriveState('checking', 'Checking Google Drive access...'));
    const auth = await getDriveProviderToken();
    if (!auth.ok || !auth.token) {
      setDriveToken('');
      const safeMessage = toNovelPublicError(auth.message, 'Google Drive needs to be reconnected.', 'auth');
      if (auth.status === 'needs_google_identity') setDriveState(buildDriveState('needs_google_identity', safeMessage));
      else if (auth.status === 'needs_consent') setDriveState(buildDriveState('needs_consent', safeMessage));
      else if (auth.status === 'needs_login' || auth.status === 'guest') setDriveState(buildDriveState('needs_login', safeMessage));
      else setDriveState(buildDriveState('error', safeMessage));
      return;
    }
    const accessProbe = await verifyDriveAccess(auth.token);
    if (!accessProbe.ok) {
      setDriveToken('');
      setDriveState(buildDriveState('needs_consent', toNovelPublicError(accessProbe.message, 'Google Drive needs additional permission.', 'auth')));
      return;
    }
    setDriveToken(auth.token);
    setDriveState(buildDriveState('connected', 'Google Drive connected for folder upload/download.'));
  }, [toNovelPublicError]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const snapshot = await readLocalSnapshot();
      if (!active) return;
      setProjects(snapshot.projects);
      setChaptersByProjectId(snapshot.chaptersByProjectId);
      setMemoryLedgerByProjectId(snapshot.memoryLedgerByProjectId);
      setAdaptationStateByProjectId(snapshot.adaptationStateByProjectId);
      setChapterSummariesByProjectId(snapshot.chapterSummariesByProjectId || {});
      setChapterVersionsByProjectId(snapshot.chapterVersionsByProjectId || {});
      setSelectedProjectId(snapshot.selectedProjectId);
      setSelectedChapterId(snapshot.selectedChapterId);
      setIsHydratingLocal(false);
    })();
    return () => {
      active = false;
    };
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
      const message = toNovelPublicError(error, 'Local folder binding failed.');
      setLocalFolderStatus(message);
      onToast(message, 'error');
    } finally {
      setIsBindingLocalFolder(false);
    }
  }, [onToast, toNovelPublicError]);

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
    const importTriggerElement = importTriggerRef.current;
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
      if (!first || !last) return;
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
      } else if (importTriggerElement) {
        importTriggerElement.focus();
      }
    };
  }, [isImportModalOpen]);

  useEffect(() => {
    if (isHydratingLocal) return;
    void writeLocalSnapshot({
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
    if (isHydratingLocal || !selectedProjectId || isAdapting || isBatchRunning) return;
    const timer = window.setTimeout(() => {
      void syncProjectToLocalFolder(selectedProjectId).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    isAdapting,
    isBatchRunning,
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
  }, [selectedProjectId, selectedChapterId, chaptersByProjectId]);

  useEffect(() => {
    if (isHydratingLocal || !selectedProjectId || !selectedChapterId) return;
    if (chapterText === lastSavedTextRef.current) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      setChaptersByProjectId((previous) => patchChapterText(previous, selectedProjectId, selectedChapterId, chapterText));
      lastSavedTextRef.current = chapterText;
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
      const message = toNovelPublicError(error, 'Chapter adaptation failed.');
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
      if (!chapter) continue;
      setBatchMessage(`Adapting ${index + 1}/${queue.length}: ${chapter.title}`);
      try {
        await adaptSingleChapter(selectedProjectId, chapter.id);
      } catch (error: any) {
        const message = toNovelPublicError(error, 'Chapter adaptation failed.');
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

  const createNovelFromName = (rawName: string): boolean => {
    const novelName = sanitizeLabel(rawName, '');
    if (!novelName) {
      onToast('Enter a novel name first.', 'info');
      return false;
    }
    const now = new Date().toISOString();
    const createdProject: NovelProject = {
      id: createLocalId('project'),
      name: novelName,
      rootFolderId: 'local',
      createdTime: now,
      modifiedTime: now,
    };
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
    onToast('Novel created.', 'success');
    return true;
  };

  const handleRenameNovel = (project: NovelProject): void => {
    const nextName = window.prompt('Rename novel', project.name);
    const safeName = sanitizeLabel(nextName ?? '', '');
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

  const createChapterFromTitle = (rawTitle: string): boolean => {
    if (!selectedProjectId) {
      onToast('Select a novel first.', 'info');
      return false;
    }
    const existing = chaptersByProjectId[selectedProjectId] || [];
    const nextIndex = Math.max(1, ...existing.map((chapter) => chapter.index + 1));
    const title = sanitizeLabel(rawTitle || `Chapter ${nextIndex}`, `Chapter ${nextIndex}`);
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
    onToast('Chapter created.', 'success');
    return true;
  };

  const handleCreateNovel = (): void => {
    if (!createNovelFromName(newProjectName)) return;
    setNewProjectName('');
  };

  const handleCreateChapter = (): void => {
    if (!createChapterFromTitle(newChapterTitle)) return;
    setNewChapterTitle('');
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
    setChaptersByProjectId((previous) => patchChapterText(previous, selectedProjectId, selectedChapterId, chapterText));
    lastSavedTextRef.current = chapterText;
    appendChapterVersion(selectedProjectId, selectedChapterId, chapterText, adaptedOutput, 'manual_save', 'manual_edit');
    onToast('Chapter saved.', 'success');
  };

  const sendEditorTextToStudio = (pane: 'source' | 'adapted'): void => {
    const nextText = pane === 'source' ? chapterText : adaptedOutput;
    if (!nextText.trim()) {
      onToast(pane === 'source' ? 'Source text is empty.' : 'Adapted text is empty.', 'info');
      return;
    }
    onSendToStudio(nextText);
  };

  const handleProofread = useCallback(async (mode: 'grammar' | 'flow' | 'novel') => {
    if (!selectedChapterId || !chapterText.trim()) {
      onToast('Chapter text is empty.', 'info');
      return;
    }
    setIsAdapting(true);
    try {
      const systemPrompt = mode === 'grammar'
        ? 'Act as a professional proofreader. Fix spelling, punctuation, and syntax errors while keeping the story exactly the same. Output ONLY the corrected text.'
        : mode === 'flow'
        ? 'Act as an editor. Optimize the flow, readability, and naturalness of the prose while preserving the meaning and tone. Output ONLY the corrected text.'
        : 'Act as a professional novel editor. Enhance the text for a premium AI Audio Novel experience. Improve descriptive language and emotional resonance. Output ONLY the corrected text.';

      const corrected = await generateTextContent(systemPrompt, chapterText, settings);
      if (corrected) {
        setAdaptedOutput(corrected);
        onToast(`Proofreading (${mode}) complete. View results in Adapted tab.`, 'success');
        appendChapterVersion(selectedProjectId, selectedChapterId, chapterText, corrected, `proofread_${mode}`, 'ai_proofread');
      }
    } catch (error: any) {
      onToast(`Proofreading failed: ${toNovelPublicError(error, 'Proofreading failed.')}`, 'error');
    } finally {
      setIsAdapting(false);
    }
  }, [chapterText, selectedChapterId, selectedProjectId, settings, onToast, toNovelPublicError, appendChapterVersion]);

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
      onToast(`Drive connection failed: ${toNovelPublicError(error, 'Drive connection failed.', 'auth')}`, 'error');
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
      const remoteChapters = await listChapters(driveToken, driveProject.id);
      let nextChapterIndex = Math.max(1, ...remoteChapters.map((chapter) => chapter.index + 1));
      for (const chapter of chaptersToUpload) {
        await createChapter(driveToken, driveProject.id, chapter.title, chapter.text, nextChapterIndex);
        nextChapterIndex += 1;
      }
      onToast('Uploaded selected novel to Drive.', 'success');
    } catch (error: any) {
      onToast(`Upload failed: ${toNovelPublicError(error, 'Upload failed.')}`, 'error');
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
      if (!driveProject) return;
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
      onToast(`Download failed: ${toNovelPublicError(error, 'Download failed.')}`, 'error');
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
      onToast(`Import failed: ${toNovelPublicError(error, 'Import failed.')}`, 'error');
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
  const novelCountLabel = `${projects.length} novel${projects.length === 1 ? '' : 's'}`;
  const phoneChipControlClassName = 'min-h-9 rounded-full px-2.5 text-[10px] font-semibold';
  const phoneInputClassName = 'min-h-9 rounded-xl px-2.5 text-[11px]';
  const phoneSectionTitleClassName = 'text-[10px] font-bold uppercase tracking-wide text-gray-500';
  const toolbarButtonClassName = isPhone
    ? `inline-flex w-full items-center justify-center gap-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${phoneChipControlClassName}`
    : isTablet
      ? 'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto'
      : 'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto';
  const sectionToggleButtonClassName = isPhone
    ? 'mb-1.5 flex min-h-9 w-full items-center justify-between gap-1.5 rounded-xl px-1 text-left'
    : isTablet
      ? 'mb-2 flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-1 text-left'
      : 'mb-2 flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-1 text-left';
  const compactActionButtonClassName = isPhone
    ? 'inline-flex min-h-9 items-center justify-center rounded-full px-2 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'
    : isTablet
      ? 'inline-flex min-h-10 items-center justify-center rounded-lg px-2.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'
      : 'inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
  const pillActionButtonClassName = isPhone
    ? 'inline-flex min-h-8 items-center justify-center rounded-full px-2.5 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'
    : isTablet
      ? 'inline-flex min-h-10 items-center justify-center rounded-full px-3 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'
      : 'inline-flex min-h-10 items-center justify-center rounded-full px-3 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
  const headerSegmentButtonClassName = isPhone
    ? 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-full px-2.5 text-[10px] font-semibold text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50'
    : isTablet
      ? 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full px-3 text-[10px] font-semibold text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50'
      : 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full px-3 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50';
  const headerPrimaryActionButtonClassName = isPhone
    ? 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full bg-indigo-600 px-3 text-[10px] font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50'
    : isTablet
      ? 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full bg-indigo-600 px-3.5 text-[11px] font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50'
      : 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full bg-indigo-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50';
  const cacheBadgeClassName = isPhone
    ? 'rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-700'
    : isTablet
      ? 'rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700'
      : 'rounded-full border border-emerald-200 bg-emerald-50 px-3 py-0.5 text-[10px] font-semibold text-emerald-700';
  const workspaceRootClassName = isPhone
    ? 'mx-auto flex min-h-[100dvh] w-full flex-col animate-in fade-in pb-1'
    : isTablet
      ? 'mx-auto flex min-h-[100dvh] w-full max-w-[1360px] flex-col animate-in fade-in pb-4'
      : 'mx-auto flex min-h-[100dvh] w-full max-w-none flex-col animate-in fade-in overflow-hidden pb-4';
  const workspaceHeaderClassName = isPhone
    ? 'mb-2 flex flex-col gap-1.5'
    : isTablet
      ? 'mb-3 flex items-start justify-between gap-3 flex-wrap'
      : 'mb-3 flex items-start justify-between gap-3 flex-wrap';
  const workspaceTitleClassName = isPhone
    ? 'text-lg font-bold tracking-tight text-gray-900'
    : isTablet
      ? 'text-2xl font-bold tracking-tight text-gray-900'
      : 'text-[2rem] font-bold tracking-tight text-gray-900';
  const workspaceDescriptionClassName = isPhone
    ? 'text-[11px] text-gray-500'
    : isTablet
      ? 'max-w-2xl text-sm text-gray-500'
      : 'max-w-xl text-sm text-gray-500';
  const workspaceToolbarClassName = isPhone
    ? `grid w-full gap-1.5 sm:flex sm:w-auto sm:flex-wrap ${isTightPhone ? 'grid-cols-2' : 'grid-cols-3'}`
    : 'flex w-full flex-wrap gap-1.5 sm:w-auto';
  const workspacePanelClassName = isPhone
    ? 'rounded-xl border border-gray-200 bg-white p-2 shadow-[0_1px_0_rgba(15,23,42,0.02)]'
    : isTablet
      ? 'rounded-[1.35rem] border border-gray-200 bg-white p-3.5 shadow-[0_1px_0_rgba(15,23,42,0.02)]'
      : 'rounded-[1.35rem] border border-gray-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.02)]';
  const workspacePanelSpacingClassName = isPhone ? 'space-y-2' : isTablet ? 'space-y-3' : 'space-y-3';
  const workspaceEditorHeaderClassName = isPhone
    ? 'flex flex-wrap items-start justify-between gap-1.5 border-b border-gray-100 bg-gray-50 p-1.5'
    : isTablet
      ? 'flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 p-3'
      : 'flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 bg-gray-50 p-4';
  const workspaceEditorTabsClassName = isPhone
    ? 'grid grid-cols-2 gap-1 border-b border-gray-100 bg-white px-1.5 py-1'
    : 'grid grid-cols-2 gap-2 border-b border-gray-100 bg-white px-3 py-2';
  const workspaceEditorPaneHeaderClassName = isPhone
    ? 'border-b border-gray-100 bg-gray-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-gray-500'
    : isTablet
      ? 'border-b border-gray-100 bg-gray-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-gray-500'
      : 'border-b border-gray-100 bg-gray-50 px-5 py-2.5 text-[12px] font-bold uppercase tracking-wide text-gray-500';
  const workspaceEditorTextareaClassName = isPhone
    ? 'h-[220px] p-2.5 resize-none outline-none text-[12px] leading-relaxed text-gray-800 font-serif'
    : isTablet
      ? 'min-h-[220px] flex-1 p-4 resize-none outline-none text-[14px] leading-relaxed text-gray-800 font-serif'
      : 'min-h-0 flex-1 overflow-y-auto p-5 resize-none outline-none text-[15px] leading-7 text-gray-800 font-serif';
  const workspaceEditorFooterClassName = isPhone
    ? 'px-1.5 py-1.5 border-t border-gray-100 bg-gray-50 flex flex-col gap-1'
    : isTablet
      ? 'px-3 py-3 border-t border-gray-100 bg-gray-50 flex flex-wrap gap-2 justify-between items-center'
      : 'px-4 py-3 border-t border-gray-100 bg-gray-50 flex flex-wrap gap-2 justify-between items-center';
  const workspaceEditorFooterActionsClassName = isPhone ? 'grid grid-cols-2 gap-1' : 'flex flex-nowrap gap-1.5 overflow-x-auto custom-scrollbar';

  useEffect(() => {
    if (!isPhone) return;
    setMobilePanelOpen((previous) => (previous.library ? previous : { ...previous, library: true }));
  }, [isPhone]);

  const workspaceGridClassName = isPhone
    ? 'grid grid-cols-1 gap-3 min-h-0'
    : `grid flex-1 min-h-0 items-stretch gap-4 ${
        isLibraryCollapsed && isInspectorCollapsed
          ? 'grid-cols-1'
          : isLibraryCollapsed
          ? 'xl:grid-cols-[2rem_minmax(0,1.15fr)_16.5rem] 2xl:grid-cols-[2rem_minmax(0,1.2fr)_17.5rem]'
          : isInspectorCollapsed
          ? 'xl:grid-cols-[16.5rem_minmax(0,1.15fr)_2rem] 2xl:grid-cols-[17.5rem_minmax(0,1.2fr)_2rem]'
          : 'xl:grid-cols-[16.5rem_minmax(0,1.15fr)_16.5rem] 2xl:grid-cols-[17.5rem_minmax(0,1.2fr)_17.5rem]'
      }`;
  const workspaceLibraryColumnClassName = isPhone
    ? 'order-2'
    : isLibraryCollapsed
      ? 'xl:w-8 overflow-hidden'
      : 'md:col-start-1 md:row-start-1 md:row-span-2 xl:col-start-1 xl:row-start-1 xl:row-span-1';
  const workspaceEditorColumnClassName = isPhone
    ? 'order-1'
    : isLibraryCollapsed && isInspectorCollapsed
      ? 'col-span-1'
      : 'md:col-start-2 md:row-start-1 xl:col-start-2 xl:row-start-1 xl:row-span-1';
  const workspaceSupportColumnClassName = isPhone
    ? 'order-3'
    : isInspectorCollapsed
      ? 'xl:w-8 overflow-hidden'
      : 'md:col-start-2 md:row-start-2 xl:col-start-3 xl:row-start-1 xl:row-span-1';
  const showNovelLibraryControls = mobileLibraryTab === 'novel';
  const showChapterLibraryControls = mobileLibraryTab === 'chapter';
  const libraryTabButtonClassName = (tab: NovelCreateMode): string => [
    isPhone ? 'min-h-8 rounded-full px-2 text-[10px]' : 'min-h-10 rounded-full px-4 text-[11px]',
    'font-semibold transition-colors',
    mobileLibraryTab === tab ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-600',
  ].join(' ');
  const inspectorTabButtonClassName = (tab: MobileToolsTab): string => [
    isPhone ? 'min-h-8 rounded-full px-2 text-[10px]' : 'min-h-10 rounded-full px-4 text-[11px]',
    'font-semibold transition-colors',
    mobileToolsTab === tab ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-600',
  ].join(' ');

  const memorySectionContent = (
    <div className="space-y-4">
      <div className="space-y-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-indigo-600/70">Chapter Summary</h4>
        {selectedChapterSummary ? (
          <div className="space-y-2 text-xs text-gray-700">
            <p className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-3 leading-relaxed shadow-sm">
              {selectedChapterSummary.summary || 'No summary generated yet.'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-gray-50/50 p-2 border border-gray-100">
                <p className="text-[10px] font-bold text-gray-500 mb-1 uppercase">Characters</p>
                <p className="text-[11px] text-gray-700 leading-tight">
                  {selectedChapterSummary.newCharacters.length > 0 ? selectedChapterSummary.newCharacters.join(', ') : 'None'}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50/50 p-2 border border-gray-100">
                <p className="text-[10px] font-bold text-gray-500 mb-1 uppercase">Places</p>
                <p className="text-[11px] text-gray-700 leading-tight">
                  {selectedChapterSummary.newPlaces.length > 0 ? selectedChapterSummary.newPlaces.join(', ') : 'None'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-center text-[11px] text-gray-400">
            Run adaptation to generate chapter summary.
          </p>
        )}
      </div>

      <div className="pt-2 border-t border-gray-100">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-indigo-600/70">Memory Ledger</h4>
          <div className="flex bg-gray-100 rounded-full p-0.5">
            <button onClick={() => setMemoryTab('character')} className={`rounded-full px-2.5 py-0.5 text-[9px] font-bold transition-all ${memoryTab === 'character' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Chars</button>
            <button onClick={() => setMemoryTab('place')} className={`rounded-full px-2.5 py-0.5 text-[9px] font-bold transition-all ${memoryTab === 'place' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Places</button>
          </div>
        </div>
        
        <div className="mb-3 space-y-2">
          <div className="flex items-center gap-1.5 rounded-xl border border-indigo-100 bg-indigo-50/20 p-2 shadow-inner">
            <input
              value={memoryDraftSource}
              onChange={(e) => setMemoryDraftSource(e.target.value)}
              placeholder="Source..."
              className="min-w-0 flex-1 bg-transparent px-1 text-[11px] font-medium outline-none placeholder:text-gray-400"
            />
            <ArrowRight size={10} className="text-indigo-300" />
            <input
              value={memoryDraftAdapted}
              onChange={(e) => setMemoryDraftAdapted(e.target.value)}
              placeholder="Adapted..."
              className="min-w-0 flex-1 bg-transparent px-1 text-[11px] font-bold text-indigo-600 outline-none placeholder:text-gray-400"
            />
            <button onClick={addMemoryTagRow} title="Add memory tag" aria-label="Add memory tag" className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
              <Plus size={14} />
            </button>
          </div>
          <input 
            value={memoryFilter} 
            onChange={(e) => setMemoryFilter(e.target.value)} 
            placeholder="Filter recordings..." 
            className="w-full rounded-lg border border-gray-100 bg-white px-2.5 py-1.5 text-[10px] outline-none focus:border-indigo-200 transition-colors" 
          />
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-1">
          {filteredMemoryRows.length === 0 && <p className="py-4 text-center text-[11px] text-gray-400">No {memoryTab} tags found.</p>}
          {filteredMemoryRows.map((row) => (
            <div key={row.id} className="group relative rounded-xl border border-gray-100 bg-white p-2 shadow-sm transition-all hover:border-indigo-200 hover:shadow-md">
              <div className="flex items-center gap-2">
                <input
                  value={row.sourceName}
                  onChange={(e) => updateMemoryRow(memoryTab, row.id, { sourceName: e.target.value })}
                  title="Source name"
                  aria-label="Source name"
                  className="min-w-0 flex-1 bg-transparent text-[11px] font-medium text-gray-600 outline-none"
                />
                <ArrowRight size={10} className="text-gray-300" />
                <input
                  value={row.adaptedName}
                  onChange={(e) => updateMemoryRow(memoryTab, row.id, { adaptedName: e.target.value })}
                  title="Adapted name"
                  aria-label="Adapted name"
                  className="min-w-0 flex-1 bg-transparent text-[11px] font-bold text-indigo-700 outline-none"
                />
              </div>
              <div className="mt-2 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => updateMemoryRow(memoryTab, row.id, { locked: !row.locked })}
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold transition-colors ${row.locked ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-500'}`}
                >
                  {row.locked ? <Lock size={9} /> : <Unlock size={9} />}
                  {row.locked ? 'Locked' : 'Open'}
                </button>
                <button onClick={() => removeMemoryRow(memoryTab, row.id)} title="Remove memory tag" aria-label="Remove memory tag" className="rounded-full bg-red-50 p-1 text-red-500 hover:bg-red-100 transition-colors">
                  <Trash2 size={10} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="pt-2 border-t border-gray-100">
        <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-indigo-600/70">Version History</h4>
        <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-1.5 pr-1">
          {selectedChapterVersions.length === 0 && <p className="text-[10px] text-gray-400">No snapshots yet.</p>}
          {selectedChapterVersions.slice(0, 10).map((row) => (
            <div key={row.id} className="rounded-lg border border-gray-100 bg-gray-50/50 p-2 transition-colors hover:bg-gray-100">
              <div className="flex items-center justify-between gap-1.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10px] font-bold text-gray-700">{row.label}</p>
                  <p className="text-[9px] text-gray-400">{new Date(row.timestamp).toLocaleTimeString()}</p>
                </div>
                <button onClick={() => handleRevertVersion(row)} className="rounded-full bg-indigo-50 px-2 py-1 text-[9px] font-bold text-indigo-600 hover:bg-indigo-100 transition-colors">Revert</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const adaptationSectionContent = (
    <div className="space-y-3 rounded-xl border border-gray-100 bg-white p-3">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-indigo-600/70">Adaptation</h4>
      <p className="text-[11px] text-gray-700">
        {selectedProject
          ? 'Chapter adaptation tools are available from the active chapter workflow.'
          : 'Select a novel to view adaptation tools.'}
      </p>
    </div>
  );

  const settingsSectionContent = (
    <div className="space-y-4">
      <div className="space-y-3">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-indigo-600/70">Cloud Sync (Drive)</h4>
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/30 p-3 shadow-sm">
          <p className="mb-3 text-[11px] text-gray-600 leading-relaxed font-medium">{driveState.message}</p>
          <div className="grid grid-cols-1 gap-2">
            <Button onClick={handleDriveConnectAction} disabled={!canConnectDrive || isConnectingDrive} className={`w-full bg-indigo-600 text-white hover:bg-indigo-700 shadow-md shadow-indigo-200/50 font-bold ${isPhone ? 'min-h-10 text-xs' : 'min-h-11 text-sm'}`}>
              {isConnectingDrive ? <Loader2 size={14} className="animate-spin mr-2" /> : <FolderOpen size={14} className="mr-2" />}
              {driveState.status === 'connected' ? 'Connected' : connectLabel}
            </Button>
            {driveState.status === 'connected' && (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => { void handleUploadCurrentNovelToDrive(); }} disabled={isUploadingToDrive || !selectedProjectId} className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100 transition-all disabled:opacity-50">
                  {isUploadingToDrive ? <Loader2 size={12} className="animate-spin" /> : <CloudUpload size={14} />} Upload
                </button>
                <button onClick={() => { void handleDownloadNovelFromDrive(); }} disabled={isDownloadingFromDrive} className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 transition-all disabled:opacity-50">
                  {isDownloadingFromDrive ? <Loader2 size={12} className="animate-spin" /> : <CloudDownload size={14} />} Download
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="pt-2 border-t border-gray-100">
        <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-indigo-600/70">Local Strategy</h4>
        <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3">
          <div className="flex items-start gap-2.5">
            <div className={`mt-0.5 h-2 w-2 rounded-full ${boundLocalFolderName ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-gray-300'}`} />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-gray-800">{boundLocalFolderName || 'No local folder bound'}</p>
              {localFolderStatus && localFolderStatus !== 'No local folder bound.' && (
                <p className="mt-0.5 text-[10px] text-gray-500 leading-normal">{localFolderStatus}</p>
              )}
            </div>
          </div>
          <button
            onClick={() => { void bindLocalFolder(); }}
            disabled={isBindingLocalFolder}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white py-2 text-[10px] font-bold text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {isBindingLocalFolder ? <Loader2 size={12} className="animate-spin" /> : <FolderOpen size={12} />}
            Bind Different Folder
          </button>
        </div>
      </div>

      <div className="pt-2 border-t border-gray-100">
        <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-indigo-600/70">Novel Metadata</h4>
        <div className="rounded-xl border border-gray-100 bg-white p-3 space-y-3">
          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Created</p>
            <p className="text-[11px] text-gray-700">{selectedProject?.createdTime ? new Date(selectedProject.createdTime).toLocaleDateString() : 'N/A'}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => selectedProject && handleRenameNovel(selectedProject)} className="flex-1 rounded-lg border border-gray-200 py-1.5 text-[10px] font-bold text-gray-600 hover:bg-gray-50">Rename Novel</button>
            <button onClick={() => selectedProject && handleDeleteNovel(selectedProject)} className="flex-1 rounded-lg border border-red-100 py-1.5 text-[10px] font-bold text-red-600 hover:bg-red-50">Delete Permanently</button>
          </div>
        </div>
      </div>
    </div>
  );

  const publishingSectionContent = selectedProject ? (
    <PublishingPanel
      novelProjectId={selectedProject.id}
      novelTitle={selectedProject.name}
      chapters={(chaptersByProjectId[selectedProject.id] ?? []).map(c => ({ id: c.id, title: c.title, text: c.text || '' }))}
      onToast={onToast}
    />
  ) : (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-8 text-center text-[11px] text-gray-400">
      Select a novel to access publishing tools.
    </div>
  );

  const inspectorTabBarContent = (
    <div className="grid grid-cols-4 gap-1 rounded-full border border-gray-200 bg-gray-100 p-1" data-testid="novel-tools-tabs">
      <button type="button" onClick={() => setMobileToolsTab('adaptation')} className={inspectorTabButtonClassName('adaptation')} data-testid="novel-tools-tab-adapt">Adapt</button>
      <button type="button" onClick={() => setMobileToolsTab('memory')} className={inspectorTabButtonClassName('memory')} data-testid="novel-tools-tab-memory">Memory</button>
      <button type="button" onClick={() => setMobileToolsTab('settings')} className={inspectorTabButtonClassName('settings')} data-testid="novel-tools-tab-settings">Settings</button>
      <button type="button" onClick={() => setMobileToolsTab('publish')} className={inspectorTabButtonClassName('publish')} data-testid="novel-tools-tab-publish">Publish</button>
    </div>
  );

  const inspectorTabContent = mobileToolsTab === 'adaptation'
    ? adaptationSectionContent
    : mobileToolsTab === 'memory'
      ? memorySectionContent
      : mobileToolsTab === 'publish'
        ? publishingSectionContent
        : settingsSectionContent;

  return (
    <div className={workspaceRootClassName} data-novel-layout={layoutMode} data-testid="novel-workspace">
      <div className={workspaceHeaderClassName}>
          <div>
            <h2 className={workspaceTitleClassName}>Novel Workspace</h2>
            <p className={workspaceDescriptionClassName}>Chapter-by-chapter adaptation with lockable memory and import flow.</p>
          </div>
          <div className={workspaceToolbarClassName}>
            <button
              ref={importTriggerRef}
              onClick={() => setIsImportModalOpen(true)}
              className={`${toolbarButtonClassName} bg-indigo-600 text-white hover:bg-indigo-700`}
            >
              <FileUp size={14} />Import File
            </button>
            <button
              onClick={() => { void bindLocalFolder(); }}
              disabled={isBindingLocalFolder}
              className={`${toolbarButtonClassName} border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100`}
            >
              {isBindingLocalFolder ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} />}
              Bind Local Folder
            </button>
            <button
              onClick={() => { void refreshDriveSession(); }}
              className={`${toolbarButtonClassName} border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 ${isTightPhone ? 'col-span-2' : ''}`}
            >
              <RefreshCw size={14} className={driveState.status === 'checking' ? 'animate-spin' : ''} />
              Refresh Drive
            </button>
          </div>
        </div>

        <div className={workspaceGridClassName}>
        {/* Library Sidebar */}
        {!isPhone && isLibraryCollapsed ? (
          <div 
            className="group flex w-8 flex-col items-center border-r border-gray-200 bg-gradient-to-b from-gray-50/50 to-white py-4 hover:bg-indigo-50/30 transition-all duration-300 cursor-pointer relative overflow-hidden" 
            onClick={() => setIsLibraryCollapsed(false)}
          >
            <div className="absolute inset-0 bg-indigo-500/0 group-hover:bg-indigo-500/5 transition-colors" />
            <button title="Expand library" aria-label="Expand library" className="text-gray-400 group-hover:text-indigo-600 transition-colors transform group-hover:scale-110">
              <ChevronRight size={18} />
            </button>
            <div className="mt-8 flex flex-col gap-3 items-center">
              <FolderOpen size={16} className="text-gray-400 group-hover:text-indigo-500 transition-colors" />
              <span className="[writing-mode:vertical-lr] text-[9px] font-black uppercase tracking-[0.2em] text-gray-400 group-hover:text-indigo-600 select-none transition-colors">Library</span>
            </div>
            <div className="absolute bottom-4 h-1 w-1 rounded-full bg-indigo-500 opacity-0 group-hover:opacity-100 transition-all group-hover:scale-[2]" />
          </div>
        ) : (
          <div className={`${workspaceLibraryColumnClassName} ${workspacePanelClassName} ${workspacePanelSpacingClassName} ${isPhone ? '' : 'flex min-h-0 flex-col overflow-hidden relative'}`}>
            {!isPhone && (
              <button
                onClick={() => setIsLibraryCollapsed(true)}
                className="absolute right-2 top-4 text-gray-400 hover:text-indigo-600 transition-colors p-1"
                aria-label="Collapse Library"
              >
                <ChevronLeft size={16} />
              </button>
            )}
            {isPhone ? (
              <div className="mb-1.5 rounded-xl px-0.5">
                <div className="flex min-h-9 items-center gap-1.5">
                  <button type="button" onClick={() => toggleMobilePanel('library')} className="min-w-0 flex flex-1 items-center gap-2 text-left">
                    <FolderOpen size={16} className="shrink-0 text-indigo-600" />
                    <div className="min-w-0">
                      <h3 className="truncate text-xs font-bold text-gray-800">Library</h3>
                      <p className="truncate text-[10px] text-gray-500">
                        {selectedProject?.name || 'No novel selected'}
                        {selectedChapter ? ` / ${selectedChapter.title}` : ''}
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleMobilePanel('library')}
                    className="inline-flex min-h-9 w-7 items-center justify-center rounded-full text-gray-500"
                    aria-label={mobilePanelOpen.library ? 'Collapse library' : 'Expand library'}
                  >
                    {mobilePanelOpen.library ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>
                <div className={`mt-1.5 flex items-center gap-1 ${isTightPhone ? 'flex-col items-stretch' : ''}`}>
                  <div className="grid flex-1 grid-cols-2 gap-1 rounded-full border border-gray-200 bg-gray-100 p-1">
                    <button
                      type="button"
                      onClick={() => setMobileLibraryTab('novel')}
                      className={`min-h-8 rounded-full px-2 text-[10px] font-semibold transition-colors ${
                        mobileLibraryTab === 'novel' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-600'
                      }`}
                    >
                      Novel
                    </button>
                    <button
                      type="button"
                      onClick={() => setMobileLibraryTab('chapter')}
                      className={`min-h-8 rounded-full px-2 text-[10px] font-semibold transition-colors ${
                        mobileLibraryTab === 'chapter' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-600'
                      }`}
                    >
                      Chapter
                    </button>
                  </div>
                  <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                    {novelCountLabel}
                  </span>
                </div>
              </div>
            ) : null}
            {!isPhone && (
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0 items-center gap-2 flex">
                  <FolderOpen size={16} className="shrink-0 text-indigo-600" />
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-bold text-gray-800">Library</h3>
                    <p className="truncate text-[11px] text-gray-500">
                      {selectedProject?.name || 'No novel selected'}
                      {selectedChapter ? ` / ${selectedChapter.title}` : ''}
                    </p>
                  </div>
                </div>
                <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                  {novelCountLabel}
                </span>
              </div>
            )}
            {!isPhone && (
              <div className="grid grid-cols-2 gap-1.5 rounded-full border border-gray-200 bg-gray-100 p-1.5" data-testid="novel-library-tabs">
                <button
                  type="button"
                  onClick={() => setMobileLibraryTab('novel')}
                  className={libraryTabButtonClassName('novel')}
                >
                  Novel
                </button>
                <button
                  type="button"
                  onClick={() => setMobileLibraryTab('chapter')}
                  className={libraryTabButtonClassName('chapter')}
                >
                  Chapter
                </button>
              </div>
            )}
            <div className={isPhone ? '' : 'flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1'}>
              {(!isPhone || mobilePanelOpen.library) && (
                <>
                  {showNovelLibraryControls && (
                    <>
                      <div>
                        <label className={`block mb-1 ${isPhone ? phoneSectionTitleClassName : 'text-xs font-bold text-gray-500 uppercase'}`}>Create Novel</label>
                        <div className={`flex flex-col sm:flex-row ${isPhone ? 'gap-1.5' : 'gap-2'}`}>
                          <input
                            value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)}
                            placeholder="Novel name"
                            className={`flex-1 border border-gray-200 bg-gray-50 outline-none ${isPhone ? phoneInputClassName : isTablet ? 'min-h-10 rounded-xl px-3 text-xs' : 'min-h-11 rounded-xl px-3 text-sm'}`}
                          />
                          <button
                            onClick={handleCreateNovel}
                            className={`inline-flex items-center justify-center gap-1.5 bg-indigo-600 font-semibold text-white hover:bg-indigo-700 sm:min-w-11 ${isPhone ? `${phoneChipControlClassName} px-3` : isTablet ? 'min-h-10 rounded-xl px-3 text-xs' : 'min-h-11 rounded-xl px-4 text-sm'}`}
                            aria-label="Create novel"
                          >
                            <Plus size={16} className="shrink-0" />
                            <span className="sm:hidden">Create novel</span>
                          </button>
                        </div>
                      </div>
                      <div className={`max-h-56 overflow-y-auto custom-scrollbar ${isPhone ? 'space-y-1' : 'space-y-1.5'}`}>
                        {projects.length === 0 && <p className="text-xs text-gray-500">No local novels yet.</p>}
                        {projects.map((project) => (
                          <div key={project.id} className={`${isPhone ? 'p-2 rounded-xl' : 'p-2.5 rounded-xl'} border ${selectedProjectId === project.id ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
                            <div className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => setSelectedProjectId(project.id)}
                                className={`min-w-0 flex-1 rounded-lg px-2 text-left font-semibold text-gray-800 truncate ${isPhone ? 'min-h-9 text-xs' : 'min-h-11 text-sm'}`}
                              >
                                {project.name}
                              </button>
                              <div className="flex gap-1">
                                <button onClick={() => handleRenameNovel(project)} className={`${compactActionButtonClassName} bg-gray-100 text-gray-600 hover:bg-gray-200`}>Rename</button>
                                <button onClick={() => handleDeleteNovel(project)} className={`${compactActionButtonClassName} bg-red-50 text-red-700 hover:bg-red-100`} aria-label={`Delete novel ${project.name}`}><Trash2 size={13} /></button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {showChapterLibraryControls && (
                    selectedProjectId ? (
                      <div>
                        <label className={`block mb-1 ${isPhone ? phoneSectionTitleClassName : 'text-xs font-bold text-gray-500 uppercase'}`}>Create Chapter</label>
                        <div className={`flex flex-col sm:flex-row ${isPhone ? 'gap-1.5' : 'gap-2'}`}>
                          <input
                            value={newChapterTitle}
                            onChange={(e) => setNewChapterTitle(e.target.value)}
                            placeholder="Chapter title"
                            className={`flex-1 border border-gray-200 bg-gray-50 outline-none ${isPhone ? phoneInputClassName : isTablet ? 'min-h-10 rounded-xl px-3 text-xs' : 'min-h-11 rounded-xl px-3 text-sm'}`}
                          />
                          <button
                            onClick={handleCreateChapter}
                            className={`inline-flex items-center justify-center gap-1.5 bg-emerald-600 font-semibold text-white hover:bg-emerald-700 sm:min-w-11 ${isPhone ? `${phoneChipControlClassName} px-3` : isTablet ? 'min-h-10 rounded-xl px-3 text-xs' : 'min-h-11 rounded-xl px-4 text-sm'}`}
                            aria-label="Create chapter"
                          >
                            <Plus size={16} className="shrink-0" />
                            <span className="sm:hidden">Create chapter</span>
                          </button>
                        </div>
                        <div className={`mt-2.5 max-h-44 overflow-y-auto custom-scrollbar ${isPhone ? 'space-y-1' : 'space-y-1.5'}`}>
                          {chapters.length === 0 && <p className="text-xs text-gray-500">No local chapters yet.</p>}
                          {chapters.map((chapter) => {
                            const state = selectedStateMap.get(chapter.id)?.status || chapter.adaptationStatus || 'idle';
                            return (
                              <div key={chapter.id} className="flex items-center gap-1.5">
                                <button onClick={() => setSelectedChapterId(chapter.id)} className={`flex-1 rounded-lg border text-left text-xs font-semibold ${isPhone ? 'min-h-9 p-2' : 'min-h-11 p-3'} ${chapter.id === selectedChapterId ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-gray-700'}`}>
                                  <div className="truncate">{chapter.name}</div>
                                  <div className="text-[10px] text-gray-500 mt-1">{state}</div>
                                </button>
                                <button onClick={() => handleDeleteChapter(chapter)} className={`inline-flex items-center justify-center border border-red-100 bg-red-50 text-red-700 hover:bg-red-100 ${isPhone ? 'min-h-9 min-w-9 rounded-full px-2.5' : 'min-h-11 min-w-11 rounded-lg px-3'}`} aria-label={`Delete chapter ${chapter.name}`}><Trash2 size={14} /></button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <p className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
                        Create a novel first to unlock chapter controls.
                      </p>
                    )
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Editor Main Column */}
        <div className={`${workspaceEditorColumnClassName} bg-white ${isPhone ? 'rounded-xl' : 'rounded-2xl'} border border-gray-200 flex min-h-0 flex-col overflow-hidden relative shadow-sm`}>
          {!isPhone && selectedChapterId && (
            <div className="absolute top-2.5 right-40 z-10">
              <ProofreadCluster isBusy={isAdapting} onProofread={handleProofread} />
            </div>
          )}
          <div className={workspaceEditorHeaderClassName}>
            <div className="min-w-0">
              <p className={isPhone ? phoneSectionTitleClassName : 'text-xs font-bold text-gray-500 uppercase'}>Editor</p>
              <p className={`${isPhone ? 'text-xs' : 'text-sm'} font-semibold text-gray-800 truncate`}>{selectedProject?.name || 'No novel selected'} {selectedChapter ? ` / ${selectedChapter.title}` : ''}</p>
              {!isPhone && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className={cacheBadgeClassName} title="Saved in browser cache. Clearing browser storage removes this workspace.">
                    Browser cache autosave
                  </span>
                  <span className="rounded-full border border-gray-200 bg-white px-3 py-0.5 text-[10px] font-semibold text-gray-500">
                    {selectedChapterId ? 'Chapter state stays local' : 'Select a chapter to edit'}
                  </span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {!isPhone && (
                <div className="flex items-center rounded-full border border-gray-200 bg-white p-1 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
                  <button type="button" onClick={goToPreviousChapter} disabled={!hasPreviousChapter} className={headerSegmentButtonClassName} aria-label="Previous chapter" data-testid="novel-workspace-back">
                    <ChevronLeft size={14} /> Back
                  </button>
                  <button type="button" onClick={goToNextChapter} disabled={!hasNextChapter} className={headerSegmentButtonClassName} aria-label="Next chapter" data-testid="novel-workspace-forward">
                    <ChevronRight size={14} /> Forward
                  </button>
                </div>
              )}
              <button onClick={handleManualSave} disabled={!selectedChapterId} className={headerPrimaryActionButtonClassName}>
                <Save size={14} /> Save
              </button>
            </div>
          </div>
          <div className={workspaceEditorTabsClassName} data-testid="novel-editor-tabs">
            <button type="button" onClick={() => setMobileEditorPane('source')} className={`rounded-full px-3 font-semibold transition-colors ${mobileEditorPane === 'source' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'} ${isPhone ? 'min-h-8 text-[10px]' : 'min-h-11 text-sm'}`}>Source</button>
            <button type="button" onClick={() => setMobileEditorPane('adapted')} className={`rounded-full px-3 font-semibold transition-colors ${mobileEditorPane === 'adapted' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'} ${isPhone ? 'min-h-8 text-[10px]' : 'min-h-11 text-sm'}`}>Adapted</button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className={`flex min-h-0 flex-1 flex-col border-gray-100 ${mobileEditorPane !== 'source' ? 'hidden' : ''}`}>
              <div className={workspaceEditorPaneHeaderClassName}>Source</div>
              <textarea value={chapterText} onChange={(e) => setChapterText(e.target.value)} placeholder="Source chapter..." className={workspaceEditorTextareaClassName} />
            </div>
            <div className={`flex min-h-0 flex-1 flex-col ${mobileEditorPane !== 'adapted' ? 'hidden' : ''}`}>
              <div className={workspaceEditorPaneHeaderClassName}>Adapted</div>
              <textarea value={adaptedOutput} onChange={(e) => setAdaptedOutput(e.target.value)} placeholder="Adapted output..." className={workspaceEditorTextareaClassName} />
            </div>
          </div>
          <div className={workspaceEditorFooterClassName}>
            <div className="flex items-center gap-2">
              {sourceAndAdaptedSame && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                  Source and adapted panes currently match
                </span>
              )}
            </div>
            <div className={workspaceEditorFooterActionsClassName}>
              <button onClick={() => sendEditorTextToStudio('source')} disabled={!chapterText.trim()} className={`${compactActionButtonClassName} border border-indigo-200 text-indigo-700`}>Send Source to Studio</button>
              <button onClick={() => sendEditorTextToStudio('adapted')} disabled={!adaptedOutput.trim()} className={`${compactActionButtonClassName} border border-indigo-200 text-indigo-700`}>Send Adapted to Studio</button>
              <button onClick={applyAdaptedToEditor} disabled={!adaptedOutput.trim()} className={`${compactActionButtonClassName} border border-gray-200 text-gray-700`}>Replace Source</button>
              <button onClick={saveAdaptedAsNewChapter} disabled={!adaptedOutput.trim()} className={`${compactActionButtonClassName} border border-emerald-200 text-emerald-700`}>Save Adapted as Chapter</button>
            </div>
          </div>
        </div>

        {/* Inspector Sidebar */}
        {!isPhone && isInspectorCollapsed ? (
          <div 
            className="group flex w-8 flex-col items-center border-l border-gray-200 bg-gradient-to-b from-gray-50/50 to-white py-4 hover:bg-indigo-50/30 transition-all duration-300 cursor-pointer relative overflow-hidden" 
            onClick={() => setIsInspectorCollapsed(false)}
          >
            <div className="absolute inset-0 bg-indigo-500/0 group-hover:bg-indigo-500/5 transition-colors" />
            <button title="Expand tools" aria-label="Expand tools" className="text-gray-400 group-hover:text-indigo-600 transition-colors transform group-hover:scale-110">
              <ChevronLeft size={18} />
            </button>
            <div className="mt-8 flex flex-col gap-3 items-center">
              <Wand2 size={16} className="text-gray-400 group-hover:text-indigo-500 transition-colors" />
              <span className="[writing-mode:vertical-lr] text-[9px] font-black uppercase tracking-[0.2em] text-gray-400 group-hover:text-indigo-600 select-none transition-colors">Inspector</span>
            </div>
            <div className="absolute bottom-4 h-1 w-1 rounded-full bg-indigo-500 opacity-0 group-hover:opacity-100 transition-all group-hover:scale-[2]" />
          </div>
        ) : (
          <div className={`${workspaceSupportColumnClassName} ${isPhone ? '' : 'flex min-h-0 flex-col overflow-hidden relative'}`}>
            {!isPhone && (
              <button onClick={() => setIsInspectorCollapsed(true)} className="absolute left-2 top-4 text-gray-400 hover:text-indigo-600 transition-colors p-1" aria-label="Collapse Inspector">
                <MoreHorizontal size={16} className="rotate-90" />
              </button>
            )}
            {isPhone ? (
              <div className={`${workspacePanelClassName} flex min-h-0 flex-col overflow-hidden`}>
                <button type="button" onClick={() => setMobileToolsOpen((prev) => !prev)} className={sectionToggleButtonClassName}>
                  <div className="flex items-center gap-1.5">
                    <Wand2 size={15} className="text-indigo-600" />
                    <h3 className="text-xs font-bold text-gray-800">Tools</h3>
                  </div>
                  {mobileToolsOpen ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
                </button>
                {mobileToolsOpen && (
                  <>
                    {inspectorTabBarContent}
                    <div className="mt-2 flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
                      {inspectorTabContent}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className={`${workspacePanelClassName} flex min-h-0 flex-col overflow-hidden`}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Wand2 size={16} className="text-indigo-600" />
                      <h3 className="text-sm font-bold text-gray-800">Inspector</h3>
                    </div>
                    <p className="mt-0.5 text-[11px] text-gray-500">Adaptation, memory, ledger, and drive.</p>
                  </div>
                </div>
                {inspectorTabBarContent}
                <div className="mt-2 flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
                  {inspectorTabContent}
                </div>
             </div>
            )}
          </div>
        )}
      </div>

      {isImportModalOpen && (
        <div
          className={`vf-scrim vf-scrim--modal fixed inset-0 z-[90] flex ${isPhone ? 'items-stretch justify-stretch p-0' : 'items-center justify-center p-4'} lg:left-64 lg:p-6`}
          role="dialog"
          aria-modal="true"
          aria-label="Import novel files"
        >
          <div
            ref={importModalRef}
            tabIndex={-1}
            className={`w-full border border-gray-200 bg-white shadow-xl ${isPhone ? 'flex h-full max-w-none flex-col rounded-none border-x-0 border-y-0 p-4' : 'max-w-3xl rounded-2xl p-4'}`}
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-lg font-bold text-gray-800">Import Novel File(s)</h3>
              <button
                onClick={() => { setIsImportModalOpen(false); resetImportState(); }}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-gray-200 px-4 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                aria-label="Close import dialog"
              >
                Close
              </button>
            </div>
            
            <div className={isPhone ? 'min-h-0 flex-1 overflow-y-auto pr-1' : ''}>
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
                          onClick={() => setImportFiles((prev) => prev.filter((item) => !(item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)))}
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
              
              <div className="mb-2 flex flex-col gap-2 sm:flex-row">
                <button
                  onClick={() => { void handleExtractImport(); }}
                  disabled={importFiles.length === 0 || isImportExtracting || isImportSplitting}
                  className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isImportExtracting ? 'Extracting...' : 'Extract + Auto Split'}
                </button>
                <button
                  onClick={handleApplyImportChapters}
                  disabled={importPreviewChapters.length === 0 || !selectedProjectId}
                  className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
                >
                  Create Chapters
                </button>
              </div>
              
              {importFiles.length > 0 && (
                <div className="text-[11px] text-gray-500 mb-2">{importFiles.length} file(s) selected</div>
              )}
              
              {importDiagnostics && (
                <div className="text-xs text-indigo-700 mb-2">
                  Mode: {importDiagnostics.mode} | AI fallback: {importDiagnostics.usedAiFallback ? 'Yes' : 'No'}
                </div>
              )}
              
              <textarea
                value={importRawText}
                onChange={(e) => setImportRawText(e.target.value)}
                title="Import raw text"
                aria-label="Import raw text"
                className="w-full h-40 p-2 border border-gray-200 rounded-xl text-xs mb-2"
              />
              
              <div className="space-y-2 max-h-44 overflow-y-auto custom-scrollbar">
                {importPreviewChapters.map((chapter) => (
                  <div key={chapter.id} className="p-2 border border-gray-200 rounded-lg bg-gray-50">
                    {chapter.sourceFileName && (
                      <div className="mb-1 text-[10px] font-semibold text-gray-500">{chapter.sourceFileName}</div>
                    )}
                    <input
                      value={chapter.title}
                      onChange={(e) => setImportPreviewChapters((prev) => prev.map((row) => row.id === chapter.id ? { ...row, title: e.target.value } : row))}
                      title="Chapter title"
                      aria-label="Chapter title"
                      className="w-full p-1.5 border border-gray-200 rounded text-xs mb-1"
                    />
                    <textarea
                      value={chapter.text}
                      onChange={(e) => setImportPreviewChapters((prev) => prev.map((row) => row.id === chapter.id ? { ...row, text: e.target.value } : row))}
                      title="Chapter text"
                      aria-label="Chapter text"
                      className="w-full h-20 p-1.5 border border-gray-200 rounded text-xs"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
