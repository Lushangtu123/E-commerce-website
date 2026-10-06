/**
 * Baseline security headers for every response. The embedded API (pages/api)
 * sets its own via helmet; Next applies these first, so the API's values win.
 * No script-src CSP yet: Next's inline scripts and Vercel Analytics would need nonces.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
];

/** @type {import('next').NextConfig} */
const embeddedApi = process.env.VERCEL === '1' || process.env.ECOMMERCE_SERVERLESS_API === 'true';
const nextConfig = {
  env: { ECOMMERCE_SERVERLESS_API: embeddedApi ? 'true' : 'false' },
  outputFileTracingRoot: embeddedApi ? require('path').join(__dirname, '..') : __dirname,
  ...(embeddedApi ? {
    experimental: { externalDir: true },
  } : {}),
  // The Docker image sets NEXT_OUTPUT=standalone to ship only the traced server files; Vercel builds its own output.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' } : {}),
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
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
