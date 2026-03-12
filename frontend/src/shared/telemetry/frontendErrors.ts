import { requestJson } from '../api/httpClient';

type FrontendErrorSeverity = 'info' | 'warning' | 'error' | 'critical' | 'warn' | 'fatal';

interface FrontendErrorPayload {
  message: string;
  route?: string;
  component?: string;
  severity?: FrontendErrorSeverity;
  stack?: string;
  metadata?: Record<string, unknown>;
}

const isTelemetryEnabled = (): boolean => {
  const raw = String(import.meta.env.VITE_FRONTEND_OBSERVABILITY_ENABLED || '1').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
};

const errorSampleRate = (): number => {
  const raw = Number(import.meta.env.VITE_FRONTEND_ERROR_SAMPLE_RATE ?? 1);
  if (!Number.isFinite(raw)) return 1;
  return Math.max(0, Math.min(1, raw));
};

const shouldSample = (): boolean => {
  const rate = errorSampleRate();
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return Math.random() < rate;
};

const normalizeSeverity = (severity: FrontendErrorSeverity | undefined): 'info' | 'warning' | 'error' | 'critical' => {
  if (severity === 'warn') return 'warning';
  if (severity === 'fatal') return 'critical';
  if (severity === 'info' || severity === 'warning' || severity === 'critical') return severity;
  return 'error';
};

export const reportFrontendError = async (payload: FrontendErrorPayload): Promise<void> => {
  if (!isTelemetryEnabled() || !shouldSample()) return;
  const route = typeof window !== 'undefined' ? window.location.pathname : '';
  const normalized: FrontendErrorPayload = {
    message: String(payload.message || 'Unknown frontend error'),
    ...(payload.route || route ? { route: payload.route || route } : {}),
    ...(payload.component ? { component: payload.component } : {}),
    severity: normalizeSeverity(payload.severity),
    ...(payload.stack ? { stack: payload.stack } : {}),
    ...(payload.metadata ? { metadata: payload.metadata } : {}),
  };
  try {
    await requestJson<{ ok: boolean }>(
      '/ops/guardian/frontend-errors',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalized),
      },
      { requireAuth: true }
    );
  } catch {
    // Intentionally swallow telemetry transport failures.
  }
};

export const reportFrontendSignal = async (payload: Omit<FrontendErrorPayload, 'severity'> & { severity?: FrontendErrorSeverity }): Promise<void> => {
  await reportFrontendError({
    ...payload,
    severity: payload.severity || 'info',
  });
};
