import { defineConfig } from 'vitest/config';

// Real S3-compatible storage (MinIO, Testcontainers).
export default defineConfig({
  test: { include: ['test/**/*.int.test.ts'], testTimeout: 60_000, hookTimeout: 180_000 },
});
