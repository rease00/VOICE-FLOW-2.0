/** @type {import('next').NextConfig} */
const configuredDistDir = String(process.env.NEXT_DIST_DIR || '').trim();
const sanitizedDistDir = configuredDistDir && !configuredDistDir.includes('..')
  ? configuredDistDir
  : '.next';

const BASE_CONNECT_SRC = [
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
  'wss://firestore.googleapis.com',
  'wss://*.firebaseio.com',
];

const LOCAL_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const normalizeLoopbackOrigin = (candidate) => {
  const token = String(candidate || '').trim();
  if (!token) return null;
  try {
    const parsed = new URL(token);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const hostname = String(parsed.hostname || '').trim().toLowerCase();
    if (!LOCAL_LOOPBACK_HOSTS.has(hostname)) return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
};

const collectLoopbackConnectSources = () => {
  const sources = new Set();
  const configuredBaseUrls = [
    process.env.NEXT_PUBLIC_API_BASE_URL,
    process.env.VITE_API_BASE_URL,
  ];

  for (const candidate of configuredBaseUrls) {
    const normalized = normalizeLoopbackOrigin(candidate);
    if (!normalized) continue;
    sources.add(normalized);

    try {
      const parsed = new URL(normalized);
      const loopbackVariants = parsed.hostname === 'localhost'
        ? ['127.0.0.1']
        : parsed.hostname === '127.0.0.1'
          ? ['localhost']
          : [];
      for (const hostname of loopbackVariants) {
        sources.add(`${parsed.protocol}//${hostname}${parsed.port ? `:${parsed.port}` : ''}`);
      }
    } catch {
      // Ignore malformed loopback URLs and keep the base source only.
    }
  }

  return Array.from(sources);
};

const nextConfig = {
  reactStrictMode: true,
  distDir: sanitizedDistDir,
  output: 'standalone',
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  serverExternalPackages: ['sharp'],
  outputFileTracingExcludes: {
    '/*': [],
  },
  async headers() {
    if (process.env.NODE_ENV !== 'production') {
      return [];
    }

    const privateRobotsValue = 'noindex, nofollow, noarchive, nosnippet, noimageindex';
    const connectSrc = [...BASE_CONNECT_SRC, ...collectLoopbackConnectSources()];
    const securityHeaders = [
      {
        key: 'Content-Security-Policy',
        value:
          `default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://apis.google.com https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' blob: data: https:; media-src 'self' blob: data: https:; connect-src ${connectSrc.join(' ')}; worker-src 'self' blob:; frame-src 'self' https://accounts.google.com https://*.google.com https://*.firebaseapp.com; manifest-src 'self'`,
      },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Permissions-Policy',
        value: 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
      },
    ];
    const privateRobotsHeaders = [{ key: 'X-Robots-Tag', value: privateRobotsValue }];

    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        source: '/app/:path*',
        headers: privateRobotsHeaders,
      },
      {
        source: '/reader/:path*',
        headers: privateRobotsHeaders,
      },
      {
        source: '/api/:path*',
        headers: privateRobotsHeaders,
      },
    ];
  },
};

export default nextConfig;
