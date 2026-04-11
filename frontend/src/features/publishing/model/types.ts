/**
 * Publishing feature types
 * Covers KYC verification, publisher agreements, and book publishing workflow.
 */

// ─── KYC ───────────────────────────────────────────────────────────────────

export type KycStatus = 'none' | 'pending' | 'verified' | 'rejected';

export interface KycSession {
  id: string;
  url: string;
  status: KycStatus;
  createdAt: string;
}

export interface KycVerificationResult {
  sessionId: string;
  status: KycStatus;
  verifiedAt?: string | undefined;
  rejectionReason?: string | undefined;
}

// ─── Publisher Agreement ────────────────────────────────────────────────────

export interface PublisherAgreement {
  id: string;
  userId: string;
  version: string;
  signedAt: string;
  ipAddress: string;
  signatureHash: string;
}

export interface AgreementTerms {
  version: string;
  effectiveDate: string;
  sections: AgreementSection[];
}

export interface AgreementSection {
  title: string;
  content: string;
}

// ─── Publishing ─────────────────────────────────────────────────────────────

export type PublishStatus = 'draft' | 'review' | 'published' | 'suspended';

export interface PublishedBook {
  id: string;
  authorId: string;
  authorName: string;
  title: string;
  description: string;
  genre: string;
  language: string;
  coverUrl: string;
  status: PublishStatus;
  chapterCount: number;
  totalCharacters: number;
  /** Per-chapter price in VN tokens */
  chapterPrice: number;
  /** Full novel price in VN tokens — locked once set, cannot change */
  fullNovelPrice: number | null;
  /** Google Drive folder ID where content is stored */
  driveRootFolderId: string;
  tags: string[];
  rating: number;
  ratingCount: number;
  downloadCount: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string | undefined;
  suspendedAt?: string | undefined;
  suspensionReason?: string | undefined;
}

export interface PublishedChapter {
  id: string;
  bookId: string;
  title: string;
  index: number;
  /** Google Drive file ID for chapter content */
  driveFileId: string;
  /** R2 cache key for published chapter text */
  r2CacheKey?: string | undefined;
  characterCount: number;
  price: number;
  isFree: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterUnlockRecord {
  id: string;
  userId: string;
  bookId: string;
  chapterId: string;
  vnSpent: number;
  unlockedAt: string;
}

// ─── Publishing Eligibility ─────────────────────────────────────────────────

export interface PublishingEligibility {
  isEligible: boolean;
  kycStatus: KycStatus;
  agreementSigned: boolean;
  totalCharacters: number;
  minimumCharacters: number;
  /** Percentage progress toward minimum character count */
  characterProgress: number;
  issues: string[];
}

// ─── API payloads ───────────────────────────────────────────────────────────

export interface PublishBookPayload {
  novelProjectId: string;
  title: string;
  description: string;
  genre: string;
  language: string;
  coverUrl?: string | undefined;
  chapterPrice: number;
  fullNovelPrice?: number | undefined;
  tags?: string[] | undefined;
}

export interface UpdatePublishedBookPayload {
  title?: string | undefined;
  description?: string | undefined;
  genre?: string | undefined;
  coverUrl?: string | undefined;
  chapterPrice?: number | undefined;
  tags?: string[] | undefined;
  status?: PublishStatus | undefined;
}
