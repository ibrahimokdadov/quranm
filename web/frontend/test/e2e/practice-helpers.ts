import { expect, type Page } from '@playwright/test';

export async function pick(page: Page, mode: 'Memorize' | 'Revise', surah = 112, from = 1, to = from): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${mode}`) }).click();
  await page.locator('#surah').selectOption(String(surah));
  await page.locator('#from').fill(String(from));
  await page.locator('#to').fill(String(to));
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
}
export async function send(page: Page, data: object): Promise<void> {
  await page.evaluate(message => window.dispatchEvent(new CustomEvent('test-recitation-event', { detail: message })), data);
}
export async function startSavedRevision(page: Page): Promise<void> {
  const passage = await page.evaluate(() => JSON.parse(localStorage.getItem('tilawa-hifz-preferences-v2')!).passage);
  await pick(page, 'Revise', passage.surah, passage.start, passage.end);
  await page.getByRole('button', { name: 'Start revision' }).click();
}
export async function voice(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('test-voice')));
}
export const position = (ayah = 1, matched = [0, 1, 2, 3], surah = 112, total = 4) => ({
  type: 'word_progress', surah, ayah, word_index: total - 1, total_words: total, matched_indices: matched,
});

export async function stubListener(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = constraints => {
      document.documentElement.dataset.micStarts = String(Number(document.documentElement.dataset.micStarts ?? 0) + 1);
      return nativeGetUserMedia(constraints);
    };
    const NativeNode = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends NativeNode {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        super(context, name, options);
        let injected = false;
        this.port.addEventListener('message', event => {
          if (event.data instanceof ArrayBuffer && !injected) event.stopImmediatePropagation();
        });
        window.addEventListener('test-voice', () => {
          injected = true;
          this.port.dispatchEvent(new MessageEvent('message', { data: new Float32Array(4800).fill(.05).buffer }));
          injected = false;
        });
      }
    };
    Object.defineProperty(window, 'Worker', { value: class {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      dead = false;
      constructor() {
        window.addEventListener('test-recitation-event', event => { if (!this.dead) this.onmessage?.({ data: (event as CustomEvent).detail }); });
      }
      postMessage(message: { type: string; requestId?: number; start?: { surah: number; ayah: number }; ref?: { surah: number; ayah: number } }) {
        if (message.type !== 'audio') document.documentElement.dataset.workerCommands = `${document.documentElement.dataset.workerCommands ?? ''},${message.type}`;
        const ref = message.start ?? message.ref;
        if (ref) document.documentElement.dataset.expectedAyah = `${ref.surah}:${ref.ayah}`;
        if (message.type === 'init') queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }));
        if (message.type === 'stop') queueMicrotask(() => this.onmessage?.({ data: { type: 'stopped', requestId: message.requestId } }));
        if (message.type === 'reset' && message.requestId !== undefined) queueMicrotask(() => this.onmessage?.({ data: { type: 'reset_done', requestId: message.requestId } }));
      }
      terminate() { this.dead = true; }
    } });
    HTMLMediaElement.prototype.play = function() {
      document.documentElement.dataset.cueCount = String(Number(document.documentElement.dataset.cueCount ?? 0) + 1);
      document.documentElement.dataset.cueUrl = this.src;
      window.addEventListener('test-cue-end', () => this.dispatchEvent(new Event('ended')), { once: true });
      if (document.documentElement.dataset.rejectCue === 'true') return Promise.reject(new Error('Audio unavailable'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function() {};
    HTMLMediaElement.prototype.load = function() {};
  });
}
export async function begin(page: Page, mode: 'Memorize' | 'Revise', surah = 112, from = 1, to = from): Promise<void> {
  await stubListener(page);
  await page.goto('/');
  await pick(page, mode, surah, from, to);
  await page.getByRole('button', { name: mode === 'Memorize' ? 'Read aloud' : 'Start revision' }).click();
  await expect(page.locator('body')).toHaveClass('recording');
  await page.clock.install();
}
