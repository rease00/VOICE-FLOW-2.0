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

export async function POST(req: NextRequest) {
  try {
    await verifyRequest(req);
    const db = getFirebaseAdminFirestore();
    const body = await req.json();

    const chapterId = String(body.chapterId || '').trim();
    const voiceId = String(body.voiceId || '').trim();

    if (!chapterId || !voiceId) {
      return NextResponse.json(
        { error: 'Missing required fields: chapterId, voiceId' },
        { status: 400 }
      );
    }

    // In a real implementation, this would call the TTS service
    // For now, we'll create a placeholder audio URL
    
    const audioUrl = `https://storage.googleapis.com/your-bucket/chapters/${chapterId}.mp3`;
    const duration = 0; // This would be calculated by TTS service

    // Update chapter with audio info
    await db.collection('chapters').doc(chapterId).update({
      audioUrl,
      duration,
      updatedAt: Timestamp.now(),
    });

    return NextResponse.json({ audioUrl, duration });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status = message === 'Missing authorization' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
