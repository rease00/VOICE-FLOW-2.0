import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getNovelRootFolder,
  isNovelLocalFsSupported,
  pickNovelRootFolder,
  syncNovelProjectToFolder,
} from '../../../../services/novelLocalFsService';
import type { ProjectMemoryLedger, ChapterMemorySummary, ChapterVersionSnapshot } from '../../../../types';
import type { LocalNovelChapter } from '../contexts/NovelEditorContext';

type ToastFn = (msg: string, type?: 'success' | 'error' | 'info') => void;

export const useLocalFolderSync = (onToast: ToastFn) => {
  const [boundFolderName, setBoundFolderName] = useState('');
  const [isBinding, setIsBinding] = useState(false);
  const [syncStatus, setSyncStatus] = useState('');
  const isSupported = isNovelLocalFsSupported();
  const rootHandleRef = useRef<FileSystemDirectoryHandle | null>(null);

  useEffect(() => {
    if (!isSupported) return;
    getNovelRootFolder()
      .then((handle) => {
        if (handle) {
          rootHandleRef.current = handle;
          setBoundFolderName(handle.name);
        }
      })
      .catch(() => {});
  }, [isSupported]);

  const bindFolder = useCallback(async () => {
    if (!isSupported) {
      onToast('Local folder sync is not supported in this browser', 'error');
      return;
    }
    setIsBinding(true);
    try {
      const handle = await pickNovelRootFolder();
      rootHandleRef.current = handle;
      setBoundFolderName(handle.name);
      onToast(`Bound to folder: ${handle.name}`, 'success');
    } catch {
      onToast('Failed to bind folder', 'error');
    } finally {
      setIsBinding(false);
    }
  }, [isSupported, onToast]);

  const syncProject = useCallback(async (
    projectName: string,
    chapters: LocalNovelChapter[],
    ledger: ProjectMemoryLedger,
    chapterSummaries: ChapterMemorySummary[],
    chapterVersions: Record<string, ChapterVersionSnapshot[]>,
  ) => {
    if (!rootHandleRef.current) {
      onToast('No local folder bound', 'error');
      return;
    }
    setSyncStatus('Syncing...');
    try {
      await syncNovelProjectToFolder(rootHandleRef.current, {
        projectName,
        chapters: chapters.map((c) => ({
          id: c.id,
          index: c.index,
          title: c.title,
          text: c.text,
          adaptedText: c.adaptedText ?? '',
        })),
        ledger,
        chapterSummaries,
        chapterVersions,
      });
      setSyncStatus('Synced');
      onToast('Project synced to local folder', 'success');
    } catch {
      setSyncStatus('Sync failed');
      onToast('Failed to sync to local folder', 'error');
    }
  }, [onToast]);

  return {
    boundFolderName,
    isBinding,
    syncStatus,
    isSupported,
    bindFolder,
    syncProject,
  };
};
