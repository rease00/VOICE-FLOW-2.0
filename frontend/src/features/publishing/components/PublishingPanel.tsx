'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { KycStatus, PublishingEligibility, PublishedBook } from '../model/types';
import { KycVerification } from './KycVerification';
import { PublisherAgreementView } from './PublisherAgreementView';
import {
  checkEligibility,
  getPublishingStatus,
  publishBook,
  getMyPublishedBooks,
} from '../services/publishingService';
import {
  BookOpen,
  ShieldCheck,
  FileText,
  Rocket,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ChevronRight,
  BarChart3,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

type Step = 'overview' | 'kyc' | 'agreement' | 'publish';

interface PublishingPanelProps {
  novelProjectId: string;
  novelTitle: string;
  chapters: { id: string; title: string; text: string }[];
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const GENRE_OPTIONS = [
  'Fantasy',
  'Sci-Fi',
  'Romance',
  'Mystery',
  'Thriller',
  'Horror',
  'Literary Fiction',
  'Non-Fiction',
  'Other',
] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function KycBadge({ status }: { status: KycStatus }) {
  switch (status) {
    case 'verified':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
          <CheckCircle2 className="w-3 h-3" /> Verified
        </span>
      );
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
          <Loader2 className="w-3 h-3 animate-spin" /> Pending
        </span>
      );
    case 'rejected':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded-full">
          <AlertCircle className="w-3 h-3" /> Rejected
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
          Not Started
        </span>
      );
  }
}

