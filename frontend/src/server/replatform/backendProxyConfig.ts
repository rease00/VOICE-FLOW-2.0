import { readEnvValue } from '../../shared/runtime/env';

const LOCAL_DEV_BACKEND_ORIGIN = 'http://127.0.0.1:7800';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

const normalizeBackendOrigin = (candidate: string): string => {
  const raw = String(candidate || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
};

export const isProductionNodeEnv = (): boolean =>
  String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';

export const readConfiguredLegacyBackendOriginValue = (): string =>
  readEnvValue(
    process.env.VF_MEDIA_BACKEND_ORIGINS_JSON,
    process.env.VF_MEDIA_BACKEND_URLS_JSON,
    process.env.VF_MEDIA_BACKEND_URL,
  );

export const hasConfiguredLegacyBackendOrigin = (): boolean =>
  Boolean(readConfiguredLegacyBackendOriginValue());

export const getLocalDevLegacyBackendOrigin = (): string =>
  isProductionNodeEnv() ? '' : LOCAL_DEV_BACKEND_ORIGIN;

export const isLoopbackOrigin = (candidate: string): boolean => {
  const normalized = normalizeBackendOrigin(candidate);
  if (!normalized) return false;
  try {
    const hostname = String(new URL(normalized).hostname || '').trim().toLowerCase();
    return Boolean(hostname) && (LOOPBACK_HOSTS.has(hostname) || hostname.endsWith('.localhost'));
  } catch {
    return false;
  }
};

export const resolveLegacyBackendSummary = () => {
  const configuredValue = readConfiguredLegacyBackendOriginValue();
  const localDevFallback = getLocalDevLegacyBackendOrigin();

  return {
    configuredValue,
    configured: Boolean(configuredValue),
    localDevFallbackEnabled: Boolean(localDevFallback),
    localDevFallbackOrigin: localDevFallback,
    launchReady: Boolean(configuredValue || localDevFallback),
  };
};
