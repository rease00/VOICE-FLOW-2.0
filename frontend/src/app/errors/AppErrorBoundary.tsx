'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { reportFrontendError } from '../../shared/telemetry/frontendErrors';
import { sanitizeUiText } from '../../shared/ui/terminology';
import { useNotifications } from '../../shared/notifications/NotificationProvider';
import { STORAGE_KEYS } from '../../shared/storage/keys';
import { BrandLogo } from '../../../components/BrandLogo';

interface AppErrorBoundaryState {
  message: string;
  technicalMessage: string;
}

interface CapturedAppError {
  message: string;
  severity: 'error' | 'warn' | 'fatal';
  stack?: string;
  metadata?: Record<string, unknown>;
}

type UnhandledRejectionRecoveryKind = 'allowlist' | 'auth' | 'transient';

export interface UnhandledRejectionRecovery {
  kind: UnhandledRejectionRecoveryKind;
  telemetryReason: string;
  title: string;
  message: string;
  details: string;
  dedupeKey: string;
}

interface ReactAppErrorBoundaryProps extends React.PropsWithChildren {
  onErrorCaptured: (error: CapturedAppError) => void;
}

const isRecoverableAllowlistError = (message: string): boolean => {
  const lowered = String(message || '').trim().toLowerCase();
  if (!lowered) return false;
  return (
    lowered.includes('admin authorization failed: uid_not_allowlisted')
    || lowered.includes('uid_not_allowlisted')
  );
};

const isRecoverableAuthRejection = (message: string): boolean => {
  const lowered = String(message || '').trim().toLowerCase();
  if (!lowered) return false;
  return (
    lowered.includes('authentication required')
    || lowered.includes('missing bearer token')
    || lowered.includes('invalid auth token')
    || lowered.includes('auth token did not include uid')
  );
};

const isMediaVolumeAssignmentError = (message: string): boolean => {
  const lowered = String(message || '').trim().toLowerCase();
  if (!lowered) return false;
  return lowered.includes("failed to set the 'volume' property")
    && lowered.includes('htmlmediaelement');
};

const TRANSIENT_UNHANDLED_REJECTION_PATTERNS = [
  'failed to fetch',
  'fetch failed',
  'network-request-failed',
  'networkerror',
  'network error',
  'connection reset',
  'connection closed',
  'socket hang up',
  'econnrefused',
  'econnreset',
  'etimedout',
  'enotfound',
  'offline',
  'timeout',
  'timed out',
  'deadline exceeded',
  'aborterror',
  'aborted',
  'cancelled',
  'canceled',
  'poll_failed',
  'background task',
  'background sync',
  'background refresh',
  'sync failed',
  'refresh failed',
];

const extractUnhandledRejectionDetails = (reason: unknown): { message: string; name: string; stack?: string } => {
  if (!reason) return { message: '', name: '' };
  if (typeof reason === 'string') {
    return { message: sanitizeUiText(reason.trim()), name: '' };
  }
  if (reason instanceof Error) {
    return {
      message: sanitizeUiText(String(reason.message || '').trim()),
      name: String(reason.name || '').trim(),
      ...(typeof reason.stack === 'string' ? { stack: reason.stack } : {}),
    };
  }
  if (typeof reason === 'object') {
    const candidate = reason as { message?: unknown; name?: unknown; stack?: unknown; cause?: unknown; detail?: unknown };
    const message = sanitizeUiText(
      String(candidate.message || candidate.detail || candidate.cause || '').trim() || String(reason).trim()
    );
    return {
      message,
      name: String(candidate.name || '').trim(),
      ...(typeof candidate.stack === 'string' ? { stack: candidate.stack } : {}),
    };
  }
  return { message: sanitizeUiText(String(reason).trim()), name: '' };
};

const isTransientUnhandledRejection = (message: string, name: string): boolean => {
  const lowered = String(message || '').trim().toLowerCase();
  const loweredName = String(name || '').trim().toLowerCase();
  if (!lowered && !loweredName) return false;
  if (loweredName === 'aborterror' || lowered.includes('aborterror')) return true;
  if (lowered.includes('aborted') || lowered.includes('cancelled') || lowered.includes('canceled')) return true;
  return TRANSIENT_UNHANDLED_REJECTION_PATTERNS.some((token) => lowered.includes(token));
};

