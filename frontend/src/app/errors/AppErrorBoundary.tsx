import React, { useEffect, useState } from 'react';
import { reportFrontendError } from '../../shared/telemetry/frontendErrors';
import { sanitizeUiText } from '../../shared/ui/terminology';
import { useNotifications } from '../../shared/notifications/NotificationProvider';
import { BrandLogo } from '../../../components/BrandLogo';

interface AppErrorBoundaryState {
  message: string;
}

const isRecoverableAllowlistError = (message: string): boolean => {
  const lowered = String(message || '').trim().toLowerCase();
  if (!lowered) return false;
  return (
    lowered.includes('admin authorization failed: uid_not_allowlisted')
    || lowered.includes('uid_not_allowlisted')
  );
};

export const AppErrorBoundary: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [uiError, setUiError] = useState<AppErrorBoundaryState>({ message: '' });
  const { emit } = useNotifications();

  useEffect(() => {
    const onWindowError = (event: ErrorEvent): void => {
      const message = sanitizeUiText(event.error?.message || event.message || 'Unknown render error');
      console.error('[ui.error_boundary]', event.error || message);
      emit('app.crash.captured', {
        title: 'Runtime Error',
        message: 'The app encountered a runtime error. You can retry the interface or reload.',
        details: message,
        sticky: true,
        dedupeKey: `ui-error-${message}`,
        action: {
          label: 'Reload App',
          onClick: () => window.location.reload(),
        },
      });
      setUiError({ message });
      void reportFrontendError({
        message,
        severity: 'error',
        stack: typeof event.error?.stack === 'string' ? event.error.stack : undefined,
        component: 'AppErrorBoundary',
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
      const reason = event.reason;
      const message = sanitizeUiText(reason?.message || String(reason || 'Unhandled rejection'));
      if (isRecoverableAllowlistError(message)) {
        event.preventDefault();
        emit('custom.message', {
          title: 'Admin Access Blocked',
          message: 'This admin action is restricted for your account.',
          details: 'Add your Firebase UID to VF_ADMIN_APPROVER_UIDS in backend env, then restart backend services.',
          sticky: true,
          dedupeKey: 'admin-uid-not-allowlisted',
        });
        void reportFrontendError({
          message,
          severity: 'warn',
          stack: typeof reason?.stack === 'string' ? reason.stack : undefined,
          component: 'AppErrorBoundary',
          metadata: { kind: 'unhandledrejection', reason: 'uid_not_allowlisted' },
        });
        return;
      }
      console.error('[ui.error_boundary.unhandled_rejection]', reason);
      emit('app.crash.captured', {
        title: 'Unhandled Failure',
        message: 'A background task failed unexpectedly. You can retry or reload the app.',
        details: message,
        sticky: true,
        dedupeKey: `ui-unhandled-${message}`,
        action: {
          label: 'Reload App',
          onClick: () => window.location.reload(),
        },
      });
      setUiError({ message });
      void reportFrontendError({
        message,
        severity: 'fatal',
        stack: typeof reason?.stack === 'string' ? reason.stack : undefined,
        component: 'AppErrorBoundary',
        metadata: { kind: 'unhandledrejection' },
      });
    };
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [emit]);

  if (uiError.message) {
    return (
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
            {uiError.message}
          </pre>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setUiError({ message: '' })}
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
  }

  return <>{children}</>;
};
