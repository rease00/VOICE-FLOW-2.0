import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';

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
    const userId = url.searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // Only allow users to view their own books unless they have admin privileges
    if (userId !== uid) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const snap = await db
      .collection('books')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const books = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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
    const db = getFirebaseAdminFirestore();
    const body = await req.json();

    const { title, description, coverImage } = body;
    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const sanitizedTitle = sanitize(title);
    const sanitizedDescription = description ? sanitize(description) : '';
    const sanitizedCoverImage = coverImage ? sanitize(coverImage) : '';

    const bookId = db.collection('books').doc().id;
    const timestamp = Timestamp.now();

    const book = {
      id: bookId,
      title: sanitizedTitle,
      description: sanitizedDescription,
      coverImage: sanitizedCoverImage,
      userId: uid,
      chapterCount: 0,
      createdAt: timestamp.toDate(),
      updatedAt: timestamp.toDate(),
    };

    await db.collection('books').doc(bookId).set(book);
    return NextResponse.json({ book }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message === 'Missing authorization' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
