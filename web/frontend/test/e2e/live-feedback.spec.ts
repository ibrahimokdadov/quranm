import { test, expect } from '@playwright/test';
import { begin, send, voice, position } from './practice-helpers';

test('revision shows only recited words, keeps them across ayahs, and updates the expected target', async ({ page }) => {
  await begin(page, 'Revise', 1, 2, 3);
  await send(page, position(2, [0, 1], 1));
  await expect(page.locator('#live-text [data-word]')).toHaveText(['ٱلْحَمْدُ', 'لِلَّهِ']);
  await expect(page.locator('#live-text')).not.toContainText('رَبِّ');
  await send(page, position(2, [2, 3], 1));
  await expect(page.locator('#live-text [data-word]')).toHaveCount(4);
  await expect(page.locator('html')).toHaveAttribute('data-expected-ayah', '1:3');
  await send(page, position(3, [0], 1, 2));
  await expect(page.locator('#live-text [data-ayah="2"]')).toBeVisible();
  await expect(page.locator('#live-text [data-ayah="3"] [data-word]')).toHaveCount(1);
});

test('wrong words turn red immediately and recover without erasing already recited text', async ({ page }) => {
  await begin(page, 'Revise', 112, 1, 4);
  await voice(page); await send(page, position(1, [0, 1]));
  await send(page, position(2, [0, 1, 2, 3], 1));
  await expect(page.locator('#orb')).toHaveClass('orb mismatch');
  await expect(page.locator('#mismatch-label')).toHaveText('Try this ayah again');
  await expect(page.locator('#live-text [data-ayah="1"]')).toBeVisible();
  await expect(page.locator('#live-text .off-track')).toHaveCSS('color', 'rgb(163, 61, 53)');
  await send(page, position(1, [2, 3]));
  await expect(page.locator('#live-mismatch')).toBeHidden();
  await expect(page.locator('#live-text .off-track')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-mic-starts', '1');
});

test('silence does not cause an error and unclear speech stays a neutral listening message', async ({ page }) => {
  await begin(page, 'Revise');
  await page.clock.runFor(10000);
  await expect(page.locator('#live-mismatch')).toBeHidden();
  await send(page, { type: 'raw_transcript', text: 'unrecognized speech tokens', confidence: 1 });
  await page.clock.runFor(5000);
  await expect(page.locator('#mismatch-label')).toHaveText('Still listening');
  await expect(page.locator('#orb')).not.toHaveClass(/mismatch/);
  await expect(page.locator('html')).not.toHaveAttribute('data-cue-count', /./);
});

test('acknowledges the optional opening without awarding the selected ayah', async ({ page }) => {
  await begin(page, 'Revise', 2, 1);
  await send(page, { type: 'recitation_preamble', kind: 'basmala', complete: true });
  await expect(page.locator('#live-label')).toHaveText('Bismillah heard');
  await expect(page.locator('#live-text')).toBeEmpty();
  await expect(page.locator('#live-mismatch')).toBeHidden();
});

test('plays the expected ayah, ignores playback recognition, and enlarges a repeated difficulty', async ({ page }) => {
  await begin(page, 'Revise', 112, 1, 4);
  await voice(page); await send(page, position(2, [0, 1, 2, 3], 1));
  await page.clock.runFor(1200);
  await expect(page.locator('#live-status')).toHaveText('Listen, then your turn');
  await expect(page.locator('html')).toHaveAttribute('data-cue-url', /112001.mp3$/);
  await send(page, position()); // Playback cannot supply the user's answer.
  await expect(page.locator('#live-text [data-ayah="1"]')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('test-cue-end')));
  await page.clock.runFor(600);
  await voice(page); await send(page, position(2, [0, 1, 2, 3], 1));
  await expect(page.locator('#focused-help')).toBeVisible();
  await expect(page.locator('#focused-help .help-label')).toHaveCSS('color', 'rgb(163, 61, 53)');
  await expect(page.locator('#focused-help .quran')).toContainText('قُلْ');
  await page.screenshot({ path: `test-results/revision-help-${test.info().project.name}.png`, fullPage: true });
  await send(page, position());
  await expect(page.locator('#focused-help')).toBeHidden();
  await expect(page.locator('#live-mismatch')).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-mic-starts', '1');
});

test('duplicate issue callbacks do not enlarge help and blocked audio resumes listening', async ({ page }) => {
  await begin(page, 'Revise', 1, 2, 3);
  await page.evaluate(() => { document.documentElement.dataset.rejectCue = 'true'; });
  const issue = { type: 'correction', totalWords: 4, state: { phase: 'error', issue: { surah: 1, ayah: 2, word: 1, kind: 'possible_omission' } } };
  await voice(page);
  for (let i = 0; i < 5; i++) await send(page, issue);
  await expect(page.locator('#focused-help')).toBeHidden();
  await page.clock.runFor(2000);
  await expect(page.getByRole('button', { name: 'Listen to this ayah' })).toBeVisible();
  await send(page, position(2, [0, 1, 2, 3], 1));
  await expect(page.locator('#live-text')).toContainText('ٱلْحَمْدُ');
  await expect(page.locator('body')).toHaveClass('recording');
});

test('finishing during an audio cue cannot restart listening afterward', async ({ page }) => {
  await begin(page, 'Revise', 112, 1, 4);
  await voice(page); await send(page, position(2, [0, 1, 2, 3], 1));
  await page.clock.runFor(1200);
  await expect(page.locator('#live-status')).toHaveText('Listen, then your turn');
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByText('Check your recall', { exact: true })).toBeVisible();
  const commands = await page.locator('html').getAttribute('data-worker-commands');
  await page.evaluate(() => window.dispatchEvent(new Event('test-cue-end')));
  await page.clock.runFor(3000);
  await expect(page.locator('html')).toHaveAttribute('data-worker-commands', commands!);
  await expect(page.locator('#live')).toBeHidden();
});
