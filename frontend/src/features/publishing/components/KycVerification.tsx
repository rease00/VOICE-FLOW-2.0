'use client';

import React, { useState, useCallback } from 'react';
import { useUser } from '../../../../contexts/UserContext';
import type { KycStatus } from '../model/types';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Loader2,
  ExternalLink,
} from 'lucide-react';

interface KycVerificationProps {
  onStatusChange?: (status: KycStatus) => void;
}

export function KycVerification({ onStatusChange }: KycVerificationProps) {
  const user = useUser();
  const [kycStatus, setKycStatus] = useState<KycStatus>('none');
  const [sessionUrl, setSessionUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startKycSession = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { firebaseAuth } = await import('../../../../services/firebaseClient');
      const token = await firebaseAuth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch('/api/kyc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'create-session' }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to start verification session');
      }

      const data = await res.json();
      setSessionUrl(data.session?.url || null);
      setKycStatus('pending');
      onStatusChange?.('pending');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [onStatusChange]);

  const checkKycStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { firebaseAuth } = await import('../../../../services/firebaseClient');
      const token = await firebaseAuth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch('/api/kyc', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to check status');
      }

      const data = await res.json();
      const status: KycStatus = data.kycStatus || 'none';
      setKycStatus(status);
      onStatusChange?.(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  }, [onStatusChange]);

  if (kycStatus === 'verified') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 w-full">
        <div className="flex flex-col items-center text-center gap-4">
          <ShieldCheck className="w-12 h-12 text-green-500" />
          <h3 className="text-lg font-semibold text-gray-900">Identity Verified</h3>
          <div className="flex items-center gap-2 text-green-600 text-sm">
            <ShieldCheck className="w-4 h-4" />
            <span>Your identity has been verified. You can now publish on Voice Flow.</span>
          </div>
        </div>
      </div>
    );
  }

  if (kycStatus === 'rejected') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 w-full">
        <div className="flex flex-col items-center text-center gap-4">
          <ShieldX className="w-12 h-12 text-red-500" />
          <h3 className="text-lg font-semibold text-gray-900">Verification Failed</h3>
          <p className="text-sm text-gray-500">
            Your identity verification was not successful. Please try again with valid documents.
          </p>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            onClick={startKycSession}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (kycStatus === 'pending') {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 w-full">
        <div className="flex flex-col items-center text-center gap-4">
          <ShieldAlert className="w-12 h-12 text-amber-500" />
          <h3 className="text-lg font-semibold text-gray-900">Verification Pending</h3>
          <p className="text-sm text-gray-500">
            Your identity verification is being processed. This usually takes a few minutes.
          </p>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <button
              onClick={checkKycStatus}
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
              Check Status
            </button>
            {sessionUrl && (
              <a
                href={sessionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors"
              >
                Continue Verification
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  // kycStatus === 'none'
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 w-full">
      <div className="flex flex-col items-center text-center gap-4">
        <Shield className="w-12 h-12 text-indigo-500" />
        <h3 className="text-lg font-semibold text-gray-900">Identity Verification Required</h3>
        <p className="text-sm text-gray-500">
          To publish on Voice Flow, we need to verify your identity. This is a one-time process
          that helps us maintain trust and safety on the platform.
        </p>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          onClick={startKycSession}
          disabled={isLoading}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
          Start Verification
        </button>
      </div>
    </div>
  );
}
