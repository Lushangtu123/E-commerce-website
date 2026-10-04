// Vercel has no source tree scanner at runtime: bundle the spec generated during build.
export const swaggerSpec = process.env.NODE_ENV === 'production'
  ? require('../openapi.json')
  : require('./swagger').swaggerSpec;
