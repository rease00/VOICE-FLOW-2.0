import type { NextRequest } from 'next/server';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

import type { Book, GutendexResponse } from '../../features/library/model/types';
import { fetchBookById, fetchDiscoveredBooks, type BookDiscoveryOptions } from '../bookDiscovery';
import { handleLibraryBookChapterAudioRoute } from '../audioNovel/service';
import { readLegacyReaderObject } from './readerObjectAdapter';
import {
  handleLibraryPublishedBookChaptersRoute,
  listPublishedBooksForLibrary,
  mapPublishedBookToLibraryBook,
  readPublishedBookById,
} from '../publishing/service';
import {
  LIBRARY_D1_TABLES,
  readReaderD1Record,
  readReaderD1Rows,
  writeReaderD1Record,
  writeReaderD1UpsertMultiKey,
  deleteReaderD1Record,
  getLibraryReaderD1Database,
  ensureLibraryReaderD1Schema,
} from './d1Storage';
import { getFirebaseAdminFirestore } from '../firebaseAdmin';

const firestore = () => getFirebaseAdminFirestore();

const READER_FIRESTORE_COLLECTIONS = Object.freeze({
  readerProgress: 'reader_progress',
  readerSessions: 'reader_sessions',
  readerPreferences: 'reader_preferences',
} as const);

type LibraryDiscoveryMeta = {
  publishedBooksAvailable: boolean;
  degradedSources: string[];
};

type LibraryDiscoveryResult = GutendexResponse & {
  meta?: LibraryDiscoveryMeta;
};

const PRIVATE_HOST_RE = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|::1)$/i;
const ALLOWED_HOST_SUFFIXES = [
  'gutenberg.org',
  'gutendex.com',
  'archive.org',
  'openlibrary.org',
];

const isAllowedHost = (hostname: string): boolean => {
  const safeHostname = String(hostname || '').trim().toLowerCase();
  if (!safeHostname || PRIVATE_HOST_RE.test(safeHostname)) {
    return false;
  }
  return ALLOWED_HOST_SUFFIXES.some((suffix) => safeHostname === suffix || safeHostname.endsWith(`.${suffix}`));
};

export const normalizeBookSource = (value: string | null): Book['source'] | undefined => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'openlibrary') return 'openlibrary';
  if (normalized === 'gutenberg') return 'gutenberg';
  if (normalized === 'published') return 'published';
  return undefined;
};

const parseDiscoveryOptions = (request: NextRequest): BookDiscoveryOptions => {
  const searchParams = request.nextUrl.searchParams;
  const options: BookDiscoveryOptions = {};
  const sort = searchParams.get('sort');
  const search = searchParams.get('search');
  const topic = searchParams.get('topic');
  const languages = searchParams.get('languages');

  if (sort) options.sort = sort;
  if (search) options.search = search;
  if (topic) options.topic = topic;
  if (languages === 'en' || languages === 'all') {
    options.languages = languages;
  }

  return options;
};

