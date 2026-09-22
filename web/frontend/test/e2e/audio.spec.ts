import { startSavedRevision } from './practice-helpers';
import { test, expect } from '@playwright/test';
test.skip(!!process.env.TILAWA_TEST_SAME_SURAH_AUDIO || !!process.env.TILAWA_TEST_MEMORY_AUDIO || !process.env.TILAWA_TEST_AUDIO || !!process.env.TILAWA_TEST_SHORT_AUDIO || !!process.env.TILAWA_TEST_RECOVERY_AUDIO || !!process.env.TILAWA_TEST_SHORT_RECOVERY_AUDIO, 'Set TILAWA_TEST_AUDIO to the 1:2 recording with leading/trailing silence.');

test('actual wrong-ayah audio reports the mismatch while the microphone stays active', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('tilawa-hifz-preferences-v2', JSON.stringify({
      passage: { surah: 112, start: 1, end: 1 }, review: true, oneAtATime: false, pause: null,
    }));
    let audioMs = 0;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      postMessage(message: { type: string; samples?: Float32Array }, transfer: Transferable[] = []) {
        if (message.type === 'audio' && message.samples) audioMs += message.samples.length / 16;
        super.postMessage(message, transfer);
      }
    };
    // Measure the actual rendered red words against microphone audio, including
    // worker inference and delivery, without counting model download/startup.
    const observer = new MutationObserver(() => {
      if (document.querySelector('#live-text .off-track [data-word]')) {
        document.documentElement.dataset.firstRedAudioMs = String(audioMs);
        observer.disconnect();
      }
    });
    observer.observe(document, { subtree: true, childList: true, attributes: true });
  });
  await page.goto('/');
  await startSavedRevision(page);
  await expect(page.locator('body')).toHaveClass('recording', { timeout: 60_000 });
  await expect(page.locator('#mismatch-label')).toHaveText('Try this ayah again', { timeout: 20_000 });
  await expect(page.locator('#mismatch-reference')).toContainText('112:1');
  await expect(page.locator('#live-mismatch')).toBeVisible();
  await expect(page.locator('#live-text .off-track')).toBeVisible();
  const firstRedAudioMs = Number(await page.locator('html').getAttribute('data-first-red-audio-ms'));
  expect(firstRedAudioMs).toBeGreaterThan(2000);
  // The fixture includes 2 s lead-in; allow worker/browser overhead beyond the
  // 4.2 s SDK regression bound, but fail the former ~8 s visible warning.
  expect(firstRedAudioMs).toBeLessThanOrEqual(6600);
  console.log(JSON.stringify({ firstRedAudioMs, recitationMs: firstRedAudioMs - 2000 }));
  await page.screenshot({ path: 'test-results/actual-wrong-ayah.png', fullPage: true });
  await expect(page.locator('body')).toHaveClass('recording');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByText('Check your recall', { exact: true })).toBeVisible({ timeout: 30_000 });
});

test('actual microphone audio follows a short selected ayah and finishes automatically', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('tilawa-hifz-preferences-v2', JSON.stringify({
    passage: { surah: 1, start: 2, end: 2 }, review: true, oneAtATime: false, pause: null,
  })));
  await page.goto('/');
  await startSavedRevision(page);
  await expect(page.locator('body')).toHaveClass('recording', { timeout: 60_000 });
  await expect(page.locator('#screen')).toBeEmpty();
  await expect(page.locator('#live-progress .heard').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#live-text .heard').first()).toBeVisible();
  await expect(page.locator('#live-text')).toContainText('ٱلْحَمْدُ');
  await page.screenshot({ path: 'test-results/listening.png', fullPage: true });
  await expect(page.getByRole('button', { name: 'Remembered', exact: true })).toBeVisible({ timeout: 45_000 });
  expect(await page.evaluate(() => localStorage.getItem('tilawa-hifz-v1'))).toBeNull();
  await page.getByRole('button', { name: 'Remembered', exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tilawa-hifz-v1')!));
  expect(saved.attempts[0]).toMatchObject({ outcome: 'independent', listening: 'tilawa', heard: ['1:2'], hints: [], issues: [], textRevealed: false });
  expect(errors).toEqual([]);
});

test('does not finish an incomplete range or reveal upcoming words during a pause', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tilawa-hifz-preferences-v2', JSON.stringify({
    passage: { surah: 1, start: 2, end: 3 }, review: true, oneAtATime: false, pause: 8000,
  })));
  await page.goto('/');
  await startSavedRevision(page);
  await expect(page.locator('body')).toHaveClass('recording', { timeout: 60_000 });
  await expect(page.locator('#live-text [data-ayah="2"] .heard').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#live-text [data-ayah="3"]')).toHaveCount(0);
  await page.waitForTimeout(10000);
  await expect(page.locator('#hint')).toBeEmpty();
  await expect(page.locator('body')).toHaveClass('recording');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remembered', exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Not sure · leave for later' }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tilawa-hifz-v1')!));
  expect(saved.attempts[0].hints).toEqual([]);
});

test('real correction audio loads under the app isolation policy and returns to the microphone', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('tilawa-hifz-preferences-v2', JSON.stringify({
      passage: { surah: 112, start: 1, end: 4 }, review: true, oneAtATime: false, pause: null,
    }));
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function() {
      return original.call(this).then(() => { document.documentElement.dataset.playedCue = this.src; });
    };
  });
  await page.goto('/'); await startSavedRevision(page);
  await expect(page.locator('body')).toHaveClass('recording', { timeout: 60_000 });
  await expect(page.locator('#live-status')).toHaveText('Listen, then your turn', { timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('data-played-cue', /112001.mp3$/, { timeout: 15_000 });
  await expect(page.locator('#live-status')).not.toHaveText('Listen, then your turn', { timeout: 15_000 });
  await expect(page.locator('body')).toHaveClass('recording');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Try without help' })).toBeVisible({ timeout: 20_000 });
});
