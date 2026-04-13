import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authFetchMock } = vi.hoisted(() => ({
  authFetchMock: vi.fn(),
}));

vi.mock('../services/authHttpClient', () => ({
  authFetch: authFetchMock,
}));

import { ACCOUNT_DELETE_CONFIRM_PHRASE, deleteAccount } from '../services/accountService';

describe('account delete contract', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  it('uses the backend confirmation phrase and sends it in the request body', async () => {
    authFetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await deleteAccount();

    expect(ACCOUNT_DELETE_CONFIRM_PHRASE).toBe('DELETE_MY_ACCOUNT');
    expect(authFetchMock).toHaveBeenCalledTimes(1);
    expect(authFetchMock).toHaveBeenCalledWith(
      '/api/v1/account/delete',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmPhrase: 'DELETE_MY_ACCOUNT' }),
      }),
      { requireAuth: true }
    );
  });
});
