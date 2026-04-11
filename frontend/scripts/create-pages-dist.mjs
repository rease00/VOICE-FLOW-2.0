#!/usr/bin/env node

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, '..');
const distDir = path.join(frontendRoot, 'dist');
const openNextDir = path.join(frontendRoot, '.open-next');
const openNextAssetsDir = path.join(frontendRoot, '.open-next', 'assets');
const publicDir = path.join(frontendRoot, 'public');

const pagesWorkerSource = `import app from './.open-next/worker.js';

const PUBLIC_HOST_SUFFIX = '.pages.dev';
const PUBLIC_HOSTS = new Set(['v-flow-ai.com', 'www.v-flow-ai.com']);
const BOT_UA_PATTERN =
  /(bot|crawler|spider|slurp|bingpreview|facebookexternalhit|discordbot|whatsapp|telegrambot|linkedinbot|semrush|ahrefs|mj12bot|dotbot|yandex)/i;
const PRIVATE_HEADER_VALUE = 'noindex, nofollow, noarchive, nosnippet, noimageindex';
const SITE_LOCK_COOKIE_NAME = 'vf_site_lock';
const SITE_LOCK_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

const readEnvBoolean = (value) => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const normalizeHost = (hostname) =>
  String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/:\\d+$/, '');

const normalizeHeaderHost = (value) => normalizeHost(String(value || '').split(',')[0] || '');

const resolveRequestHost = (request) => {
  const headerHost =
    normalizeHeaderHost(request.headers.get('x-forwarded-host')) ||
    normalizeHeaderHost(request.headers.get('host')) ||
    normalizeHeaderHost(request.headers.get('cf-connecting-host'));
  if (headerHost) return headerHost;

  try {
    return normalizeHost(new URL(request.url).hostname);
  } catch {
    return '';
  }
};

const isPublicDeploymentHost = (hostname) => {
  const safeHost = normalizeHost(hostname);
  return PUBLIC_HOSTS.has(safeHost) || safeHost.endsWith(PUBLIC_HOST_SUFFIX);
};

const shouldEnforcePrivateMode = (env, hostname) => {
  if (!readEnvBoolean(env?.VF_SITE_PRIVATE)) return false;
  if (readEnvBoolean(env?.VF_SITE_PRIVATE_FORCE_PUBLIC)) return true;
  return !isPublicDeploymentHost(hostname);
};

const unauthorizedResponse = (status, message) =>
  new Response(message, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Robots-Tag': PRIVATE_HEADER_VALUE,
      'WWW-Authenticate': 'Basic realm="V FLOW AI Private", charset="UTF-8"',
    },
  });

const parseBasicAuth = (authorizationHeader) => {
  if (!authorizationHeader || !authorizationHeader.startsWith('Basic ')) return null;
  try {
    const decoded = atob(authorizationHeader.slice(6));
    const delimiter = decoded.indexOf(':');
    if (delimiter < 0) return null;
    return {
      username: decoded.slice(0, delimiter),
      password: decoded.slice(delimiter + 1),
    };
  } catch {
    return null;
  }
};

const normalizeCredential = (value) => String(value ?? '').replace(/[\\r\\n]+$/g, '');

const readCookie = (request, name) => {
  const cookieHeader = request.headers.get('Cookie') || '';
  for (const cookieEntry of cookieHeader.split(';')) {
    const trimmed = cookieEntry.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex < 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (key !== name) continue;
    return decodeURIComponent(trimmed.slice(separatorIndex + 1).trim());
  }
  return '';
};

const base64UrlFromBytes = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\\+/g, '-')
    .replace(/\\//g, '_')
    .replace(/=+$/g, '');

const buildSiteLockToken = async (username, password, host) => {
  const payload = \`\${normalizeCredential(username)}\\n\${normalizeCredential(password)}\\n\${String(host || '')
    .trim()
    .toLowerCase()}\`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return base64UrlFromBytes(new Uint8Array(digest));
};

const decoratePrivateHeaders = (response, siteLockToken) => {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Robots-Tag', PRIVATE_HEADER_VALUE);
  if (siteLockToken) {
    headers.append(
      'Set-Cookie',
      \`\${SITE_LOCK_COOKIE_NAME}=\${encodeURIComponent(siteLockToken)}; Path=/; Max-Age=\${SITE_LOCK_COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax\`,
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const isHiddenRuntimePath = (pathname) =>
  pathname === '/_worker.js' || pathname.startsWith('/.open-next/');

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (isHiddenRuntimePath(url.pathname)) {
      return new Response('Not found', {
        status: 404,
        headers: {
          'Cache-Control': 'no-store',
        },
      });
    }

    const requestHost = resolveRequestHost(request);
    if (!shouldEnforcePrivateMode(env, requestHost)) {
      return app.fetch(request, env, ctx);
    }

    const configuredUser = normalizeCredential(env?.SITE_LOCK_USER);
    const configuredPass = normalizeCredential(env?.SITE_LOCK_PASS);
    if (!configuredUser || !configuredPass) {
      return unauthorizedResponse(
        503,
        'V FLOW AI private mode is enabled, but credentials are not configured yet.',
      );
    }

    const userAgent = request.headers.get('User-Agent') || '';
    const expectedSiteLockToken = await buildSiteLockToken(configuredUser, configuredPass, requestHost);
    const cookieToken = readCookie(request, SITE_LOCK_COOKIE_NAME);
    let isAuthed = cookieToken === expectedSiteLockToken;
    if (!isAuthed) {
      const auth = parseBasicAuth(request.headers.get('Authorization'));
      isAuthed =
        !!auth &&
        normalizeCredential(auth.username) === configuredUser &&
        normalizeCredential(auth.password) === configuredPass;
    }
    if (!isAuthed) {
      if (BOT_UA_PATTERN.test(userAgent)) {
        return new Response('Forbidden', {
          status: 403,
          headers: {
            'Cache-Control': 'no-store',
            'X-Robots-Tag': PRIVATE_HEADER_VALUE,
          },
        });
      }
      return unauthorizedResponse(401, 'Authentication required.');
    }

    const response = await app.fetch(request, env, ctx);
    const shouldSetSiteLockCookie = cookieToken !== expectedSiteLockToken;
    return decoratePrivateHeaders(response, shouldSetSiteLockCookie ? expectedSiteLockToken : '');
  },
};
`;

const main = async () => {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  try {
    await cp(openNextAssetsDir, distDir, {
      recursive: true,
      force: true,
      preserveTimestamps: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to copy OpenNext assets into dist: ${message}`);
  }

  try {
    await cp(publicDir, distDir, {
      recursive: true,
      force: true,
      preserveTimestamps: true,
    });
  } catch {
    // The public directory is optional for the Pages fallback bundle.
  }

  try {
    await cp(openNextDir, path.join(distDir, '.open-next'), {
      recursive: true,
      force: true,
      preserveTimestamps: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to copy the OpenNext runtime into dist: ${message}`);
  }

  await writeFile(path.join(distDir, '_worker.js'), pagesWorkerSource, 'utf8');

  const indexHtml = path.join(distDir, 'index.html');
  const fallbackHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>V FLOW AI</title>
  </head>
  <body>
    <noscript>V FLOW AI is loading.</noscript>
  </body>
</html>
`;
  await writeFile(indexHtml, fallbackHtml, 'utf8');
  console.log('[pages:dist] Prepared Cloudflare Pages advanced-mode output in dist/.');
};

main().catch((error) => {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  console.error('[pages:dist] Failed to prepare Cloudflare Pages output.');
  console.error(detail);
  process.exit(1);
});
