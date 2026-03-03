import { defineConfig } from 'vitest/config';

// Runs against a real PostgreSQL started by Testcontainers (requires Docker).
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
