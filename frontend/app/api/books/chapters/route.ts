import { NextRequest, NextResponse } from 'next/server';
import { getD1Database, ensureD1Schema } from '../../../../src/server/d1/util';
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '@/server/firebaseAdmin';

async function verifyRequest(req: NextRequest): Promise<{ uid: string }> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing authorization');
  }
  const token = authHeader.slice(7);
  const decoded = await getFirebaseAdminAuth().verifyIdToken(token);
  return { uid: decoded.uid };
}

function sanitize(input: string): string {
  return String(input || '').replace(/["`${}]/g, '').trim();
}

function parsePayload(row: { payload_json?: string } | null): Record<string, unknown> | null {
  if (!row?.payload_json) return null;
  try {
    const parsed = JSON.parse(row.payload_json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const CHAPTERS_SCHEMA = `
CREATE TABLE IF NOT EXISTS chapters (
  chapter_id TEXT PRIMARY KEY NOT NULL,
  book_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chapters_book_id ON chapters(book_id);
`;

const BOOKS_SCHEMA = `
CREATE TABLE IF NOT EXISTS books (
  book_id TEXT PRIMARY KEY NOT NULL,
  uid TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_books_uid ON books(uid);
`;

export async function GET(req: NextRequest) {
  try {
    const { uid } = await verifyRequest(req);
    const url = new URL(req.url);
    const bookId = url.searchParams.get('bookId');

    if (!bookId) {
      return NextResponse.json({ error: 'bookId is required' }, { status: 400 });
    }

    const d1 = await getD1Database();

    if (d1) {
      await ensureD1Schema(d1, CHAPTERS_SCHEMA);
      const rows = await d1.prepare(
        `SELECT chapter_id as id, payload_json FROM chapters WHERE book_id = ? ORDER BY updated_at ASC`
      ).bind(bookId).all<{ id: string; payload_json: string }>();

      const chapters = (rows.results || []).map((row) => {
        const payload = parsePayload(row);
        return payload ? { id: row.id, ...payload } : { id: row.id };
      });

      // Sort by order field after parsing
      chapters.sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));

      return NextResponse.json({ chapters });
    }

    const db = getFirebaseAdminFirestore();

    const snap = await db
      .collection('chapters')
      .where('bookId', '==', bookId)
      .orderBy('order', 'asc')
      .get();

    const chapters = snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    return NextResponse.json({ chapters });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message === 'Missing authorization' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { uid } = await verifyRequest(req);
    const body = await req.json();

    const { bookId, title, content, order } = body;
    if (!bookId || !title || typeof content !== 'string' || order === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: bookId, title, content, order' },
        { status: 400 }
      );
    }

    const sanitizedTitle = sanitize(title);
    const sanitizedContent = sanitize(content);

    const chapterId = crypto.randomUUID();
    const now = new Date().toISOString();

    const chapter = {
      id: chapterId,
      bookId,
      title: sanitizedTitle,
      content: sanitizedContent,
      order,
      audioUrl: null,
      duration: null,
      createdAt: now,
      updatedAt: now,
    };

    const d1 = await getD1Database();

    if (d1) {
      await ensureD1Schema(d1, CHAPTERS_SCHEMA);
      await ensureD1Schema(d1, BOOKS_SCHEMA);

      await d1.prepare(`
        INSERT INTO chapters (chapter_id, book_id, uid, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(chapterId, bookId, uid, JSON.stringify(chapter), now, now).run();

      // Update book chapter count via D1
      const bookRow = await d1.prepare(
        `SELECT payload_json FROM books WHERE book_id = ? LIMIT 1`
      ).bind(bookId).first<{ payload_json: string }>();

      if (bookRow) {
        const bookPayload = parsePayload(bookRow) || {};
        const newChapterCount = Number((bookPayload as any).chapterCount ?? 0) + 1;
        const updatedBook = { ...bookPayload, chapterCount: newChapterCount, updatedAt: now } as Record<string, unknown>;

        await d1.prepare(`
          UPDATE books SET payload_json = ?, updated_at = ? WHERE book_id = ?
        `).bind(JSON.stringify(updatedBook), now, bookId).run();
      }

      return NextResponse.json({ chapter }, { status: 201 });
    }

    const db = getFirebaseAdminFirestore();

    await db.collection('chapters').doc(chapterId).set(chapter);

    await db.collection('books').doc(bookId).update({
      chapterCount: (await db.collection('books').doc(bookId).get()).data()?.chapterCount + 1 || 1,
      updatedAt: now,
    });

    return NextResponse.json({ chapter }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message === 'Missing authorization' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
