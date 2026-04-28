import { NextResponse } from 'next/server';

import { getD1AuthService } from '../../../../src/server/auth/d1Auth';

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

export const GET = async (request: Request): Promise<Response> => {
  try {
    const auth = getD1AuthService();
    const cookieToken = readCookieValue(request, SESSION_COOKIE_NAME);
    const bearerToken = readBearerToken(request);

    const context = cookieToken
      ? await auth.resolveSessionToken(cookieToken)
      : null;
    const resolvedContext = context || (bearerToken ? await auth.resolveSessionToken(bearerToken) : null);

    if (!resolvedContext) {
      return buildJsonResponse({ error: 'Unauthorized' }, 401);
    }

    if (!resolvedContext.userExists) {
      return buildJsonResponse({ error: 'User not found' }, 404);
    }

    return buildJsonResponse({
      uid: resolvedContext.uid,
      email: String((resolvedContext.userData as Record<string, unknown> | null)?.email || resolvedContext.decodedToken.email || ''),
      displayName: (resolvedContext.userData as Record<string, unknown> | null)?.displayName
        || (resolvedContext.userData as Record<string, unknown> | null)?.name
        || resolvedContext.decodedToken.name
        || null,
      photoURL: (resolvedContext.userData as Record<string, unknown> | null)?.photoURL
        || (resolvedContext.userData as Record<string, unknown> | null)?.photoUrl
        || resolvedContext.decodedToken.picture
        || null,
      emailVerified: Boolean((resolvedContext.userData as Record<string, unknown> | null)?.emailVerified ?? resolvedContext.decodedToken.email_verified),
    });
  } catch (error) {
    console.error('Get user error:', error);
    return buildJsonResponse({ error: 'Failed to get user' }, 500);
  }
};
