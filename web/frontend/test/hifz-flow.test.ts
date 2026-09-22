import { describe, expect, it } from 'vitest';
import { RecitationFlow } from '../src/hifz/recitation-flow';
const create = (delay: number | null = 8000) => new RecitationFlow({ surah: 112, start: 1, end: 3 }, new Map([[1, 4], [2, 2], [3, 3]]), delay, 0);

describe('recitation flow', () => {
  it('offers one hint after a pause, not a stream of answers during silence', () => {
    const flow = create();
    expect(flow.tick(7999)).toBeNull();
    expect(flow.tick(8000)).toEqual({ type: 'hint', position: { ayah: 1, word: 0 } });
    expect(flow.tick(60_000)).toBeNull();
    flow.voice(61_000);
    expect(flow.tick(69_000)).toEqual({ type: 'hint', position: { ayah: 1, word: 1 } });
  });
  it('follows recitation to the next word and crosses ayah boundaries', () => {
    const flow = create();
    flow.track({ surah: 112, ayah: 1, word: 2, matched: [0, 1, 2] }, 1000);
    expect(flow.hint()).toEqual({ ayah: 1, word: 3 });
    flow.track({ surah: 112, ayah: 1, word: 3, matched: [0, 1, 2, 3] }, 2000);
    expect(flow.hint()).toEqual({ ayah: 2, word: 0 });
  });
  it('does not finish at partial verse recognition, on speech, or with a skipped ayah', () => {
    const flow = create(null);
    flow.voice(1000);
    flow.track({ surah: 112, ayah: 1, word: 2, matched: [0, 1, 2] }, 1000);
    flow.track({ surah: 112, ayah: 3, word: 2, matched: [0, 1, 2] }, 2000);
    expect(flow.tick(10_000)).toBeNull();
  });
  it('finishes once, only after the selected ending and a quiet pause', () => {
    const flow = create();
    flow.track({ surah: 112, ayah: 1, word: 3, matched: [3] }, 1000);
    flow.track({ surah: 112, ayah: 2, word: 1, matched: [1] }, 2000);
    flow.voice(3000);
    flow.track({ surah: 112, ayah: 3, word: 2, matched: [2] }, 3000);
    expect(flow.tick(4000)).toBeNull();
    flow.voice(4500);
    expect(flow.tick(6000)).toBeNull();
    expect(flow.tick(6300)).toEqual({ type: 'finish' });
    expect(flow.tick(6400)).toBeNull();
    expect(flow.hint()).toBeNull();
  });
  it('cancels a pending finish when the reciter goes back', () => {
    const flow = create(null);
    for (const [ayah, count] of [[1, 4], [2, 2], [3, 3]]) flow.track({ surah: 112, ayah, word: count - 1, matched: [count - 1] }, 1000);
    flow.voice(1000);
    flow.track({ surah: 112, ayah: 2, word: 0, matched: [0] }, 2000);
    expect(flow.tick(4000)).toBeNull();
  });
  it('supports requested-only hints and ignores positions outside the selection', () => {
    const flow = create(null);
    flow.track({ surah: 113, ayah: 1, word: 1, matched: [1] }, 1000);
    expect(flow.position).toEqual({ ayah: 1, word: 0 });
    expect(flow.tick(60_000)).toBeNull();
    expect(flow.hint()).toEqual({ ayah: 1, word: 0 });
  });
});
