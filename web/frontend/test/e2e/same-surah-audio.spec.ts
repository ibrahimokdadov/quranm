import { test, expect } from '@playwright/test';
import { pick } from './practice-helpers';

test.skip(!process.env.TILAWA_TEST_SAME_SURAH_AUDIO || !process.env.TILAWA_TEST_AUDIO,
  'Set TILAWA_TEST_SAME_SURAH_AUDIO to wrong (2:256) or correct (2:3), with a padded microphone WAV.');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = constraints => {
      document.documentElement.dataset.micStarts = String(Number(document.documentElement.dataset.micStarts ?? 0) + 1);
      return getMedia(constraints);
    };
    let audioMs = 0;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message: { type: string; samples?: Float32Array }, transfer: Transferable[] = []) {
        if (message.type === 'audio' && message.samples) audioMs += message.samples.length / 16;
        super.postMessage(message, transfer);
      }
    };
    const observer = new MutationObserver(() => {
      if (document.querySelector('#live-text .off-track [data-word]')) {
        document.documentElement.dataset.firstRedAudioMs ??= String(audioMs);
      }
    });
    observer.observe(document, { subtree: true, childList: true, attributes: true });
  });
  await page.goto('/');
  await pick(page, 'Revise', 2, 3, 3);
  await page.getByRole('button', { name: 'Start revision' }).click();
  await expect(page.locator('body')).toHaveClass('recording', { timeout: 60_000 });
});

test('reciting 2:256 instead of 2:3 turns red during the opening phrase', async ({ page }) => {
  test.skip(process.env.TILAWA_TEST_SAME_SURAH_AUDIO !== 'wrong');
  await expect(page.locator('#orb')).toHaveClass(/mismatch/, { timeout: 20_000 });
  await expect(page.locator('#live-text .off-track')).toBeVisible();
  await expect(page.locator('#live-text .off-track')).toHaveAttribute('aria-label', /2:256$/);
  await expect(page.locator('#live-mismatch')).toHaveCSS('color', 'rgb(163, 61, 53)');
  await expect(page.locator('#mismatch-reference')).toContainText('2:3');
  const firstRedAudioMs = Number(await page.locator('html').getAttribute('data-first-red-audio-ms'));
  // Includes the two-second lead-in and one hop of browser delivery overhead.
  expect(firstRedAudioMs).toBeLessThanOrEqual(9900);
  expect(firstRedAudioMs).toBeGreaterThan(2000);
  console.log(JSON.stringify({ selected: '2:3', recited: '2:256', firstRedAudioMs }));
  await expect(page.locator('html')).toHaveAttribute('data-mic-starts', '1');
  await expect(page.locator('body')).toHaveClass('recording');
  await page.screenshot({ path: 'test-results/same-surah-wrong.png', fullPage: true });
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
});

test('correct 2:3 follows all eight words without red wrong-ayah feedback', async ({ page }) => {
  test.skip(process.env.TILAWA_TEST_SAME_SURAH_AUDIO !== 'correct');
  await expect(page.locator('#live-text [data-ayah="3"] .heard')).toHaveCount(8, { timeout: 25_000 });
  await expect(page.locator('#orb')).not.toHaveClass(/mismatch/);
  await expect(page.locator('html')).not.toHaveAttribute('data-first-red-audio-ms');
  await expect(page.locator('html')).toHaveAttribute('data-mic-starts', '1');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
});
