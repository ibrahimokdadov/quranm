import { defineConfig, devices } from '@playwright/test';
const port = process.env.TILAWA_TEST_PORT ?? '5174';
const audio = process.env.TILAWA_TEST_AUDIO;
export default defineConfig({
  testDir: './test/e2e',
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: 'chrome',
    permissions: ['microphone'],
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...(audio ? [`--use-file-for-fake-audio-capture=${audio}`] : [])] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium' }, testIgnore: '**/*audio.spec.ts' },
  ],
  webServer: { command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 30_000 },
});
