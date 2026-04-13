import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdminAuth, getFirebaseAdminFirestore } from '../../../../../src/server/firebaseAdmin';

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

export async function POST(
  req: NextRequest,
  context: RouteContext<'/api/books/[bookId]/publish'>
) {
  try {
    const { uid } = await verifyRequest(req);
    const { bookId } = await context.params;
    const db = getFirebaseAdminFirestore();

    // Read book and verify ownership
    const bookRef = db.collection('publishedBooks').doc(bookId);
    const bookDoc = await bookRef.get();
    if (!bookDoc.exists) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const bookData = bookDoc.data()!;
    if (bookData.authorId !== uid) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    if (bookData.status === 'published') {
      return NextResponse.json({ error: 'Already published' }, { status: 400 });
    }

    // Check KYC
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();
    if (userData?.kycStatus !== 'verified') {
      return NextResponse.json({ error: 'KYC verification required' }, { status: 403 });
    }

    // Check agreement
    if (!userData?.agreementSigned) {
      return NextResponse.json({ error: 'Publisher agreement required' }, { status: 403 });
    }

    // Check character count
    const chaptersSnap = await db
      .collection('publishedChapters')
      .where('bookId', '==', bookId)
      .get();

    let totalChars = 0;
    chaptersSnap.docs.forEach((doc) => {
      totalChars += doc.data().characterCount ?? 0;
    });

    if (totalChars < 30000) {
      return NextResponse.json(
        { error: 'Minimum 30,000 characters required', current: totalChars },
        { status: 400 }
      );
    }

    // Publish
    const now = new Date().toISOString();
    await bookRef.update({
      status: 'published',
      publishedAt: now,
      updatedAt: now,
    });

    const updatedDoc = await bookRef.get();
    const updatedData = updatedDoc.data();
    if (!updatedData) {
      return NextResponse.json({ error: 'Failed to retrieve published book' }, { status: 500 });
    }
    return NextResponse.json({
      published: true,
      book: { id: updatedDoc.id, ...updatedData },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message === 'Missing authorization' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(
  req: NextRequest,
  context: RouteContext<'/api/books/[bookId]/publish'>
) {
  try {
    const { uid } = await verifyRequest(req);
    const { bookId } = await context.params;
    const db = getFirebaseAdminFirestore();

    // Verify book ownership
    const bookRef = db.collection('publishedBooks').doc(bookId);
    const bookDoc = await bookRef.get();
    if (!bookDoc.exists) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const bookData = bookDoc.data()!;
    if (bookData.authorId !== uid) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const body = await req.json();
    const incomingChapters: Array<{
      title: string;
      index: number;
      driveFileId: string;
      characterCount: number;
      price: number;
      isFree: boolean;
    }> = (body.chapters ?? []).slice(0, 200);

    // Validate each chapter
    for (const ch of incomingChapters) {
      if (!ch.title || typeof ch.index !== 'number' || ch.index < 0) {
        return NextResponse.json({ error: 'Invalid chapter: title and positive index required' }, { status: 400 });
      }
      if (typeof ch.characterCount !== 'number' || ch.characterCount < 0) {
        return NextResponse.json({ error: 'Invalid chapter: characterCount must be >= 0' }, { status: 400 });
      }
      if (typeof ch.price !== 'number' || ch.price < 0) {
        return NextResponse.json({ error: 'Invalid chapter: price must be >= 0' }, { status: 400 });
      }
    }

    const upsertedChapters: Array<Record<string, unknown>> = [];
    let totalCharacters = 0;

    for (const ch of incomingChapters) {
      const sanitizedTitle = sanitize(ch.title);

      // Check if chapter already exists for this book + index
      const existingSnap = await db
        .collection('publishedChapters')
        .where('bookId', '==', bookId)
        .where('index', '==', ch.index)
        .limit(1)
        .get();

      const chapterData = {
        bookId,
        title: sanitizedTitle,
        index: ch.index,
        driveFileId: ch.driveFileId || '',
        characterCount: ch.characterCount,
        price: ch.price,
        isFree: !!ch.isFree,
        updatedAt: new Date().toISOString(),
      };

      if (!existingSnap.empty) {
        // Update existing
        const existingDoc = existingSnap.docs[0]!;
        await existingDoc.ref.update(chapterData);
        upsertedChapters.push({ id: existingDoc.id, ...chapterData });
      } else {
        // Create new
        const newRef = db.collection('publishedChapters').doc();
        const newData = { ...chapterData, id: newRef.id, createdAt: new Date().toISOString() };
        await newRef.set(newData);
        upsertedChapters.push(newData);
      }

      totalCharacters += ch.characterCount;
    }

    // Update book with chapter count and total characters
    const chapterCount = upsertedChapters.length;
    await bookRef.update({
      chapterCount,
      totalCharacters,
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      chapters: upsertedChapters,
      bookUpdate: { chapterCount, totalCharacters },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message === 'Missing authorization' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
