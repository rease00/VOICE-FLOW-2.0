'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { reportFrontendError } from '../../shared/telemetry/frontendErrors';
import { sanitizeUiText } from '../../shared/ui/terminology';
import { useOptionalNotifications } from '../../shared/notifications/NotificationProvider';
import { STORAGE_KEYS } from '../../shared/storage/keys';
import { BrandLogo } from '../../../components/BrandLogo';
import { classifyUnhandledRejection } from './unhandledRejectionRecovery';

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

interface ReactAppErrorBoundaryProps extends React.PropsWithChildren {
  onErrorCaptured: (error: CapturedAppError) => void;
}

const isMediaVolumeAssignmentError = (message: string): boolean => {
  const lowered = String(message || '').trim().toLowerCase();
  if (!lowered) return false;
  return lowered.includes("failed to set the 'volume' property")
    && lowered.includes('htmlmediaelement');
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
  const notifications = useOptionalNotifications();
  const emit = notifications?.emit;

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
    emit?.('app.crash.captured', {
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
        emit?.('custom.message', {
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