function StatusBadge({ value, label }: { value: boolean; label: string }) {
  return value ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
      <CheckCircle2 className="w-3 h-3" /> {label}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
      Not {label}
    </span>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PublishingPanel({
  novelProjectId,
  novelTitle,
  chapters,
  onToast,
}: PublishingPanelProps) {
  const [step, setStep] = useState<Step>('overview');
  const [kycStatus, setKycStatus] = useState<KycStatus>('none');
  const [agreementSigned, setAgreementSigned] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [publishedBook, setPublishedBook] = useState<PublishedBook | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Publish form state
  const [formTitle, setFormTitle] = useState(novelTitle);
  const [formDescription, setFormDescription] = useState('');
  const [formGenre, setFormGenre] = useState<string>(GENRE_OPTIONS[0]);
  const [formLanguage, setFormLanguage] = useState('English');
  const [formChapterPrice, setFormChapterPrice] = useState(5);
  const [formFullNovelPrice, setFormFullNovelPrice] = useState<number | ''>('');
  const [formTags, setFormTags] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);

  // ── Load status on mount ────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        const [status, books] = await Promise.all([
          getPublishingStatus(),
          getMyPublishedBooks(),
        ]);
        if (cancelled) return;

        setKycStatus(status.kycStatus);
        setAgreementSigned(status.agreementSigned);

        const existing = (books ?? []).find(
          (b) => (b as PublishedBook & { novelProjectId?: string }).novelProjectId === novelProjectId
            || b.title === novelTitle,
        );
        if (existing) setPublishedBook(existing);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load publishing status');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [novelProjectId, novelTitle]);

  // ── Eligibility ─────────────────────────────────────────────────────────

  const eligibility: PublishingEligibility = useMemo(() => {
    const chapterStats = (chapters ?? []).map((c) => ({
      characterCount: c.text.length,
    }));
    return checkEligibility(kycStatus, agreementSigned, chapterStats);
  }, [kycStatus, agreementSigned, chapters]);

  // ── Publish handler ─────────────────────────────────────────────────────

  const handlePublish = useCallback(async () => {
    setIsPublishing(true);
    setError(null);
    try {
      const book = await publishBook({
        novelProjectId,
        title: formTitle,
        description: formDescription,
        genre: formGenre,
        language: formLanguage,
        chapterPrice: formChapterPrice,
        fullNovelPrice: formFullNovelPrice === '' ? undefined : formFullNovelPrice,
        tags: formTags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setPublishedBook(book);
      onToast('Novel published successfully!', 'success');
      setStep('overview');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Publishing failed';
      setError(msg);
      onToast(msg, 'error');
    } finally {
      setIsPublishing(false);
    }
  }, [
    novelProjectId,
    formTitle,
    formDescription,
    formGenre,
    formLanguage,
    formChapterPrice,
    formFullNovelPrice,
    formTags,
    onToast,
  ]);

  // ── Loading / error states ──────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
        <span className="ml-2 text-sm text-gray-500">Loading publishing status…</span>
      </div>
    );
  }

  // ── Back button helper ──────────────────────────────────────────────────

  const BackButton = () => (
    <button
      type="button"
      onClick={() => setStep('overview')}
      className="mb-4 text-sm text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
    >
      ← Back to Overview
    </button>
  );

  // ── Step: KYC ───────────────────────────────────────────────────────────

  if (step === 'kyc') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <BackButton />
        <KycVerification
          onStatusChange={(s: KycStatus) => {
            setKycStatus(s);
            if (s === 'verified') setStep('overview');
          }}
        />
      </div>
    );
  }

  // ── Step: Agreement ─────────────────────────────────────────────────────

  if (step === 'agreement') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <BackButton />
        <PublisherAgreementView
          onSigned={() => {
            setAgreementSigned(true);
            setStep('overview');
          }}
        />
      </div>
    );
  }

  // ── Step: Publish form ──────────────────────────────────────────────────

  if (step === 'publish') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <BackButton />
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Rocket className="w-5 h-5 text-indigo-600" />
          Publish Novel
        </h2>

        {error && (
          <div className="mb-4 p-3 text-sm text-red-700 bg-red-50 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              type="text"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              maxLength={200}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              rows={4}
              maxLength={2000}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {/* Genre */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Genre</label>
            <select
              value={formGenre}
              onChange={(e) => setFormGenre(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            >
              {GENRE_OPTIONS.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>

          {/* Language */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
            <input
              type="text"
              value={formLanguage}
              onChange={(e) => setFormLanguage(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {/* Chapter Price */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Chapter Price (VN tokens)
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={formChapterPrice}
              onChange={(e) => setFormChapterPrice(Math.max(0, Math.min(100, Number(e.target.value))))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {/* Full Novel Price */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Full Novel Price (VN tokens, optional)
            </label>
            <input
              type="number"
              min={1}
              value={formFullNovelPrice}
              onChange={(e) =>
                setFormFullNovelPrice(e.target.value === '' ? '' : Number(e.target.value))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
            <p className="mt-1 text-xs text-amber-600">
              ⚠ Once set, the full novel price cannot be changed after publishing.
            </p>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tags (comma-separated)
            </label>
            <input
              type="text"
              value={formTags}
              onChange={(e) => setFormTags(e.target.value)}
              placeholder="e.g. adventure, magic, coming-of-age"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {/* Submit */}
          <button
            type="button"
            onClick={handlePublish}
            disabled={isPublishing || !formTitle.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isPublishing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Rocket className="w-4 h-4" />
            )}
            {isPublishing ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </div>
    );
  }

  // ── Step: Overview (default) ────────────────────────────────────────────

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-6">
      <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
        <BookOpen className="w-5 h-5 text-indigo-600" />
        Publishing
      </h2>

      {error && (
        <div className="p-3 text-sm text-red-700 bg-red-50 rounded-lg flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Checklist */}
      <div className="space-y-3">
        {/* 1. KYC */}
        <button
          type="button"
          onClick={() => setStep('kyc')}
          className="w-full flex items-center justify-between p-4 rounded-xl border border-gray-200 hover:border-indigo-200 hover:bg-indigo-50/30 transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-indigo-500" />
            <div>
              <p className="text-sm font-medium text-gray-900">KYC Verification</p>
              <p className="text-xs text-gray-500">Identity verification for publishers</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <KycBadge status={kycStatus} />
            <ChevronRight className="w-4 h-4 text-gray-400" />
          </div>
        </button>

        {/* 2. Agreement */}
        <button
          type="button"
          onClick={() => setStep('agreement')}
          className="w-full flex items-center justify-between p-4 rounded-xl border border-gray-200 hover:border-indigo-200 hover:bg-indigo-50/30 transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-indigo-500" />
            <div>
              <p className="text-sm font-medium text-gray-900">Publisher Agreement</p>
              <p className="text-xs text-gray-500">Terms &amp; conditions for publishing</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge value={agreementSigned} label="Signed" />
            <ChevronRight className="w-4 h-4 text-gray-400" />
          </div>
        </button>

        {/* 3. Character count */}
        <div className="p-4 rounded-xl border border-gray-200">
          <div className="flex items-center gap-3 mb-2">
            <BarChart3 className="w-5 h-5 text-indigo-500" />
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">Character Count</p>
              <p className="text-xs text-gray-500">
                {eligibility.totalCharacters.toLocaleString()} /{' '}
                {eligibility.minimumCharacters.toLocaleString()} characters
                <span className="ml-1 text-indigo-600 font-medium">
                  ({eligibility.characterProgress}%)
                </span>
              </p>
            </div>
          </div>
          <div className="w-full h-2 rounded-full bg-gray-100">
            <div
              className="h-2 rounded-full bg-indigo-500 transition-all"
              style={{ width: `${eligibility.characterProgress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Published book status */}
      {publishedBook && (
        <div className="p-4 rounded-xl border border-green-200 bg-green-50/50">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">{publishedBook.title}</p>
              <p className="text-xs text-gray-500">
                {publishedBook.chapterCount} chapters ·{' '}
                <span className="capitalize">{publishedBook.status}</span>
              </p>
            </div>
            <button
              type="button"
              className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Manage
            </button>
          </div>
        </div>
      )}

      {/* Publish button */}
      {!publishedBook && (
        <div className="relative group">
          <button
            type="button"
            onClick={() => setStep('publish')}
            disabled={!eligibility.isEligible}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Rocket className="w-4 h-4" />
            Publish Novel
          </button>
          {!eligibility.isEligible && (eligibility.issues ?? []).length > 0 && (
            <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg z-10">
              <p className="font-medium mb-1">Requirements not met:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {(eligibility.issues ?? []).map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
