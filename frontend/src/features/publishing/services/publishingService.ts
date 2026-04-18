import type {
  KycStatus,
  PublishedBook,
  PublishedChapter,
  PublishingEligibility,
  PublishBookPayload,
  UpdatePublishedBookPayload,
  PublisherAgreement,
} from '../model/types';
import { firebaseAuth } from '../../../../services/firebaseClient';
import { API_ROUTES } from '../../../shared/api/routes';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function authFetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await firebaseAuth.currentUser?.getIdToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
    signal: init?.signal || AbortSignal.timeout(15000),
  });
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

export async function getPublishingStatus(): Promise<{
  kycStatus: KycStatus;
  agreementSigned: boolean;
}> {
  return authFetchJson(API_ROUTES.account.kyc);
}

export async function startKycSession(): Promise<{
  id: string;
  url: string;
  status: string;
}> {
  return authFetchJson(API_ROUTES.account.kyc, {
    method: 'POST',
    body: JSON.stringify({ action: 'create-session' }),
  });
}

export async function signAgreement(version: string): Promise<PublisherAgreement> {
  return authFetchJson(API_ROUTES.account.kyc, {
    method: 'POST',
    body: JSON.stringify({ action: 'sign-agreement', version }),
  });
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
  return unwrapBookPayload(authFetchJson(API_ROUTES.publishing.books, {
    method: 'POST',
    body: JSON.stringify(payload),
  }));
}

export async function updatePublishedBook(
  bookId: string,
  payload: UpdatePublishedBookPayload,
): Promise<PublishedBook> {
  return unwrapBookPayload(authFetchJson(API_ROUTES.publishing.books, {
    method: 'PATCH',
    body: JSON.stringify({ bookId, ...payload }),
  }));
}

export async function getMyPublishedBooks(): Promise<PublishedBook[]> {
  return unwrapBooksPayload(authFetchJson(API_ROUTES.publishing.books));
}

export async function getPublishedBookChapters(
  bookId: string,
): Promise<PublishedChapter[]> {
  return unwrapChaptersPayload(authFetchJson(API_ROUTES.publishing.bookChapters(bookId)));
}