export const fetchLibraryBooks = async (options: BookDiscoveryOptions = {}): Promise<LibraryDiscoveryResult> => {
  const [external, publishedResult] = await Promise.all([
    fetchDiscoveredBooks(options),
    listPublishedBooksForLibrary(options).then(
      (books) => ({ ok: true as const, books }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
  ]);
  const published = publishedResult.ok ? publishedResult.books : [];

  if (!publishedResult.ok) {
    console.warn('[library] Published book discovery degraded; continuing with external catalog only.', {
      error: publishedResult.error instanceof Error ? publishedResult.error.message : String(publishedResult.error || 'unknown'),
      options,
    });
  }

  return {
    ...external,
    count: external.count + published.length,
    results: [...published, ...(external.results || [])],
    ...(publishedResult.ok ? {} : {
      meta: {
        publishedBooksAvailable: false,
        degradedSources: ['publishedBooks'],
      } satisfies LibraryDiscoveryMeta,
    }),
  };
};

export const fetchLibraryBookById = async (
  bookId: string,
  source?: Book['source'],
): Promise<Book | null> => {
  if (source === 'published') {
    const book = await readPublishedBookById(bookId);
    return book ? mapPublishedBookToLibraryBook(book) : null;
  }
  return fetchBookById(bookId, source);
};

export const handleLibraryBooksRoute = async (request: NextRequest): Promise<Response> => {
  try {
    const rawUrl = String(request.nextUrl.searchParams.get('url') || '').trim();
    if (rawUrl) {
      const parsed = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return Response.json({ error: 'Only http(s) URLs are allowed.' }, { status: 400 });
      }
      if (!isAllowedHost(parsed.hostname)) {
        return Response.json({ error: 'Book host is not allowed.' }, { status: 403 });
      }

      const upstream = await fetch(parsed.toString(), {
        headers: {
          Accept: 'text/plain, text/html;q=0.8, */*;q=0.1',
          'User-Agent': 'V-FLOW-AI-Reader/1.0',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });

      if (!upstream.ok) {
        return Response.json(
          { error: `Book request failed (${upstream.status}).` },
          { status: upstream.status },
        );
      }

      return new Response(await upstream.text(), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    return Response.json(await fetchLibraryBooks(parseDiscoveryOptions(request)), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Book fetch failed.';
    return Response.json({ error: message }, { status: 500 });
  }
};

export const handleLibraryBookRoute = async (
  request: NextRequest,
  bookId: string,
): Promise<Response> => {
  try {
    const source = normalizeBookSource(request.nextUrl.searchParams.get('source'));
    const book = await fetchLibraryBookById(bookId, source);
    if (!book) {
      return Response.json({ error: 'Book not found.' }, { status: 404 });
    }
    return Response.json({ book }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Book fetch failed.';
    return Response.json({ error: message }, { status: 500 });
  }
};

export const handleLibraryBookChaptersRoute = async (
  request: NextRequest,
  bookId: string,
): Promise<Response> => {
  return handleLibraryPublishedBookChaptersRoute(request, bookId);
};

export const handleLibraryBookChapterAudioGetRoute = async (
  request: NextRequest,
  bookId: string,
  chapterId: string,
): Promise<Response> => {
  return handleLibraryBookChapterAudioRoute(request, bookId, chapterId);
};

export const handleLibraryReaderObjectRoute = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const objectKey = String(url.searchParams.get('key') || '').trim();
  if (!objectKey) {
    return Response.json({ error: 'key is required.' }, { status: 400 });
  }

  const object = await readLegacyReaderObject(objectKey);
  if (!object) {
    return Response.json({ error: 'Reader object not found.' }, { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': object.contentType,
      'Cache-Control': 'no-store',
    },
  });
};

// ── Reader Progress ──────────────────────────────────────────────────────────────

export const readReaderProgress = async (
  uid: string,
  bookId: string,
): Promise<Record<string, unknown> | null> => {
  const db = await getLibraryReaderD1Database();
  if (db) {
    await ensureLibraryReaderD1Schema(db);
    const d1Record = await readReaderD1Record(LIBRARY_D1_TABLES.readerProgress, 'uid', uid);
    if (d1Record) {
      return d1Record;
    }
    return null;
  }

  const snapshot = await firestore()
    .collection(READER_FIRESTORE_COLLECTIONS.readerProgress)
    .where('uid', '==', uid)
    .where('bookId', '==', bookId)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  return snapshot.docs[0].data() as Record<string, unknown>;
};

export const writeReaderProgress = async (
  uid: string,
  bookId: string,
  progress: Record<string, unknown>,
): Promise<void> => {
  const nowIso = new Date().toISOString();
  const payload = { ...progress, uid, bookId, updatedAt: nowIso };

  const db = await getLibraryReaderD1Database();
  if (db) {
    await ensureLibraryReaderD1Schema(db);
    await writeReaderD1UpsertMultiKey(
      LIBRARY_D1_TABLES.readerProgress,
      ['uid', 'book_id'],
      [uid, bookId],
      payload,
      nowIso,
    );
    return;
  }

  const query = await firestore()
    .collection(READER_FIRESTORE_COLLECTIONS.readerProgress)
    .where('uid', '==', uid)
    .where('bookId', '==', bookId)
    .limit(1)
    .get();
  if (!query.empty) {
    await query.docs[0].ref.set(payload, { merge: true });
    return;
  }
  await firestore().collection(READER_FIRESTORE_COLLECTIONS.readerProgress).add(payload);
};

export const deleteReaderProgress = async (uid: string, bookId: string): Promise<number> => {
  const db = await getLibraryReaderD1Database();
  if (db) {
    await ensureLibraryReaderD1Schema(db);
    const existing = await readReaderD1Record(LIBRARY_D1_TABLES.readerProgress, 'uid', uid);
    await db.prepare(`DELETE FROM ${LIBRARY_D1_TABLES.readerProgress} WHERE uid = ? AND book_id = ?`)
      .bind(uid, bookId)
      .run();
    return existing ? 1 : 0;
  }

  const query = await firestore()
    .collection(READER_FIRESTORE_COLLECTIONS.readerProgress)
    .where('uid', '==', uid)
    .where('bookId', '==', bookId)
    .limit(1)
    .get();
  if (query.empty) return 0;
  await query.docs[0].ref.delete();
  return 1;
};

// ── Reader Sessions ──────────────────────────────────────────────────────────────

export const readReaderSession = async (
  sessionId: string,
): Promise<Record<string, unknown> | null> => {
  const db = await getLibraryReaderD1Database();
  if (db) {
    await ensureLibraryReaderD1Schema(db);
    return readReaderD1Record(LIBRARY_D1_TABLES.readerSessions, 'session_id', sessionId);
  }

  const snapshot = await firestore().collection(READER_FIRESTORE_COLLECTIONS.readerSessions).doc(sessionId).get();
  return snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null;
};

export const listReaderSessions = async (uid: string, limit = 50): Promise<Record<string, unknown>[]> => {
  const safeLimit = Math.max(1, Math.min(200, limit));

  const db = await getLibraryReaderD1Database();
  if (db) {
    await ensureLibraryReaderD1Schema(db);
    return readReaderD1Rows(
      `SELECT session_id, payload_json, updated_at FROM ${LIBRARY_D1_TABLES.readerSessions} WHERE uid = ? ORDER BY updated_at DESC, session_id DESC LIMIT ?`,
      uid,
      safeLimit,
    );
  }

  const snapshot = await firestore()
    .collection(READER_FIRESTORE_COLLECTIONS.readerSessions)
    .where('uid', '==', uid)
    .orderBy('updatedAt', 'desc')
    .limit(safeLimit)
    .get();
  return snapshot.docs.map((doc: QueryDocumentSnapshot) => doc.data() as Record<string, unknown>);
};

export const writeReaderSession = async (
  sessionId: string,
  session: Record<string, unknown>,
): Promise<void> => {
  const nowIso = new Date().toISOString();
  const payload = { ...session, sessionId, updatedAt: nowIso };

  const db = await getLibraryReaderD1Database();
  if (db) {
    await ensureLibraryReaderD1Schema(db);
    await writeReaderD1Record(LIBRARY_D1_TABLES.readerSessions, 'session_id', sessionId, payload, nowIso);
    return;
  }

  await firestore().collection(READER_FIRESTORE_COLLECTIONS.readerSessions).doc(sessionId).set(payload, { merge: true });
};

export const deleteReaderSession = async (sessionId: string): Promise<number> => {
  const db = await getLibraryReaderD1Database();
  if (db) {
    await ensureLibraryReaderD1Schema(db);
    return deleteReaderD1Record(LIBRARY_D1_TABLES.readerSessions, 'session_id', sessionId);
  }

  const ref = firestore().collection(READER_FIRESTORE_COLLECTIONS.readerSessions).doc(sessionId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return 0;
  await ref.delete();
  return 1;
};

// ── Reader Preferences ───────────────────────────────────────────────────────────

export const readReaderPreferences = async (uid: string): Promise<Record<string, unknown> | null> => {
  const db = await getLibraryReaderD1Database();
  if (db) {
    await ensureLibraryReaderD1Schema(db);
    return readReaderD1Record(LIBRARY_D1_TABLES.readerPreferences, 'uid', uid);
  }

  const snapshot = await firestore().collection(READER_FIRESTORE_COLLECTIONS.readerPreferences).doc(uid).get();
  return snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null;
};

export const writeReaderPreferences = async (
  uid: string,
  preferences: Record<string, unknown>,
): Promise<void> => {
  const nowIso = new Date().toISOString();
  const payload = { ...preferences, uid, updatedAt: nowIso };

  const db = await getLibraryReaderD1Database();
  if (db) {
    await ensureLibraryReaderD1Schema(db);
    await writeReaderD1Record(LIBRARY_D1_TABLES.readerPreferences, 'uid', uid, payload, nowIso);
    return;
  }

  await firestore().collection(READER_FIRESTORE_COLLECTIONS.readerPreferences).doc(uid).set(payload, { merge: true });
};

export const deleteReaderPreferences = async (uid: string): Promise<number> => {
  const db = await getLibraryReaderD1Database();
  if (db) {
    await ensureLibraryReaderD1Schema(db);
    return deleteReaderD1Record(LIBRARY_D1_TABLES.readerPreferences, 'uid', uid);
  }

  const ref = firestore().collection(READER_FIRESTORE_COLLECTIONS.readerPreferences).doc(uid);
  const snapshot = await ref.get();
  if (!snapshot.exists) return 0;
  await ref.delete();
  return 1;
};
