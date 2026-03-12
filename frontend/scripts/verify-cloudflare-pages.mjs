#!/usr/bin/env node
import path from 'node:path';
import { loadEnv } from 'vite';

const REPO_ROOT = path.resolve(process.cwd(), '..');

const truthy = (value) => {
  const token = String(value || '').trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
};

const trimTrailingSlashes = (input) => String(input || '').replace(/\/+$/, '');

const isLoopbackHost = (value) => {
  const host = String(value || '').trim().toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
};

const normalizeRemoteHttpsUrl = (input) => {
  const candidate = String(input || '').trim();
  if (!candidate) {
    throw new Error('VITE_API_BASE_URL is missing.');
  }

  const withScheme = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  const parsed = new URL(withScheme);
  if (parsed.protocol !== 'https:') {
    throw new Error('VITE_API_BASE_URL must use https on Cloudflare Pages.');
  }
  if (isLoopbackHost(parsed.hostname)) {
    throw new Error('VITE_API_BASE_URL cannot point at localhost or another loopback host on Cloudflare Pages.');
  }
  return trimTrailingSlashes(parsed.toString());
};

const main = () => {
  const env = loadEnv('production', REPO_ROOT, '');
  if (!truthy(env.CF_PAGES)) {
    console.log('[cloudflare:pages] skipped: CF_PAGES is not set.');
    return;
  }

  const normalizedApiBaseUrl = normalizeRemoteHttpsUrl(env.VITE_API_BASE_URL);
  console.log(`[cloudflare:pages] api base url verified: ${normalizedApiBaseUrl}`);
};

try {
  main();
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error('[cloudflare:pages] Cloudflare Pages preflight failed.');
  console.error(`[cloudflare:pages] ${detail}`);
  console.error('[cloudflare:pages] Set VITE_API_BASE_URL to your deployed backend origin before running the Pages build.');
  process.exit(1);
}
