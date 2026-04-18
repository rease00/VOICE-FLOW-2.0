import { readEnvCsv, readEnvValue } from '../runtime/env';

const ADMIN_PROVISIONING_HINT =
  'This admin account has not been seeded in Firebase yet. If this is a fresh local environment, run the Firebase admin seed step before retrying.';

const normalizeEmail = (value: unknown): string => String(value || '').trim().toLowerCase();

const readAdminLoginEmails = (): Set<string> => {
  const values = new Set<string>();
  const configuredLoginEmail = readEnvValue(process.env.NEXT_PUBLIC_ADMIN_LOGIN_EMAIL);
  if (configuredLoginEmail) {
    values.add(normalizeEmail(configuredLoginEmail));
  }

  for (const email of readEnvCsv(process.env.NEXT_PUBLIC_ADMIN_EMAIL_ALLOWLIST)) {
    values.add(normalizeEmail(email));
  }

  return values;
};

export const isAdminLoginEmail = (email: string): boolean => {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return false;
  return readAdminLoginEmails().has(normalizedEmail);
};

export const resolveAdminProvisioningHint = (email: string, errorCode?: string): string | null => {
  const normalizedCode = String(errorCode || '').trim().toLowerCase();
  if (normalizedCode !== 'auth/user-not-found') return null;
  return isAdminLoginEmail(email) ? ADMIN_PROVISIONING_HINT : null;
};
