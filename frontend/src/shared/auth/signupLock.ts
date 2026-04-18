export const SIGNUP_DISABLED_CODE = 'signup_temporarily_disabled';
export const SIGNUP_DISABLED_API_MESSAGE =
  'Account creation is temporarily unavailable while V FLOW AI completes launch checks. Existing users can still sign in.';
export const SIGNUP_DISABLED_TITLE = 'Signup is temporarily paused';
export const SIGNUP_DISABLED_DETAIL =
  'We are finishing launch checks and keeping account creation closed for now. Existing users can still sign in normally.';
export const SIGNUP_DISABLED_MARKETING_HEADLINE =
  'New account creation is temporarily paused while we finish launch checks.';
export const SIGNUP_DISABLED_MARKETING_DETAIL =
  'If you already have access, sign in and continue in the studio. Public signup will open soon.';

export const isSignupTemporarilyDisabled = (): boolean => true;

export const isSignupMode = (value: unknown): boolean =>
  String(value || '').trim().toLowerCase() === 'signup';

export const normalizeLoginRouteMode = (value: unknown): 'login' | undefined => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'login' || normalized === 'signup') {
    return 'login';
  }
  return undefined;
};
