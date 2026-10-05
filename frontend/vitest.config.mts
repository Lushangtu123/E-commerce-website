import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Component and store tests render real React into happy-dom. The older
 * node:test suite (tests/*.test.cjs) still runs alongside until it is migrated.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
  },
});
