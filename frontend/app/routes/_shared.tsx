import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useLoaderData } from 'react-router';
import { backendFetch, type BackendEnv } from '../lib/backend';

export const AUTH_SESSION_ENDPOINTS = ['/api/auth/session', '/auth/session'] as const;
export const BILLING_SUMMARY_ENDPOINTS = ['/api/v1/billing/account-summary'] as const;
export const ACCOUNT_PROFILE_ENDPOINTS = ['/api/v1/account/profile'] as const;
export const BILLING_PORTAL_SESSION_ENDPOINTS = ['/api/v1/billing/portal-session'] as const;
export const BILLING_SUBSCRIPTION_CANCEL_ENDPOINTS = ['/api/v1/billing/subscription/cancel'] as const;
export const BILLING_SUBSCRIPTION_RESUME_ENDPOINTS = ['/api/v1/billing/subscription/resume'] as const;
export const STUDIO_NEXT_ROUTE = '/app/studio';

export type AuthSessionUser = {
  id?: string | null;
  userId?: string | null;
  email?: string | null;
  displayName?: string | null;
  name?: string | null;
};

export type AuthSessionPayload = {
  ok?: boolean;
  user?: AuthSessionUser | null;
  session?: Record<string, unknown> | null;
  roles?: string[] | null;
};

export type BillingSummaryPayload = {
  summary?: {
    account?: {
      email?: string | null;
      displayName?: string | null;
      country?: string | null;
    } | null;
    billingProfile?: {
      email?: string | null;
      companyName?: string | null;
      contactName?: string | null;
      country?: string | null;
    } | null;
    subscription?: {
      status?: string | null;
      planName?: string | null;
      planId?: string | null;
      provider?: string | null;
      renewsAt?: string | number | null;
      cancelAtPeriodEnd?: boolean | null;
    } | null;
    wallet?: {
      vfBalance?: number | null;
      vcFreeBalance?: number | null;
      vcGrantedBalance?: number | null;
      vcPaidBalance?: number | null;
      vcSpendableBalance?: number | null;
      monthlyFreeRemaining?: number | null;
      monthlyFreeLimit?: number | null;
    } | null;
    portal?: {
      enabled?: boolean | null;
      url?: string | null;
    } | null;
    support?: {
      email?: string | null;
      topic?: string | null;
    } | null;
  } | null;
};

export type AccountProfilePayload = {
  profile?: {
    userId?: string | null;
    displayName?: string | null;
    fullName?: string | null;
    username?: string | null;
    email?: string | null;
    avatarUrl?: string | null;
    bio?: string | null;
    timezone?: string | null;
    locale?: string | null;
    billingProfile?: {
      companyName?: string | null;
      contactName?: string | null;
      email?: string | null;
      phone?: string | null;
      line1?: string | null;
      line2?: string | null;
      city?: string | null;
      state?: string | null;
      postalCode?: string | null;
      country?: string | null;
      taxId?: string | null;
      notes?: string | null;
    } | null;
    settings?: {
      theme?: string | null;
      motionLevel?: string | null;
      notifications?: Record<string, unknown> | null;
    } | null;
    roles?: string[] | null;
    support?: {
      email?: string | null;
      topic?: string | null;
    } | null;
  } | null;
  requiredUserId?: boolean | null;
  suggestedUserId?: string | null;
};

export type RouteJsonResult<T> = {
  ok: boolean;
  status: number;
  endpoint: string | null;
  data: T | null;
  error: string | null;
};

async function readJsonBody<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function readErrorMessage(data: unknown, fallback: string) {
  if (data && typeof data === 'object') {
    const error = (data as { error?: unknown }).error;
    if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) {
        return message.trim();
      }
    }
    if (typeof error === 'string' && error.trim()) {
      return error.trim();
    }
    const message = (data as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
  }

  return fallback;
}

export async function fetchFirstJson<T>(
  request: Request,
  candidates: readonly string[],
  init?: RequestInit,
  backendEnv?: BackendEnv
): Promise<RouteJsonResult<T>> {
  const cookie = request.headers.get('cookie');
  let lastError: string | null = null;

  for (const candidate of candidates) {
    const headers = new Headers(init?.headers);

    headers.set('accept', 'application/json');
    if (cookie) {
      headers.set('cookie', cookie);
    }

    try {
      const response = backendEnv
        ? await backendFetch(candidate, {
            ...init,
            env: backendEnv,
            request,
            headers,
          })
        : await fetch(new URL(candidate, request.url), {
            ...init,
            cache: 'no-store',
            credentials: 'include',
            headers,
          });
      const data = await readJsonBody<T>(response);

      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          endpoint: candidate,
          data,
          error: null,
        };
      }

      lastError = readErrorMessage(data, response.statusText || 'Request failed');
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Request failed';
    }
  }

  return {
    ok: false,
    status: 0,
    endpoint: null,
    data: null,
    error: lastError,
  };
}

