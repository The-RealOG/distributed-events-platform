import { defineConfig } from 'vitest/config';

// Fast static checks over the repository; no services needed.
export default defineConfig({
  // Generous: a synchronous scan of a cold filesystem on a loaded machine can take a while.
  test: { include: ['architecture/**/*.test.ts'], testTimeout: 60_000 },
});
