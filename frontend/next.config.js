const { buildContentSecurityPolicy, SECRET_URL_PATHS } = require('./csp');

/**
 * Baseline security headers for every response. The embedded API (pages/api)
 * sets its own via helmet; Next applies these first, so the API's values win.
 * The CSP (csp.js) is enforced with inline scripts allowed, plus a report-only trial without them.
 */
const csp = buildContentSecurityPolicy({
  dev: process.env.NODE_ENV === 'development',
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
  sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
});
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Content-Security-Policy', value: csp.enforced },
  { key: 'Content-Security-Policy-Report-Only', value: csp.reportOnly },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
];

/** @type {import('next').NextConfig} */
const embeddedApi = process.env.VERCEL === '1' || process.env.ECOMMERCE_SERVERLESS_API === 'true';
const nextConfig = {
  env: {
    ECOMMERCE_SERVERLESS_API: embeddedApi ? 'true' : 'false',
    // Forward only public deployment metadata; raw Vercel vars are server-only.
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    NEXT_PUBLIC_SENTRY_RELEASE: process.env.VERCEL_GIT_COMMIT_SHA || '',
  },
  outputFileTracingRoot: embeddedApi ? require('path').join(__dirname, '..') : __dirname,
  ...(embeddedApi ? {
    experimental: { externalDir: true },
  } : {}),
  // The Docker image sets NEXT_OUTPUT=standalone to ship only the traced server files; Vercel builds its own output.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // A later rule overrides the same header: keep the reset token out of CSP reports.
      ...SECRET_URL_PATHS.map(source => ({ source, headers: [{ key: 'Content-Security-Policy-Report-Only', value: csp.reportOnlyUnreported }] })),
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
      },
    ],
  },
}

module.exports = nextConfig
