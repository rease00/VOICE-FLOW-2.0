import type { NextRequest } from 'next/server';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '../firebaseAdmin';
import type { Book } from '../../features/library/model/types';
import type { PublishedBook, PublishedChapter } from '../../features/publishing/model/types';
import { handleAudioNovelJobCreateRoute } from '../audioNovel/service';

type ChapterUpsertInput = {
  id?: string;
  title: string;
  index: number;
  driveFileId?: string;
  r2CacheKey?: string;
  text?: string;
  characterCount: number;
  price: number;
  isFree: boolean;
  audioKey?: string;
  syncKey?: string;
  audioHash?: string;
  generatedAt?: string;
};

const verifyRequest = async (request: NextRequest): Promise<{ uid: string }> => {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing authorization');
  }
  const token = authHeader.slice(7);
  const decoded = await getFirebaseAdminAuth().verifyIdToken(token);
  return { uid: decoded.uid };
};

const tryResolveUserId = async (request: Request): Promise<string | null> => {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  try {
    const token = authHeader.slice(7);
    const decoded = await getFirebaseAdminAuth().verifyIdToken(token);
    return String(decoded.uid || '').trim() || null;
  } catch {
    return null;
  }
};

const sanitize = (input: string): string => {
  return String(input || '').replace(/["`${}]/g, '').trim();
};

const sanitizeOptional = (input: unknown): string | undefined => {
  const safe = sanitize(String(input || ''));
  return safe || undefined;
};

const db = () => getFirebaseAdminFirestore();

const getBookRef = (bookId: string) => db().collection('publishedBooks').doc(bookId);
const getBookChapterCollection = (bookId: string) => getBookRef(bookId).collection('chapters');

const toPublishedBook = (snapshot: FirebaseFirestore.DocumentSnapshot): PublishedBook | null => {
  if (!snapshot.exists) return null;
  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<PublishedBook, 'id'>),
  };
};

const toPublishedChapter = (snapshot: FirebaseFirestore.DocumentSnapshot): PublishedChapter => {
  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<PublishedChapter, 'id'>),
  };
};

const readCanonicalChapterSnapshots = async (bookId: string): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> => {
  const snapshot = await getBookChapterCollection(bookId).orderBy('index').get();
  return snapshot.docs;
};

const readLegacyChapterSnapshots = async (bookId: string): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> => {
  const snapshot = await db()
    .collection('publishedChapters')
    .where('bookId', '==', bookId)
    .orderBy('index')
    .get();
  return snapshot.docs;
};

export const readCanonicalOrLegacyBookChapters = async (bookId: string): Promise<PublishedChapter[]> => {
  const canonicalDocs = await readCanonicalChapterSnapshots(bookId);
  if (canonicalDocs.length > 0) {
    return canonicalDocs.map((snapshot) => toPublishedChapter(snapshot));
  }
  return (await readLegacyChapterSnapshots(bookId)).map((snapshot) => toPublishedChapter(snapshot));
};

const findExistingChapterId = async (bookId: string, index: number): Promise<string | null> => {
  const canonicalSnapshot = await getBookChapterCollection(bookId)
    .where('index', '==', index)
    .limit(1)
    .get();
  if (!canonicalSnapshot.empty) {
    return canonicalSnapshot.docs[0]!.id;
  }

  const legacySnapshot = await db()
    .collection('publishedChapters')
    .where('bookId', '==', bookId)
    .where('index', '==', index)
    .limit(1)
    .get();
  if (!legacySnapshot.empty) {
    return legacySnapshot.docs[0]!.id;
  }

  return null;
};

