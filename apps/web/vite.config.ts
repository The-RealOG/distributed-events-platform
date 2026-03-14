import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    testTimeout: 15_000,
    env: { VITE_DEV_LOGIN_ENABLED: 'true', VITE_API_BASE_URL: 'http://gateway.test/api' },
  },
});
