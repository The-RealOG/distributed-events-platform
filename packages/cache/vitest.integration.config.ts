import { defineConfig } from 'vitest/config';

// Real Redis-compatible server (Valkey, Testcontainers).
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
