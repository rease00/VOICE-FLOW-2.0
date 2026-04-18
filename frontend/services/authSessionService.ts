const AUTH_SESSION_ROUTE = '/api/auth/session';

const assertOk = async (response: Response): Promise<void> => {
  if (response.ok) return;
  throw new Error(`Auth session sync failed with status ${response.status}`);
};

export const syncFirebaseSession = async (idToken: string): Promise<void> => {
  const response = await fetch(AUTH_SESSION_ROUTE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
    credentials: 'same-origin',
    cache: 'no-store',
  });
  await assertOk(response);
};

export const clearFirebaseSession = async (): Promise<void> => {
  const response = await fetch(AUTH_SESSION_ROUTE, {
    method: 'DELETE',
    credentials: 'same-origin',
    cache: 'no-store',
  });
  await assertOk(response);
};
