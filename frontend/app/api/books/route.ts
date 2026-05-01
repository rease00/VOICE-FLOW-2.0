import { NextRequest, NextResponse } from 'next/server';
import { getD1Database, ensureD1Schema } from '../../../src/server/d1/util';
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

const SCHEMA = `
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
    const userId = url.searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    if (userId !== uid) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const d1 = await getD1Database();

    if (d1) {
      await ensureD1Schema(d1, SCHEMA);
      const rows = await d1.prepare(
        `SELECT book_id as id, payload_json FROM books WHERE uid = ? ORDER BY updated_at DESC`
      ).bind(userId).all<{ id: string; payload_json: string }>();

      const books = (rows.results || []).map((row) => {
        const payload = parsePayload(row);
        return payload ? { id: row.id, ...payload } : { id: row.id };
      });

      return NextResponse.json({ books });
    }

    const db = getFirebaseAdminFirestore();

    const snap = await db
      .collection('books')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const books = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ books });
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

    const { title, description, coverImage } = body;
    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const sanitizedTitle = sanitize(title);
    const sanitizedDescription = description ? sanitize(description) : '';
    const sanitizedCoverImage = coverImage ? sanitize(coverImage) : '';

    const bookId = crypto.randomUUID();
    const now = new Date().toISOString();

    const book = {
      id: bookId,
      title: sanitizedTitle,
      description: sanitizedDescription,
      coverImage: sanitizedCoverImage,
      userId: uid,
      chapterCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    const d1 = await getD1Database();

    if (d1) {
      await ensureD1Schema(d1, SCHEMA);
      await d1.prepare(`
        INSERT INTO books (book_id, uid, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(bookId, uid, JSON.stringify(book), now, now).run();

      return NextResponse.json({ book }, { status: 201 });
    }

    const db = getFirebaseAdminFirestore();
    await db.collection('books').doc(bookId).set(book);
    return NextResponse.json({ book }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message === 'Missing authorization' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
