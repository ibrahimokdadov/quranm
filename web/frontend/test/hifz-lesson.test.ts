import { describe, expect, it } from 'vitest';
import { lessonSteps, displayIssue, recitationWords, type Verse } from '../src/hifz/lesson';
import { emptyProgress, recordAttempt, type Attempt } from '../src/hifz/progress';

describe('a connected memorization lesson', () => {
  const p = { surah: 112, start: 1, end: 3 };
  it('learns each ayah then tests the connected passage with text closed', () => {
    expect(lessonSteps(p, false, true).map(s => [s.passage.start, s.passage.end, s.kind, s.unit])).toEqual([
      [1, 1, 'learn', true], [2, 2, 'learn', true], [3, 3, 'learn', true], [1, 3, 'connect', false],
    ]);
    expect(lessonSteps(p, true, true)).toEqual([{ passage: p, kind: 'review', unit: false }]);
  });
  it('logs individual units without treating them as a successful whole passage', () => {
    const attempt: Attempt = { id: 'unit', passage: p, mode: 'practice', unit: true, startedAt: '2026-09-21T10:00:00Z', finishedAt: '2026-09-21T10:01:00Z',
      hints: [], textRevealed: false, listening: 'manual', heard: [], issues: [], outcome: 'independent' };
    const result = recordAttempt(emptyProgress(), attempt);
    expect(result.cards).toEqual({});
    expect(result.attempts).toHaveLength(1);
  });
  it('aligns hints and vowel or whole-ayah flags after an optional basmalah', () => {
    const verse: Verse = { surah: 112, ayah: 1, text_uthmani: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ قُلْ هُوَ ٱللَّهُ أَحَدٌ', surah_name: '', surah_name_en: '' };
    expect(recitationWords(verse)).toHaveLength(4);
    const issue = { surah: 112, ayah: 1, word: 0, words: 4, kind: 'unclear_ayah' };
    expect(displayIssue(issue, 4, verse)).toMatchObject({ word: 4, words: 4 });
    expect(displayIssue(issue, 5, verse).word).toBe(-1);
  });
});
