'use client';

import React, { useState, useRef, useCallback } from 'react';
import { useUser } from '../../../../contexts/UserContext';
import type { PublisherAgreement, AgreementTerms, AgreementSection } from '../model/types';
import { FileText, CheckCircle2, ScrollText, Loader2 } from 'lucide-react';
import { API_ROUTES } from '../../../shared/api/routes';

interface PublisherAgreementViewProps {
  onSigned?: (agreement: PublisherAgreement) => void;
}

const AGREEMENT_TERMS: AgreementTerms = {
  version: '1.0',
  effectiveDate: '2025-01-01',
  sections: [
    {
      title: 'Platform Role',
      content:
        'Voice Flow acts solely as a hosting and distribution platform. The platform provides infrastructure for authors to publish and readers to discover novels.',
    },
    {
      title: 'Intellectual Property',
      content:
        'Authors retain full intellectual property rights to all content published on the platform. Voice Flow claims no ownership over any user-created content.',
    },
    {
      title: 'Commission Structure',
      content:
        'The platform charges a 5% commission on all sales. This covers hosting, distribution, payment processing, and reader-facing features.',
    },
    {
      title: 'Content Standards',
      content:
        'Authors agree not to publish content that violates applicable laws, infringes on third-party rights, or contains harmful material as defined in our content policy.',
    },
    {
      title: 'Payment Terms',
      content:
        'Author earnings are credited to their VN wallet within 7 business days of purchase. Minimum withdrawal threshold applies as per current platform policy.',
    },
    {
      title: 'Termination',
      content:
        'Either party may terminate this agreement with 30 days written notice. Upon termination, published content will be removed within 14 business days. Existing purchases remain accessible to readers.',
    },
    {
      title: 'Governing Law',
      content:
        'This agreement is governed by the laws of India. Any disputes shall be resolved through arbitration in accordance with Indian arbitration laws.',
    },
  ],
};

export function PublisherAgreementView({ onSigned }: PublisherAgreementViewProps) {
  const user = useUser();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isSigned, setIsSigned] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
      setHasScrolledToBottom(true);
    }
  }, []);

  const signAgreement = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { firebaseAuth } = await import('../../../../services/firebaseClient');
      const token = await firebaseAuth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(API_ROUTES.account.kyc, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'sign-agreement',
          version: AGREEMENT_TERMS.version,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to sign agreement');
      }

      const data = await res.json();
      setIsSigned(true);
      onSigned?.(data.agreement);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [onSigned]);

  if (isSigned) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 w-full">
        <div className="flex flex-col items-center text-center gap-4">
          <CheckCircle2 className="w-12 h-12 text-green-500" />
          <h3 className="text-lg font-semibold text-gray-900">Agreement Signed</h3>
          <p className="text-sm text-gray-500">
            You have successfully signed the Publisher Agreement (v{AGREEMENT_TERMS.version}).
            You can now proceed to publish your novels.
          </p>
          <div className="text-xs text-gray-400">
            Effective from {AGREEMENT_TERMS.effectiveDate}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 w-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-6 border-b border-gray-100">
        <ScrollText className="w-6 h-6 text-indigo-500" />
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Publisher Agreement</h3>
          <p className="text-xs text-gray-400">
            Version {AGREEMENT_TERMS.version} &middot; Effective {AGREEMENT_TERMS.effectiveDate}
          </p>
        </div>
      </div>

      {/* Scrollable Agreement Sections */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="max-h-[60vh] overflow-y-auto p-6 space-y-6"
      >
        {AGREEMENT_TERMS.sections.map((section, i) => (
          <div key={i}>
            <h4 className="text-sm font-semibold text-gray-900 mb-1">
              {i + 1}. {section.title}
            </h4>
            <p className="text-sm text-gray-600 leading-relaxed">{section.content}</p>
          </div>
        ))}
      </div>

      {/* Sticky Bottom Bar */}
      <div className="sticky bottom-0 bg-white border-t border-gray-100 p-4 rounded-b-2xl space-y-3">
        {error && <p className="text-sm text-red-500 text-center">{error}</p>}

        <label
          className={`flex items-start gap-3 cursor-pointer ${
            !hasScrolledToBottom ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          <input
            type="checkbox"
            checked={agreed}
            disabled={!hasScrolledToBottom}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-sm text-gray-700">
            I have read and agree to the terms of the Publisher Agreement
          </span>
        </label>

        <button
          onClick={signAgreement}
          disabled={!agreed || isLoading}
          className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <FileText className="w-4 h-4" />
          )}
          Sign Agreement
        </button>
      </div>
    </div>
  );
}
