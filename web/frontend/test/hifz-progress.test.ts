import { describe, expect, it } from 'vitest';
import { afterDays, coverage, emptyProgress, parseProgress, recordAttempt, validPassage } from '../src/hifz/progress';
import type { Attempt } from '../src/hifz/progress';
const passage = { surah: 112, start: 1, end: 3 };
const attempt = (day: number, fields: Partial<Attempt> = {}): Attempt => ({
  id: `${day}-${Math.random()}`, passage, mode: 'review', startedAt: `2026-09-${day}T12:00:00`, finishedAt: `2026-09-${day}T12:05:00`,
  outcome: 'independent', hints: [], textRevealed: false, listening: 'manual', heard: [], issues: [], ...fields,
});
describe('hifz progress', () => {
  it('schedules acquisition tomorrow, then lengthens a successful due review', () => {
    const first = recordAttempt(emptyProgress(), attempt(20));
    expect(first.cards['112:1-3']).toMatchObject({ stage: 0, due: '2026-09-21' });
    const second = recordAttempt(first, attempt(21));
    expect(second.cards['112:1-3']).toMatchObject({ stage: 1, due: '2026-09-24' });
  });
  it('does not lengthen or postpone a review for same-day repeats or early reviews', () => {
    let result = recordAttempt(emptyProgress(), attempt(20));
    result = recordAttempt(result, attempt(21));
    result = recordAttempt(result, attempt(21));
    result = recordAttempt(result, attempt(22));
    expect(result.cards['112:1-3']).toMatchObject({ stage: 1, due: '2026-09-24' });
    expect(result.attempts).toHaveLength(4);
  });
  it('does not treat practice after reading as a successful delayed review', () => {
    let result = recordAttempt(emptyProgress(), attempt(20, { mode: 'practice' }));
    result = recordAttempt(result, attempt(21, { mode: 'practice' }));
    expect(result.cards['112:1-3']).toMatchObject({ stage: 0, due: '2026-09-21' });
  });
  it.each([{ hints: [{ ayah: 1, word: 0 }] }, { textRevealed: true }])('records assistance even if an independent grade is supplied: %j', assistance => {
    const result = recordAttempt(emptyProgress(), attempt(20, assistance));
    expect(result.attempts[0].outcome).toBe('assisted');
    expect(result.cards['112:1-3']).toMatchObject({ stage: -1, due: '2026-09-20' });
  });
  it('preserves the first attempt and resets a failed passage without erasing history', () => {
    let result = recordAttempt(emptyProgress(), attempt(20));
    result = recordAttempt(result, attempt(21, { outcome: 'repair' }));
    result = recordAttempt(result, attempt(21));
    expect(result.attempts.map(a => a.outcome)).toEqual(['independent', 'repair', 'independent']);
    expect(result.cards['112:1-3']).toMatchObject({ stage: 0, due: '2026-09-22' });
  });
  it('does not penalize uncertain audio or silently count recognition as mastery', () => {
    const before = recordAttempt(emptyProgress(), attempt(20));
    const result = recordAttempt(before, attempt(21, { outcome: 'uncertain', listening: 'tilawa', heard: ['112:1', '112:2', '112:3'] }));
    expect(result.cards['112:1-3']).toMatchObject({ stage: 0, due: '2026-09-21' });
    expect(result.attempts[1].outcome).toBe('uncertain');
  });
  it('deduplicates a double save and snapshots an attempt immutably', () => {
    const a = attempt(20);
    const result = recordAttempt(emptyProgress(), a);
    a.hints.push({ ayah: 1, word: 2 });
    expect(result.attempts[0].hints).toHaveLength(0);
    expect(recordAttempt(result, a).attempts).toHaveLength(1);
  });
  it('detects incomplete coverage and unexpected verses without assigning fault', () => {
    expect(coverage(passage, ['112:1', '112:3', '113:1'])).toEqual({ missing: ['112:2'], outside: ['113:1'] });
  });
  it('validates real surah boundaries and ordered integer ranges', () => {
    const counts = new Map([[112, 4]]);
    expect(validPassage(passage, counts)).toBe(true);
    for (const p of [{ surah: 115, start: 1, end: 2 }, { surah: 112, start: 3, end: 1 }, { surah: 112, start: 1, end: 5 }, { surah: 112, start: 1.5, end: 3 }]) expect(validPassage(p, counts)).toBe(false);
  });
  it('round-trips progress and rejects corrupt data instead of overwriting it', () => {
    const result = recordAttempt(emptyProgress(), attempt(20));
    const counts = new Map([[112, 4]]);
    expect(parseProgress(JSON.stringify(result), counts)).toEqual(result);
    expect(() => parseProgress('{bad json', counts)).toThrow();
    expect(() => parseProgress(JSON.stringify({ ...result, version: 2 }), counts)).toThrow();
    expect(() => parseProgress(JSON.stringify({ ...result, attempts: [{}] }), counts)).toThrow();
  });
  it('uses calendar days across month and year boundaries', () => {
    expect(afterDays('2026-09-30', 3)).toBe('2026-10-03');
    expect(afterDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
