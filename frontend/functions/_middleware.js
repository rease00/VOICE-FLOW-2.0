import { resolveRequestHost, shouldEnforcePrivateMode } from '../src/shared/runtime/siteAccess';

const BOT_UA_PATTERN =
  /(bot|crawler|spider|slurp|bingpreview|facebookexternalhit|discordbot|whatsapp|telegrambot|linkedinbot|semrush|ahrefs|mj12bot|dotbot|yandex)/i;

const PRIVATE_HEADER_VALUE = 'noindex, nofollow, noarchive, nosnippet, noimageindex';

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

const decoratePrivateHeaders = (response) => {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Robots-Tag', PRIVATE_HEADER_VALUE);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export async function onRequest(context) {
  const requestHost = resolveRequestHost(context.request);
  if (!shouldEnforcePrivateMode(context.env, requestHost)) {
    return context.next();
  }

  const configuredUser = String(context.env.SITE_LOCK_USER ?? '');
  const configuredPass = String(context.env.SITE_LOCK_PASS ?? '');
  if (!configuredUser || !configuredPass) {
    return unauthorizedResponse(
      503,
      'V FLOW AI private mode is enabled, but credentials are not configured yet.',
    );
  }

  const userAgent = context.request.headers.get('User-Agent') || '';
  const auth = parseBasicAuth(context.request.headers.get('Authorization'));
  const isAuthed = !!auth && auth.username === configuredUser && auth.password === configuredPass;
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

  const response = await context.next();
  return decoratePrivateHeaders(response);
}
