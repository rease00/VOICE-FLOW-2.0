import path from 'node:path';

const browserOnlyStubPath = path.join(process.cwd(), 'src/shared/runtime/browserOnlyStub.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  serverExternalPackages: [
    'sharp',
    'kokoro-js',
    '@huggingface/transformers',
    '@huggingface/jinja',
    'onnxruntime-web',
    'onnxruntime-node',
    'onnxruntime-common',
  ],
  webpack(config, { isServer }) {
    if (isServer) {
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        'kokoro-js': browserOnlyStubPath,
        '@huggingface/transformers': browserOnlyStubPath,
        'onnxruntime-node': browserOnlyStubPath,
        'onnxruntime-web': browserOnlyStubPath,
      };
    }

    return config;
  },
  outputFileTracingExcludes: {
    '/*': [
      'node_modules/kokoro-js/**/*',
      'node_modules/@huggingface/transformers/**/*',
      'node_modules/onnxruntime-web/**/*',
    ],
  },
  async headers() {
    if (process.env.NODE_ENV !== 'production') {
      return [];
    }

    const securityHeaders = [
      {
        key: 'Content-Security-Policy',
        value:
          "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://apis.google.com https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' blob: data: https:; media-src 'self' blob: data: https:; connect-src 'self' https: wss:; worker-src 'self' blob:; frame-src 'self' https://accounts.google.com https://*.google.com https://*.firebaseapp.com; manifest-src 'self'",
      },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Permissions-Policy',
        value: 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
      },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive, nosnippet, noimageindex' },
    ];

    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        source: '/kokoro-assets/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