export async function loadAuthSession(request: Request, backendEnv?: BackendEnv) {
  return fetchFirstJson<AuthSessionPayload>(request, AUTH_SESSION_ENDPOINTS, undefined, backendEnv);
}

export async function loadBillingSummary(request: Request, backendEnv?: BackendEnv) {
  return fetchFirstJson<BillingSummaryPayload>(request, BILLING_SUMMARY_ENDPOINTS, undefined, backendEnv);
}

export async function loadAccountProfile(request: Request, backendEnv?: BackendEnv) {
  return fetchFirstJson<AccountProfilePayload>(request, ACCOUNT_PROFILE_ENDPOINTS, undefined, backendEnv);
}

export async function postFirstJson<T>(
  request: Request,
  candidates: readonly string[],
  body: unknown,
  backendEnv?: BackendEnv
): Promise<RouteJsonResult<T>> {
  const cookie = request.headers.get('cookie');
  let lastError: string | null = null;

  for (const candidate of candidates) {
    const headers = new Headers();
    headers.set('accept', 'application/json');
    headers.set('content-type', 'application/json');
    if (cookie) {
      headers.set('cookie', cookie);
    }

    try {
      const response = backendEnv
        ? await backendFetch(candidate, {
            env: backendEnv,
            request,
            method: 'POST',
            headers,
            json: body,
          })
        : await fetch(new URL(candidate, request.url), {
            method: 'POST',
            cache: 'no-store',
            credentials: 'include',
            headers,
            body: JSON.stringify(body),
          });
      const data = await readJsonBody<T>(response);

      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          endpoint: candidate,
          data,
          error: null,
        };
      }

      lastError = readErrorMessage(data, response.statusText || 'Request failed');
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Request failed';
    }
  }

  return {
    ok: false,
    status: 0,
    endpoint: null,
    data: null,
    error: lastError,
  };
}

export function sanitizeLoginNext(next: string | null | undefined): string {
  const value = String(next || '').trim();
  if (!value || value.startsWith('//') || value.includes('://') || !value.startsWith('/')) {
    return STUDIO_NEXT_ROUTE;
  }

  if (!value.startsWith('/app/')) {
    return STUDIO_NEXT_ROUTE;
  }

  return value;
}

export function loginHref(next: string | null | undefined = STUDIO_NEXT_ROUTE): string {
  return `/app/login?mode=login&next=${encodeURIComponent(sanitizeLoginNext(next))}`;
}

export function ShellRoot({
  ariaLabel,
  children,
}: {
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <div
      className="vf-app-layout relative isolate min-h-dvh overflow-hidden bg-[color:var(--vf-bg)] text-[color:var(--vf-text)]"
      data-vf-app-shell="true"
      data-vf-visual-ready="false"
      data-vf-brand-theme="aurora"
      data-vf-theme-mode="dark"
      data-vf-resolved-theme="dark"
    >
      <div className="vf-live-wallpaper" aria-hidden="true" />
      <div className="relative z-[1]">
        <main className="ap-shell overflow-hidden" aria-label={ariaLabel}>
          <div className="ap-grid" aria-hidden="true" />
          <div className="ap-aurora ap-aurora--a" aria-hidden="true" />
          <div className="ap-aurora ap-aurora--b" aria-hidden="true" />
          <div className="ap-aurora ap-aurora--c" aria-hidden="true" />
          {children}
        </main>
      </div>
      <div
        className="vf-screen-reader-only"
        role="status"
        tabIndex={-1}
        aria-live="polite"
        aria-relevant="additions text"
        aria-atomic="false"
      />
    </div>
  );
}

