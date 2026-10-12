/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
  // Coverage (`npm run test:coverage`) counts every source file, not only the ones tests load.
  collectCoverageFrom: ['src/**/*.ts', '!src/__tests__/**'],
  coverageReporters: ['text-summary'],
  // Floors measured with MySQL and Redis available, as in CI (integration suites skip without them).
  // Raise them when coverage improves; never lower them.
  coverageThreshold: {
    global: { statements: 83, branches: 82, functions: 82, lines: 85 },
  },
};
