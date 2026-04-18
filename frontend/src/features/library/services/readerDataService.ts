import type { Book, ChapterComment, LastPlayedRecord, ReaderChapter } from '../model/types';

const LOCAL_COMMENTS_PREFIX = 'vf:chapter-comments:';
const LOCAL_LAST_PLAYED_PREFIX = 'vf:last-played:';

const CHAPTER_HEADING_REGEX =
  /^(chapter|book|part|section)\s+([0-9]+|[ivxlcdm]+)([\s:.\-].*)?$/i;

const isBrowser = () => typeof window !== 'undefined';

const createId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const normalizeBookText = (text: string) => {
  const normalized = text.replace(/\r\n/g, '\n');

  const startMatch = normalized.match(
    /\*\*\* START OF (THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i
  );
  const endMatch = normalized.match(
    /\*\*\* END OF (THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i
  );

  let sliced = normalized;
  if (startMatch?.index !== undefined) {
    sliced = normalized.slice(startMatch.index + startMatch[0].length);
  }
  if (endMatch?.index !== undefined) {
    sliced = sliced.slice(0, sliced.indexOf(endMatch[0]));
  }

  return sliced
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const toTitleCase = (value: string) =>
  value
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();

const chunkBySize = (text: string, size = 9000): ReaderChapter[] => {
  const chapters: ReaderChapter[] = [];
  let cursor = 0;
  let index = 0;

  while (cursor < text.length) {
    const roughEnd = Math.min(text.length, cursor + size);
    const paragraphBreak = text.lastIndexOf('\n\n', roughEnd);
    const end = paragraphBreak > cursor + 1000 ? paragraphBreak : roughEnd;
    const body = text.slice(cursor, end).trim();

    if (body.length > 0) {
      chapters.push({ index, title: `Chapter ${index + 1}`, start: cursor, end, text: body });
      index += 1;
    }

    cursor = end;
  }

  return chapters;
};

export const extractReaderChapters = (rawText: string): ReaderChapter[] => {
  const text = normalizeBookText(rawText);
  if (!text) return [];

  const lines = text.split('\n');
  const markers: Array<{ title: string; start: number }> = [];
  let cursor = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && CHAPTER_HEADING_REGEX.test(trimmed)) {
      markers.push({ title: toTitleCase(trimmed), start: cursor });
    }
    cursor += line.length + 1;
  }

  if (markers.length < 2) return chunkBySize(text);

  const chapters: ReaderChapter[] = [];

  for (let i = 0; i < markers.length; i += 1) {
    const marker = markers[i]!;
    const next = markers[i + 1];
    const start = marker.start;
    const end = next ? next.start : text.length;
    const chapterText = text.slice(start, end).trim();

    if (!chapterText || chapterText.length < 120) continue;

    chapters.push({
      index: chapters.length,
      title: marker.title,
      start,
      end,
      text: chapterText,
    });
  }

  return chapters.length === 0 ? chunkBySize(text) : chapters;
};

// ---------------------------------------------------------------------------
// Chapter comments — localStorage-backed (Firestore sync planned for Phase E)
// ---------------------------------------------------------------------------

const readLocalComments = (bookId: string): ChapterComment[] => {
  if (!isBrowser()) return [];
  const raw = window.localStorage.getItem(`${LOCAL_COMMENTS_PREFIX}${bookId}`);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as ChapterComment[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeLocalComments = (bookId: string, comments: ChapterComment[]) => {
  if (!isBrowser()) return;
  window.localStorage.setItem(`${LOCAL_COMMENTS_PREFIX}${bookId}`, JSON.stringify(comments));
};

export const getChapterComments = async (bookId: string): Promise<ChapterComment[]> => {
  return readLocalComments(bookId);
};

export const createChapterComment = async (
  bookId: string,
  chapterIndex: number,
  chapterTitle: string,
  body: string,
  userLabel = 'Guest Reader'
): Promise<ChapterComment> => {
  const nextComment: ChapterComment = {
    id: createId(),
    bookId,
    chapterIndex,
    chapterTitle,
    body,
    userId: null,
    userLabel,
    createdAt: new Date().toISOString(),
  };

  const local = [nextComment, ...readLocalComments(bookId)];
  writeLocalComments(bookId, local);
  return nextComment;
};

// ---------------------------------------------------------------------------
// Last-played tracking — localStorage-backed
// ---------------------------------------------------------------------------

const getLastPlayedStorageKey = (userId?: string | null) =>
  `${LOCAL_LAST_PLAYED_PREFIX}${userId ?? 'guest'}`;

const readLocalLastPlayed = (userId?: string | null): LastPlayedRecord | null => {
  if (!isBrowser()) return null;
  const raw = window.localStorage.getItem(getLastPlayedStorageKey(userId));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as LastPlayedRecord;
  } catch {
    return null;
  }
};

const writeLocalLastPlayed = (userId: string | null | undefined, record: LastPlayedRecord) => {
  if (!isBrowser()) return;
  window.localStorage.setItem(getLastPlayedStorageKey(userId), JSON.stringify(record));
};

export const getLastPlayed = async (userId?: string | null): Promise<LastPlayedRecord | null> => {
  return readLocalLastPlayed(userId);
};

export const saveLastPlayed = async (
  userId: string | null | undefined,
  payload: Omit<LastPlayedRecord, 'id'>
): Promise<LastPlayedRecord> => {
  const nextRecord: LastPlayedRecord = { ...payload, id: createId() };
  writeLocalLastPlayed(userId, nextRecord);
  return nextRecord;
};
