import { NextResponse } from 'next/server';

import { getFirebaseAdminAuth } from '../../../../src/server/firebaseAdmin';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';

const buildJsonResponse = (body: Record<string, unknown>, status: number = 200): NextResponse =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });

const readBearerToken = (request: Request): string => {
  const authHeader = String(request.headers.get('authorization') || '').trim();
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return '';
  }
  return authHeader.slice(7).trim();
};

export const GET = async (request: Request): Promise<Response> => {
  try {
    const token = readBearerToken(request);
    if (!token) {
      return buildJsonResponse({ error: 'Unauthorized' }, 401);
    }

    const auth = getFirebaseAdminAuth();

    // Verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as { uid: string; email: string };
    } catch {
      return buildJsonResponse({ error: 'Invalid token' }, 401);
    }

    // Get user by UID
    const userRecord = await auth.getUser(decoded.uid);
    if (!userRecord) {
      return buildJsonResponse({ error: 'User not found' }, 404);
    }

    return buildJsonResponse({
      uid: userRecord.uid,
      email: userRecord.email,
      displayName: userRecord.displayName,
      photoURL: userRecord.photoURL,
      emailVerified: userRecord.emailVerified,
    });
  } catch (error) {
    console.error('Get user error:', error);
    return buildJsonResponse({ error: 'Failed to get user' }, 500);
  }
};