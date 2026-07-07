import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Optional: develop the UI against a deployed backend (e.g. the AWS dev environment) with
    // VITE_API_BASE_URL=/api and VITE_DEV_PROXY_TARGET=https://<cloudfront-domain>. Same-origin,
    // so no CORS changes on the gateway.
    ...(process.env['VITE_DEV_PROXY_TARGET']
      ? { proxy: { '/api': { target: process.env['VITE_DEV_PROXY_TARGET'], changeOrigin: true } } }
      : {}),
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    testTimeout: 15_000,
    env: { VITE_DEV_LOGIN_ENABLED: 'true', VITE_API_BASE_URL: 'http://gateway.test/api' },
  },
});
