import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { POST } from '../app/api/creator/upload/route';

let previousFlag: string | undefined;
let previousNodeEnv: string | undefined;

describe('creator upload route', () => {
  beforeEach(() => {
    previousFlag = process.env.VF_ENABLE_CREATOR_UPLOAD_ROUTE;
    previousNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (previousFlag === undefined) delete process.env.VF_ENABLE_CREATOR_UPLOAD_ROUTE;
    else process.env.VF_ENABLE_CREATOR_UPLOAD_ROUTE = previousFlag;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });

  it('is disabled by default', async () => {
    delete process.env.VF_ENABLE_CREATOR_UPLOAD_ROUTE;
    delete process.env.NODE_ENV;

    const response = await POST(new Request('https://v-flow-ai.local/api/creator/upload', { method: 'POST' }) as never);

    expect(response.status).toBe(404);
  });

  it('stays disabled in production even when explicitly flagged', async () => {
    process.env.VF_ENABLE_CREATOR_UPLOAD_ROUTE = '1';
    process.env.NODE_ENV = 'production';

    const response = await POST(new Request('https://v-flow-ai.local/api/creator/upload', { method: 'POST' }) as never);

    expect(response.status).toBe(404);
  });
});
