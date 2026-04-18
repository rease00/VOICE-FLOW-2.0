import { NextResponse } from 'next/server';

import { SIGNUP_DISABLED_API_MESSAGE, SIGNUP_DISABLED_CODE } from '../../../../src/shared/auth/signupLock';

export const runtime = 'nodejs';

export const POST = async (): Promise<Response> =>
  NextResponse.json(
    {
      error: SIGNUP_DISABLED_API_MESSAGE,
      code: SIGNUP_DISABLED_CODE,
    },
    {
      status: 403,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
