import { readEnvBoolean } from './env';

const PUBLIC_HOST_SUFFIX = '.pages.dev';
const PUBLIC_HOSTS = new Set(['v-flow-ai.com', 'www.v-flow-ai.com']);

const normalizeHost = (hostname: string): string =>
  String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');

export const isPublicDeploymentHost = (hostname: string): boolean => {
  const safeHost = normalizeHost(hostname);
  return PUBLIC_HOSTS.has(safeHost) || safeHost.endsWith(PUBLIC_HOST_SUFFIX);
};

export const shouldEnforcePrivateMode = (
  env: { VF_SITE_PRIVATE?: string | undefined } | undefined,
  hostname: string,
): boolean => {
  if (!readEnvBoolean(env?.VF_SITE_PRIVATE)) return false;
  return !isPublicDeploymentHost(hostname);
};
