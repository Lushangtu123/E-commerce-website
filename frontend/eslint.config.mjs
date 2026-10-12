import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // A disable comment must still suppress something, so a fixed warning cannot leave a stale excuse behind.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      // Every `any` has been replaced by API types; keep it that way.
      '@typescript-eslint/no-explicit-any': 'error',
      // Product images are arbitrary admin-entered URLs, so next/image host allowlists do not fit.
      '@next/next/no-img-element': 'off',
      // React Compiler rules added by react-hooks v7 (eslint-config-next 16). They flag deliberate
      // session/stale-request guards (refs written during render, state reset in effects).
      // The compiler is not enabled; tracked as warnings until those pages are reworked. Deliberate cases are
      // fixed or disabled line by line with an `-- reason`, page by page, and the cap in package.json goes down.
      // `npm run lint` caps warnings at the current count (package.json --max-warnings), so new
      // code cannot add more; lower the cap when a page is reworked.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
  {
    files: ['**/*.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  // The Playwright browser regression (tests/e2e/commerce.cjs) is a CommonJS script run by plain Node.
  globalIgnores(['.next/**', 'out/**', 'test-results/**', 'next-env.d.ts', '**/*.cjs']),
]);
