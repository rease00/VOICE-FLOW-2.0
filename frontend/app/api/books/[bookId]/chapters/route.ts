import { NextRequest, NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  try {
    const { uid } = await verifyRequest(req);
    const { bookId } = await params;
    const db = getFirestore(getAdminApp());

    const snap = await db
      .collection('publishedChapters')
      .where('bookId', '==', bookId)
      .orderBy('index')
      .get();

    const chapters = await Promise.all(
      snap.docs.map(async (doc) => {
        const data = doc.data();
        const unlockSnap = await db
          .collection('chapterUnlocks')
          .where('userId', '==', uid)
          .where('chapterId', '==', doc.id)
          .limit(1)
          .get();
        return {
          id: doc.id,
          ...data,
          unlocked: !unlockSnap.empty,
        };
      })
    );

    return NextResponse.json({ chapters });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  try {
    const { uid } = await verifyRequest(req);
    const { bookId } = await params;
    const db = getFirestore(getAdminApp());
    const body = await req.json();

    const chapterId = sanitize(body.chapterId || '');
    if (!chapterId) {
      return NextResponse.json({ error: 'chapterId is required' }, { status: 400 });
    }

    // Read chapter and verify it belongs to this book
    const chapterDoc = await db.collection('publishedChapters').doc(chapterId).get();
    if (!chapterDoc.exists) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
    }

    const chapter = chapterDoc.data()!;
    if (chapter.bookId !== bookId) {
      return NextResponse.json({ error: 'Chapter does not belong to this book' }, { status: 400 });
    }

    // Free chapter — no cost
    if (chapter.isFree) {
      return NextResponse.json({ unlocked: true, cost: 0 });
    }

    // Check if already unlocked
    const existingUnlock = await db
      .collection('chapterUnlocks')
      .where('userId', '==', uid)
      .where('chapterId', '==', chapterId)
      .limit(1)
      .get();

    if (!existingUnlock.empty) {
      return NextResponse.json({ unlocked: true, cost: 0, existing: true });
    }

    // Check user wallet
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const userData = userDoc.data()!;
    const vffBalance = userData.wallet?.vffBalance ?? 0;
    const monthlyFreeRemaining = userData.monthlyFreeRemaining ?? 0;
    const price = chapter.price ?? 0;

    if (monthlyFreeRemaining <= 0 && vffBalance < price) {
      return NextResponse.json({ error: 'Insufficient VN balance' }, { status: 402 });
    }

    // Deduct price from wallet
    const userRef = db.collection('users').doc(uid);
    if (monthlyFreeRemaining > 0) {
      await userRef.update({
        monthlyFreeRemaining: FieldValue.increment(-1),
      });
    } else {
      await userRef.update({
        'wallet.vffBalance': FieldValue.increment(-price),
      });
    }

    // Create unlock record
    await db.collection('chapterUnlocks').add({
      userId: uid,
      bookId,
      chapterId,
      vnSpent: price,
      unlockedAt: new Date().toISOString(),
    });

    // Increment book download count
    await db.collection('publishedBooks').doc(bookId).update({
      downloadCount: FieldValue.increment(1),
    });

    return NextResponse.json({ unlocked: true, cost: price });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message === 'Missing authorization' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
