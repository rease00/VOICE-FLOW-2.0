import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CloudDownload,
  CloudUpload,
  FolderOpen,
  Lightbulb,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { Button } from './Button';
import { LANGUAGES } from '../constants';
import { useUser } from '../contexts/UserContext';
import {
  DriveConnectionState,
  GenerationSettings,
  NovelChapter,
  NovelIdeaCard,
  NovelIdeaSource,
  NovelProject,
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
import { extractNovelIdeaMetadata, generateNovelIdeaCards, NovelIdeaMetadata } from '../services/novelIdeaService';
import { generateTextContent, localizeNovel, proofreadScript, translateText } from '../services/geminiService';

type ToastKind = 'success' | 'error' | 'info';

interface NovelWorkspaceProps {
  settings: GenerationSettings;
  mediaBackendUrl: string;
  onSendToStudio: (text: string) => void;
  onToast: (message: string, type?: ToastKind) => void;
}

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

interface LocalNovelChapter extends NovelChapter {
  text: string;
}

type ChaptersByProjectId = Record<string, LocalNovelChapter[]>;

interface LocalNovelWorkspaceSnapshot {
  version: number;
  projects: NovelProject[];
  chaptersByProjectId: ChaptersByProjectId;
  selectedProjectId: string;
  selectedChapterId: string;
}

const LOCAL_NOVEL_STORAGE_KEYS = [
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

const createLocalId = (prefix: 'project' | 'chapter'): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const buildChapterName = (index: number, title: string): string =>
  `Chapter ${String(index).padStart(3, '0')} - ${title}`;

const buildDriveState = (status: DriveConnectionState['status'], message: string): DriveConnectionState => ({
  status,
  message,
});

const normalizeError = (error: any): string => String(error?.message || 'Unknown error');

const buildUniqueProjectName = (existing: NovelProject[], baseName: string): string => {
  const normalized = sanitizeLabel(baseName, 'Imported Novel');
  const used = new Set(existing.map((project) => project.name.toLowerCase()));
  if (!used.has(normalized.toLowerCase())) return normalized;
  let suffix = 2;
  while (used.has(`${normalized} (${suffix})`.toLowerCase())) {
    suffix += 1;
  }
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

    rawProjects.forEach((rawProject: any) => {
      const nowIso = new Date().toISOString();
      const projectId =
        typeof rawProject?.id === 'string' && rawProject.id ? rawProject.id : createLocalId('project');
      const createdTime = typeof rawProject?.createdTime === 'string' ? rawProject.createdTime : nowIso;
      const modifiedTime = typeof rawProject?.modifiedTime === 'string' ? rawProject.modifiedTime : createdTime;

      const project: NovelProject = {
        id: projectId,
        name: sanitizeLabel(rawProject?.name, 'Untitled Novel'),
        rootFolderId:
          typeof rawProject?.rootFolderId === 'string' && rawProject.rootFolderId
            ? rawProject.rootFolderId
            : 'local',
        createdTime,
        modifiedTime,
      };
      projects.push(project);

      const mappedChapters = Array.isArray(payload?.chaptersByProjectId?.[projectId])
        ? payload.chaptersByProjectId[projectId]
        : null;
      const projectChapters = Array.isArray(rawProject?.chapters) ? rawProject.chapters : null;
      const sourceChapters = (mappedChapters || projectChapters || []) as any[];

      const normalizedChapters: LocalNovelChapter[] = sourceChapters
        .map((rawChapter: any, chapterIndex: number) => {
          const parsedIndex = Number(rawChapter?.index);
          const index = Number.isFinite(parsedIndex) && parsedIndex > 0 ? parsedIndex : chapterIndex + 1;
          const title = sanitizeLabel(
            rawChapter?.title || rawChapter?.name || `Chapter ${index}`,
            `Chapter ${index}`
          );
          return {
            id:
              typeof rawChapter?.id === 'string' && rawChapter.id
                ? rawChapter.id
                : createLocalId('chapter'),
            projectId,
            title,
            name: sanitizeLabel(
              rawChapter?.name || buildChapterName(index, title),
              buildChapterName(index, title)
            ),
            index,
            text: typeof rawChapter?.text === 'string' ? rawChapter.text : '',
            createdTime: typeof rawChapter?.createdTime === 'string' ? rawChapter.createdTime : createdTime,
            modifiedTime: typeof rawChapter?.modifiedTime === 'string' ? rawChapter.modifiedTime : modifiedTime,
          } as LocalNovelChapter;
        })
        .sort(chapterSort);

      chaptersByProjectId[projectId] = normalizedChapters;
    });

    const selectedProjectIdRaw =
      typeof payload.selectedProjectId === 'string' ? payload.selectedProjectId : '';
    const selectedProjectId =
      selectedProjectIdRaw && projects.some((project) => project.id === selectedProjectIdRaw)
        ? selectedProjectIdRaw
        : projects[0]?.id || '';
    const selectedProjectChapters = chaptersByProjectId[selectedProjectId] || [];
    const selectedChapterIdRaw =
      typeof payload.selectedChapterId === 'string' ? payload.selectedChapterId : '';
    const selectedChapterId =
      selectedChapterIdRaw && selectedProjectChapters.some((chapter) => chapter.id === selectedChapterIdRaw)
        ? selectedChapterIdRaw
        : selectedProjectChapters[0]?.id || '';

    return {
      version: 2,
      projects,
      chaptersByProjectId,
      selectedProjectId,
      selectedChapterId,
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
    version: 2,
    projects: [],
    chaptersByProjectId: {},
    selectedProjectId: '',
    selectedChapterId: '',
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
): ChaptersByProjectId => {
  const projectChapters = previous[projectId] || [];
  const nextProjectChapters = projectChapters.map((chapter) =>
    chapter.id === chapterId
      ? {
          ...chapter,
          text,
          modifiedTime: new Date().toISOString(),
        }
      : chapter
  );
  return {
    ...previous,
    [projectId]: nextProjectChapters,
  };
};

export const NovelWorkspace: React.FC<NovelWorkspaceProps> = ({
  settings,
  mediaBackendUrl,
  onSendToStudio,
  onToast,
}) => {
  const { user } = useUser();

  const [driveState, setDriveState] = useState<DriveConnectionState>(
    buildDriveState('checking', 'Checking Google Drive access...')
  );
  const [driveToken, setDriveToken] = useState('');
  const [isConnectingDrive, setIsConnectingDrive] = useState(false);
  const [isUploadingToDrive, setIsUploadingToDrive] = useState(false);
  const [isDownloadingFromDrive, setIsDownloadingFromDrive] = useState(false);

  const [projects, setProjects] = useState<NovelProject[]>([]);
  const [chaptersByProjectId, setChaptersByProjectId] = useState<ChaptersByProjectId>({});
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedChapterId, setSelectedChapterId] = useState('');
  const [isHydratingLocal, setIsHydratingLocal] = useState(true);

  const [isLoadingChapterText, setIsLoadingChapterText] = useState(false);

  const [newProjectName, setNewProjectName] = useState('');
  const [newChapterTitle, setNewChapterTitle] = useState('');

  const [chapterText, setChapterText] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');

  const [writingOutput, setWritingOutput] = useState('');
  const [isRunningWritingTool, setIsRunningWritingTool] = useState(false);
  const [translationOutput, setTranslationOutput] = useState('');
  const [isRunningTranslation, setIsRunningTranslation] = useState(false);
  const [targetLang, setTargetLang] = useState('Hinglish');
  const [targetCulture, setTargetCulture] = useState('');

  const [ideaSource, setIdeaSource] = useState<NovelIdeaSource>('webnovel');
  const [ideaUrl, setIdeaUrl] = useState('');
  const [ideaMetadata, setIdeaMetadata] = useState<NovelIdeaMetadata | null>(null);
  const [ideaCards, setIdeaCards] = useState<NovelIdeaCard[]>([]);
  const [isGeneratingIdeas, setIsGeneratingIdeas] = useState(false);

  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedTextRef = useRef('');
  const activeSelectionKeyRef = useRef('');

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );
  const chapters = useMemo(() => {
    const projectChapters = chaptersByProjectId[selectedProjectId] || [];
    return [...projectChapters].sort(chapterSort);
  }, [chaptersByProjectId, selectedProjectId]);
  const selectedChapter = useMemo(
    () => chapters.find((chapter) => chapter.id === selectedChapterId) || null,
    [chapters, selectedChapterId]
  );

  const refreshDriveSession = useCallback(async () => {
    setDriveState(buildDriveState('checking', 'Checking Google Drive access...'));
    const auth = await getDriveProviderToken();

    if (!auth.ok || !auth.token) {
      setDriveToken('');
      switch (auth.status) {
        case 'needs_login':
          setDriveState(buildDriveState('needs_login', auth.message));
          return;
        case 'needs_google_identity':
          setDriveState(buildDriveState('needs_google_identity', auth.message));
          return;
        case 'needs_consent':
          setDriveState(buildDriveState('needs_consent', auth.message));
          return;
        case 'guest':
          setDriveState(buildDriveState('needs_login', auth.message));
          return;
        default:
          setDriveState(buildDriveState('error', auth.message));
          return;
      }
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
    setSelectedProjectId(snapshot.selectedProjectId);
    setSelectedChapterId(snapshot.selectedChapterId);
    setIsHydratingLocal(false);
  }, []);

  useEffect(() => {
    void refreshDriveSession();
  }, [refreshDriveSession]);

  useEffect(() => {
    if (isHydratingLocal) return;
    writeLocalSnapshot({
      version: 2,
      projects,
      chaptersByProjectId,
      selectedProjectId,
      selectedChapterId,
    });
  }, [projects, chaptersByProjectId, selectedProjectId, selectedChapterId, isHydratingLocal]);

  useEffect(() => {
    if (isHydratingLocal) return;
    setSelectedProjectId((previous) => {
      if (previous && projects.some((project) => project.id === previous)) return previous;
      return projects[0]?.id || '';
    });
  }, [projects, isHydratingLocal]);

  useEffect(() => {
    if (isHydratingLocal) return;
    const projectChapters = chaptersByProjectId[selectedProjectId] || [];
    setSelectedChapterId((previous) => {
      if (previous && projectChapters.some((chapter) => chapter.id === previous)) return previous;
      return projectChapters[0]?.id || '';
    });
  }, [chaptersByProjectId, selectedProjectId, isHydratingLocal]);

  useEffect(() => {
    const nextSelectionKey = selectedProjectId && selectedChapterId
      ? `${selectedProjectId}:${selectedChapterId}`
      : '';
    if (activeSelectionKeyRef.current === nextSelectionKey) return;
    activeSelectionKeyRef.current = nextSelectionKey;

    if (!nextSelectionKey) {
      setChapterText('');
      setSaveState('idle');
      setSaveError('');
      lastSavedTextRef.current = '';
      return;
    }

    const chapter = (chaptersByProjectId[selectedProjectId] || []).find((item) => item.id === selectedChapterId);
    const text = chapter?.text || '';
    setIsLoadingChapterText(true);
    setChapterText(text);
    lastSavedTextRef.current = text;
    setSaveState('idle');
    setSaveError('');
    setIsLoadingChapterText(false);
  }, [selectedProjectId, selectedChapterId, chaptersByProjectId]);

  useEffect(() => {
    if (isHydratingLocal || !selectedProjectId || !selectedChapterId || isLoadingChapterText) {
      return;
    }
    if (chapterText === lastSavedTextRef.current) return;

    setSaveState('pending');
    setSaveError('');
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);

    autosaveTimerRef.current = setTimeout(() => {
      try {
        setSaveState('saving');
        setChaptersByProjectId((previous) =>
          patchChapterText(previous, selectedProjectId, selectedChapterId, chapterText)
        );
        lastSavedTextRef.current = chapterText;
        setSaveState('saved');
      } catch (error: any) {
        setSaveState('error');
        setSaveError(normalizeError(error));
      }
    }, 1400);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [chapterText, selectedProjectId, selectedChapterId, isHydratingLocal, isLoadingChapterText]);

  const handleManualSave = async (): Promise<void> => {
    if (!selectedProjectId || !selectedChapterId) return;
    try {
      setSaveState('saving');
      setChaptersByProjectId((previous) =>
        patchChapterText(previous, selectedProjectId, selectedChapterId, chapterText)
      );
      lastSavedTextRef.current = chapterText;
      setSaveState('saved');
      setSaveError('');
      onToast('Chapter saved to local storage.', 'success');
    } catch (error: any) {
      setSaveState('error');
      setSaveError(normalizeError(error));
      onToast(`Save failed: ${normalizeError(error)}`, 'error');
    }
  };

  const handleCreateNovel = async (): Promise<void> => {
    const novelName = sanitizeLabel(newProjectName, '');
    if (!novelName) {
      onToast('Enter a novel name first.', 'info');
      return;
    }
    const timestamp = new Date().toISOString();
    const createdProject: NovelProject = {
      id: createLocalId('project'),
      name: novelName,
      rootFolderId: 'local',
      createdTime: timestamp,
      modifiedTime: timestamp,
    };
    setProjects((previous) => [createdProject, ...previous]);
    setChaptersByProjectId((previous) => ({
      ...previous,
      [createdProject.id]: [],
    }));
    setSelectedProjectId(createdProject.id);
    setSelectedChapterId('');
    setChapterText('');
    lastSavedTextRef.current = '';
    setNewProjectName('');
    onToast('Novel created in local storage.', 'success');
  };

  const handleRenameNovel = async (project: NovelProject): Promise<void> => {
    const nextName = window.prompt('Rename novel', project.name);
    const safeName = sanitizeLabel(nextName, '');
    if (!safeName || safeName === project.name) return;
    const now = new Date().toISOString();
    setProjects((previous) =>
      previous.map((item) => (item.id === project.id ? { ...item, name: safeName, modifiedTime: now } : item))
    );
    onToast('Novel renamed.', 'success');
  };

  const handleDeleteNovel = (project: NovelProject): void => {
    if (!window.confirm(`Delete "${project.name}" and all chapters from local storage?`)) return;
    setProjects((previous) => previous.filter((item) => item.id !== project.id));
    setChaptersByProjectId((previous) => {
      const next = { ...previous };
      delete next[project.id];
      return next;
    });
    if (selectedProjectId === project.id) {
      setSelectedProjectId('');
      setSelectedChapterId('');
      setChapterText('');
      lastSavedTextRef.current = '';
      setSaveState('idle');
      setSaveError('');
    }
    onToast('Novel deleted from local storage.', 'success');
  };

  const handleCreateChapter = async (): Promise<void> => {
    if (!selectedProjectId) {
      onToast('Select a novel first.', 'info');
      return;
    }
    const existing = chaptersByProjectId[selectedProjectId] || [];
    const nextIndex = Math.max(1, ...existing.map((chapter) => chapter.index + 1));
    const safeTitle = sanitizeLabel(
      newChapterTitle || `Chapter ${nextIndex}`,
      `Chapter ${nextIndex}`
    );
    const now = new Date().toISOString();
    const created: LocalNovelChapter = {
      id: createLocalId('chapter'),
      projectId: selectedProjectId,
      title: safeTitle,
      name: buildChapterName(nextIndex, safeTitle),
      index: nextIndex,
      text: '',
      createdTime: now,
      modifiedTime: now,
    };

    setChaptersByProjectId((previous) => ({
      ...previous,
      [selectedProjectId]: [...(previous[selectedProjectId] || []), created].sort(chapterSort),
    }));
    setSelectedChapterId(created.id);
    setChapterText('');
    lastSavedTextRef.current = '';
    setNewChapterTitle('');
    onToast('Chapter created in local storage.', 'success');
  };

  const handleDeleteChapter = (chapter: NovelChapter): void => {
    if (!selectedProjectId) return;
    if (!window.confirm(`Delete "${chapter.name}" from local storage?`)) return;
    setChaptersByProjectId((previous) => ({
      ...previous,
      [selectedProjectId]: (previous[selectedProjectId] || []).filter((item) => item.id !== chapter.id),
    }));
    if (selectedChapterId === chapter.id) {
      setSelectedChapterId('');
      setChapterText('');
      lastSavedTextRef.current = '';
      setSaveState('idle');
      setSaveError('');
    }
    onToast('Chapter deleted from local storage.', 'success');
  };

  const insertTextAtCursor = (value: string): void => {
    if (!value.trim()) return;
    const textarea = editorRef.current;
    if (!textarea) {
      setChapterText((previous) => `${previous}${previous.endsWith('\n') ? '' : '\n'}${value}`);
      return;
    }

    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const before = chapterText.slice(0, start);
    const after = chapterText.slice(end);
    const nextValue = `${before}${value}${after}`;
    setChapterText(nextValue);

    requestAnimationFrame(() => {
      textarea.focus();
      const nextCursor = start + value.length;
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const runWritingTool = async (mode: 'continue' | 'rewrite' | 'polish' | 'summarize'): Promise<void> => {
    if (!chapterText.trim()) {
      onToast('Open a chapter and write text first.', 'info');
      return;
    }
    setIsRunningWritingTool(true);
    try {
      let output = '';
      if (mode === 'polish') {
        output = await proofreadScript(chapterText, settings, 'flow');
      } else if (mode === 'continue') {
        output = await generateTextContent(
          'Continue this chapter in the same voice for 3 short paragraphs. Keep character continuity.',
          chapterText,
          settings
        );
      } else if (mode === 'rewrite') {
        output = await generateTextContent(
          'Rewrite this chapter with stronger prose and pacing while keeping plot and key events unchanged.',
          chapterText,
          settings
        );
      } else {
        output = await generateTextContent(
          'Summarize this chapter into concise bullet points. Include beats and character intent.',
          chapterText,
          settings
        );
      }
      setWritingOutput(output);
      onToast('Writing tool output is ready.', 'success');
    } catch (error: any) {
      onToast(`Writing tool failed: ${normalizeError(error)}`, 'error');
    } finally {
      setIsRunningWritingTool(false);
    }
  };

  const runDirectTranslation = async (): Promise<void> => {
    if (!chapterText.trim()) {
      onToast('Open a chapter and write text first.', 'info');
      return;
    }
    setIsRunningTranslation(true);
    try {
      const translated = await translateText(chapterText, targetLang, settings);
      setTranslationOutput(translated);
      onToast('Direct translation complete.', 'success');
    } catch (error: any) {
      onToast(`Translation failed: ${normalizeError(error)}`, 'error');
    } finally {
      setIsRunningTranslation(false);
    }
  };

  const runCulturalAdaptation = async (): Promise<void> => {
    if (!chapterText.trim()) {
      onToast('Open a chapter and write text first.', 'info');
      return;
    }
    if (!targetCulture.trim()) {
      onToast('Enter target culture/setting for adaptation.', 'info');
      return;
    }
    setIsRunningTranslation(true);
    try {
      const adapted = await localizeNovel(chapterText, targetLang, targetCulture, 'adapt', settings);
      setTranslationOutput(adapted);
      onToast('Cultural adaptation complete.', 'success');
    } catch (error: any) {
      onToast(`Adaptation failed: ${normalizeError(error)}`, 'error');
    } finally {
      setIsRunningTranslation(false);
    }
  };

  const saveOutputAsNewChapter = async (output: string, suffix: string): Promise<void> => {
    if (!selectedProjectId) {
      onToast('Select a novel first.', 'info');
      return;
    }
    if (!output.trim()) {
      onToast('Nothing to save yet.', 'info');
      return;
    }
    const existing = chaptersByProjectId[selectedProjectId] || [];
    const nextIndex = Math.max(1, ...existing.map((chapter) => chapter.index + 1));
    const baseTitle = selectedChapter?.title || 'Generated Chapter';
    const title = sanitizeLabel(`${baseTitle} (${suffix})`, `Chapter ${nextIndex}`);
    const now = new Date().toISOString();
    const created: LocalNovelChapter = {
      id: createLocalId('chapter'),
      projectId: selectedProjectId,
      title,
      name: buildChapterName(nextIndex, title),
      index: nextIndex,
      text: output,
      createdTime: now,
      modifiedTime: now,
    };

    setChaptersByProjectId((previous) => ({
      ...previous,
      [selectedProjectId]: [...(previous[selectedProjectId] || []), created].sort(chapterSort),
    }));
    setSelectedChapterId(created.id);
    setChapterText(output);
    lastSavedTextRef.current = output;
    setSaveState('saved');
    setSaveError('');
    onToast('Output saved as a new chapter.', 'success');
  };

  const handleIdeaGeneration = async (): Promise<void> => {
    if (!ideaUrl.trim()) {
      onToast('Paste a source URL first.', 'info');
      return;
    }
    setIsGeneratingIdeas(true);
    try {
      const metadata = await extractNovelIdeaMetadata(mediaBackendUrl, ideaSource, ideaUrl.trim());
      setIdeaMetadata(metadata);
      const cards = await generateNovelIdeaCards(metadata, settings);
      setIdeaCards(cards);
      onToast(`Generated ${cards.length} idea card(s).`, 'success');
    } catch (error: any) {
      onToast(`Idea import failed: ${normalizeError(error)}`, 'error');
    } finally {
      setIsGeneratingIdeas(false);
    }
  };

  const handleDriveConnectAction = async (): Promise<void> => {
    setIsConnectingDrive(true);
    try {
      if (driveState.status === 'needs_google_identity') {
        await connectDriveIdentity();
      } else {
        await reconsentDriveScopes();
      }
    } catch (error: any) {
      onToast(`Google Drive connection failed: ${normalizeError(error)}`, 'error');
    } finally {
      setIsConnectingDrive(false);
    }
  };

  const handleUploadCurrentNovelToDrive = async (): Promise<void> => {
    if (driveState.status !== 'connected' || !driveToken) {
      onToast('Connect Google Drive first.', 'info');
      return;
    }
    if (!selectedProjectId || !selectedProject) {
      onToast('Select a local novel first.', 'info');
      return;
    }

    const chaptersToUpload = [...(chaptersByProjectId[selectedProjectId] || [])].sort(chapterSort);
    setIsUploadingToDrive(true);
    try {
      const driveProject = await createNovelProject(driveToken, selectedProject.name);
      for (const chapter of chaptersToUpload) {
        await createChapter(driveToken, driveProject.id, chapter.title, chapter.text);
      }
      onToast(
        `Uploaded "${selectedProject.name}" to Google Drive (${chaptersToUpload.length} chapter${chaptersToUpload.length === 1 ? '' : 's'}).`,
        'success'
      );
    } catch (error: any) {
      onToast(`Upload failed: ${normalizeError(error)}`, 'error');
    } finally {
      setIsUploadingToDrive(false);
    }
  };

  const handleDownloadNovelFromDrive = async (): Promise<void> => {
    if (driveState.status !== 'connected' || !driveToken) {
      onToast('Connect Google Drive first.', 'info');
      return;
    }

    setIsDownloadingFromDrive(true);
    try {
      const driveProjects = await listNovelProjects(driveToken);
      if (driveProjects.length === 0) {
        onToast('No Google Drive novel folders found.', 'info');
        return;
      }

      const promptLines = driveProjects
        .slice(0, 25)
        .map((project, index) => `${index + 1}. ${project.name}`)
        .join('\n');
      const selectedIndexRaw = window.prompt(
        `Enter folder number to download into local storage:\n${promptLines}`,
        '1'
      );
      if (!selectedIndexRaw) return;

      const selectedIndex = Number(selectedIndexRaw);
      if (!Number.isFinite(selectedIndex) || selectedIndex < 1 || selectedIndex > driveProjects.length) {
        onToast('Invalid folder number.', 'error');
        return;
      }

      const driveProject = driveProjects[selectedIndex - 1];
      const driveChapters = (await listChapters(driveToken, driveProject.id)).sort(chapterSort);
      const now = new Date().toISOString();
      const localProjectId = createLocalId('project');

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
          createdTime: driveChapter.createdTime || now,
          modifiedTime: driveChapter.modifiedTime || now,
        });
      }

      setProjects((previous) => {
        const name = buildUniqueProjectName(previous, driveProject.name);
        const importedProject: NovelProject = {
          id: localProjectId,
          name,
          rootFolderId: 'local',
          createdTime: now,
          modifiedTime: now,
        };
        return [importedProject, ...previous];
      });
      setChaptersByProjectId((previous) => ({
        ...previous,
        [localProjectId]: localChapters,
      }));
      setSelectedProjectId(localProjectId);
      setSelectedChapterId(localChapters[0]?.id || '');

      onToast(
        `Downloaded "${driveProject.name}" (${localChapters.length} chapter${localChapters.length === 1 ? '' : 's'}) to local storage.`,
        'success'
      );
    } catch (error: any) {
      onToast(`Download failed: ${normalizeError(error)}`, 'error');
    } finally {
      setIsDownloadingFromDrive(false);
    }
  };

  const canConnectDrive = driveState.status !== 'checking' && driveState.status !== 'connected';
  const connectLabel =
    driveState.status === 'needs_google_identity'
      ? 'Link Google Account'
      : driveState.status === 'guest' || driveState.status === 'needs_login'
        ? 'Login with Google'
        : 'Reconnect Google Drive';

  return (
    <div className="max-w-[1200px] mx-auto animate-in fade-in h-full flex flex-col">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Novel Workspace</h2>
          <p className="text-sm text-gray-500">
            Local-first writing with auto-restore and autosave. Google Drive is used only for folder upload/download.
          </p>
        </div>
        <button
          onClick={() => { void refreshDriveSession(); }}
          className="px-3 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 bg-white hover:bg-gray-50"
        >
          <RefreshCw size={14} className={driveState.status === 'checking' ? 'animate-spin inline mr-2' : 'inline mr-2'} />
          Refresh Drive
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 min-h-[620px] flex-1">
        <div className="xl:col-span-3 bg-white rounded-2xl border border-gray-200 p-4 flex flex-col gap-4 overflow-hidden">
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Create Novel</label>
            <div className="flex gap-2">
              <input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Novel name"
                className="flex-1 p-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={() => { void handleCreateNovel(); }}
                className="px-3 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
                title="Create local novel"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
            <p className="text-xs font-bold text-gray-500 uppercase mb-2">Local Novels</p>
            <div className="space-y-1.5">
              {isHydratingLocal && <p className="text-xs text-gray-500">Loading local workspace...</p>}
              {!isHydratingLocal && projects.length === 0 && (
                <p className="text-xs text-gray-500">No local novels yet. Create your first one.</p>
              )}
              {projects.map((project) => (
                <div
                  key={project.id}
                  className={`p-2.5 rounded-xl border cursor-pointer transition-colors ${
                    selectedProjectId === project.id
                      ? 'border-indigo-300 bg-indigo-50'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                  onClick={() => setSelectedProjectId(project.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-800 truncate">{project.name}</p>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRenameNovel(project);
                        }}
                        className="text-[10px] px-2 py-1 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200"
                      >
                        Rename
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteNovel(project);
                        }}
                        className="text-[10px] px-2 py-1 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 flex items-center gap-1"
                        title="Delete novel"
                      >
                        <Trash2 size={11} />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Create Chapter</label>
            <div className="flex gap-2">
              <input
                value={newChapterTitle}
                onChange={(e) => setNewChapterTitle(e.target.value)}
                placeholder="Chapter title"
                className="flex-1 p-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={() => { void handleCreateChapter(); }}
                className="px-3 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                title="Create chapter"
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="mt-3 max-h-40 overflow-y-auto custom-scrollbar space-y-1.5">
              {chapters.length === 0 && <p className="text-xs text-gray-500">No chapters yet for this novel.</p>}
              {chapters.map((chapter) => (
                <div key={chapter.id} className="flex items-center gap-1.5">
                  <button
                    onClick={() => setSelectedChapterId(chapter.id)}
                    className={`flex-1 text-left p-2 rounded-lg border text-xs font-semibold ${
                      chapter.id === selectedChapterId
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {chapter.name}
                  </button>
                  <button
                    onClick={() => handleDeleteChapter(chapter)}
                    className="px-2.5 py-2 rounded-lg border border-red-100 bg-red-50 text-red-700 hover:bg-red-100"
                    title="Delete chapter"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="xl:col-span-5 bg-white rounded-2xl border border-gray-200 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-gray-100 flex items-center justify-between gap-2 bg-gray-50">
            <div className="min-w-0">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Editor</p>
              <p className="text-sm font-semibold text-gray-800 truncate">
                {selectedProject?.name || 'No novel selected'} {selectedChapter ? ` / ${selectedChapter.title}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-gray-500">
                {saveState === 'saving' && 'Saving...'}
                {saveState === 'pending' && 'Autosave queued'}
                {saveState === 'saved' && 'Saved'}
                {saveState === 'error' && 'Save error'}
              </span>
              <button
                onClick={() => { void handleManualSave(); }}
                disabled={!selectedChapterId || isLoadingChapterText}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1"
              >
                <Save size={12} /> Save
              </button>
              <button
                onClick={() => onSendToStudio(chapterText)}
                disabled={!chapterText.trim()}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1"
              >
                <Send size={12} /> Send to Studio
              </button>
            </div>
          </div>
          <textarea
            ref={editorRef}
            value={chapterText}
            onChange={(e) => setChapterText(e.target.value)}
            placeholder="Select or create a chapter to start writing..."
            className="flex-1 p-5 resize-none outline-none text-[15px] leading-relaxed text-gray-800 font-serif bg-white custom-scrollbar"
            disabled={isLoadingChapterText || !selectedChapterId}
          />
          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-500 flex justify-between">
            <span>{chapterText.trim() ? chapterText.trim().split(/\s+/).length : 0} words</span>
            <span>{saveState === 'error' ? saveError : 'Local autosave active'}</span>
          </div>
        </div>

        <div className="xl:col-span-4 space-y-4 overflow-y-auto custom-scrollbar pr-1">
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen size={16} className="text-indigo-600" />
              <h3 className="text-sm font-bold text-gray-800">Google Storage</h3>
            </div>
            <p className="text-xs text-gray-600 mb-3">
              Use Google only for backup transfer: upload local folder or download a Drive folder into local storage.
            </p>
            <div className="p-2.5 rounded-xl border border-gray-200 bg-gray-50 mb-3">
              <p className="text-xs text-gray-700">{driveState.message}</p>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <Button
                onClick={handleDriveConnectAction}
                disabled={!canConnectDrive || isConnectingDrive}
                className="w-full bg-indigo-600 hover:bg-indigo-700"
              >
                {isConnectingDrive ? <Loader2 size={14} className="animate-spin mr-2" /> : <FolderOpen size={14} className="mr-2" />}
                {driveState.status === 'connected' ? 'Drive Connected' : connectLabel}
              </Button>
              <button
                onClick={() => { void handleUploadCurrentNovelToDrive(); }}
                disabled={driveState.status !== 'connected' || isUploadingToDrive || !selectedProjectId}
                className="w-full px-3 py-2 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-bold hover:bg-indigo-100 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isUploadingToDrive ? <Loader2 size={12} className="animate-spin" /> : <CloudUpload size={12} />}
                Upload Selected Folder
              </button>
              <button
                onClick={() => { void handleDownloadNovelFromDrive(); }}
                disabled={driveState.status !== 'connected' || isDownloadingFromDrive}
                className="w-full px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isDownloadingFromDrive ? <Loader2 size={12} className="animate-spin" /> : <CloudDownload size={12} />}
                Download Folder to Local
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Wand2 size={16} className="text-indigo-600" />
              <h3 className="text-sm font-bold text-gray-800">Writing Tools</h3>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button onClick={() => { void runWritingTool('continue'); }} className="px-3 py-2 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-bold hover:bg-indigo-100">Continue</button>
              <button onClick={() => { void runWritingTool('rewrite'); }} className="px-3 py-2 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-bold hover:bg-indigo-100">Rewrite</button>
              <button onClick={() => { void runWritingTool('polish'); }} className="px-3 py-2 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-bold hover:bg-indigo-100">Polish</button>
              <button onClick={() => { void runWritingTool('summarize'); }} className="px-3 py-2 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-bold hover:bg-indigo-100">Summarize</button>
            </div>
            {isRunningWritingTool && <p className="text-xs text-gray-500 mb-2">Running tool...</p>}
            <textarea
              value={writingOutput}
              onChange={(e) => setWritingOutput(e.target.value)}
              placeholder="Writing tool output appears here..."
              className="w-full h-24 p-2.5 border border-gray-200 rounded-xl text-xs bg-gray-50 outline-none resize-y"
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => insertTextAtCursor(writingOutput)}
                disabled={!writingOutput.trim()}
                className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Insert in Editor
              </button>
              <button
                onClick={() => { void saveOutputAsNewChapter(writingOutput, 'writing'); }}
                disabled={!writingOutput.trim()}
                className="flex-1 px-3 py-2 rounded-lg border border-indigo-200 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
              >
                Save as Chapter
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={16} className="text-emerald-600" />
              <h3 className="text-sm font-bold text-gray-800">Translation & Adaptation</h3>
            </div>
            <div className="grid grid-cols-1 gap-2 mb-2">
              <select
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="w-full p-2.5 border border-gray-200 rounded-xl text-xs bg-gray-50 outline-none"
              >
                <option value="Hinglish">Hinglish</option>
                <option value="English">English</option>
                <option value="Hindi">Hindi</option>
                {LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.name}>{lang.name}</option>
                ))}
              </select>
              <input
                value={targetCulture}
                onChange={(e) => setTargetCulture(e.target.value)}
                placeholder="Target culture e.g. Mumbai, India"
                className="w-full p-2.5 border border-gray-200 rounded-xl text-xs bg-gray-50 outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button onClick={() => { void runDirectTranslation(); }} className="px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100">Direct Translate</button>
              <button onClick={() => { void runCulturalAdaptation(); }} className="px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100">Cultural Adapt</button>
            </div>
            {isRunningTranslation && <p className="text-xs text-gray-500 mb-2">Generating translated output...</p>}
            <textarea
              value={translationOutput}
              onChange={(e) => setTranslationOutput(e.target.value)}
              placeholder="Translation/adaptation output..."
              className="w-full h-24 p-2.5 border border-gray-200 rounded-xl text-xs bg-gray-50 outline-none resize-y"
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => insertTextAtCursor(translationOutput)}
                disabled={!translationOutput.trim()}
                className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Insert in Editor
              </button>
              <button
                onClick={() => { void saveOutputAsNewChapter(translationOutput, 'translated'); }}
                disabled={!translationOutput.trim()}
                className="flex-1 px-3 py-2 rounded-lg border border-emerald-200 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
              >
                Save as Chapter
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Lightbulb size={16} className="text-fuchsia-600" />
              <h3 className="text-sm font-bold text-gray-800">Idea Import (Metadata Only)</h3>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <select
                value={ideaSource}
                onChange={(e) => setIdeaSource(e.target.value as NovelIdeaSource)}
                className="p-2.5 border border-gray-200 rounded-xl text-xs bg-gray-50 outline-none"
              >
                <option value="webnovel">webnovel.com</option>
                <option value="pocketnovel">pocketnovel.com</option>
              </select>
              <button
                onClick={() => { void handleIdeaGeneration(); }}
                disabled={isGeneratingIdeas}
                className="px-3 py-2 rounded-lg bg-fuchsia-600 text-white text-xs font-bold hover:bg-fuchsia-700 disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {isGeneratingIdeas ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Generate Ideas
              </button>
            </div>
            <input
              value={ideaUrl}
              onChange={(e) => setIdeaUrl(e.target.value)}
              placeholder="Paste webnovel or pocketnovel URL"
              className="w-full p-2.5 border border-gray-200 rounded-xl text-xs bg-gray-50 outline-none mb-2"
            />
            {ideaMetadata && (
              <div className="p-2.5 rounded-xl border border-fuchsia-100 bg-fuchsia-50/60 mb-2">
                <p className="text-xs font-semibold text-fuchsia-800">{ideaMetadata.title || 'Untitled source'}</p>
                <p className="text-[11px] text-fuchsia-700 mt-1">{ideaMetadata.synopsis || 'No synopsis found from metadata.'}</p>
                {ideaMetadata.tags.length > 0 && (
                  <p className="text-[11px] text-fuchsia-700 mt-1">Tags: {ideaMetadata.tags.join(', ')}</p>
                )}
              </div>
            )}
            <div className="space-y-2 max-h-44 overflow-y-auto custom-scrollbar">
              {ideaCards.map((card) => (
                <div key={card.id} className="p-2.5 rounded-xl border border-gray-200 bg-gray-50">
                  <p className="text-xs font-bold text-gray-800">{card.title}</p>
                  <p className="text-[11px] text-gray-600 mt-1">{card.premise}</p>
                  <p className="text-[11px] text-gray-500 mt-1"><strong>Hook:</strong> {card.hook}</p>
                  <button
                    onClick={() => insertTextAtCursor(`${card.title}\n${card.premise}\nHook: ${card.hook}\nConflict: ${card.conflict}\nTwist: ${card.twist}\n`)}
                    className="mt-2 px-2.5 py-1.5 rounded-lg border border-gray-200 text-[11px] font-semibold text-gray-700 hover:bg-white"
                  >
                    Insert Idea
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
