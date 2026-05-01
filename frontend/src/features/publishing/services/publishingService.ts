import type {
  KycStatus,
  PublishedBook,
  PublishedChapter,
  PublishingEligibility,
  PublishBookPayload,
  UpdatePublishedBookPayload,
  PublisherAgreement,
} from '../model/types';
import { authFetch } from '../../../../services/authHttpClient';
import { API_ROUTES } from '../../../shared/api/routes';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function authFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const requestInit: RequestInit = {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  };
  if (init?.signal) {
    requestInit.signal = init.signal;
  }

  const authOptions: { requireAuth: true; signal?: AbortSignal } = { requireAuth: true };
  if (init?.signal) {
    authOptions.signal = init.signal;
  }

  const res = await authFetch(url, requestInit, authOptions);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body || `Request failed: ${res.status}`);
  }
  return res.json();
}

const unwrapBookPayload = async (request: Promise<PublishedBook | { book?: PublishedBook | null }>): Promise<PublishedBook> => {
  const payload = await request;
  if (payload && typeof payload === 'object' && 'book' in payload && payload.book) {
    return payload.book;
  }
  return payload as PublishedBook;
};

const unwrapBooksPayload = async (
  request: Promise<PublishedBook[] | { books?: PublishedBook[] | null }>
): Promise<PublishedBook[]> => {
  const payload = await request;
  if (payload && typeof payload === 'object' && 'books' in payload) {
    return Array.isArray(payload.books) ? payload.books : [];
  }
  return Array.isArray(payload) ? payload : [];
};

const unwrapChaptersPayload = async (
  request: Promise<PublishedChapter[] | { chapters?: PublishedChapter[] | null }>
): Promise<PublishedChapter[]> => {
  const payload = await request;
  if (payload && typeof payload === 'object' && 'chapters' in payload) {
    return Array.isArray(payload.chapters) ? payload.chapters : [];
  }
  return Array.isArray(payload) ? payload : [];
};

// ─── KYC & Agreement ───────────────────────────────────────────────────────

export async function getPublishingStatus(signal?: AbortSignal): Promise<{
  kycStatus: KycStatus;
  agreementSigned: boolean;
}> {
  return authFetchJson<{ kycStatus: KycStatus; agreementSigned: boolean }>(
    API_ROUTES.account.kyc,
    signal ? { signal } : undefined
  );
}

export async function startKycSession(signal?: AbortSignal): Promise<{
  session: {
    id: string;
    url: string;
    status: string;
  };
}> {
  const requestInit: RequestInit = {
    method: 'POST',
    body: JSON.stringify({ action: 'create-session' }),
  };
  if (signal) {
    requestInit.signal = signal;
  }
  return authFetchJson<{ session: { id: string; url: string; status: string } }>(API_ROUTES.account.kyc, requestInit);
}

export async function signAgreement(version: string, signal?: AbortSignal): Promise<{ agreement: PublisherAgreement }> {
  const requestInit: RequestInit = {
    method: 'POST',
    body: JSON.stringify({ action: 'sign-agreement', version }),
  };
  if (signal) {
    requestInit.signal = signal;
  }
  return authFetchJson<{ agreement: PublisherAgreement }>(API_ROUTES.account.kyc, requestInit);
}

// ─── Eligibility (pure) ────────────────────────────────────────────────────

export function checkEligibility(
  kycStatus: KycStatus,
  agreementSigned: boolean,
  chapters: { characterCount: number }[],
): PublishingEligibility {
  const totalCharacters = (chapters ?? []).reduce(
    (sum, c) => sum + (c.characterCount || 0),
    0,
  );
  const minimumCharacters = 30_000;
  const characterProgress =
    minimumCharacters > 0
      ? Math.min(100, Math.round((totalCharacters / minimumCharacters) * 100))
      : 0;

  const issues: string[] = [];

  if (kycStatus !== 'verified') {
    issues.push('KYC verification must be completed before publishing.');
  }
  if (!agreementSigned) {
    issues.push('Publisher agreement must be signed before publishing.');
  }
  if (totalCharacters < minimumCharacters) {
    issues.push(
      `Minimum ${minimumCharacters.toLocaleString()} characters required (currently ${totalCharacters.toLocaleString()}).`,
    );
  }
  if ((chapters ?? []).length === 0) {
    issues.push('At least one chapter is required.');
  }

  return {
    isEligible: issues.length === 0,
    kycStatus,
    agreementSigned,
    totalCharacters,
    minimumCharacters,
    characterProgress,
    issues,
  };
}

// ─── Book CRUD ──────────────────────────────────────────────────────────────

export async function publishBook(payload: PublishBookPayload): Promise<PublishedBook> {
  return unwrapBookPayload(authFetchJson<PublishedBook | { book?: PublishedBook | null }>(API_ROUTES.publishing.books, {
    method: 'POST',
    body: JSON.stringify(payload),
  }));
}

export async function updatePublishedBook(
  bookId: string,
  payload: UpdatePublishedBookPayload,
): Promise<PublishedBook> {
  return unwrapBookPayload(authFetchJson<PublishedBook | { book?: PublishedBook | null }>(API_ROUTES.publishing.books, {
    method: 'PATCH',
    body: JSON.stringify({ bookId, ...payload }),
  }));
}

export async function getMyPublishedBooks(): Promise<PublishedBook[]> {
  return unwrapBooksPayload(authFetchJson<PublishedBook[] | { books?: PublishedBook[] | null }>(API_ROUTES.publishing.books));
}

export async function getPublishedBookChapters(
  bookId: string,
): Promise<PublishedChapter[]> {
  return unwrapChaptersPayload(authFetchJson<PublishedChapter[] | { chapters?: PublishedChapter[] | null }>(API_ROUTES.publishing.bookChapters(bookId)));
}
