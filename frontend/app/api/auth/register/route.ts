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

const validateRegistration = (body: Record<string, string>): { error: string | null } => {
  const { email, password, displayName } = body;
  if (!email || !password || !displayName) {
    return { error: 'Email, password, and displayName are required' };
  }
  if (password.length < 6) {
    return { error: 'Password must be at least 6 characters' };
  }
  return { error: null };
};

export const POST = async (request: Request): Promise<Response> => {
  try {
    const { email, password, displayName } = await request.json();
    const validation = validateRegistration({ email, password, displayName });
    if (validation.error) {
      return buildJsonResponse({ error: validation.error }, 400);
    }

    const auth = getFirebaseAdminAuth();
    // Check if user exists
    try {
      await auth.getUserByEmail(email);
      return buildJsonResponse({ error: 'User already exists' }, 400);
    } catch (e) {
      // User doesn't exist, continue with creation
    }

    // Create user
    const userRecord = await auth.createUser({
      email,
      emailVerified: false,
      displayName,
      password,
    });

    // Generate JWT token
    const token = jwt.sign(
      { uid: userRecord.uid, email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY_DAYS }
    );

    return buildJsonResponse({ 
      message: 'User created successfully', 
      uid: userRecord.uid,
      token 
    });
  } catch (error) {
    console.error('Registration error:', error);
    return buildJsonResponse({ error: 'Registration failed' }, 500);
  }
};