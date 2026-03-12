import { defineConfig } from 'vitest/config';

// Gateway tests run against real in-process upstream servers; no Docker needed.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
