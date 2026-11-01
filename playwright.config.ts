import { defineConfig } from '@playwright/test';
export default defineConfig({
  webServer:
    process.env.RUN_REPLAY_E2E === 'true'
      ? {
          command: 'pnpm --filter @lab/web preview',
          url: process.env.BASE_URL ?? 'http://127.0.0.1:4173',
          reuseExistingServer: !process.env.CI,
          timeout: 60000,
        }
      : undefined,
  testDir: './e2e',
  timeout: 180000,
  workers: 1,
  use: { baseURL: process.env.BASE_URL ?? 'http://localhost:8088', trace: 'retain-on-failure' },
  reporter: [['list'], ['html', { open: 'never' }]],
});
