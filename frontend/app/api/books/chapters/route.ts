import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

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

export async function GET(req: NextRequest) {
  try {
    const { uid } = await verifyRequest(req);
    const db = getFirebaseAdminFirestore();
    const url = new URL(req.url);
    const bookId = url.searchParams.get('bookId');

    if (!bookId) {
      return NextResponse.json({ error: 'bookId is required' }, { status: 400 });
    }

    const snap = await db
      .collection('chapters')
      .where('bookId', '==', bookId)
      .orderBy('order', 'asc')
      .get();

    const chapters = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
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
    const db = getFirebaseAdminFirestore();
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

    const chapterId = db.collection('chapters').doc().id;
    const timestamp = Timestamp.now();

    const chapter = {
      id: chapterId,
      bookId,
      title: sanitizedTitle,
      content: sanitizedContent,
      order,
      audioUrl: null,
      duration: null,
      createdAt: timestamp.toDate(),
      updatedAt: timestamp.toDate(),
    };

    await db.collection('chapters').doc(chapterId).set(chapter);

    // Update book chapter count
    await db.collection('books').doc(bookId).update({
      chapterCount: FieldValue.increment(1),
      updatedAt: timestamp,
    });

    return NextResponse.json({ chapter }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message === 'Missing authorization' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
