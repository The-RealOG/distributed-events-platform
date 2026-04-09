import { defineConfig } from 'vitest/config';

// Cross-service tests: real built service processes + Testcontainers PostgreSQL.
export default defineConfig({
  test: {
    include: ['integration/**/*.int.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
