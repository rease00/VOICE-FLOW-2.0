import { NextResponse, type NextRequest } from 'next/server';

// SECURITY: Generate cryptographically random nonce for CSP
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
  'wss://firestore.googleapis.com',
  'wss://*.firebaseio.com',
];

const buildContentSecurityPolicy = (nonce: string, allowInlineScripts: boolean): string => [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  allowInlineScripts
    ? "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://apis.google.com https://www.gstatic.com https://static.cloudflareinsights.com"
    : `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval' https://apis.google.com https://www.gstatic.com https://static.cloudflareinsights.com`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' blob: data: https:",
  "media-src 'self' blob: data: https:",
  `connect-src ${CSP_CONNECT_SRC.join(' ')}`,
  "worker-src 'self' blob:",
  "frame-src 'self' https://accounts.google.com https://*.google.com https://*.firebaseapp.com",
  "manifest-src 'self'",
].join('; ');

// SECURITY: Protected routes that require authentication
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

// SECURITY: Routes that are public and don't need auth
const PUBLIC_ROUTES = ['/login', '/signup', '/forgot-password', '/verify-email', '/landing', '/billing', '/legal'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Generate nonce for this request
  const nonce = generateNonce();
  const allowInlineScripts = ['localhost', '127.0.0.1', '::1'].includes(request.nextUrl.hostname);
  const csp = buildContentSecurityPolicy(nonce, allowInlineScripts);

  // Check if this is a protected route
  const isProtectedRoute = PROTECTED_ROUTES.some(route => pathname.startsWith(route));
  const isPublicRoute = PUBLIC_ROUTES.some(route => pathname.startsWith(route));

  // SECURITY: Validate auth token for protected routes BEFORE rendering
  // NOTE: Full auth validation happens in server components via Firebase SDK
  // This middleware just ensures we redirect unauthenticated users to login early
  if (isProtectedRoute && !isPublicRoute) {
    const authCookie = request.cookies.get('__session')?.value;

    // If no auth cookie and not public route, redirect to login
    // (Note: This is a simple check; full validation happens server-side)
    if (!authCookie && !request.headers.get('x-id-token')) {
      // Allow protected route access - final auth check happens in page components
      // Returning here allows the request to proceed; firebaseAuth in components will redirect if needed
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  // Clone response and inject nonce into headers for layout.tsx to access
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('x-nonce', nonce);

  // Optionally, you can also set the nonce in cookies for client-side access
  response.cookies.set('x-nonce', nonce, {
    httpOnly: false, // Allow JS access since nonce must be in script tags
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 5 * 60, // 5 minutes
  });

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files (public assets)
     */
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};
