import { resolveLegacyBackendSummary } from './backendProxyConfig';

export const CANONICAL_API_FAMILIES = Object.freeze({
  account: '/api/v1/account',
  billing: '/api/v1/billing',
  studio: '/api/v1/studio',
  library: '/api/v1/library',
  publishing: '/api/v1/publishing',
  voiceClone: '/api/v1/voice-clone',
  admin: '/api/v1/admin',
  ops: '/api/v1/ops',
});

export const LEGACY_PROXY_BASE = '/api/backend';

export const getReplatformRuntimeSummary = () => {
  const nextRuntime = String(process.env.NEXT_RUNTIME || 'nodejs').trim() || 'nodejs';
  const backend = resolveLegacyBackendSummary();

  return {
    active: true,
    mode: 'cloudflare-native',
    deploymentTarget: 'cloudflare-workers',
    nextRuntime,
    nodeEnv: String(process.env.NODE_ENV || '').trim() || 'development',
    cloudflareWorkers: {
      supported: true,
      standaloneOutput: true,
    },
    cloudRun: {
      supported: false,
      standaloneOutput: true,
    },
    nativeLaunchReady: true,
    legacyProxyBase: LEGACY_PROXY_BASE,
    legacyProxyConfigured: backend.configured,
    legacyProxyLocalDevFallbackEnabled: backend.localDevFallbackEnabled,
    legacyProxyLaunchReady: backend.launchReady,
    canonicalFamilies: CANONICAL_API_FAMILIES,
  };
};
