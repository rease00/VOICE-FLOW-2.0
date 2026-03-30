import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Mic2, Upload, X } from 'lucide-react';
import type { ClonedVoice } from '../../../types';
import { Button } from '../../../components/Button';
import { getEngineDisplayName } from '../../../services/engineDisplay';
import { fileToBase64, fetchUrlToBase64, base64ToArrayBuffer } from '../../shared/audio/base64';
import { getSharedAudioContext } from '../../shared/audio/audioContext';
import { buildDunoClonePreviewUrl } from './dunoPreview';
import { cloneVoiceWithDunoNative, cloneVoiceWithOpenVoice } from './api';

export interface VoiceCloneModalResult {
  cloneMode: 'modal_reference' | 'duno_native';
  engine: string;
  referenceArtifactId: string;
  referenceAudioUrl: string;
  referenceAudioName: string;
  sourceVoiceId: string;
  sourceVoiceName: string;
  sourceVoiceEngine: string;
  consumedVcUnits: number;
  clonedVoice?: ClonedVoice;
}

interface VoiceCloneModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCloneCreated: (result: VoiceCloneModalResult) => void;
  backendBaseUrl?: string;
  sourceVoiceId?: string;
  sourceVoiceLabel?: string;
  sourceVoiceEngine?: string;
  sourceVoiceUrl?: string;
  prepareSourceVoiceUrl?: () => Promise<{ url: string; needsCleanup: boolean }>;
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error || 'Unable to attach reference audio.');
};

const buildReferenceDataUrl = async (file: File): Promise<string> => {
  const encoded = await fileToBase64(file);
  const contentType = String(file.type || 'audio/wav').trim() || 'audio/wav';
  return `data:${contentType};base64,${encoded}`;
};

