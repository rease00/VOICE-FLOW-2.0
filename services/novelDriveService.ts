import { NovelChapter, NovelProject } from '../types';

export const DRIVE_ROOT_FOLDER_NAME = 'VoiceFlow Novels';
export const EXPORTS_FOLDER_NAME = 'Exports';

export const MIME_GOOGLE_FOLDER = 'application/vnd.google-apps.folder';
export const MIME_GOOGLE_DOC = 'application/vnd.google-apps.document';
export const MIME_PDF = 'application/pdf';
export const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MIME_TEXT = 'text/plain';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3/files';
const DOCS_API_BASE = 'https://docs.googleapis.com/v1/documents';

interface DriveFileRecord {
  id: string;
  name: string;
  mimeType?: string;
  createdTime?: string;
  modifiedTime?: string;
}

const buildAuthHeaders = (token: string, extra?: Record<string, string>): HeadersInit => ({
  Authorization: `Bearer ${token}`,
  ...extra,
});

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const sanitizeName = (value: string, fallback: string): string => {
  const clean = collapseWhitespace(String(value || '').replace(/[\\/:*?"<>|]/g, ''));
  return clean.slice(0, 120) || fallback;
};

const parseChapterMetaFromName = (fileName: string, fallbackIndex: number): { title: string; index: number } => {
  const match = /^Chapter\s+(\d{1,4})\s*-\s*(.+)$/i.exec(fileName);
  if (match) {
    const parsedIndex = Number(match[1]);
    return {
      index: Number.isFinite(parsedIndex) && parsedIndex > 0 ? parsedIndex : fallbackIndex,
      title: collapseWhitespace(match[2] || '') || `Chapter ${fallbackIndex}`,
    };
  }

  return {
    index: fallbackIndex,
    title: fileName,
  };
};

const parseDriveError = async (response: Response): Promise<string> => {
  try {
    const payload = await response.json();
    const message = payload?.error?.message || payload?.error_description || payload?.message;
    return message || `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
};

const driveJson = async <T>(token: string, url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: buildAuthHeaders(token, {
      Accept: 'application/json',
      ...(init?.headers as Record<string, string>),
    }),
  });

  if (!response.ok) {
    throw new Error(await parseDriveError(response));
  }

  return response.json();
};

const driveBlob = async (token: string, url: string): Promise<Blob> => {
  const response = await fetch(url, {
    method: 'GET',
    headers: buildAuthHeaders(token),
  });

  if (!response.ok) {
    throw new Error(await parseDriveError(response));
  }

  return response.blob();
};

const driveText = async (token: string, url: string): Promise<string> => {
  const response = await fetch(url, {
    method: 'GET',
    headers: buildAuthHeaders(token),
  });

  if (!response.ok) {
    throw new Error(await parseDriveError(response));
  }

  return response.text();
};

const escapeDriveQueryString = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const uploadMultipart = async (
  token: string,
  metadata: Record<string, any>,
  blob: Blob,
  contentType: string
): Promise<DriveFileRecord> => {
  const boundary = `voiceflow_${Math.random().toString(36).slice(2)}`;
  const body = new Blob(
    [
      `--${boundary}\r\n`,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(metadata),
      '\r\n',
      `--${boundary}\r\n`,
      `Content-Type: ${contentType}\r\n\r\n`,
      blob,
      '\r\n',
      `--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` }
  );

  const url = `${DRIVE_UPLOAD_BASE}?uploadType=multipart&fields=id,name,mimeType,createdTime,modifiedTime`;
  const response = await fetch(url, {
    method: 'POST',
    headers: buildAuthHeaders(token, {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    }),
    body,
  });

  if (!response.ok) {
    throw new Error(await parseDriveError(response));
  }

  return response.json();
};

const listFoldersByName = async (token: string, folderName: string, parentId: string): Promise<DriveFileRecord[]> => {
  const escapedName = escapeDriveQueryString(folderName);
  const escapedParent = escapeDriveQueryString(parentId);
  const query = [
    `name='${escapedName}'`,
    `mimeType='${MIME_GOOGLE_FOLDER}'`,
    `'${escapedParent}' in parents`,
    'trashed=false',
  ].join(' and ');

  const url = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,createdTime,modifiedTime)&spaces=drive&pageSize=20`;
  const payload = await driveJson<{ files?: DriveFileRecord[] }>(token, url);
  return Array.isArray(payload.files) ? payload.files : [];
};

const createFolder = async (token: string, name: string, parentId: string): Promise<DriveFileRecord> => {
  return driveJson<DriveFileRecord>(token, `${DRIVE_API_BASE}/files?fields=id,name,mimeType,createdTime,modifiedTime`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: sanitizeName(name, 'Untitled Folder'),
      mimeType: MIME_GOOGLE_FOLDER,
      parents: [parentId],
    }),
  });
};

export const verifyDriveAccess = async (token: string): Promise<{ ok: boolean; message: string }> => {
  try {
    await driveJson<any>(token, `${DRIVE_API_BASE}/about?fields=user(displayName,emailAddress)`);
    return { ok: true, message: 'Google Drive access verified.' };
  } catch (error: any) {
    const message = String(error?.message || 'Unable to access Google Drive.');
    if (message.toLowerCase().includes('insufficient')) {
      return { ok: false, message: 'Drive permission is missing. Please reconnect Google Drive.' };
    }
    return { ok: false, message };
  }
};

export const ensureNovelRootFolder = async (token: string): Promise<DriveFileRecord> => {
  const existing = await listFoldersByName(token, DRIVE_ROOT_FOLDER_NAME, 'root');
  if (existing.length > 0) {
    return existing[0];
  }
  return createFolder(token, DRIVE_ROOT_FOLDER_NAME, 'root');
};

export const ensureProjectExportsFolder = async (token: string, projectFolderId: string): Promise<DriveFileRecord> => {
  const existing = await listFoldersByName(token, EXPORTS_FOLDER_NAME, projectFolderId);
  if (existing.length > 0) {
    return existing[0];
  }
  return createFolder(token, EXPORTS_FOLDER_NAME, projectFolderId);
};

export const listNovelProjects = async (token: string): Promise<NovelProject[]> => {
  const root = await ensureNovelRootFolder(token);
  const query = [
    `mimeType='${MIME_GOOGLE_FOLDER}'`,
    `'${escapeDriveQueryString(root.id)}' in parents`,
    'trashed=false',
  ].join(' and ');
  const url = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name,createdTime,modifiedTime)&spaces=drive&pageSize=200&orderBy=modifiedTime desc`;
  const payload = await driveJson<{ files?: DriveFileRecord[] }>(token, url);
  const files = Array.isArray(payload.files) ? payload.files : [];
  return files.map((file) => ({
    id: file.id,
    name: file.name,
    rootFolderId: root.id,
    createdTime: file.createdTime,
    modifiedTime: file.modifiedTime,
  }));
};

export const createNovelProject = async (token: string, name: string): Promise<NovelProject> => {
  const root = await ensureNovelRootFolder(token);
  const folderName = sanitizeName(name, 'Untitled Novel');
  const projectFolder = await createFolder(token, folderName, root.id);
  const exportsFolder = await ensureProjectExportsFolder(token, projectFolder.id);
  return {
    id: projectFolder.id,
    name: projectFolder.name,
    rootFolderId: root.id,
    exportsFolderId: exportsFolder.id,
    createdTime: projectFolder.createdTime,
    modifiedTime: projectFolder.modifiedTime,
  };
};

export const renameNovelProject = async (token: string, projectId: string, name: string): Promise<NovelProject> => {
  const root = await ensureNovelRootFolder(token);
  const updated = await driveJson<DriveFileRecord>(
    token,
    `${DRIVE_API_BASE}/files/${encodeURIComponent(projectId)}?fields=id,name,createdTime,modifiedTime`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: sanitizeName(name, 'Untitled Novel'),
      }),
    }
  );
  return {
    id: updated.id,
    name: updated.name,
    rootFolderId: root.id,
    createdTime: updated.createdTime,
    modifiedTime: updated.modifiedTime,
  };
};

export const listChapters = async (token: string, projectFolderId: string): Promise<NovelChapter[]> => {
  const query = [
    `mimeType='${MIME_GOOGLE_DOC}'`,
    `'${escapeDriveQueryString(projectFolderId)}' in parents`,
    'trashed=false',
  ].join(' and ');
  const url = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name,createdTime,modifiedTime)&spaces=drive&pageSize=300&orderBy=name asc`;
  const payload = await driveJson<{ files?: DriveFileRecord[] }>(token, url);
  const files = Array.isArray(payload.files) ? payload.files : [];

  return files.map((file, idx) => {
    const chapterMeta = parseChapterMetaFromName(file.name, idx + 1);
    return {
      id: file.id,
      projectId: projectFolderId,
      title: chapterMeta.title,
      name: file.name,
      index: chapterMeta.index,
      createdTime: file.createdTime,
      modifiedTime: file.modifiedTime,
    };
  });
};

