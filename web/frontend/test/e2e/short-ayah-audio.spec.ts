import { startSavedRevision } from './practice-helpers';
import { test, expect } from '@playwright/test';

test.skip(!process.env.TILAWA_TEST_SHORT_AUDIO || !process.env.TILAWA_TEST_AUDIO,
  'Set TILAWA_TEST_AUDIO to a padded 2:1 recording and TILAWA_TEST_SHORT_AUDIO=1.');

test('Alif Lam Mim is displayed and the single-ayah attempt finishes after a pause', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tilawa-hifz-preferences-v2', JSON.stringify({
    passage: { surah: 2, start: 1, end: 1 }, review: true, oneAtATime: false, pause: null,
  })));
  await page.goto('/');
  await startSavedRevision(page);
  await expect(page.locator('body')).toHaveClass('recording', { timeout: 60_000 });
  if (process.env.TILAWA_TEST_SHORT_AUDIO === 'basmala') {
    await expect(page.locator('#live-label')).toHaveText('Bismillah', { timeout: 15_000 });
    await expect(page.locator('#live-mismatch')).toBeHidden();
    await expect(page.locator('#live-text')).toBeEmpty();
    await expect(page.locator('#live-label')).toHaveText('Bismillah heard', { timeout: 15_000 });
  }
  await expect(page.locator('#live-text .heard')).toHaveText('الٓمٓ', { timeout: 20_000 });
  await expect(page.locator('#live-mismatch')).toBeHidden();
  await page.screenshot({ path: 'test-results/alif-lam-mim-recognized.png', fullPage: true });
  await expect(page.getByRole('button', { name: 'Remembered', exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Remembered', exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tilawa-hifz-v1')!));
  expect(saved.attempts[0]).toMatchObject({ heard: ['2:1'], issues: [], hints: [], textRevealed: false });
});
