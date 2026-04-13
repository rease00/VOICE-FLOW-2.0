import { NextResponse, type NextRequest } from 'next/server';

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

const CSP_CONNECT_SRC = [
  "'self'",
  'https://www.googleapis.com',
  'https://docs.googleapis.com',
  'https://identitytoolkit.googleapis.com',
  'https://securetoken.googleapis.com',
  'https://firestore.googleapis.com',
  'https://*.firebaseio.com',
  'https://*.firebaseapp.com',
  'https://accounts.google.com',
  'https://www.google.com',
  'https://api.stripe.com',
  'https://*.sentry.io',
  'https://cloudflareinsights.com',
  'https://static.cloudflareinsights.com',
  'https://generativelanguage.googleapis.com',
  'wss://firestore.googleapis.com',
  'wss://*.firebaseio.com',
];

const LOCAL_DEV_CONNECT_SRC = [
  'http://127.0.0.1:7800',
  'http://localhost:7800',
  'https://*.ngrok-free.app',
  'https://*.ngrok.io',
];

const PROTECTED_ROUTES = [
  '/app/admin',
  '/app/studio',
  '/app/billing',
  '/app/settings',
  '/app/workspace',
  '/app/voices',
  '/app/writing',
  '/app/runs',
  '/app/profile',
  '/app/onboarding',
  '/app/user-id-setup',
];

const LOGIN_ROUTE = '/app/login';

export const buildContentSecurityPolicy = (
  nonce: string,
  allowInlineScripts: boolean,
  extraConnectSrc: readonly string[] = [],
): string => [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  allowInlineScripts
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://apis.google.com https://www.gstatic.com https://static.cloudflareinsights.com"
    : `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval' https://apis.google.com https://www.gstatic.com https://static.cloudflareinsights.com`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' blob: data: https:",
  "media-src 'self' blob: data: https:",
  `connect-src ${[...CSP_CONNECT_SRC, ...extraConnectSrc].join(' ')}`,
  "worker-src 'self' blob:",
  "frame-src 'self' https://accounts.google.com https://*.google.com https://*.firebaseapp.com",
  "manifest-src 'self'",
].join('; ');

const isProtectedRoute = (pathname: string): boolean => PROTECTED_ROUTES.some((route) => pathname.startsWith(route));

const applySecurityHeaders = (response: NextResponse, nonce: string, csp: string): NextResponse => {
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('x-nonce', nonce);
  response.cookies.set('x-nonce', nonce, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 5 * 60,
  });
  return response;
};

const buildUnauthorizedRedirect = (request: NextRequest): NextResponse => {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = LOGIN_ROUTE;
  loginUrl.search = '';
  loginUrl.searchParams.set('mode', 'login');
  loginUrl.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
};

export function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const allowInlineScripts = ['localhost', '127.0.0.1', '::1'].includes(request.nextUrl.hostname);
  const csp = buildContentSecurityPolicy(
    nonce,
    allowInlineScripts,
    allowInlineScripts ? LOCAL_DEV_CONNECT_SRC : [],
  );

  if (isProtectedRoute(request.nextUrl.pathname)) {
    const authCookie = request.cookies.get('__session')?.value;
    const idTokenHeader = request.headers.get('x-id-token');
    if (!authCookie && !idTokenHeader) {
      return applySecurityHeaders(buildUnauthorizedRedirect(request), nonce, csp);
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  return applySecurityHeaders(NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  }), nonce, csp);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};