const upsertChapterMirror = async (
  bookId: string,
  chapterId: string,
  chapter: ChapterUpsertInput,
): Promise<PublishedChapter> => {
  const now = new Date().toISOString();
  const canonicalRef = getBookChapterCollection(bookId).doc(chapterId);
  const legacyRef = db().collection('publishedChapters').doc(chapterId);
  const existingCanonical = await canonicalRef.get();
  const createdAt = existingCanonical.exists
    ? String(existingCanonical.data()?.createdAt || now)
    : now;

  const payload: PublishedChapter = {
    id: chapterId,
    bookId,
    title: sanitize(chapter.title),
    index: chapter.index,
    driveFileId: sanitize(String(chapter.driveFileId || '')),
    ...(sanitizeOptional(chapter.r2CacheKey) ? { r2CacheKey: sanitizeOptional(chapter.r2CacheKey) } : {}),
    ...(sanitizeOptional(chapter.text) ? { text: String(chapter.text || '') } : {}),
    characterCount: chapter.characterCount,
    price: chapter.price,
    isFree: Boolean(chapter.isFree),
    ...(sanitizeOptional(chapter.audioKey) ? { audioKey: sanitizeOptional(chapter.audioKey) } : {}),
    ...(sanitizeOptional(chapter.syncKey) ? { syncKey: sanitizeOptional(chapter.syncKey) } : {}),
    ...(sanitizeOptional(chapter.audioHash) ? { audioHash: sanitizeOptional(chapter.audioHash) } : {}),
    ...(sanitizeOptional(chapter.generatedAt) ? { generatedAt: sanitizeOptional(chapter.generatedAt) } : {}),
    createdAt,
    updatedAt: now,
  };

  await Promise.all([
    canonicalRef.set(payload, { merge: true }),
    legacyRef.set(payload, { merge: true }),
  ]);

  return payload;
};

export const mapPublishedBookToLibraryBook = (book: PublishedBook): Book => {
  return {
    id: book.id,
    title: book.title,
    authors: [{ name: book.authorName || 'Anonymous' }],
    translators: [],
    subjects: book.tags || [],
    bookshelves: book.tags || [],
    languages: [String(book.language || 'en').trim()],
    copyright: true,
    media_type: 'Text',
    formats: {},
    download_count: Number(book.downloadCount || 0),
    source: 'published',
    description: book.description,
    authorId: book.authorId,
    coverUrl: book.coverUrl,
    genre: book.genre,
    vnPrice: Number(book.chapterPrice || 0),
    ...(book.publishedAt ? { publishedAt: book.publishedAt } : {}),
  };
};

export const readPublishedBookById = async (bookId: string): Promise<PublishedBook | null> => {
  return toPublishedBook(await getBookRef(bookId).get());
};

