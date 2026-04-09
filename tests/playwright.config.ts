import { defineConfig, devices } from '@playwright/test';

/**
 * Browser E2E against the real Docker Compose stack:
 * browser → web (nginx) + api-gateway → project-service → PostgreSQL. Nothing is mocked.
 * Start it first with `docker compose up --build -d --wait`.
 */
export default defineConfig({
  testDir: 'e2e',
  // The outage spec stops shared containers, so specs must not overlap.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env['WEB_URL'] ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
});
