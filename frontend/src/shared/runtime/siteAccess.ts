import { readEnvBoolean } from './env';

const PUBLIC_HOST_SUFFIX = '.pages.dev';
const PUBLIC_HOSTS = new Set(['v-flow-ai.com', 'www.v-flow-ai.com']);

const normalizeHost = (hostname: string): string =>
  String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');

const normalizeHeaderHost = (value: string | null | undefined): string =>
  normalizeHost(String(value || '').split(',')[0] || '');

export const isPublicDeploymentHost = (hostname: string): boolean => {
  const safeHost = normalizeHost(hostname);
  return PUBLIC_HOSTS.has(safeHost) || safeHost.endsWith(PUBLIC_HOST_SUFFIX);
};

type RequestHostSource = {
  url: string;
  headers?: {
    get(name: string): string | null;
  };
};

export const resolveRequestHost = (request: RequestHostSource): string => {
  const headerHost =
    normalizeHeaderHost(request.headers?.get('x-forwarded-host')) ||
    normalizeHeaderHost(request.headers?.get('host')) ||
    normalizeHeaderHost(request.headers?.get('cf-connecting-host'));
  if (headerHost) return headerHost;

  try {
    return normalizeHost(new URL(request.url).hostname);
  } catch {
    return '';
  }
};

export const shouldEnforcePrivateMode = (
  env: { VF_SITE_PRIVATE?: string | undefined } | undefined,
  hostname: string,
): boolean => {
  if (!readEnvBoolean(env?.VF_SITE_PRIVATE)) return false;
  return !isPublicDeploymentHost(hostname);
};
