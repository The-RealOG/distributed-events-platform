import { defineConfig } from 'vitest/config';

// Real PostgreSQL + real Kafka (Testcontainers). Files run one at a time: some pause the shared
// database container or stop a broker.
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 240_000,
  },
});
