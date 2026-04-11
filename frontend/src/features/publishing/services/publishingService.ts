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

// ─── KYC & Agreement ───────────────────────────────────────────────────────

export async function getPublishingStatus(): Promise<{
  kycStatus: KycStatus;
  agreementSigned: boolean;
}> {
  return authFetchJson('/api/kyc');
}

export async function startKycSession(): Promise<{
  id: string;
  url: string;
  status: string;
}> {
  return authFetchJson('/api/kyc', {
    method: 'POST',
    body: JSON.stringify({ action: 'create-session' }),
  });
}

export async function signAgreement(version: string): Promise<PublisherAgreement> {
  return authFetchJson('/api/kyc', {
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
  return authFetchJson('/api/books', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updatePublishedBook(
  bookId: string,
  payload: UpdatePublishedBookPayload,
): Promise<PublishedBook> {
  return authFetchJson('/api/books', {
    method: 'PATCH',
    body: JSON.stringify({ bookId, ...payload }),
  });
}

export async function getMyPublishedBooks(): Promise<PublishedBook[]> {
  return authFetchJson('/api/books');
}

export async function getPublishedBookChapters(
  bookId: string,
): Promise<PublishedChapter[]> {
  return authFetchJson(`/api/books?bookId=${encodeURIComponent(bookId)}&chapters=true`);
}
