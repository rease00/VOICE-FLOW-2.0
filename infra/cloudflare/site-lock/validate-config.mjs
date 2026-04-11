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

if (typeof globalThis.atob !== 'function') {
  globalThis.atob = (value) => Buffer.from(value, 'base64').toString('binary');
}

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

  const callWorker = (url, env = {}, headers = {}) =>
    worker.fetch(
      new Request(url, {
        headers,
      }),
      env
    );

  const basicAuth = (username, password) =>
    `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;

  const localResponse = await callWorker('https://localhost:3000/', {});
  assert(localResponse.status === 200, 'Local/dev requests must bypass site-lock when the hostname is not protected.');
  assert(localResponse.headers.get('X-V-Flow-AI-Lock') === null, 'Local/dev bypass must not decorate private headers.');

  const prodWithoutSecrets = await callWorker('https://v-flow-ai.com/', {
    SITE_LOCK_PROTECTED_HOSTS: 'v-flow-ai.com,www.v-flow-ai.com',
  });
  assert(prodWithoutSecrets.status === 503, 'Protected production hosts must fail closed when secrets are missing.');

  const botBlocked = await callWorker(
    'https://www.v-flow-ai.com/',
    {
      SITE_LOCK_PROTECTED_HOSTS: 'v-flow-ai.com,www.v-flow-ai.com',
      SITE_LOCK_USER: 'admin',
      SITE_LOCK_PASS: 'secret',
    },
    {
      'User-Agent': 'DiscordBot/2.0',
    }
  );
  assert(botBlocked.status === 403, 'Unauthenticated bots must be rejected on protected hosts.');

  const wrongAuth = await callWorker(
    'https://v-flow-ai.com/',
    {
      SITE_LOCK_PROTECTED_HOSTS: 'v-flow-ai.com,www.v-flow-ai.com',
      SITE_LOCK_USER: 'admin',
      SITE_LOCK_PASS: 'secret',
    },
    {
      Authorization: basicAuth('admin', 'wrong'),
    }
  );
  assert(wrongAuth.status === 401, 'Protected hosts must challenge invalid credentials.');

  const correctAuth = await callWorker(
    'https://v-flow-ai.com/',
    {
      SITE_LOCK_PROTECTED_HOSTS: 'v-flow-ai.com,www.v-flow-ai.com',
      SITE_LOCK_USER: 'admin',
      SITE_LOCK_PASS: 'secret',
    },
    {
      Authorization: basicAuth('admin', 'secret'),
    }
  );
  assert(correctAuth.status === 200, 'Protected hosts must allow valid credentials.');
  assert(correctAuth.headers.get('X-V-Flow-AI-Lock') === 'basic-auth', 'Protected responses must keep the private header decoration.');
  assert(correctAuth.headers.get('Cache-Control') === 'no-store', 'Protected responses must remain non-cacheable.');

  console.log('[cloudflare] site-lock validation passed.');
} finally {
  globalThis.fetch = originalFetch;
}