const toSortableTimestamp = (value: string | undefined): number => {
  const normalized = String(value || '').trim();
  if (!normalized) return 0;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const listPublishedBooksForLibrary = async (input?: {
  search?: string;
  topic?: string;
  languages?: string;
}): Promise<Book[]> => {
  const snapshot = await db()
    .collection('publishedBooks')
    .where('status', '==', 'published')
    .limit(100)
    .get();

  const search = String(input?.search || '').trim().toLowerCase();
  const topic = String(input?.topic || '').trim().toLowerCase();
  const languages = String(input?.languages || '').trim().toLowerCase();

  return snapshot.docs
    .map((doc: QueryDocumentSnapshot) => toPublishedBook(doc))
    .filter((book: PublishedBook | null): book is PublishedBook => Boolean(book))
    .filter((book: PublishedBook) => {
      if (languages && languages !== 'all' && String(book.language || '').trim().toLowerCase() !== languages) {
        return false;
      }
      if (topic && topic !== 'all') {
        const haystack = `${book.genre || ''} ${(book.tags || []).join(' ')}`.toLowerCase();
        if (!haystack.includes(topic)) return false;
      }
      if (search) {
        const haystack = `${book.title} ${book.description} ${book.authorName}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    })
    .sort((left: PublishedBook, right: PublishedBook) => {
      const rightPublishedAt = toSortableTimestamp(right.publishedAt || right.createdAt);
      const leftPublishedAt = toSortableTimestamp(left.publishedAt || left.createdAt);
      return rightPublishedAt - leftPublishedAt;
    })
    .slice(0, 50)
    .map((book: PublishedBook) => mapPublishedBookToLibraryBook(book));
};

export const handlePublishingBooksRoute = async (request: NextRequest): Promise<Response> => {
  try {
    const { uid } = await verifyRequest(request);
    const url = new URL(request.url);
    const bookId = String(url.searchParams.get('bookId') || '').trim();
    const includeChapters = url.searchParams.get('chapters') === 'true';

    if (request.method === 'GET') {
      if (bookId && includeChapters) {
        const book = await readPublishedBookById(bookId);
        if (!book) {
          return Response.json({ error: 'Book not found' }, { status: 404 });
        }
        if (book.authorId !== uid) {
          return Response.json({ error: 'Not authorized to view this book' }, { status: 403 });
        }
        return Response.json({ chapters: await readCanonicalOrLegacyBookChapters(bookId) });
      }

      if (bookId) {
        const book = await readPublishedBookById(bookId);
        if (!book) {
          return Response.json({ error: 'Book not found' }, { status: 404 });
        }
        if (book.authorId !== uid) {
          return Response.json({ error: 'Not authorized to view this book' }, { status: 403 });
        }
        return Response.json({ book });
      }

      const snapshot = await db()
        .collection('publishedBooks')
        .where('authorId', '==', uid)
        .orderBy('createdAt', 'desc')
        .get();
      const books = snapshot.docs
        .map((doc: QueryDocumentSnapshot) => toPublishedBook(doc))
        .filter((book: PublishedBook | null): book is PublishedBook => Boolean(book));
      return Response.json({ books });
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const { novelProjectId, title, description, genre, language, chapterPrice } = body || {};
      if (!novelProjectId || !title || !description || !genre || !language || chapterPrice === undefined) {
        return Response.json(
          { error: 'Missing required fields: novelProjectId, title, description, genre, language, chapterPrice' },
          { status: 400 },
        );
      }

      if (typeof chapterPrice !== 'number' || chapterPrice < 0 || chapterPrice > 1000) {
        return Response.json({ error: 'chapterPrice must be a number between 0 and 1000' }, { status: 400 });
      }
      if (body.fullNovelPrice !== undefined && body.fullNovelPrice !== null) {
        if (typeof body.fullNovelPrice !== 'number' || body.fullNovelPrice < 0) {
          return Response.json({ error: 'fullNovelPrice must be a non-negative number' }, { status: 400 });
        }
      }

      const tags: string[] = (body.tags ?? []).slice(0, 10).map((entry: unknown) => sanitize(String(entry)));
      const userDoc = await db().collection('users').doc(uid).get();
      const userData = userDoc.data();

      const docRef = db().collection('publishedBooks').doc();
      const bookData: PublishedBook & { novelProjectId: string } = {
        id: docRef.id,
        authorId: uid,
        authorName: String(userData?.name || 'Anonymous'),
        title: sanitize(title),
        description: sanitize(description),
        genre: sanitize(genre),
        language: sanitize(language),
        coverUrl: sanitize(String(body.coverUrl || '')),
        status: 'draft',
        chapterCount: 0,
        totalCharacters: 0,
        chapterPrice,
        fullNovelPrice: body.fullNovelPrice || null,
        driveRootFolderId: String(novelProjectId),
        novelProjectId: String(novelProjectId),
        tags,
        rating: 0,
        ratingCount: 0,
        downloadCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await docRef.set(bookData);
      return Response.json({ book: bookData }, { status: 201 });
    }

    if (request.method === 'PATCH') {
      const body = await request.json();
      const targetBookId = String(body?.bookId || '').trim();
      if (!targetBookId) {
        return Response.json({ error: 'bookId is required' }, { status: 400 });
      }

      const bookRef = getBookRef(targetBookId);
      const bookDoc = await bookRef.get();
      const book = toPublishedBook(bookDoc);
      if (!book) {
        return Response.json({ error: 'Book not found' }, { status: 404 });
      }
      if (book.authorId !== uid) {
        return Response.json({ error: 'Not authorized to update this book' }, { status: 403 });
      }

      const updates: Record<string, unknown> = {};
      if (body.title !== undefined) updates.title = sanitize(String(body.title));
      if (body.description !== undefined) updates.description = sanitize(String(body.description));
      if (body.genre !== undefined) updates.genre = sanitize(String(body.genre));
      if (body.coverUrl !== undefined) updates.coverUrl = sanitize(String(body.coverUrl));
      if (body.tags !== undefined) {
        updates.tags = (body.tags ?? []).slice(0, 10).map((entry: unknown) => sanitize(String(entry)));
      }
      if (body.chapterPrice !== undefined) {
        if (typeof body.chapterPrice !== 'number' || body.chapterPrice < 0 || body.chapterPrice > 1000) {
          return Response.json({ error: 'chapterPrice must be a number between 0 and 1000' }, { status: 400 });
        }
        updates.chapterPrice = body.chapterPrice;
      }
      if (body.status !== undefined) {
        const nextStatus = sanitize(String(body.status));
        const validStatuses = ['draft', 'review', 'published', 'suspended'];
        if (!validStatuses.includes(nextStatus)) {
          return Response.json({ error: 'Invalid status. Must be one of: draft, review, published, suspended' }, { status: 400 });
        }
        updates.status = nextStatus;
      }
      if (book.fullNovelPrice != null && body.fullNovelPrice !== undefined) {
        return Response.json({ error: 'fullNovelPrice is locked and cannot be changed' }, { status: 400 });
      }
      updates.updatedAt = new Date().toISOString();
      await bookRef.update(updates);

      const updated = await readPublishedBookById(targetBookId);
      return Response.json({ book: updated });
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message === 'Missing authorization' ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
};

export const handlePublishingBookChaptersRoute = async (
  request: NextRequest,
  bookId: string,
): Promise<Response> => {
  try {
    const { uid } = await verifyRequest(request);
    const book = await readPublishedBookById(bookId);
    if (!book) {
      return Response.json({ error: 'Book not found' }, { status: 404 });
    }
    if (book.authorId !== uid) {
      return Response.json({ error: 'Not authorized to access this book' }, { status: 403 });
    }

    if (request.method === 'GET') {
      return Response.json({ chapters: await readCanonicalOrLegacyBookChapters(bookId) });
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const chapters = Array.isArray(body?.chapters)
        ? body.chapters
        : Array.isArray(body)
          ? body
          : [];

      if (chapters.length <= 0) {
        return Response.json({ error: 'chapters array is required' }, { status: 400 });
      }

      const upserted: PublishedChapter[] = [];
      let totalCharacters = 0;
      for (const raw of chapters.slice(0, 200)) {
        const chapter = raw as Partial<ChapterUpsertInput>;
        if (!chapter.title || typeof chapter.index !== 'number' || chapter.index < 0) {
          return Response.json({ error: 'Invalid chapter: title and non-negative index required' }, { status: 400 });
        }
        if (typeof chapter.characterCount !== 'number' || chapter.characterCount < 0) {
          return Response.json({ error: 'Invalid chapter: characterCount must be >= 0' }, { status: 400 });
        }
        if (typeof chapter.price !== 'number' || chapter.price < 0) {
          return Response.json({ error: 'Invalid chapter: price must be >= 0' }, { status: 400 });
        }

        const chapterId = String(chapter.id || await findExistingChapterId(bookId, chapter.index) || '').trim()
          || db().collection('_ids').doc().id;
        const r2CacheKey = sanitizeOptional(chapter.r2CacheKey);
        const text = typeof chapter.text === 'string' ? chapter.text : undefined;
        const audioKey = sanitizeOptional(chapter.audioKey);
        const syncKey = sanitizeOptional(chapter.syncKey);
        const audioHash = sanitizeOptional(chapter.audioHash);
        const generatedAt = sanitizeOptional(chapter.generatedAt);
        const saved = await upsertChapterMirror(bookId, chapterId, {
          title: String(chapter.title),
          index: chapter.index,
          driveFileId: sanitizeOptional(chapter.driveFileId) || '',
          characterCount: chapter.characterCount,
          price: chapter.price,
          isFree: Boolean(chapter.isFree),
          ...(r2CacheKey ? { r2CacheKey } : {}),
          ...(text ? { text } : {}),
          ...(audioKey ? { audioKey } : {}),
          ...(syncKey ? { syncKey } : {}),
          ...(audioHash ? { audioHash } : {}),
          ...(generatedAt ? { generatedAt } : {}),
        });
        upserted.push(saved);
        totalCharacters += saved.characterCount;
      }

      await getBookRef(bookId).set({
        chapterCount: upserted.length,
        totalCharacters,
        updatedAt: new Date().toISOString(),
      }, { merge: true });

      return Response.json({
        chapters: upserted,
        bookUpdate: {
          chapterCount: upserted.length,
          totalCharacters,
        },
      });
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message === 'Missing authorization' ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
};

export const handlePublishingBookPublishRoute = async (
  request: NextRequest,
  bookId: string,
): Promise<Response> => {
  try {
    const { uid } = await verifyRequest(request);
    const bookRef = getBookRef(bookId);
    const book = await readPublishedBookById(bookId);
    if (!book) {
      return Response.json({ error: 'Book not found' }, { status: 404 });
    }
    if (book.authorId !== uid) {
      return Response.json({ error: 'Not authorized' }, { status: 403 });
    }
    if (request.method === 'PATCH') {
      return handlePublishingBookChaptersRoute(request, bookId);
    }
    if (book.status === 'published') {
      return Response.json({ error: 'Already published' }, { status: 400 });
    }

    const userDoc = await db().collection('users').doc(uid).get();
    const userData = userDoc.data();
    if (userData?.kycStatus !== 'verified') {
      return Response.json({ error: 'KYC verification required' }, { status: 403 });
    }
    if (!userData?.agreementSigned) {
      return Response.json({ error: 'Publisher agreement required' }, { status: 403 });
    }

    const chapters = await readCanonicalOrLegacyBookChapters(bookId);
    const totalCharacters = chapters.reduce((sum, chapter) => sum + Number(chapter.characterCount || 0), 0);
    if (totalCharacters < 30000) {
      return Response.json(
        { error: 'Minimum 30,000 characters required', current: totalCharacters },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    await bookRef.set({
      status: 'published',
      chapterCount: chapters.length,
      totalCharacters,
      publishedAt: now,
      updatedAt: now,
    }, { merge: true });

    const updated = await readPublishedBookById(bookId);
    return Response.json({
      published: true,
      book: updated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message === 'Missing authorization' ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
};

export const handlePublishingChapterAudioRoute = async (
  request: NextRequest,
  bookId: string,
  chapterId: string,
): Promise<Response> => {
  try {
    const { uid } = await verifyRequest(request);
    const book = await readPublishedBookById(bookId);
    if (!book) {
      return Response.json({ error: 'Book not found' }, { status: 404 });
    }
    if (book.authorId !== uid) {
      return Response.json({ error: 'Not authorized to generate chapter audio' }, { status: 403 });
    }

    const chapters = await readCanonicalOrLegacyBookChapters(bookId);
    const chapter = chapters.find((entry) => String(entry.id) === String(chapterId));
    if (!chapter) {
      return Response.json({ error: 'Chapter not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const text = String(body.text || chapter.text || '').trim();
    if (!text) {
      return Response.json({ error: 'Chapter text is required to generate audio.' }, { status: 400 });
    }

    return handleAudioNovelJobCreateRoute(new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'novel',
        bookId,
        chapterId,
        text,
        language: sanitizeOptional(body.language) || String(book.language || 'en-US'),
        targetLanguage: sanitizeOptional(body.targetLanguage),
        voice: sanitizeOptional(body.voice) || 'Kore',
        engine: sanitizeOptional(body.engine) || 'VECTOR',
        speed: Number.isFinite(Number(body.speed)) ? Number(body.speed) : 1,
        pitch: Number.isFinite(Number(body.pitch)) ? Number(body.pitch) : 0,
        speakerConfigs: Array.isArray(body.speakerConfigs) ? body.speakerConfigs : [],
      }),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message === 'Missing authorization' ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
};

export const handleLibraryPublishedBookChaptersRoute = async (
  request: NextRequest,
  bookId: string,
): Promise<Response> => {
  try {
    const book = await readPublishedBookById(bookId);
    if (!book) {
      return Response.json({ error: 'Book not found' }, { status: 404 });
    }

    const requesterUid = await tryResolveUserId(request);
    const isOwner = requesterUid && requesterUid === book.authorId;
    if (book.status !== 'published' && !isOwner) {
      return Response.json({ error: 'Book not available' }, { status: 403 });
    }

    return Response.json({
      chapters: await readCanonicalOrLegacyBookChapters(bookId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load chapters';
    return Response.json({ error: message }, { status: 500 });
  }
};
