const BOT_UA_PATTERN =
  /(bot|crawler|spider|slurp|bingpreview|facebookexternalhit|discordbot|whatsapp|telegrambot|linkedinbot|semrush|ahrefs|mj12bot|dotbot|yandex)/i;

const PRIVATE_HEADER_VALUE = 'noindex, nofollow, noarchive, nosnippet, noimageindex';
const DEFAULT_PROTECTED_HOSTS = ['v-flow-ai.com', 'www.v-flow-ai.com'];
const textEncoder = new TextEncoder();
const SITE_LOCK_COOKIE_NAME = 'vf_site_lock';
const SITE_LOCK_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

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

const normalizeHostname = (value) => String(value || '').trim().toLowerCase().replace(/\.+$/, '');

const getProtectedHosts = (env) => {
  const configuredHosts = String(env.SITE_LOCK_PROTECTED_HOSTS ?? '')
    .split(',')
    .map(normalizeHostname)
    .filter(Boolean);
  if (configuredHosts.length > 0) {
    return new Set(configuredHosts);
  }
  return new Set(DEFAULT_PROTECTED_HOSTS);
};

const isProtectedRequest = (request, env) =>
  getProtectedHosts(env).has(normalizeHostname(new URL(request.url).hostname));

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

const normalizeCredential = (value) => String(value ?? '').replace(/[\r\n]+$/g, '');

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
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const buildSiteLockToken = async (username, password, host) => {
  const payload = `${normalizeCredential(username)}\n${normalizeCredential(password)}\n${normalizeHostname(host)}`;
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(payload));
  return base64UrlFromBytes(new Uint8Array(digest));
};

const decoratePrivateHeaders = (response, siteLockToken) => {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Robots-Tag', PRIVATE_HEADER_VALUE);
  headers.set('X-V-Flow-AI-Lock', 'basic-auth');
  if (siteLockToken) {
    headers.append(
      'Set-Cookie',
      `${SITE_LOCK_COOKIE_NAME}=${encodeURIComponent(siteLockToken)}; Path=/; Max-Age=${SITE_LOCK_COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const timingSafeEqual = (left, right) => {
  const leftBytes = textEncoder.encode(String(left ?? ''));
  const rightBytes = textEncoder.encode(String(right ?? ''));
  const length = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length === rightBytes.length ? 0 : 1;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
};

export default {
  async fetch(request, env) {
    if (!isProtectedRequest(request, env)) {
      return fetch(request);
    }

    const requestHost = normalizeHostname(new URL(request.url).hostname);
    const configuredUser = normalizeCredential(env.SITE_LOCK_USER);
    const configuredPass = normalizeCredential(env.SITE_LOCK_PASS);
    if (!configuredUser || !configuredPass) {
      return unauthorizedResponse(
        503,
        'V FLOW AI private mode is enabled, but credentials are not configured yet.',
      );
    }

    const userAgent = request.headers.get('User-Agent') || '';
    const expectedSiteLockToken = await buildSiteLockToken(configuredUser, configuredPass, requestHost);
    const cookieToken = readCookie(request, SITE_LOCK_COOKIE_NAME);
    let isAuthed = timingSafeEqual(cookieToken, expectedSiteLockToken);
    if (!isAuthed) {
      const auth = parseBasicAuth(request.headers.get('Authorization'));
      isAuthed =
        !!auth &&
        timingSafeEqual(normalizeCredential(auth.username), configuredUser) &&
        timingSafeEqual(normalizeCredential(auth.password), configuredPass);
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

    const response = await fetch(request);
    const shouldSetSiteLockCookie = !timingSafeEqual(cookieToken, expectedSiteLockToken);
    return decoratePrivateHeaders(response, shouldSetSiteLockCookie ? expectedSiteLockToken : '');
  },
};
