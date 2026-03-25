import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Mic2, Upload, X } from 'lucide-react';
import { Button } from '../../../components/Button';
import { useUser } from '../../../contexts/UserContext';
import type { ClonedVoice } from '../../../types';
import { fileToBase64, fetchUrlToBase64 } from '../../shared/audio/base64';
import {
  cloneVoiceWithOpenVoice,
  type OpenVoiceCloneRequest,
  type OpenVoiceCloneResponse,
} from './api';

interface VoiceCloneModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCloneCreated: (voice: ClonedVoice) => void;
  backendBaseUrl?: string;
  sourceVoiceId?: string;
  sourceVoiceLabel?: string;
  sourceVoiceEngine?: string;
  sourceVoiceUrl?: string;
  prepareSourceVoiceUrl?: () => Promise<{ url: string; needsCleanup: boolean }>;
}

const makeRequestId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `vc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error || 'Unable to convert voice.');
};

const resolveAudioUrl = (url: string, baseUrl?: string): string => {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^(?:https?:|blob:|data:)/i.test(raw)) return raw;
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) return raw;
  return raw.startsWith('/') ? `${base}${raw}` : `${base}/${raw}`;
};

const buildClonedVoice = (
  response: OpenVoiceCloneResponse,
  fallback: {
    id: string;
    name: string;
    gender: ClonedVoice['gender'];
    accent: string;
    description: string;
    originalSampleUrl: string;
    sourceVoiceId: string;
    sourceVoiceName: string;
    sourceVoiceEngine: string;
  }
): ClonedVoice => {
  const clonedVoice = response.clonedVoice;
  const country = String(clonedVoice?.country || '').trim();
  const ageGroup = String(clonedVoice?.ageGroup || '').trim();
  const previewUrl = String(clonedVoice?.previewUrl || response.artifact?.downloadUrl || fallback.originalSampleUrl || '').trim();
  const originalSampleUrl = String(clonedVoice?.originalSampleUrl || response.artifact?.downloadUrl || fallback.originalSampleUrl || '').trim();
  const referenceText = String(clonedVoice?.referenceText || '').trim();
  const sourceVoiceId = String(clonedVoice?.sourceVoiceId || response.sourceVoiceId || fallback.sourceVoiceId || '').trim();
  const sourceVoiceName = String(clonedVoice?.sourceVoiceName || response.sourceVoiceName || fallback.sourceVoiceName || fallback.name || '').trim();
  const sourceVoiceEngine = String(clonedVoice?.sourceVoiceEngine || response.sourceVoiceEngine || fallback.sourceVoiceEngine || '').trim();
  const referenceAudioUrl = String(clonedVoice?.referenceAudioUrl || response.referenceAudioUrl || '').trim();
  const referenceAudioName = String(clonedVoice?.referenceAudioName || response.referenceAudioName || '').trim();
  const createdAt = clonedVoice?.dateCreated;

  const voice: ClonedVoice = {
    id: String(clonedVoice?.id || fallback.id),
    name: String(clonedVoice?.name || fallback.name),
    gender: (clonedVoice?.gender || fallback.gender) as ClonedVoice['gender'],
    accent: String(clonedVoice?.accent || fallback.accent),
    geminiVoiceName: String(clonedVoice?.geminiVoiceName || fallback.name),
    engine: clonedVoice?.engine || 'KOKORO',
    source: clonedVoice?.source || 'openvoice',
    isDownloaded: Boolean(clonedVoice?.isDownloaded ?? true),
    isCloned: true,
    ...(previewUrl ? { previewUrl } : {}),
    accessTier: clonedVoice?.accessTier || 'pro',
    isPlanRestricted: clonedVoice?.isPlanRestricted || false,
    dateCreated: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : Date.now(),
    description: String(clonedVoice?.description || fallback.description),
    originalSampleUrl: originalSampleUrl || '',
    ...(country ? { country } : {}),
    ...(ageGroup ? { ageGroup } : {}),
    ...(sourceVoiceId ? { sourceVoiceId } : {}),
    ...(sourceVoiceName ? { sourceVoiceName } : {}),
    ...(referenceAudioUrl ? { referenceAudioUrl } : {}),
    ...(referenceAudioName ? { referenceAudioName } : {}),
    ...(referenceText ? { referenceText } : {}),
  };
  if (sourceVoiceEngine) {
    voice.sourceVoiceEngine = sourceVoiceEngine;
  }
  return voice;
};

export const VoiceCloneModal: React.FC<VoiceCloneModalProps> = ({
  isOpen,
  onClose,
  onCloneCreated,
  backendBaseUrl,
  sourceVoiceId,
  sourceVoiceLabel,
  sourceVoiceEngine,
  sourceVoiceUrl,
  prepareSourceVoiceUrl,
}) => {
  const { authReady, isAuthenticated } = useUser();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [resultVoice, setResultVoice] = useState<ClonedVoice | null>(null);
  const [resultAudioUrl, setResultAudioUrl] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setReferenceFile(null);
    setIsSubmitting(false);
    setSubmitError('');
    setResultVoice(null);
    setResultAudioUrl('');
  }, [isOpen]);

  const currentSourceLabel = useMemo(
    () => String(sourceVoiceLabel || '').trim() || 'Selected speaker',
    [sourceVoiceLabel]
  );
  const currentSourceUrl = useMemo(
    () => resolveAudioUrl(String(sourceVoiceUrl || '').trim(), backendBaseUrl),
    [backendBaseUrl, sourceVoiceUrl]
  );
  const canSubmit = authReady && isAuthenticated && Boolean(referenceFile) && !isSubmitting && (Boolean(currentSourceUrl) || Boolean(prepareSourceVoiceUrl));

  const handleOverlayClick = () => {
    if (!isSubmitting) onClose();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setReferenceFile(event.target.files?.[0] || null);
    setSubmitError('');
    setResultVoice(null);
    setResultAudioUrl('');
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!authReady) {
      setSubmitError('Loading your session...');
      return;
    }
    if (!isAuthenticated) {
      setSubmitError('Sign in to use voice conversion.');
      return;
    }
    if (!referenceFile) {
      setSubmitError('Choose a reference audio file.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError('');
    let resolvedSourceUrl = currentSourceUrl;
    let shouldCleanupSourceUrl = false;

    try {
      if (!resolvedSourceUrl && prepareSourceVoiceUrl) {
        const prepared = await prepareSourceVoiceUrl();
        resolvedSourceUrl = String(prepared.url || '').trim();
        shouldCleanupSourceUrl = Boolean(prepared.needsCleanup);
      }
      if (!resolvedSourceUrl) {
        setSubmitError('No source audio is available for this speaker.');
        return;
      }

      const [referenceAudioBase64, sourceAudioBase64] = await Promise.all([
        fileToBase64(referenceFile),
        fetchUrlToBase64(resolvedSourceUrl),
      ]);
      const requestId = makeRequestId();
      const payload: OpenVoiceCloneRequest = {
        durationSec: 15,
        language: 'EN',
        text: currentSourceLabel,
        referenceAudioBase64,
        referenceAudioName: referenceFile.name || 'reference.wav',
        sourceAudioBase64,
        sourceAudioName: `${currentSourceLabel || 'speaker'}.wav`,
        sourceVoiceId: String(sourceVoiceId || '').trim(),
        sourceVoiceName: currentSourceLabel,
        sourceVoiceEngine: String(sourceVoiceEngine || '').trim(),
        referenceAudioUrl: '',
        speed: 1,
        requestId,
        traceId: requestId,
        regionHint: '',
        regionSource: 'frontend',
        costMultiplier: 1,
      };

      const response = await cloneVoiceWithOpenVoice(payload, backendBaseUrl ? { baseUrl: backendBaseUrl } : undefined);
      const responseContentType = String(response.artifact?.contentType || referenceFile.type || 'audio/wav').trim() || 'audio/wav';
      const responsePreviewUrl = resolveAudioUrl(
        String(response.clonedVoice?.previewUrl || response.artifact?.downloadUrl || ''),
        backendBaseUrl
      );
      const inlineAudioUrl = response.audioBase64
        ? `data:${responseContentType};base64,${String(response.audioBase64 || '').trim()}`
        : '';
      const resultSampleUrl = responsePreviewUrl || inlineAudioUrl;

      const clonedVoice = buildClonedVoice(response, {
        id: response.clonedVoice?.id || requestId,
        name: currentSourceLabel,
        gender: 'Unknown',
        accent: 'Neutral',
        description: `Converted from ${currentSourceLabel}`,
        originalSampleUrl: resultSampleUrl || currentSourceUrl,
        sourceVoiceId: String(sourceVoiceId || '').trim(),
        sourceVoiceName: currentSourceLabel,
        sourceVoiceEngine: String(sourceVoiceEngine || '').trim(),
      });

      setResultVoice({
        ...clonedVoice,
        ...(resultSampleUrl ? { previewUrl: resultSampleUrl } : {}),
      });
      setResultAudioUrl(resultSampleUrl);
      onCloneCreated({
        ...clonedVoice,
        ...(resultSampleUrl ? { previewUrl: resultSampleUrl } : {}),
      });
    } catch (error) {
      setResultVoice(null);
      setResultAudioUrl('');
      setSubmitError(getErrorMessage(error));
    } finally {
      if (shouldCleanupSourceUrl && resolvedSourceUrl.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(resolvedSourceUrl);
        } catch {
          // Ignore cleanup failures.
        }
      }
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 px-4 py-4 backdrop-blur-sm"
      onClick={handleOverlayClick}
      role="presentation"
    >
      <div
        aria-modal="true"
        aria-labelledby="voice-clone-modal-title"
        className="w-full max-w-xl overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm">
              <Mic2 size={18} />
            </div>
            <div>
              <h2 id="voice-clone-modal-title" className="text-lg font-semibold">
                Change Speaker Voice
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Upload a reference voice. The selected speaker sample is used automatically.
              </p>
            </div>
          </div>
          <button
            aria-label="Close voice conversion modal"
            className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <CheckCircle2 size={16} className="text-emerald-600" />
              <span>{currentSourceLabel}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              This speaker will be replaced with the converted voice.
            </p>
            {!currentSourceUrl && prepareSourceVoiceUrl ? (
              <p className="mt-1 text-xs text-slate-500">
                The speaker sample will be prepared automatically when you convert.
              </p>
            ) : null}
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Reference audio</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Upload the voice sample that should drive the conversion.
                  </p>
                </div>
                <Button
                  icon={<Upload size={14} />}
                  isLoading={isSubmitting}
                  onClick={() => fileInputRef.current?.click()}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Choose file
                </Button>
              </div>

              <input
                accept="audio/*"
                className="hidden"
                disabled={isSubmitting}
                onChange={handleFileChange}
                ref={fileInputRef}
                type="file"
              />

              <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                {referenceFile ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-slate-800">{referenceFile.name}</span>
                    <span className="text-xs text-slate-500">{Math.max(1, Math.round(referenceFile.size / 1024))} KB</span>
                  </div>
                ) : (
                  'No reference file selected.'
                )}
              </div>
            </div>

            {submitError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
                <div className="flex items-center gap-2">
                  <AlertCircle size={16} />
                  <span>{submitError}</span>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                disabled={isSubmitting}
                onClick={onClose}
                size="md"
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                fullWidth
                isLoading={isSubmitting}
                size="md"
                type="submit"
                variant="primary"
                disabled={!canSubmit}
              >
                Convert Voice
              </Button>
            </div>
          </form>

          {resultVoice ? (
            <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-cyan-100 text-cyan-700">
                  <CheckCircle2 size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-cyan-900">{resultVoice.name}</p>
                  <p className="mt-1 text-xs text-cyan-700">
                    The speaker voice was updated with the converted clone.
                  </p>
                </div>
              </div>
              {resultAudioUrl ? (
                <audio className="mt-4 w-full" controls src={resultAudioUrl} />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
