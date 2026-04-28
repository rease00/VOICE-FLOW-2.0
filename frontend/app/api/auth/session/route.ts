import { NextResponse } from 'next/server';

import { getD1AuthService } from '../../../../src/server/auth/d1Auth';

export const runtime = 'nodejs';

const SESSION_COOKIE_NAME = '__session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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

const resolveRequestProtocol = (request: Request): string => {
  const forwardedProto = String(request.headers.get('x-forwarded-proto') || '').trim().toLowerCase();
  if (forwardedProto) {
    return forwardedProto.split(',')[0]?.trim() || '';
  }
  try {
    return new URL(request.url).protocol.replace(':', '').trim().toLowerCase();
  } catch {
    return '';
  }
};

const resolveRequestHostname = (request: Request): string => {
  const forwardedHost = String(request.headers.get('x-forwarded-host') || '').trim();
  const rawHost = (forwardedHost.split(',')[0] || '').trim();
  if (rawHost) {
    return rawHost.replace(/:\d+$/, '').trim().toLowerCase();
  }
  try {
    return new URL(request.url).hostname.trim().toLowerCase();
  } catch {
    return '';
  }
};

const isLoopbackHostname = (hostname: string): boolean => {
  const safeHostname = String(hostname || '').trim().toLowerCase();
  return safeHostname === 'localhost' || safeHostname === '127.0.0.1' || safeHostname === '::1';
};

const shouldUseSecureSessionCookie = (request: Request): boolean => {
  if (process.env.NODE_ENV !== 'production') return false;
  const protocol = resolveRequestProtocol(request);
  if (protocol === 'https') return true;
  return !isLoopbackHostname(resolveRequestHostname(request));
};

export const POST = async (request: Request): Promise<Response> => {
  const idToken = readBearerToken(request);
  if (!idToken) {
    return buildJsonResponse({ ok: false }, 401);
  }

  const auth = getD1AuthService();
  const context = await auth.resolveSessionToken(idToken);
  if (!context) {
    return buildJsonResponse({ ok: false }, 401);
  }

  const response = buildJsonResponse({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, idToken, {
    httpOnly: true,
    secure: shouldUseSecureSessionCookie(request),
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(SESSION_MAX_AGE_MS / 1000),
  });
  return response;
};

export const DELETE = async (request: Request): Promise<Response> => {
  const auth = getD1AuthService();
  const idToken = readBearerToken(request) || readCookieValue(request, SESSION_COOKIE_NAME);
  if (idToken) {
    await auth.revokeSessionToken(idToken).catch(() => undefined);
  }

  const response = buildJsonResponse({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: shouldUseSecureSessionCookie(request),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  });
  return response;
};
