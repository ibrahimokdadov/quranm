import { startSavedRevision } from './practice-helpers';
import { test, expect } from '@playwright/test';

test.skip(!process.env.TILAWA_TEST_RECOVERY_AUDIO || !process.env.TILAWA_TEST_AUDIO,
  'Set TILAWA_TEST_AUDIO to padded 1:2 → 112:1 audio and TILAWA_TEST_RECOVERY_AUDIO=1.');

test('real audio turns wrong words red and resumes the selected ayah in the same recording', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('tilawa-hifz-preferences-v2', JSON.stringify({
      passage: { surah: 112, start: 1, end: 4 }, review: true, oneAtATime: false, pause: null,
    }));
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message: { type: string }, transfer: Transferable[] = []) {
        if (message.type === 'reset' || message.type === 'stop') {
          document.documentElement.dataset.workerCommands = `${document.documentElement.dataset.workerCommands ?? ''},${message.type}`;
        }
        super.postMessage(message, transfer);
      }
    };
  });
  await page.route('https://everyayah.com/**', route => route.abort());
  await page.goto('/');
  await startSavedRevision(page);
  await expect(page.locator('body')).toHaveClass('recording', { timeout: 60_000 });
  await expect(page.locator('#orb')).toHaveClass('orb mismatch', { timeout: 20_000 });
  await expect(page.locator('#mismatch-reference')).toContainText('112:1');
  await expect(page.locator('#live-text .off-track')).toContainText('ٱلْحَمْدُ');
  await expect(page.locator('#live-text .off-track')).toHaveCSS('color', 'rgb(163, 61, 53)');
  await page.screenshot({ path: 'test-results/actual-inline-mismatch.png', fullPage: true });
  await expect(page.locator('#live-mismatch')).toBeHidden({ timeout: 25_000 });
  await expect(page.locator('#live-text [data-ayah="1"]')).toContainText('قُلْ');
  await expect(page.locator('#live-text .off-track')).toHaveCount(0);
  await expect(page.locator('body')).toHaveClass('recording');
  await expect(page.locator('html')).toHaveAttribute('data-worker-commands', /^,reset(,reset)*$/);
  expect(await page.evaluate(() => localStorage.getItem('tilawa-hifz-v1'))).toBeNull();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByText('Check your recall', { exact: true })).toBeVisible({ timeout: 30_000 });
});
