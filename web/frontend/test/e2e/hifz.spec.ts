import { test, expect } from '@playwright/test';
import { begin, pick, send, voice, position } from './practice-helpers';

test('starts with two paths and a plain passage picker on desktop and mobile', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your time with the Quran.' })).toBeVisible();
  await expect(page.locator('.path-card')).toHaveCount(2);
  await page.screenshot({ path: `test-results/paths-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: /^Memorize/ }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('#setup-form select')).toHaveCount(1);
  await expect(page.locator('#setup-form input')).toHaveCount(2);
  await page.locator('#surah').selectOption('112');
  await page.locator('#from').fill('3'); await page.locator('#to').fill('1');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#setup-error')).toBeVisible();
  await page.locator('#to').fill('4');
  await page.screenshot({ path: `test-results/picker-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#screen .quran')).toBeVisible();
  await expect(page.locator('.reference')).toHaveText('Ayah 3');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('automatically counts fresh readings, hides text for recall, and uses one microphone session', async ({ page }) => {
  await begin(page, 'Memorize');
  await expect(page.locator('#live-text [data-word]')).toHaveCount(8); // includes the displayed opening
  for (let round = 0; round < 4; round++) {
    await voice(page); await send(page, position());
    await page.clock.runFor(3900);
    if (round < 3) {
      await expect(page.locator('#memory-meter [role="progressbar"]')).toHaveAttribute('aria-valuenow', String(round + 1));
      if (round >= 1) await expect(page.locator('#live-text')).toBeHidden();
      await page.clock.runFor(2200);
      await expect(page.locator('#memory-meter [role="progressbar"]')).toHaveAttribute('aria-valuenow', String(round + 1));
    }
  }
  await expect(page.getByText('Today’s practice, complete')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-mic-starts', '1');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tilawa-hifz-v1')!));
  expect(saved.attempts.map((a: { outcome: string }) => a.outcome)).toEqual(['assisted', 'assisted', 'independent', 'independent']);
  expect(saved.cards['112:1-1'].stage).toBe(0);
});

test('a wrong or partial reading does not tick off a repetition', async ({ page }) => {
  await begin(page, 'Memorize');
  await voice(page); await send(page, position(1, [0, 1]));
  await page.clock.runFor(2500);
  await expect(page.locator('#memory-meter [role="progressbar"]')).toHaveAttribute('aria-valuenow', '0');
  await voice(page);
  await send(page, { type: 'verse_match', surah: 1, ayah: 2, confidence: 1, verse_text: '', surah_name: '', surrounding_verses: [] });
  await page.clock.runFor(3900);
  await expect(page.locator('#memory-meter [role="progressbar"]')).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('#live-text')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!localStorage.getItem('tilawa-hifz-v1'))).toBe(true);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tilawa-hifz-v1')!));
  expect(saved.attempts[0].outcome).toBe('repair');
  expect(saved.cards).toEqual({});
});

test('a peek during hidden recall requires another unaided attempt', async ({ page }) => {
  await begin(page, 'Memorize');
  for (let i = 0; i < 2; i++) {
    await voice(page); await send(page, position()); await page.clock.runFor(3900);
    await expect(page.locator('#memory-meter [role="progressbar"]')).toHaveAttribute('aria-valuenow', String(i + 1));
    await expect(page.locator('#live')).not.toHaveClass(/between-passes/);
  }
  await page.keyboard.press('r');
  await expect(page.locator('#live-text')).toBeVisible();
  await voice(page); await send(page, position()); await page.clock.runFor(3900);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('tilawa-hifz-v1')!).attempts.length)).toBe(3);
  await expect(page.locator('#memory-meter [role="progressbar"]')).toHaveAttribute('aria-valuenow', '2');
  await expect(page.locator('#live-text')).toBeHidden();
});

test('preserves malformed progress and does not auto-start a saved mode', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tilawa-hifz-v1', '{invalid'));
  await page.goto('/');
  await expect(page.getByText(/Saved progress could not be read/)).toBeVisible();
  await pick(page, 'Revise');
  await expect(page.getByRole('button', { name: 'Start revision' })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('tilawa-hifz-v1'))).toBe('{invalid');
});

test('shows the live memory text and small progress ring without the setup UI', async ({ page }) => {
  await begin(page, 'Memorize', 1, 2, 3);
  await expect(page.locator('.topbar')).toHaveCSS('opacity', '0');
  await expect(page.locator('#setup-page')).toBeHidden();
  await expect(page.locator('#live-text')).toContainText('ٱلْحَمْدُ');
  await page.screenshot({ path: `test-results/memorize-${test.info().project.name}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('keeps a failed save available and resumes the same repetition after storage recovers', async ({ page }) => {
  await begin(page, 'Memorize');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'tilawa-hifz-v1' && document.documentElement.dataset.allowSave !== 'true') throw new DOMException('Full', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await voice(page); await send(page, position()); await page.clock.runFor(2300);
  await expect(page.getByRole('button', { name: 'Save & continue' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('tilawa-hifz-v1'))).toBeNull();
  await page.evaluate(() => { document.documentElement.dataset.allowSave = 'true'; });
  await page.getByRole('button', { name: 'Save & continue' }).click();
  await page.clock.runFor(2000);
  await expect(page.locator('#memory-meter [role="progressbar"]')).toHaveAttribute('aria-valuenow', '1');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tilawa-hifz-v1')!).attempts.length)).toBe(1);
});

test('can cancel microphone preparation and return to the two paths', async ({ page }) => {
  await page.route('**/models/*.onnx', route => route.abort());
  await page.goto('/'); await pick(page, 'Memorize');
  await page.getByRole('button', { name: 'Read aloud' }).click();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.locator('.path-card')).toHaveCount(2);
  await expect(page.locator('#live')).toBeHidden();
});