export const createChapter = async (
  token: string,
  projectFolderId: string,
  title: string,
  initialText: string
): Promise<NovelChapter> => {
  const existing = await listChapters(token, projectFolderId);
  const nextIndex = Math.max(1, ...existing.map((chapter) => chapter.index + 1));
  const safeTitle = sanitizeName(title, `Chapter ${nextIndex}`);
  const chapterName = `Chapter ${String(nextIndex).padStart(3, '0')} - ${safeTitle}`;

  const created = await driveJson<DriveFileRecord>(
    token,
    `${DRIVE_API_BASE}/files?fields=id,name,createdTime,modifiedTime`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: chapterName,
        mimeType: MIME_GOOGLE_DOC,
        parents: [projectFolderId],
      }),
    }
  );

  if (initialText.trim()) {
    await saveChapterText(token, created.id, initialText);
  }

  return {
    id: created.id,
    projectId: projectFolderId,
    title: safeTitle,
    name: chapterName,
    index: nextIndex,
    createdTime: created.createdTime,
    modifiedTime: created.modifiedTime,
  };
};

export const loadChapterText = async (token: string, fileId: string): Promise<string> => {
  const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(MIME_TEXT)}`;
  return driveText(token, url);
};

export const saveChapterText = async (token: string, fileId: string, text: string): Promise<void> => {
  const doc = await driveJson<any>(token, `${DOCS_API_BASE}/${encodeURIComponent(fileId)}`);
  const content = Array.isArray(doc?.body?.content) ? doc.body.content : [];
  const lastEntry = content.length > 0 ? content[content.length - 1] : null;
  const endIndex = Number(lastEntry?.endIndex || 1);

  const requests: any[] = [];
  if (endIndex > 1) {
    requests.push({
      deleteContentRange: {
        range: {
          startIndex: 1,
          endIndex: endIndex - 1,
        },
      },
    });
  }

  if (text.length > 0) {
    requests.push({
      insertText: {
        location: { index: 1 },
        text,
      },
    });
  }

  if (requests.length === 0) return;

  await driveJson<any>(token, `${DOCS_API_BASE}/${encodeURIComponent(fileId)}:batchUpdate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  });
};

export const exportChapter = async (token: string, fileId: string, mimeType: string): Promise<Blob> => {
  const url = `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(mimeType)}`;
  return driveBlob(token, url);
};

export const uploadAsGoogleDoc = async (
  token: string,
  file: File,
  parentId: string
): Promise<DriveFileRecord> => {
  const nameWithoutExtension = sanitizeName(file.name.replace(/\.[^/.]+$/i, ''), 'Imported File');
  return uploadMultipart(
    token,
    {
      name: nameWithoutExtension,
      parents: [parentId],
      mimeType: MIME_GOOGLE_DOC,
    },
    file,
    file.type || 'application/octet-stream'
  );
};

export const saveExportFile = async (
  token: string,
  parentId: string,
  blob: Blob,
  fileName: string,
  mimeType: string
): Promise<DriveFileRecord> => {
  return uploadMultipart(
    token,
    {
      name: sanitizeName(fileName, 'export'),
      parents: [parentId],
      mimeType: mimeType || 'application/octet-stream',
    },
    blob,
    mimeType || 'application/octet-stream'
  );
};