const getTransientRecoveryDetails = (message: string, name: string): Pick<UnhandledRejectionRecovery, 'telemetryReason' | 'title' | 'message' | 'details' | 'dedupeKey'> => {
  const lowered = String(message || '').trim().toLowerCase();
  if (String(name || '').trim().toLowerCase() === 'aborterror' || lowered.includes('aborterror') || lowered.includes('aborted') || lowered.includes('cancelled') || lowered.includes('canceled')) {
    return {
      telemetryReason: 'abort',
      title: 'Request Cancelled',
      message: 'A request was cancelled before it completed. Retry if you still need it.',
      details: 'This looks like a normal cancellation, so the app stayed on screen.',
      dedupeKey: 'unhandled-rejection-transient-abort',
    };
  }
  if (lowered.includes('timeout') || lowered.includes('timed out') || lowered.includes('deadline exceeded') || lowered.includes('etimedout')) {
    return {
      telemetryReason: 'timeout',
      title: 'Request Timed Out',
      message: 'A request took too long to finish. Please retry in a moment.',
      details: 'The app stayed open because the request looks recoverable.',
      dedupeKey: 'unhandled-rejection-transient-timeout',
    };
  }
  if (
    lowered.includes('poll_failed')
    || lowered.includes('background task')
    || lowered.includes('background sync')
    || lowered.includes('background refresh')
    || lowered.includes('sync failed')
    || lowered.includes('refresh failed')
  ) {
    return {
      telemetryReason: 'background',
      title: 'Background Task Interrupted',
      message: 'A background task failed temporarily. The app stayed open so you can try again.',
      details: 'This looks like a recoverable background failure rather than a fatal app crash.',
      dedupeKey: 'unhandled-rejection-transient-background',
    };
  }
  return {
    telemetryReason: 'network',
    title: 'Connection Issue',
    message: 'A temporary connection problem interrupted part of the app. Check your connection and retry.',
    details: 'The app stayed open because the error looks transient.',
    dedupeKey: 'unhandled-rejection-transient-network',
  };
};

export const classifyUnhandledRejection = (reason: unknown): UnhandledRejectionRecovery | null => {
  const extracted = extractUnhandledRejectionDetails(reason);
  const message = extracted.message || sanitizeUiText(String(reason || 'Unhandled rejection'));
  if (isRecoverableAllowlistError(message)) {
    return {
      kind: 'allowlist',
      telemetryReason: 'uid_not_allowlisted',
      title: 'Admin Access Blocked',
      message: 'This admin action is restricted for your account.',
      details: 'Ask a workspace administrator to grant admin access for your account, then retry.',
      dedupeKey: 'admin-uid-not-allowlisted',
    };
  }
  if (isRecoverableAuthRejection(message)) {
    return {
      kind: 'auth',
      telemetryReason: 'auth_required',
      title: 'Sign In Required',
      message: 'Your session is missing or expired. Sign in again and retry.',
      details: 'The session looks recoverable after sign-in, so the app stayed open.',
      dedupeKey: 'auth-required-unhandled-rejection',
    };
  }
  if (isTransientUnhandledRejection(message, extracted.name)) {
    return {
      kind: 'transient',
      ...getTransientRecoveryDetails(message, extracted.name),
    };
  }
  return null;
};

const DEFAULT_APP_ERROR_MESSAGE = 'The app encountered an unexpected error. You can retry the interface or reload the app.';

const createAppErrorState = (error: unknown): AppErrorBoundaryState => ({
  message: DEFAULT_APP_ERROR_MESSAGE,
  technicalMessage: sanitizeUiText((error as Error)?.message || 'Unknown render error'),
});

const clampUnitVolume = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
};

const sanitizeStoredVolumeSettings = (): void => {
  if (typeof window === 'undefined') return;
  const storage = window.localStorage;

  const sanitizeRecord = (key: string, defaults: { speechVolume: number; musicVolume: number }) => {
    const raw = storage.getItem(key);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      const current = parsed as Record<string, unknown>;
      const nextSpeechVolume = clampUnitVolume(current.speechVolume, defaults.speechVolume);
      const nextMusicVolume = clampUnitVolume(current.musicVolume, defaults.musicVolume);
      const speechChanged = !Object.is(current.speechVolume, nextSpeechVolume);
      const musicChanged = !Object.is(current.musicVolume, nextMusicVolume);
      if (!speechChanged && !musicChanged) return;
      const nextPayload = {
        ...current,
        speechVolume: nextSpeechVolume,
        musicVolume: nextMusicVolume,
      };
      storage.setItem(key, JSON.stringify(nextPayload));
    } catch {
      // If the payload is corrupt, remove it so the app can fall back to defaults.
      storage.removeItem(key);
    }
  };

  sanitizeRecord(STORAGE_KEYS.readerPreferences, { speechVolume: 1, musicVolume: 0.3 });
  sanitizeRecord(STORAGE_KEYS.settings, { speechVolume: 1, musicVolume: 0.3 });
};

const AppErrorFallback: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div className="min-h-screen w-full flex items-center justify-center bg-slate-950 text-slate-100 p-6">
    <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
      <div className="mb-4 flex justify-center">
        <BrandLogo size="sm" tone="light" />
      </div>
      <h1 className="text-lg font-bold">Interface Error</h1>
      <p className="mt-2 text-sm text-slate-300">
        The UI hit a runtime error. You can retry without restarting services.
      </p>
      <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-rose-300 custom-scrollbar">
        {message}
      </pre>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Retry UI
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
        >
          Reload App
        </button>
      </div>
    </div>
  </div>
);

