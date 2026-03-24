import { defineConfig } from 'vitest/config';

// Against a real Kafka broker (Testcontainers). Files run one at a time: they share the
// broker, and consumer-group rebalances are sensitive to CPU starvation.
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 240_000,
  },
});
