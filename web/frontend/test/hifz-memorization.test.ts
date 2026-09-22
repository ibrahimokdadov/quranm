import { describe, expect, it } from 'vitest';
import { memorySteps, passMatched, RevisionCoach } from '../src/hifz/memorization';
import type { WordProgressMessage } from '../src/lib/types';

const passage = { surah: 112, start: 1, end: 2 };
const position = (ayah: number, matched: number[]): WordProgressMessage => ({
  type: 'word_progress', surah: 112, ayah, word_index: 3, total_words: 4, matched_indices: matched,
});
describe('guided memorization', () => {
  it('separates later recalls with other ayahs and finishes by joining the range', () => {
    const plan = memorySteps(passage);
    expect(plan.map(s => `${s.passage.start}:${s.stage}:${s.round}`)).toEqual([
      '1:read:1', '1:read:2', '1:recall:1', '2:read:1', '2:read:2', '2:recall:1', '1:recall:2', '2:recall:2', '1:connect:1',
    ]);
    expect(plan.slice(0, -1).every(s => s.unit)).toBe(true);
    expect(plan.at(-1)).toMatchObject({ passage, unit: false });
  });
  it('gives one ayah two visible passes followed by two hidden recalls', () => {
    const plan = memorySteps({ ...passage, end: 1 });
    expect(plan.map(s => s.stage)).toEqual(['read', 'read', 'recall', 'recall']);
    expect(plan.at(-1)?.unit).toBe(false);
  });
  it('does not tick partial words, skipped ayahs, duplicate indices, errors, or uncertainty', () => {
    const positions = new Map([[1, position(1, [0, 1, 2, 3])]]);
    expect(passMatched(passage, positions, [], false)).toBe(false);
    positions.set(2, position(2, [0, 1, 2, 2]));
    expect(passMatched(passage, positions, [], false)).toBe(false);
    positions.set(2, position(2, [0, 1, 2, 3]));
    expect(passMatched(passage, positions, [], false)).toBe(true);
    expect(passMatched(passage, positions, [], true)).toBe(false);
    expect(passMatched(passage, positions, [{ surah: 112, ayah: 2, word: 1, kind: 'possible_vowel' }], false)).toBe(false);
  });
  it('counts separate difficulties rather than duplicate callbacks from one utterance', () => {
    const coach = new RevisionCoach();
    const issue = { surah: 112, ayah: 2, word: 1, kind: 'possible_omission' };
    expect(coach.note(issue, 1)).toBe(1);
    expect(coach.note(issue, 1)).toBe(1);
    expect(coach.note(issue, 2)).toBe(2);
    expect(coach.note({ ...issue, word: 0 }, 2)).toBe(1);
  });
});