class ReactAppErrorBoundary extends React.Component<ReactAppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { message: '', technicalMessage: '' };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return createAppErrorState(error);
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    const message = sanitizeUiText((error as Error)?.message || 'Unknown render error');
    const stackSegments = [
      typeof (error as Error)?.stack === 'string' ? (error as Error).stack : '',
      typeof info.componentStack === 'string' ? info.componentStack.trim() : '',
    ].filter(Boolean);
    const captured: CapturedAppError = {
      message,
      severity: 'error',
      metadata: { kind: 'react_error_boundary' },
    };
    if (stackSegments.length > 0) {
      captured.stack = stackSegments.join('\n\n');
    }
    console.error('[ui.error_boundary.react]', error, info.componentStack);
    this.props.onErrorCaptured(captured);
  }

  private handleRetry = (): void => {
    if (isMediaVolumeAssignmentError(this.state.technicalMessage)) {
      sanitizeStoredVolumeSettings();
    }
    this.setState({ message: '', technicalMessage: '' });
  };

  render(): React.ReactNode {
    if (this.state.message) {
      return <AppErrorFallback message={this.state.message} onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}

export const AppErrorBoundary: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [uiError, setUiError] = useState<AppErrorBoundaryState>({ message: '', technicalMessage: '' });
  const { emit } = useNotifications();

  const reportCapturedError = useCallback((error: CapturedAppError, options: { showFallback?: boolean; title: string; userMessage: string; dedupeKey: string }) => {
    const telemetryPayload: Parameters<typeof reportFrontendError>[0] = {
      message: error.message,
      severity: error.severity,
      component: 'AppErrorBoundary',
    };
    if (error.stack) {
      telemetryPayload.stack = error.stack;
    }
    if (error.metadata) {
      telemetryPayload.metadata = error.metadata;
    }
    emit('app.crash.captured', {
      title: options.title,
      message: options.userMessage,
      details: options.userMessage,
      sticky: true,
      dedupeKey: options.dedupeKey,
      action: {
        label: 'Reload App',
        onClick: () => window.location.reload(),
      },
    });
    if (options.showFallback !== false) {
      setUiError({ message: options.userMessage, technicalMessage: error.message });
    }
    void reportFrontendError(telemetryPayload);
  }, [emit]);

  const handleReactError = useCallback((error: CapturedAppError) => {
    reportCapturedError(error, {
      showFallback: false,
      title: 'Interface Error',
      userMessage: 'The app encountered a render error. You can retry the interface or reload.',
      dedupeKey: `ui-react-${error.message}`,
    });
  }, [reportCapturedError]);

  useEffect(() => {
    const onWindowError = (event: ErrorEvent): void => {
      const message = sanitizeUiText(event.error?.message || event.message || 'Unknown runtime error');
      console.error('[ui.error_boundary.window]', event.error || message);
      reportCapturedError({
        message,
        severity: 'error',
        ...(typeof event.error?.stack === 'string' ? { stack: event.error.stack } : {}),
        metadata: { kind: 'window.error' },
      }, {
        title: 'Runtime Error',
        userMessage: 'The app encountered a runtime error. You can retry the interface or reload.',
        dedupeKey: `ui-window-${message}`,
      });
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
      const reason = event.reason;
      const message = sanitizeUiText(reason?.message || String(reason || 'Unhandled rejection'));
      const recovery = classifyUnhandledRejection(reason);
      if (recovery) {
        const telemetryPayload: Parameters<typeof reportFrontendError>[0] = {
          message,
          severity: 'warn',
          component: 'AppErrorBoundary',
          metadata: { kind: 'unhandledrejection', reason: recovery.telemetryReason },
        };
        if (typeof reason?.stack === 'string') {
          telemetryPayload.stack = reason.stack;
        }
        event.preventDefault();
        emit('custom.message', {
          title: recovery.title,
          message: recovery.message,
          details: recovery.details,
          severity: 'warning',
          category: recovery.kind === 'transient' ? 'system' : 'security',
          sticky: true,
          dedupeKey: recovery.dedupeKey,
        });
        void reportFrontendError(telemetryPayload);
        return;
      }

      console.error('[ui.error_boundary.unhandled_rejection]', reason);
      reportCapturedError({
        message,
        severity: 'fatal',
        ...(typeof reason?.stack === 'string' ? { stack: reason.stack } : {}),
        metadata: { kind: 'unhandledrejection' },
      }, {
        title: 'Unhandled Failure',
        userMessage: 'A background task failed unexpectedly. You can retry or reload the app.',
        dedupeKey: `ui-unhandled-${message}`,
      });
    };

    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [emit, reportCapturedError]);

  const handleFallbackRetry = useCallback(() => {
    if (isMediaVolumeAssignmentError(uiError.technicalMessage)) {
      sanitizeStoredVolumeSettings();
    }
    setUiError({ message: '', technicalMessage: '' });
  }, [uiError.technicalMessage]);

  if (uiError.message) {
    return <AppErrorFallback message={uiError.message} onRetry={handleFallbackRetry} />;
  }

  return (
    <ReactAppErrorBoundary onErrorCaptured={handleReactError}>
      {children}
    </ReactAppErrorBoundary>
  );
};