const toAudioFileName = (label: string, fallback: string): string => {
  const safeLabel = String(label || '').trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${safeLabel || fallback}.wav`;
};

const measureDurationFromBase64 = async (audioBase64: string): Promise<number> => {
  try {
    const context = getSharedAudioContext();
    const buffer = await context.decodeAudioData(base64ToArrayBuffer(audioBase64).slice(0));
    const duration = Number(buffer?.duration || 0);
    if (Number.isFinite(duration) && duration > 0) {
      return Math.max(1, Math.ceil(duration));
    }
  } catch {
    // Fall back to a single billable second when duration detection fails.
  }
  return 1;
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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocusedElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReferenceFile(null);
    setIsSubmitting(false);
    setSubmitError('');

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusDialog = () => {
      const focusableSelector = [
        'button:not([disabled])',
        '[href]',
        'input:not([disabled]):not([type="hidden"])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
      ].join(', ');
      const dialog = dialogRef.current;
      const firstFocusable = dialog
        ? (Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).find((element) => element.offsetParent !== null) ||
            closeButtonRef.current ||
            dialog)
        : null;
      firstFocusable?.focus();
    };

    const raf = window.requestAnimationFrame(focusDialog);

    return () => {
      window.cancelAnimationFrame(raf);
      document.body.style.overflow = previousOverflow;
      const previous = previouslyFocusedElementRef.current;
      if (previous && typeof previous.focus === 'function' && previous.isConnected) {
        previous.focus();
      }
      previouslyFocusedElementRef.current = null;
    };
  }, [isOpen]);

  const normalizedSourceEngine = useMemo(
    () => String(sourceVoiceEngine || '').trim().toUpperCase() || 'PRIME',
    [sourceVoiceEngine]
  );
  const isDunoNativeClone = normalizedSourceEngine === 'DUNO';
  const dunoLabel = getEngineDisplayName('DUNO');
  const currentSourceLabel = useMemo(
    () => String(sourceVoiceLabel || '').trim() || 'Selected speaker',
    [sourceVoiceLabel]
  );
  const currentSourceId = useMemo(
    () => String(sourceVoiceId || '').trim(),
    [sourceVoiceId]
  );
  const canSubmit = Boolean(referenceFile) && !isSubmitting;
  const modalTitle = isDunoNativeClone ? `Create ${dunoLabel} Native Clone` : 'Attach Modal VC Reference';
  const modalDescription = isDunoNativeClone
    ? `Upload a consented reference clip to create a ${dunoLabel}-native cloned voice.`
    : 'Upload a consented reference clip and bind it to this speaker for Modal voice conversion.';

  const handleOverlayClick = () => {
    if (!isSubmitting) onClose();
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      if (isSubmitting) return;
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusableSelector = [
      'button:not([disabled])',
      '[href]',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');
    const focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
      (element) => element.offsetParent !== null
    );
    if (focusableElements.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (!firstElement || !lastElement) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const activeElement = document.activeElement as HTMLElement | null;

    if (event.shiftKey && activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return;
    }

    if (!event.shiftKey && activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setReferenceFile(event.target.files?.[0] || null);
    setSubmitError('');
  };

  const resolveSourceSamplePayload = async (): Promise<{
    sourceAudioBase64: string;
    sourceAudioName: string;
    durationSec: number;
  }> => {
    let preparedUrl = String(sourceVoiceUrl || '').trim();
    let needsCleanup = false;
    if (!preparedUrl && prepareSourceVoiceUrl) {
      const prepared = await prepareSourceVoiceUrl();
      preparedUrl = String(prepared?.url || '').trim();
      needsCleanup = Boolean(prepared?.needsCleanup);
    }
    if (!preparedUrl) {
      throw new Error('Selected speaker preview is unavailable. Generate a preview first, then retry.');
    }

    try {
      const sourceAudioBase64 = await fetchUrlToBase64(preparedUrl);
      if (!sourceAudioBase64) {
        throw new Error('Selected speaker preview did not return audio.');
      }
      return {
        sourceAudioBase64,
        sourceAudioName: toAudioFileName(currentSourceLabel, currentSourceId || 'source'),
        durationSec: await measureDurationFromBase64(sourceAudioBase64),
      };
    } finally {
      if (needsCleanup) {
        try {
          URL.revokeObjectURL(preparedUrl);
        } catch {
          // Ignore cleanup failures for temporary preview URLs.
        }
      }
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!referenceFile) {
      setSubmitError('Choose a reference audio file.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError('');

    try {
      const referenceAudioName = String(referenceFile.name || 'reference.wav').trim() || 'reference.wav';
      const [referenceAudioUrl, referenceAudioBase64] = await Promise.all([
        buildReferenceDataUrl(referenceFile),
        fileToBase64(referenceFile),
      ]);

      if (isDunoNativeClone) {
        const requestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `duno_clone_${Date.now()}`;
        const response = await cloneVoiceWithDunoNative(
          {
            referenceAudioBase64,
            referenceAudioName,
            sourceVoiceId: currentSourceId,
            sourceVoiceName: currentSourceLabel,
            sourceVoiceEngine: 'DUNO',
            speaker: currentSourceLabel,
            requestId,
            traceId: requestId,
          },
          backendBaseUrl ? { baseUrl: backendBaseUrl } : undefined
        );

        const backendClonedVoice = (response.clonedVoice || {}) as Partial<ClonedVoice>;
        let previewUrl = String(backendClonedVoice.previewUrl || '').trim();
        if (!previewUrl) {
          previewUrl = await buildDunoClonePreviewUrl({
            backendBaseUrl,
            voiceId: String(backendClonedVoice.geminiVoiceName || response.voiceId || currentSourceId || '').trim() || String(response.voiceId || currentSourceId || '').trim(),
            voiceName: String(backendClonedVoice.name || `${currentSourceLabel} Clone`).trim() || `${currentSourceLabel} Clone`,
            voiceModel: String(response.model || '').trim(),
          });
        }
        const clonedVoice: ClonedVoice = {
          id: String(response.voiceId || backendClonedVoice.id || '').trim(),
          name: String(backendClonedVoice.name || `${currentSourceLabel} Clone`).trim() || `${currentSourceLabel} Clone`,
          gender: backendClonedVoice.gender || 'Unknown',
          accent: backendClonedVoice.accent || 'Neutral',
          geminiVoiceName: String(backendClonedVoice.geminiVoiceName || response.voiceId || currentSourceLabel).trim() || currentSourceLabel,
          engine: 'DUNO',
          source: String(backendClonedVoice.source || 'duno_native').trim() || 'duno_native',
          isDownloaded: true,
          isCloned: true,
          previewUrl,
          accessTier: backendClonedVoice.accessTier || 'pro',
          isPlanRestricted: Boolean(backendClonedVoice.isPlanRestricted),
          dateCreated: Math.max(0, Number(backendClonedVoice.dateCreated || Date.now())),
          description: String(backendClonedVoice.description || `Native ${getEngineDisplayName('DUNO')} clone of ${currentSourceLabel}`).trim() || `Native ${getEngineDisplayName('DUNO')} clone of ${currentSourceLabel}`,
          originalSampleUrl: String(backendClonedVoice.originalSampleUrl || referenceAudioUrl).trim() || referenceAudioUrl,
          referenceAudioUrl,
          referenceAudioName,
          sourceVoiceId: currentSourceId,
          sourceVoiceName: currentSourceLabel,
          sourceVoiceEngine: 'DUNO',
        };

        onCloneCreated({
          cloneMode: 'duno_native',
          engine: 'DUNO',
          referenceArtifactId: '',
          referenceAudioUrl,
          referenceAudioName,
          sourceVoiceId: currentSourceId,
          sourceVoiceName: currentSourceLabel,
          sourceVoiceEngine: 'DUNO',
          consumedVcUnits: 0,
          clonedVoice,
        });
        return;
      }

      const { sourceAudioBase64, sourceAudioName, durationSec } = await resolveSourceSamplePayload();
      const requestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `modal_clone_${Date.now()}`;
      const response = await cloneVoiceWithOpenVoice(
        {
          durationSec,
          language: 'EN',
          text: '',
          sourceVoiceId: currentSourceId,
          sourceVoiceName: currentSourceLabel,
          sourceVoiceEngine: normalizedSourceEngine,
          referenceAudioBase64,
          referenceAudioName,
          referenceAudioUrl,
          sourceAudioBase64,
          sourceAudioName,
          speed: 1,
          requestId,
          traceId: requestId,
          regionHint: '',
          regionSource: 'studio_reference_modal',
          costMultiplier: 1,
        },
        backendBaseUrl ? { baseUrl: backendBaseUrl } : undefined
      );

      onCloneCreated({
        cloneMode: 'modal_reference',
        engine: normalizedSourceEngine,
        referenceArtifactId: String(response.referenceArtifactId || '').trim(),
        referenceAudioUrl: String(response.referenceAudioUrl || referenceAudioUrl).trim() || referenceAudioUrl,
        referenceAudioName: String(response.referenceAudioName || referenceAudioName).trim() || referenceAudioName,
        sourceVoiceId: currentSourceId,
        sourceVoiceName: currentSourceLabel,
        sourceVoiceEngine: normalizedSourceEngine,
        consumedVcUnits: Math.max(0, Number(response.consumedVcUnits || 0)),
      });
    } catch (error) {
      setSubmitError(getErrorMessage(error));
    } finally {
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
        aria-describedby="voice-clone-modal-description"
        aria-labelledby="voice-clone-modal-title"
        className="w-full max-w-xl overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-900 shadow-2xl"
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm">
              <Mic2 size={18} />
            </div>
            <div>
              <h2 id="voice-clone-modal-title" className="text-lg font-semibold">
                {modalTitle}
              </h2>
              <p id="voice-clone-modal-description" className="mt-1 text-sm text-slate-500">
                {modalDescription}
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            aria-label="Close reference audio modal"
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
              {isDunoNativeClone
                ? `A new ${dunoLabel}-native cloned voice will be created from this speaker and reference sample.`
                : 'This speaker will use Modal voice conversion with the uploaded reference during generation.'}
            </p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Reference audio</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Upload the consented voice sample that should be attached to this speaker.
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

            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
              <p className="font-semibold">Consent and safety</p>
              <p className="mt-1">
                Only upload voice samples you have explicit rights to use. Non-consensual cloning, impersonation, fraud, and deceptive content are prohibited.
              </p>
            </div>

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
                {isDunoNativeClone ? `Create ${dunoLabel} Clone` : 'Attach Modal Reference'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
