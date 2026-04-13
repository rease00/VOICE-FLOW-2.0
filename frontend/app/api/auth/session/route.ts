import { NextResponse } from 'next/server';

import { getFirebaseAdminAuth } from '../../../../src/server/firebaseAdmin';

export const runtime = 'nodejs';

const SESSION_COOKIE_NAME = '__session';
const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

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

export const POST = async (request: Request): Promise<Response> => {
  const idToken = readBearerToken(request);
  if (!idToken) {
    return buildJsonResponse({ ok: false }, 401);
  }

  try {
    const auth = getFirebaseAdminAuth();
    await auth.verifyIdToken(idToken);
    const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn: SESSION_MAX_AGE_MS });

    const response = buildJsonResponse({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(SESSION_MAX_AGE_MS / 1000),
    });
    return response;
  } catch {
    return buildJsonResponse({ ok: false }, 401);
  }
};

export const DELETE = async (): Promise<Response> => {
  const response = buildJsonResponse({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  });
  return response;
};
