import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getFirebaseAdminFirestore } from '../firebaseAdmin.ts';

export const VOICE_REGISTRY = Object.freeze({
  Narrator: 'Charon',
  Hero: 'Kore',
  Villain: 'Fenrir',
  Heroine: 'Aoede',
  Elder: 'Orus',
  Child: 'Zephyr',
  Mentor: 'Achird',
  Comic: 'Puck',
  Soldier: 'Rasalgethi',
  Sage: 'Algenib',
  Default: 'Charon',
} as const);

const castCache = new Map<string, Record<string, string>>();

const getDb = () => {
  try {
    return getFirebaseAdminFirestore();
  } catch {
    return null;
  }
};

export const resolveVoiceSync = (speaker: string): string => {
  const safeSpeaker = String(speaker || '').trim();
  return VOICE_REGISTRY[safeSpeaker as keyof typeof VOICE_REGISTRY] || VOICE_REGISTRY.Default;
};

export const resolveVoice = async (speaker: string, bookId?: string): Promise<string> => {
  const safeSpeaker = String(speaker || '').trim();
  if (!bookId) {
    return resolveVoiceSync(safeSpeaker);
  }

  if (!castCache.has(bookId)) {
    const db = getDb();
    if (!db) {
      castCache.set(bookId, {});
    } else {
      const snapshot = await db.collection('publishedBooks').doc(bookId).collection('cast').get();
      const cast: Record<string, string> = {};
      snapshot.forEach((doc: QueryDocumentSnapshot) => {
        cast[doc.id] = String(doc.data()?.voiceName || '').trim();
      });
      castCache.set(bookId, cast);
      globalThis.setTimeout(() => castCache.delete(bookId), 300_000);
    }
  }

  const cast = castCache.get(bookId) || {};
  return cast[safeSpeaker] || resolveVoiceSync(safeSpeaker);
};
