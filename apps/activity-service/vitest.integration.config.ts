import { defineConfig } from 'vitest/config';

// Real PostgreSQL + real Kafka (Testcontainers), one file at a time.
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 240_000,
  },
});
