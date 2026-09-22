import { startSavedRevision } from './practice-helpers';
import { test, expect } from '@playwright/test';

test.skip(!process.env.TILAWA_TEST_SHORT_RECOVERY_AUDIO || !process.env.TILAWA_TEST_AUDIO,
  'Use padded 112:1 → 12 seconds of silence → 112:2 audio with TILAWA_TEST_SHORT_RECOVERY_AUDIO=1.');

test('hears 112:2 after red wrong-ayah feedback and a long pause without another tap', async ({ page }) => {
  // An unavailable cue must also return automatically to the existing mic.
  await page.route('https://everyayah.com/**', route => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('tilawa-hifz-preferences-v2', JSON.stringify({
      passage: { surah: 112, start: 2, end: 3 }, review: true, oneAtATime: false, pause: null,
    }));
    const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = constraints => {
      document.documentElement.dataset.micStarts = String(Number(document.documentElement.dataset.micStarts ?? 0) + 1);
      return getMedia(constraints);
    };
  });
  await page.goto('/');
  await startSavedRevision(page);
  await expect(page.locator('body')).toHaveClass('recording', { timeout: 60_000 });
  await expect(page.locator('#mismatch-label')).toHaveText('Try this ayah again', { timeout: 18_000 });
  await expect(page.locator('#orb')).toHaveClass(/mismatch/);
  await expect(page.locator('#mismatch-reference')).toContainText('112:2');
  await page.screenshot({ path: 'test-results/short-ayah-waiting.png', fullPage: true });
  await expect(page.locator('#live-mismatch')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#live-label')).toHaveText('Ayah 2 · 2 of 2 words followed');
  await expect(page.locator('#live-text [data-ayah="2"] [data-word]')).toHaveText(['ٱللَّهُ', 'ٱلصَّمَدُ']);
  await expect(page.locator('html')).toHaveAttribute('data-mic-starts', '1');
  await expect(page.locator('body')).toHaveClass('recording');
  expect(await page.evaluate(() => localStorage.getItem('tilawa-hifz-v1'))).toBeNull();
  await page.screenshot({ path: 'test-results/short-ayah-recovered.png', fullPage: true });
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByText('Check your recall', { exact: true })).toBeVisible({ timeout: 30_000 });
});
