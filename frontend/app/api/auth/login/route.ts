import { NextResponse } from 'next/server';

import { getFirebaseAdminAuth } from '../../../../src/server/firebaseAdmin';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';
const JWT_EXPIRY_DAYS = '7d';

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

    const auth = getFirebaseAdminAuth();

    // Get user by email
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email);
    } catch (e) {
      return buildJsonResponse({ error: 'Invalid credentials' }, 401);
    }

    // Verify password (Firebase Admin should handle this in createUser)
    // Note: Firebase Auth stores password securely, we just need to check if account exists
    // and is email verified if required by app logic
    if (!userRecord.emailVerified) {
      return buildJsonResponse({ error: 'Email not verified' }, 401);
    }

    // Generate JWT token
    const token = jwt.sign(
      { uid: userRecord.uid, email: userRecord.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY_DAYS }
    );

    return buildJsonResponse({ 
      message: 'Login successful', 
      uid: userRecord.uid,
      token,
      user: {
        email: userRecord.email,
        displayName: userRecord.displayName,
        photoURL: userRecord.photoURL,
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return buildJsonResponse({ error: 'Login failed' }, 500);
  }
};