import { test, expect } from '@playwright/test';
import { pick } from './practice-helpers';

test.skip(!process.env.TILAWA_TEST_MEMORY_AUDIO || !process.env.TILAWA_TEST_AUDIO,
  'Use four clean 112:2 readings separated by five seconds, with the usual padding.');

test('real recitation completes visible readings and hidden recalls without another microphone permission', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = constraints => {
      document.documentElement.dataset.micStarts = String(Number(document.documentElement.dataset.micStarts ?? 0) + 1);
      return original(constraints);
    };
  });
  await page.goto('/'); await pick(page, 'Memorize', 112, 2);
  await page.getByRole('button', { name: 'Read aloud' }).click();
  await expect(page.locator('body')).toHaveClass('recording', { timeout: 60_000 });
  await expect(page.locator('#memory-meter [role="progressbar"]')).toHaveAttribute('aria-valuenow', '1', { timeout: 15_000 });
  await expect(page.locator('#memory-meter [role="progressbar"]')).toHaveAttribute('aria-valuenow', '2', { timeout: 15_000 });
  await expect(page.locator('#live-text')).toBeHidden({ timeout: 5000 });
  await expect(page.getByText('Today’s practice, complete')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-mic-starts', '1');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tilawa-hifz-v1')!));
  expect(saved.attempts.map((a: { outcome: string }) => a.outcome)).toEqual(['assisted', 'assisted', 'independent', 'independent']);
  expect(saved.cards['112:2-2'].stage).toBe(0);
  expect(errors).toEqual([]);
});
