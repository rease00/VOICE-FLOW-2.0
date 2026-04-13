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
  const backendOrigin = String(
    process.env.VF_MEDIA_BACKEND_URL
    || process.env.VF_MEDIA_BACKEND_ORIGINS_JSON
    || ''
  ).trim();

  return {
    active: true,
    mode: backendOrigin ? 'compatibility-shim' : 'nextjs-first',
    nextRuntime,
    nodeEnv: String(process.env.NODE_ENV || '').trim() || 'development',
    cloudRun: {
      supported: true,
      standaloneOutput: true,
    },
    legacyProxyBase: LEGACY_PROXY_BASE,
    legacyProxyConfigured: Boolean(backendOrigin),
    canonicalFamilies: CANONICAL_API_FAMILIES,
  };
};
