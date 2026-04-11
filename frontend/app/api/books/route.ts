import { NextRequest, NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function getAdminApp() {
  const existing = getApps();
  if (existing.length > 0) return existing[0]!;
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID ?? '',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
      privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
    }),
  });
}

async function verifyRequest(req: NextRequest): Promise<{ uid: string }> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing authorization');
  }
  const token = authHeader.slice(7);
  const decoded = await getAuth(getAdminApp()).verifyIdToken(token);
  return { uid: decoded.uid };
}

function sanitize(input: string): string {
  return String(input || '').replace(/["`${}]/g, '').trim();
}

export async function GET(req: NextRequest) {
  try {
    const { uid } = await verifyRequest(req);
    const db = getFirestore(getAdminApp());
    const url = new URL(req.url);
    const bookId = url.searchParams.get('bookId');
    const chapters = url.searchParams.get('chapters');

    if (bookId && chapters === 'true') {
      const snap = await db
        .collection('publishedChapters')
        .where('bookId', '==', bookId)
        .orderBy('index')
        .get();
      const chapterDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      return NextResponse.json({ chapters: chapterDocs });
    }

    if (bookId) {
      const doc = await db.collection('publishedBooks').doc(bookId).get();
      if (!doc.exists) {
        return NextResponse.json({ error: 'Book not found' }, { status: 404 });
      }
      return NextResponse.json({ book: { id: doc.id, ...doc.data() } });
    }

    const snap = await db
      .collection('publishedBooks')
      .where('authorId', '==', uid)
      .orderBy('createdAt', 'desc')
      .get();
    const books = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ books });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { uid } = await verifyRequest(req);
    const db = getFirestore(getAdminApp());
    const body = await req.json();

    const { novelProjectId, title, description, genre, language, chapterPrice } = body;
    if (!novelProjectId || !title || !description || !genre || !language || chapterPrice === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: novelProjectId, title, description, genre, language, chapterPrice' },
        { status: 400 }
      );
    }

    const sanitizedTitle = sanitize(title);
    const sanitizedDescription = sanitize(description);
    const sanitizedGenre = sanitize(genre);
    const sanitizedLanguage = sanitize(language);

    if (typeof chapterPrice !== 'number' || chapterPrice < 0 || chapterPrice > 1000) {
      return NextResponse.json({ error: 'chapterPrice must be a number between 0 and 1000' }, { status: 400 });
    }

    if (body.fullNovelPrice !== undefined && body.fullNovelPrice !== null) {
      if (typeof body.fullNovelPrice !== 'number' || body.fullNovelPrice < 0) {
        return NextResponse.json({ error: 'fullNovelPrice must be a non-negative number' }, { status: 400 });
      }
    }

    const tags: string[] = (body.tags ?? []).slice(0, 10).map((t: unknown) => sanitize(String(t)));

    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();

    const docRef = db.collection('publishedBooks').doc();
    const bookData = {
      id: docRef.id,
      authorId: uid,
      authorName: userData?.name || 'Anonymous',
      title: sanitizedTitle,
      description: sanitizedDescription,
      genre: sanitizedGenre,
      language: sanitizedLanguage,
      coverUrl: sanitize(body.coverUrl || ''),
      status: 'draft' as const,
      chapterCount: 0,
      totalCharacters: 0,
      chapterPrice: body.chapterPrice,
      fullNovelPrice: body.fullNovelPrice || null,
      driveRootFolderId: body.novelProjectId,
      tags,
      rating: 0,
      ratingCount: 0,
      downloadCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await docRef.set(bookData);
    return NextResponse.json({ book: bookData }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message === 'Missing authorization' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { uid } = await verifyRequest(req);
    const db = getFirestore(getAdminApp());
    const body = await req.json();

    const { bookId } = body;
    if (!bookId) {
      return NextResponse.json({ error: 'bookId is required' }, { status: 400 });
    }

    const bookRef = db.collection('publishedBooks').doc(bookId);
    const bookDoc = await bookRef.get();
    if (!bookDoc.exists) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const bookData = bookDoc.data()!;
    if (bookData.authorId !== uid) {
      return NextResponse.json({ error: 'Not authorized to update this book' }, { status: 403 });
    }

    const updates: Record<string, unknown> = {};

    if (body.title !== undefined) updates.title = sanitize(body.title);
    if (body.description !== undefined) updates.description = sanitize(body.description);
    if (body.genre !== undefined) updates.genre = sanitize(body.genre);
    if (body.coverUrl !== undefined) updates.coverUrl = sanitize(body.coverUrl);
    if (body.status !== undefined) {
      const VALID_STATUSES = ['draft', 'review', 'published', 'suspended'];
      const sanitizedStatus = sanitize(body.status);
      if (!VALID_STATUSES.includes(sanitizedStatus)) {
        return NextResponse.json({ error: 'Invalid status. Must be one of: draft, review, published, suspended' }, { status: 400 });
      }
      updates.status = sanitizedStatus;
    }

    if (body.chapterPrice !== undefined) {
      if (typeof body.chapterPrice !== 'number' || body.chapterPrice < 0 || body.chapterPrice > 1000) {
        return NextResponse.json({ error: 'chapterPrice must be a number between 0 and 1000' }, { status: 400 });
      }
      updates.chapterPrice = body.chapterPrice;
    }

    if (body.tags !== undefined) {
      updates.tags = (body.tags ?? []).slice(0, 10).map((t: unknown) => sanitize(String(t)));
    }

    if (bookData.fullNovelPrice != null && body.fullNovelPrice !== undefined) {
      return NextResponse.json({ error: 'fullNovelPrice is locked and cannot be changed' }, { status: 400 });
    }

    updates.updatedAt = new Date().toISOString();
    await bookRef.update(updates);

    const updatedDoc = await bookRef.get();
    return NextResponse.json({ book: { id: updatedDoc.id, ...updatedDoc.data() } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message === 'Missing authorization' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