export function AppHandoffView() {
  return (
    <ShellRoot ariaLabel="Opening Studio">
      <div className="relative z-10 flex min-h-[100dvh] items-start justify-center px-4 py-8 sm:items-center">
        <div className="ap-card w-full max-w-lg p-6 sm:p-8">
          <span className="ap-eyebrow">
            <span className="ap-live-dot" style={{ height: 6, width: 6 }} />
            Workspace handoff
          </span>
          <div className="mt-6 flex flex-col items-start justify-between gap-4 sm:flex-row">
            <div className="min-w-0 flex-1">
              <BrandMark />
              <h1 className="mt-4 text-2xl font-black tracking-tight text-white sm:text-3xl">Opening Studio</h1>
              <p className="mt-2 text-sm leading-7 text-slate-400">
                We&apos;re checking your session and sending you to the right starting point.
              </p>
            </div>
            <div className="ap-wave-loader self-start pt-1 sm:shrink-0" aria-hidden="true">
              <span className="ap-wave-bar" style={{ height: '55.00000000000001%', animationDelay: '0ms' }} />
              <span className="ap-wave-bar" style={{ height: '82%', animationDelay: '120ms' }} />
              <span className="ap-wave-bar" style={{ height: '48%', animationDelay: '240ms' }} />
              <span className="ap-wave-bar" style={{ height: '90%', animationDelay: '360ms' }} />
              <span className="ap-wave-bar" style={{ height: '65%', animationDelay: '480ms' }} />
              <span className="ap-wave-bar" style={{ height: '78%', animationDelay: '600ms' }} />
              <span className="ap-wave-bar" style={{ height: '52%', animationDelay: '720ms' }} />
              <span className="ap-wave-bar" style={{ height: '88%', animationDelay: '840ms' }} />
            </div>
          </div>
          <div className="ap-progress-track mt-6">
            <div className="ap-progress-bar" />
          </div>
          <div className="ap-status-grid mt-5">
            <div className="ap-status-item">
              <p className="ap-status-item__label">Studio</p>
              <p className="ap-status-item__value">Ready</p>
            </div>
            <div className="ap-status-item">
              <p className="ap-status-item__label">Voices</p>
              <p className="ap-status-item__value">Synced</p>
            </div>
            <div className="ap-status-item">
              <p className="ap-status-item__label">History</p>
              <p className="ap-status-item__value">Waiting</p>
            </div>
          </div>
          <div className="mt-4 flex flex-col items-start justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-2.5 text-xs text-slate-400 sm:flex-row sm:items-center">
            <span className="min-w-0 break-words">Checking session and route</span>
            <span className="flex shrink-0 items-center gap-1 text-cyan-300">
              Keep this tab open
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="lucide lucide-arrow-right"
                aria-hidden="true"
              >
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </span>
          </div>
        </div>
      </div>
    </ShellRoot>
  );
}

export function CommandPaletteButton() {
  return (
    <button
      aria-label="Open command palette (Ctrl+K)"
      className="fixed right-4 top-3 z-[9985] hidden items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-[var(--vf-color-text-muted)] backdrop-blur-sm transition-all hover:border-white/20 hover:text-[var(--vf-color-text-primary)] lg:flex"
      type="button"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="lucide lucide-search h-3.5 w-3.5"
        aria-hidden="true"
      >
        <path d="m21 21-4.34-4.34" />
        <circle cx="11" cy="11" r="8" />
      </svg>
      <span>Search...</span>
      <kbd className="inline-flex h-5 items-center rounded border border-white/15 bg-white/8 px-1.5 font-mono text-[10px] text-[var(--vf-color-text-muted)]">Ctrl+K</kbd>
    </button>
  );
}

export function BrandMark({
  compact = false,
  subtitle = 'AI STUDIO',
}: {
  compact?: boolean;
  subtitle?: string;
}) {
  return (
    <div className={`inline-flex items-center gap-2 ${compact ? ' ' : ''}`} data-testid="brand-logo">
      <span
        className={`vf-brand-mark vf-brand-mark--live relative inline-flex shrink-0 ${compact ? 'h-9 w-9' : 'h-11 w-11'}`}
        aria-hidden="true"
        data-testid="brand-logo-mark"
      >
        <span className="vf-brand-mark__orb" />
        <span className="vf-brand-mark__shell">
          <span className="vf-brand-mark__core">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width={compact ? 11 : 12}
              height={compact ? 11 : 12}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-mic text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
              aria-hidden="true"
            >
              <path d="M12 19v3" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <rect x="9" y="2" width="6" height="13" rx="3" />
            </svg>
          </span>
        </span>
        <span className="vf-brand-mark__badge vf-brand-mark__badge--spark">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width={compact ? 7 : 8}
            height={compact ? 7 : 8}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="lucide lucide-sparkles text-white"
            aria-hidden="true"
          >
            <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
            <path d="M20 2v4" />
            <path d="M22 4h-4" />
            <circle cx="4" cy="20" r="2" />
          </svg>
        </span>
        <span className="vf-brand-mark__badge vf-brand-mark__badge--pulse">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width={compact ? 7 : 8}
            height={compact ? 7 : 8}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="lucide lucide-activity text-white"
            aria-hidden="true"
          >
            <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
          </svg>
        </span>
      </span>
      <span className="flex min-w-0 flex-col leading-none" data-testid="brand-logo-wordmark">
        <span className={`truncate font-extrabold tracking-tight text-slate-100 ${compact ? 'text-xl' : 'text-xl'}`}>V FLOW AI</span>
        <span className="mt-1 truncate font-mono font-bold uppercase text-[12px] tracking-[0.2em] text-slate-400">
          {subtitle}
        </span>
      </span>
    </div>
  );
}

export const WorkspaceHandoffView = AppHandoffView;

