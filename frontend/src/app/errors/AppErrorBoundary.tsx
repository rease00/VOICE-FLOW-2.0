import React, { useCallback, useEffect, useState } from 'react';
import { reportFrontendError } from '../../shared/telemetry/frontendErrors';
import { sanitizeUiText } from '../../shared/ui/terminology';
import { useNotifications } from '../../shared/notifications/NotificationProvider';
import { BrandLogo } from '../../../components/BrandLogo';

interface AppErrorBoundaryState {
  message: string;
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

const isRecoverableAllowlistError = (message: string): boolean => {
  const lowered = String(message || '').trim().toLowerCase();
  if (!lowered) return false;
  return (
    lowered.includes('admin authorization failed: uid_not_allowlisted')
    || lowered.includes('uid_not_allowlisted')
  );
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
  state: AppErrorBoundaryState = { message: '' };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      message: sanitizeUiText((error as Error)?.message || 'Unknown render error'),
    };
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
    this.setState({ message: '' });
  };

  render(): React.ReactNode {
    if (this.state.message) {
      return <AppErrorFallback message={this.state.message} onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}

export const AppErrorBoundary: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [uiError, setUiError] = useState<AppErrorBoundaryState>({ message: '' });
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
      details: error.message,
      sticky: true,
      dedupeKey: options.dedupeKey,
      action: {
        label: 'Reload App',
        onClick: () => window.location.reload(),
      },
    });
    if (options.showFallback !== false) {
      setUiError({ message: error.message });
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
      if (isRecoverableAllowlistError(message)) {
        const telemetryPayload: Parameters<typeof reportFrontendError>[0] = {
          message,
          severity: 'warn',
          component: 'AppErrorBoundary',
          metadata: { kind: 'unhandledrejection', reason: 'uid_not_allowlisted' },
        };
        if (typeof reason?.stack === 'string') {
          telemetryPayload.stack = reason.stack;
        }
        event.preventDefault();
        emit('custom.message', {
          title: 'Admin Access Blocked',
          message: 'This admin action is restricted for your account.',
          details: 'Add your Firebase UID to VF_ADMIN_APPROVER_UIDS in backend env, then restart backend services.',
          sticky: true,
          dedupeKey: 'admin-uid-not-allowlisted',
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

  if (uiError.message) {
    return <AppErrorFallback message={uiError.message} onRetry={() => setUiError({ message: '' })} />;
  }

  return (
    <ReactAppErrorBoundary onErrorCaptured={handleReactError}>
      {children}
    </ReactAppErrorBoundary>
  );
};
