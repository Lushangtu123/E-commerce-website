import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      // Product images are arbitrary admin-entered URLs, so next/image host allowlists do not fit.
      '@next/next/no-img-element': 'off',
      // React Compiler rules added by react-hooks v7 (eslint-config-next 16). They flag deliberate
      // session/stale-request guards (refs written during render, state reset in effects).
      // The compiler is not enabled; tracked as warnings until those pages are reworked.
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
  // The node:test harness under tests/ is CommonJS and builds its own module scope.
  globalIgnores(['.next/**', 'out/**', 'test-results/**', 'next-env.d.ts', '**/*.cjs']),
]);