export function AnchorButton({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className: string;
}) {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

export function InfoPill({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'success' | 'warning' }) {
  const className =
    tone === 'success'
      ? 'rounded-full border border-emerald-300/20 bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold text-emerald-100'
      : tone === 'warning'
        ? 'rounded-full border border-cyan-300/20 bg-cyan-500/10 px-3 py-2 text-[11px] font-semibold text-cyan-100'
        : 'rounded-full border border-white/12 bg-white/[0.05] px-3 py-2 text-[11px] font-semibold text-slate-100';

  return <div className={className}>{children}</div>;
}

export function StatCard({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/48 px-3 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

export function clampText(value: unknown, fallback: string) {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export function useRouteData<T>() {
  return useLoaderData() as T;
}

export const READER_HIDDEN_FALLBACK_PATH = '/app/library';

type ReaderHandoffResolution = {
  targetPath: string;
  bookId: string | null;
};

function cleanReaderValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isUsableReaderBookId(value: unknown) {
  const id = cleanReaderValue(value);
  if (!id) return false;
  const lower = id.toLowerCase();
  if (lower === 'app' || lower === 'library' || lower === 'reader' || lower === 'read') return false;
  if (lower === '/app/library' || lower === '/app/reader') return false;
  return true;
}

function readReaderJson(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function extractReaderBookIdFromRecord(raw: string | null) {
  const parsed = readReaderJson(raw);
  if (!parsed) return null;
  if (typeof parsed === 'string') {
    return isUsableReaderBookId(parsed) ? parsed.trim() : null;
  }
  if (typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  const candidate = record.id || record.bookId || record.selectedBookId || record.libraryBookId || record.entryId || record.value;
  if (typeof candidate === 'number') {
    const text = String(candidate);
    return isUsableReaderBookId(text) ? text : null;
  }
  return isUsableReaderBookId(candidate) ? cleanReaderValue(candidate) : null;
}

function readReaderStorageKey(key: string) {
  try {
    return extractReaderBookIdFromRecord(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

export function resolveReaderHandoffTarget(search = '', fallbackPath = READER_HIDDEN_FALLBACK_PATH): ReaderHandoffResolution {
  const params = new URLSearchParams(search);
  const queryKeys = ['bookId', 'selectedBookId', 'libraryBookId'];
  for (const key of queryKeys) {
    const queryValue = params.get(key);
    if (isUsableReaderBookId(queryValue)) {
      const bookId = cleanReaderValue(queryValue);
      return {
        bookId,
        targetPath: `/app/library/${encodeURIComponent(bookId)}/read`,
      };
    }
  }

  try {
    const lastPlayed = readReaderStorageKey('vf-library-last-played');
    if (lastPlayed) {
      return {
        bookId: lastPlayed,
        targetPath: `/app/library/${encodeURIComponent(lastPlayed)}/read`,
      };
    }

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const storageKey = window.localStorage.key(index);
      if (!storageKey || !storageKey.startsWith('vf-library-selected-book:')) continue;
      const candidate = readReaderStorageKey(storageKey);
      if (candidate) {
        return {
          bookId: candidate,
          targetPath: `/app/library/${encodeURIComponent(candidate)}/read`,
        };
      }
    }
  } catch {
    // Ignore browser storage failures and fall back to the library root.
  }

  return {
    bookId: null,
    targetPath: fallbackPath,
  };
}

export function ReaderHandoffView({
  fallbackPath = READER_HIDDEN_FALLBACK_PATH,
  heading = 'Loading reader',
  statusLabel = 'Reader handoff',
}: {
  fallbackPath?: string;
  heading?: string;
  statusLabel?: string;
}) {
  useEffect(() => {
    const resolution = resolveReaderHandoffTarget(window.location.search, fallbackPath);
    if (window.location.pathname === resolution.targetPath) {
      return;
    }

    window.setTimeout(() => {
      window.location.replace(resolution.targetPath);
    }, 0);
  }, [fallbackPath]);

  return (
    <main
      className="grid min-h-dvh place-items-center bg-[radial-gradient(circle_at_top,rgba(77,212,255,0.14),transparent_40%),linear-gradient(180deg,#040713_0%,#050816_100%)] px-6 py-8 text-[#e5eefb]"
    >
      <section className="w-full max-w-[420px] rounded-[20px] border border-white/10 bg-[rgba(10,14,26,0.9)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(77,212,255,0.24)] px-3 py-1.5 text-[12px] font-bold uppercase tracking-[0.08em] text-[#4dd4ff]">
          {statusLabel}
        </div>
        <h1 className="mt-4 text-[28px] leading-[1.1] text-white">{heading}</h1>
        <p className="mt-2 text-[14px] leading-6 text-[#92a4bf]">
          Resolving the active book from the browser session and routing to the current read view.
        </p>
        <p className="mt-4 break-words text-[12px] text-[#7f92b2]">Checking local storage...</p>
      </section>
    </main>
  );
}
