import { describe, expect, it } from 'vitest';
import { RecitationMonitor } from '../src/hifz/recitation-monitor';
import type { WordProgressMessage } from '../src/lib/types';

const passage = { surah: 1, start: 2, end: 3 };
const position: WordProgressMessage = { type: 'word_progress', surah: 1, ayah: 2, total_words: 4, word_index: 1, matched_indices: [0] };

describe('recitation mismatch feedback', () => {
  it('flags a confirmed phrase in a long wrong ayah without waiting for most of that ayah', () => {
    const monitor = new RecitationMonitor({ surah: 2, start: 3, end: 3 }, 0);
    const wrong = { ...position, surah: 2, ayah: 256, total_words: 34, word_index: 4 };
    monitor.progress({ ...wrong, matched_indices: [] }, 500);
    monitor.progress({ ...wrong, matched_indices: [0, 0, 0, -1, 99] }, 1000);
    monitor.progress({ ...wrong, matched_indices: [0, 2, 4] }, 1500);
    expect(monitor.mismatch).toBeNull();
    monitor.progress({ ...wrong, matched_indices: [2, 3, 4] }, 2000);
    expect(monitor.mismatch).toEqual({ kind: 'different', expected: { surah: 2, ayah: 3 }, detected: { surah: 2, ayah: 256 } });
    monitor.progress({ ...position, surah: 2, ayah: 3 }, 2500);
    expect(monitor.mismatch).toBeNull();
  });
  it('acknowledges the opening without counting it as passage progress', () => {
    const monitor = new RecitationMonitor(passage, 0);
    for (let t = 500; t <= 6000; t += 500) {
      monitor.audio(.5, 500, t);
      monitor.preamble(false, t);
      monitor.decoded('ب'.repeat(t / 500), t);
      monitor.tick(t);
      expect(monitor.mismatch).toBeNull();
    }
    monitor.preamble(true, 6500);
    expect(monitor.opening).toBe('complete');
    expect(monitor.expected).toEqual({ surah: 1, ayah: 2 });
    monitor.progress(position, 7000);
    expect(monitor.opening).toBeNull();
    monitor.preamble(true, 7500); // A late opening event cannot erase real progress.
    expect(monitor.opening).toBeNull();
  });

  it('never calls silence or a quiet microphone wrong', () => {
    const monitor = new RecitationMonitor(passage, 0);
    for (let t = 0; t < 30000; t += 300) { monitor.audio(.05, 300, t); monitor.tick(t); }
    expect(monitor.mismatch).toBeNull();
  });

  it('warns when speech continues without a match and keeps the message after pausing', () => {
    const monitor = new RecitationMonitor(passage, 0);
    monitor.decoded('unrecognized speech', 500);
    monitor.tick(2500);
    expect(monitor.mismatch).toBeNull();
    monitor.tick(4600);
    expect(monitor.mismatch).toEqual({ kind: 'unmatched', expected: { surah: 1, ayah: 2 } });
    monitor.tick(20000);
    expect(monitor.mismatch?.kind).toBe('unmatched');
  });

  it('reports audible but undecodable input as uncertain, not a known wrong ayah', () => {
    const monitor = new RecitationMonitor(passage, 0);
    for (let t = 300; t <= 2400; t += 300) monitor.audio(.5, 300, t);
    monitor.tick(5000);
    expect(monitor.mismatch?.kind).toBe('unmatched');
  });

  it('distinguishes weak evidence from a confidently recognized other ayah', () => {
    const monitor = new RecitationMonitor(passage, 0);
    monitor.recognized({ surah: 112, ayah: 1 }, .4);
    expect(monitor.mismatch).toBeNull();
    monitor.recognized({ surah: 112, ayah: 1 }, .5);
    expect(monitor.mismatch?.kind).toBe('unmatched');
    monitor.recognized({ surah: 112, ayah: 1 }, .9);
    expect(monitor.mismatch).toEqual({ kind: 'different', expected: { surah: 1, ayah: 2 }, detected: { surah: 112, ayah: 1 } });
  });

  it('does not accept starting at the wrong ayah inside the selected range', () => {
    const monitor = new RecitationMonitor(passage, 0);
    expect(monitor.progress({ ...position, ayah: 3, total_words: 2, matched_indices: [0, 1] }, 1000)).toBe(false);
    expect(monitor.mismatch).toMatchObject({ kind: 'different', expected: { ayah: 2 }, detected: { ayah: 3 } });
  });

  it('allows a normal transition and an earlier ayah to be repeated', () => {
    const monitor = new RecitationMonitor(passage, 0);
    monitor.progress({ ...position, word_index: 3, matched_indices: [0, 1, 2] }, 1000);
    expect(monitor.progress({ ...position, ayah: 3, total_words: 2, word_index: 0, matched_indices: [] }, 1100)).toBe(true);
    expect(monitor.progress({ ...position, ayah: 3, total_words: 2, matched_indices: [0] }, 1500)).toBe(true);
    expect(monitor.progress(position, 2000)).toBe(true);
    expect(monitor.mismatch).toBeNull();
  });

  it('does not treat repeated old snapshots as new correct speech, and recovers on fresh matches', () => {
    const monitor = new RecitationMonitor(passage, 0);
    monitor.progress(position, 500);
    monitor.decoded('speech that did not match', 1000);
    for (let t = 2000; t <= 6000; t += 1000) { monitor.progress(position, t); monitor.tick(t); }
    expect(monitor.mismatch?.kind).toBe('unmatched');
    monitor.progress({ ...position, word_index: 2, matched_indices: [0, 1, 2] }, 6500);
    expect(monitor.mismatch).toBeNull();
  });

  it('does not flag a starting basmalah as a different selected passage', () => {
    const monitor = new RecitationMonitor({ surah: 112, start: 1, end: 4 }, 0);
    monitor.recognized({ surah: 1, ayah: 1 }, 1);
    expect(monitor.progress({ ...position, ayah: 1, matched_indices: [0, 1, 2, 3] }, 2000)).toBe(false);
    expect(monitor.mismatch).toBeNull();
  });
});
