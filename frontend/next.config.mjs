/** @type {import('next').NextConfig} */
const configuredDistDir = String(process.env.NEXT_DIST_DIR || '').trim();
const sanitizedDistDir = configuredDistDir && !configuredDistDir.includes('..')
  ? configuredDistDir
  : '.next';

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
    const securityHeaders = [
      {
        key: 'Content-Security-Policy',
        value:
          "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://apis.google.com https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' blob: data: https:; media-src 'self' blob: data: https:; connect-src 'self' https://www.googleapis.com https://docs.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com https://accounts.google.com https://www.google.com https://api.stripe.com https://*.sentry.io wss://firestore.googleapis.com wss://*.firebaseio.com; worker-src 'self' blob:; frame-src 'self' https://accounts.google.com https://*.google.com https://*.firebaseapp.com; manifest-src 'self'",
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
