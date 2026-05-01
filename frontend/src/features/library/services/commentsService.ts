import {
  collection,
  addDoc,
  query,
  where,
  orderBy,
  getDocs,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { ChapterComment } from '../model/types';

const COMMENTS_COLLECTION = 'bookComments';

// Firebase may not be configured yet — graceful fallback
let firebaseDb: Firestore | null = null;

async function getDb(): Promise<Firestore | null> {
  if (firebaseDb) return firebaseDb;
  try {
    const { db } = await import('@/lib/firebase');
    firebaseDb = db;
    return firebaseDb;
  } catch {
    return null;
  }
}

export async function getChapterComments(bookId: string): Promise<ChapterComment[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const q = query(
      collection(db, COMMENTS_COLLECTION),
      where('bookId', '==', bookId),
      orderBy('createdAt', 'desc')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d: QueryDocumentSnapshot) => {
      const data = d.data();
      return {
        id: d.id,
        bookId: data.bookId,
        chapterIndex: data.chapterIndex,
        chapterTitle: data.chapterTitle ?? '',
        body: data.body,
        userId: data.userId ?? null,
        userLabel: data.userLabel ?? 'Anonymous',
        createdAt: data.createdAt instanceof Timestamp
          ? data.createdAt.toDate().toISOString()
          : new Date().toISOString(),
      } satisfies ChapterComment;
    });
  } catch {
    return [];
  }
}

export async function createChapterComment(
  bookId: string,
  chapterIndex: number,
  chapterTitle: string,
  body: string,
  userId: string | null,
  userLabel: string
): Promise<ChapterComment> {
  const db = await getDb();
  if (!db) {
    // Fallback: return a local-only comment
    return {
      id: crypto.randomUUID(),
      bookId,
      chapterIndex,
      chapterTitle,
      body,
      userId,
      userLabel,
      createdAt: new Date().toISOString(),
    };
  }
  const ref = await addDoc(collection(db, COMMENTS_COLLECTION), {
    bookId,
    chapterIndex,
    chapterTitle,
    body,
    userId,
    userLabel,
    createdAt: serverTimestamp(),
  });
  return {
    id: ref.id,
    bookId,
    chapterIndex,
    chapterTitle,
    body,
    userId,
    userLabel,
    createdAt: new Date().toISOString(),
  };
}

export async function deleteChapterComment(commentId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await deleteDoc(doc(db, COMMENTS_COLLECTION, commentId));
}
