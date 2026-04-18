import { describe, expect, it } from 'vitest';

describe('/api/auth/register', () => {
  it('rejects public signup with the launch lock contract', async () => {
    const { POST } = await import('../app/api/auth/register/route');
    const response = await POST();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'signup_temporarily_disabled',
      error: 'Account creation is temporarily unavailable while V FLOW AI completes launch checks. Existing users can still sign in.',
    });
  });
});
