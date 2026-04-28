import { NextResponse } from 'next/server';

import { D1AuthError, getD1AuthService } from '../../../../src/server/auth/d1Auth';

export const runtime = 'nodejs';

const buildJsonResponse = (body: Record<string, unknown>, status: number = 200): NextResponse =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });

const validateLogin = (body: Record<string, string>): { error: string | null } => {
  const { email, password } = body;
  if (!email || !password) {
    return { error: 'Email and password are required' };
  }
  return { error: null };
};
export const POST = async (request: Request): Promise<Response> => {
  try {
    const { email, password } = await request.json();
    const validation = validateLogin({ email, password });
    if (validation.error) {
      return buildJsonResponse({ error: validation.error }, 400);
    }

    const auth = getD1AuthService();
    await auth.ensureAdminSeeds();
    const result = await auth.loginWithEmailAndPassword(String(email).trim(), String(password));

    return buildJsonResponse({
      message: 'Login successful',
      uid: result.uid,
      token: result.token,
      user: {
        email: result.user.email,
        displayName: result.user.displayName,
        photoURL: result.user.photoURL,
      },
    });
  } catch (error) {
    if (error instanceof D1AuthError || (error && typeof error === 'object' && 'code' in error)) {
      const code = String((error as { code?: unknown }).code || '').trim();
      const message = String((error as { message?: unknown }).message || 'Invalid credentials').trim() || 'Invalid credentials';
      const status = error instanceof D1AuthError ? error.status : 401;
      return buildJsonResponse({
        error: message,
        code,
      }, status);
    }

    console.error('Login error:', error);
    return buildJsonResponse({ error: 'Login failed' }, 500);
  }
};
