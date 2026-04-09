import { defineConfig } from 'vitest/config';

// Against the running Docker Compose stack (docker compose up --build -d --wait). These tests
// stop and start Compose services, so they run one at a time.
export default defineConfig({
  test: {
    include: ['stack/**/*.stack.test.ts'],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 120_000,
  },
});
