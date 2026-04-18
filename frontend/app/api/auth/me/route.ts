import { NextResponse } from 'next/server';

import { getFirebaseAdminAuth } from '../../../../src/server/firebaseAdmin';

export const runtime = 'nodejs';
const SESSION_COOKIE_NAME = '__session';

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

const readCookieValue = (request: Request, cookieName: string): string => {
  const cookieHeader = String(request.headers.get('cookie') || '').trim();
  if (!cookieHeader) return '';
  for (const entry of cookieHeader.split(';')) {
    const [name, ...rawValue] = entry.split('=');
    if (String(name || '').trim() !== cookieName) continue;
    return decodeURIComponent(rawValue.join('=').trim());
  }
  return '';
};

const resolveDecodedToken = async (
  request: Request,
): Promise<{ uid: string } | null> => {
  const bearerToken = readBearerToken(request);
  const sessionCookie = readCookieValue(request, SESSION_COOKIE_NAME);
  if (!bearerToken && !sessionCookie) {
    return null;
  }

  const auth = getFirebaseAdminAuth();
  if (sessionCookie) {
    try {
      return await auth.verifySessionCookie(sessionCookie, true);
    } catch {
      // Fall back to bearer verification for callers that send an explicit token.
    }
  }

  if (bearerToken) {
    try {
      return await auth.verifyIdToken(bearerToken);
    } catch {
      return null;
    }
  }

  return null;
};

export const GET = async (request: Request): Promise<Response> => {
  try {
    const decoded = await resolveDecodedToken(request);
    if (!decoded) {
      return buildJsonResponse({ error: 'Unauthorized' }, 401);
    }

    const auth = getFirebaseAdminAuth();
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
