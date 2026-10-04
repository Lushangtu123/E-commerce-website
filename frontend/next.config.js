/** @type {import('next').NextConfig} */
const embeddedApi = process.env.VERCEL === '1' || process.env.ECOMMERCE_SERVERLESS_API === 'true';
const nextConfig = {
  env: { ECOMMERCE_SERVERLESS_API: embeddedApi ? 'true' : 'false' },
  ...(embeddedApi ? { experimental: {
    externalDir: true,
    outputFileTracingRoot: require('path').join(__dirname, '..'),
  } } : {}),
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
      },
    ],
  },
}

module.exports = nextConfig
