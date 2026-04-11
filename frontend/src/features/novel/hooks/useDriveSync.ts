import { useCallback, useEffect, useRef, useState } from 'react';
import type { DriveConnectionState, NovelProject, NovelChapter } from '../../../../types';
import {
  connectDriveIdentity,
  getDriveProviderToken,
  reconsentDriveScopes,
} from '../../../../services/driveAuthService';
import {
  createChapter as driveCreateChapter,
  createNovelProject as driveCreateProject,
  listChapters as driveListChapters,
  listNovelProjects as driveListProjects,
  loadChapterText as driveLoadChapterText,
  verifyDriveAccess,
} from '../../../../services/novelDriveService';
import { formatFrontendError } from '../../../shared/errors/formatFrontendError';

type ToastFn = (msg: string, type?: 'success' | 'error' | 'info') => void;

const buildDriveState = (status: DriveConnectionState['status'], message: string): DriveConnectionState => ({
  status,
  message,
});

export const useDriveSync = (onToast: ToastFn, isAdmin: boolean) => {
  const [driveState, setDriveState] = useState<DriveConnectionState>(
    buildDriveState('checking', 'Checking Google Drive access...')
  );
  const [driveToken, setDriveToken] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const toPublicError = useCallback(
    (err: unknown, fallback: string) =>
      formatFrontendError(err, { fallback, context: 'media', isAdmin }).publicMessage,
    [isAdmin]
  );

  const refreshDriveSession = useCallback(async () => {
    try {
      const result = await getDriveProviderToken();
      if (result.ok && result.token) {
        const verify = await verifyDriveAccess(result.token);
        if (verify.ok) {
          setDriveToken(result.token);
          setDriveState(buildDriveState('connected', 'Google Drive connected'));
          return;
        }
        setDriveState(buildDriveState('needs_consent', verify.message));
        return;
      }
      setDriveState(buildDriveState(
        result.status === 'needs_consent' ? 'needs_consent' : 'needs_google_identity',
        result.message || 'Sign in with Google to enable Drive sync'
      ));
    } catch (error) {
      setDriveState(buildDriveState('error', toPublicError(error, 'Failed to check Drive access')));
    }
  }, [toPublicError]);

  useEffect(() => {
    void refreshDriveSession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connectDrive = useCallback(async () => {
    setIsConnecting(true);
    try {
      if (driveState.status === 'needs_consent') {
        await reconsentDriveScopes();
      } else {
        await connectDriveIdentity();
      }
      await refreshDriveSession();
      onToast('Google Drive connected', 'success');
    } catch (error) {
      setDriveState(buildDriveState('error', toPublicError(error, 'Failed to connect Google Drive')));
      onToast('Drive connection failed', 'error');
    } finally {
      setIsConnecting(false);
    }
  }, [driveState.status, refreshDriveSession, toPublicError, onToast]);

  const uploadToDrive = useCallback(async (
    projects: NovelProject[],
    chaptersByProjectId: Record<string, { id: string; projectId: string; title: string; name: string; index: number; text: string }[]>,
  ) => {
    if (!driveToken) {
      onToast('Connect Google Drive first', 'error');
      return;
    }
    setIsUploading(true);
    try {
      for (const project of projects) {
        const chapters = chaptersByProjectId[project.id] || [];
        let driveProject: NovelProject;
        try {
          driveProject = await driveCreateProject(driveToken, project.name);
        } catch {
          continue;
        }
        for (const chapter of chapters) {
          try {
            await driveCreateChapter(driveToken, driveProject.rootFolderId, chapter.title, chapter.text, chapter.index);
          } catch {
            // Skip individual chapter failures
          }
        }
      }
      onToast('Uploaded to Google Drive', 'success');
    } catch (error) {
      onToast(toPublicError(error, 'Drive upload failed'), 'error');
    } finally {
      setIsUploading(false);
    }
  }, [driveToken, onToast, toPublicError]);

  const downloadFromDrive = useCallback(async (): Promise<{
    projects: NovelProject[];
    chaptersByProject: Record<string, Array<NovelChapter & { text: string }>>;
  } | null> => {
    if (!driveToken) {
      onToast('Connect Google Drive first', 'error');
      return null;
    }
    setIsDownloading(true);
    try {
      const projects = await driveListProjects(driveToken);
      const chaptersByProject: Record<string, Array<NovelChapter & { text: string }>> = {};
      for (const project of projects) {
        const chapters = await driveListChapters(driveToken, project.rootFolderId);
        const withText: Array<NovelChapter & { text: string }> = [];
        for (const chapter of chapters) {
          const text = await driveLoadChapterText(driveToken, chapter.id);
          withText.push({ ...chapter, text });
        }
        chaptersByProject[project.id] = withText;
      }
      onToast('Downloaded from Google Drive', 'success');
      return { projects, chaptersByProject };
    } catch (error) {
      onToast(toPublicError(error, 'Drive download failed'), 'error');
      return null;
    } finally {
      setIsDownloading(false);
    }
  }, [driveToken, onToast, toPublicError]);

  return {
    driveState,
    driveToken,
    isConnecting,
    isUploading,
    isDownloading,
    connectDrive,
    uploadToDrive,
    downloadFromDrive,
    refreshDriveSession,
  };
};
