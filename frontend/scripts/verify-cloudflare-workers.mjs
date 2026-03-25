#!/usr/bin/env node

const trim = (value) => String(value || '').trim();

const truthy = (value) => {
  const token = trim(value).toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
};

const isLoopbackHost = (value) => {
  const host = trim(value).toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
};

const normalizeRemoteHttpsUrl = (input, label) => {
  const candidate = trim(input);
  if (!candidate) {
    throw new Error(`${label} is missing.`);
  }

  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  const parsed = new URL(withScheme);
  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} must use https for Cloudflare Workers.`);
  }
  if (isLoopbackHost(parsed.hostname)) {
    throw new Error(`${label} cannot point at localhost or another loopback host for Cloudflare Workers.`);
  }
  return parsed.toString().replace(/\/+$/, '');
};

const resolveBrowserApiBase = (...values) => {
  for (const value of values) {
    const token = trim(value);
    if (token) return token.replace(/\/+$/, '');
  }
  return '/api/backend';
};

const main = () => {
  const browserApiBase = resolveBrowserApiBase(
    process.env.NEXT_PUBLIC_API_BASE_URL,
    process.env.VITE_API_BASE_URL
  );

  if (browserApiBase !== '/api/backend') {
    throw new Error(
      `Browser API base must remain '/api/backend' so the Next proxy stays the single browser entrypoint. Found: ${browserApiBase}`
    );
  }

  const backendOrigin = normalizeRemoteHttpsUrl(process.env.VF_MEDIA_BACKEND_URL, 'VF_MEDIA_BACKEND_URL');
  console.log(`[cloudflare:workers] browser API base verified: ${browserApiBase}`);
  console.log(`[cloudflare:workers] backend origin verified: ${backendOrigin}`);

  if (truthy(process.env.CF_PAGES)) {
    console.log('[cloudflare:workers] note: CF_PAGES is set, but this app now deploys through Cloudflare Workers.');
  }
};

try {
  main();
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error('[cloudflare:workers] Cloudflare preflight failed.');
  console.error(`[cloudflare:workers] ${detail}`);
  process.exit(1);
}
