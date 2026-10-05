/** @type {import('next').NextConfig} */
const embeddedApi = process.env.VERCEL === '1' || process.env.ECOMMERCE_SERVERLESS_API === 'true';
const nextConfig = {
  env: { ECOMMERCE_SERVERLESS_API: embeddedApi ? 'true' : 'false' },
  outputFileTracingRoot: embeddedApi ? require('path').join(__dirname, '..') : __dirname,
  ...(embeddedApi ? {
    experimental: { externalDir: true },
  } : {}),
  reactStrictMode: true,
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
