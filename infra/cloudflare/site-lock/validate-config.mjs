#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const readJsonc = (filePath) => {
  const content = readFileSync(filePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(content);
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const wranglerConfig = readJsonc(path.join(scriptDir, 'wrangler.jsonc'));
const protectedHosts = String(wranglerConfig.vars?.SITE_LOCK_PROTECTED_HOSTS ?? '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean)
  .sort();
const routeHosts = (wranglerConfig.routes ?? [])
  .map((route) => String(route.pattern ?? '').split('/')[0].trim().toLowerCase())
  .filter(Boolean)
  .sort();

assert(protectedHosts.length > 0, 'SITE_LOCK_PROTECTED_HOSTS must be configured.');
assert(
  JSON.stringify(protectedHosts) === JSON.stringify(routeHosts),
  'SITE_LOCK_PROTECTED_HOSTS must match the Cloudflare production route hostnames.'
);
for (const host of protectedHosts) {
  assert(!/localhost|127\.0\.0\.1|\[::1\]/i.test(host), `Protected host ${host} cannot be a local/dev hostname.`);
}
assert(!('SITE_LOCK_USER' in (wranglerConfig.vars ?? {})), 'SITE_LOCK_USER must stay in Cloudflare secrets, not wrangler vars.');
assert(!('SITE_LOCK_PASS' in (wranglerConfig.vars ?? {})), 'SITE_LOCK_PASS must stay in Cloudflare secrets, not wrangler vars.');

const originalFetch = globalThis.fetch;
globalThis.fetch = async (request) =>
  new Response(`upstream:${new URL(request.url).hostname}`, {
    status: 200,
    headers: {
      'X-Upstream': '1',
    },
  });

try {
  const moduleUrl = `${pathToFileURL(path.join(scriptDir, 'src', 'index.js')).href}?t=${Date.now()}`;
  const workerModule = await import(moduleUrl);
  const worker = workerModule.default;

  const callWorker = (url) => worker.fetch(new Request(url), {});

  const localResponse = await callWorker('https://localhost:3000/');
  assert(localResponse.status === 200, 'Site-lock worker must pass through localhost requests.');
  assert(localResponse.headers.get('X-V-Flow-AI-Lock') === 'disabled', 'Site-lock worker must label pass-through responses as disabled.');
  assert(localResponse.headers.get('X-Robots-Tag') === 'noindex, nofollow, noarchive, nosnippet, noimageindex', 'Site-lock worker must keep robots protection.');
  assert(localResponse.headers.get('WWW-Authenticate') === null, 'Site-lock worker must not challenge with Basic Auth.');

  const prodResponse = await callWorker('https://v-flow-ai.com/');
  assert(prodResponse.status === 200, 'Site-lock worker must pass through protected production hosts.');
  assert(prodResponse.headers.get('X-V-Flow-AI-Lock') === 'disabled', 'Production responses must report the lock as disabled.');
  assert(prodResponse.headers.get('X-Robots-Tag') === 'noindex, nofollow, noarchive, nosnippet, noimageindex', 'Production responses must keep robots protection.');
  assert(prodResponse.headers.get('WWW-Authenticate') === null, 'Production responses must not challenge with Basic Auth.');

  console.log('[cloudflare] site-lock validation passed.');
} finally {
  globalThis.fetch = originalFetch;
}
