import { describe, expect, it } from 'vitest';
import { CorrectionController, possibleWordIssues } from '../../src/recitation/correction';
import type { WordVerdict } from '../../src/recitation/types';
const word = (n: number, patch: Partial<WordVerdict> = {}): WordVerdict => ({ surah: 112, ayah: 3, word: n, wordIndex: 100 + n, state: 'ok', distance: 0, margin: .9, heardRatio: 1, vowelErrors: 0, vowelMargin: 0, ...patch });
const correct = [word(0), word(1), word(2), word(3)];
const omission = [word(0), word(1, { state: 'skipped', distance: 1, heardRatio: 0, margin: 0 }), word(2), word(3)];
const substitution = [word(0), word(1, { state: 'wrong', distance: .8 }), word(2), word(3)];
const vowel = [word(0), word(1, { distance: .02, vowelErrors: 1, vowelMargin: .8 }), word(2), word(3)];
const cursor = { surah: 112, ayah: 3, word: 3 };
function flag() {
  const c = new CorrectionController(); c.setMode('correction');
  expect(c.observe(omission, cursor, 30)).toBe(false);
  expect(c.observe(omission, cursor, 42)).toBe(true); return c;
}
describe('conservative word correction', () => {
  it('defaults to Tracking and leaves correct recitation unflagged', () => {
    const c = new CorrectionController(); c.observe(omission, cursor, 30); c.observe(omission, cursor, 50);
    expect(c.state.phase).toBe('idle'); expect(possibleWordIssues(correct)).toEqual([]);
  });
  it('detects interior omissions and gross substitutions with clear anchors', () => {
    expect(possibleWordIssues(omission)[0]).toMatchObject({ word: 1, kind: 'possible_omission' });
    expect(possibleWordIssues(substitution)[0]).toMatchObject({ word: 1, kind: 'possible_substitution' });
  });
  it('detects a confident harakah error on an otherwise matching word', () => {
    expect(possibleWordIssues(vowel)[0]).toMatchObject({ word: 1, kind: 'possible_vowel' });
    // Same skeleton, but the decoder was unsure which vowel it heard, or the word itself was weak.
    for (const patch of [{ vowelMargin: .01 }, { vowelErrors: 0 }, { margin: .3 }, { distance: .3 }, { state: 'wrong' as const }, { heardRatio: .5 }]) {
      expect(possibleWordIssues([word(0), { ...vowel[1]!, ...patch }, word(2)])).toEqual([]);
    }
    // Thresholds are tunable per controller.
    expect(possibleWordIssues(vowel, { vowelMargin: .9, vowelWordMargin: .5 })).toEqual([]);
    expect(possibleWordIssues([word(0), { ...vowel[1]!, vowelMargin: .2 }, word(2)], { vowelMargin: .1, vowelWordMargin: .5 })).toHaveLength(1);
    // A contested vowel (p(heard) 0.54 vs p(expected) 0.44, the rabbuka case) still counts by default.
    expect(possibleWordIssues([word(0), { ...vowel[1]!, vowelMargin: .1 }, word(2)])).toHaveLength(1);
  });
  it('does not accept a retry that repeats the vowel error', () => {
    const c = new CorrectionController(); c.setMode('correction');
    c.observe(vowel, cursor, 30); expect(c.observe(vowel, cursor, 42)).toBe(true);
    expect(c.state.issue).toMatchObject({ kind: 'possible_vowel', word: 1 });
    c.act('retry');
    c.observe(vowel, cursor, 100); c.observe(vowel, cursor, 120); expect(c.state.phase).toBe('retrying');
    c.observe(correct, cursor, 130); c.observe(correct, cursor, 142); expect(c.state.phase).toBe('corrected');
  });
  it('abstains on unclear audio, pending alignment, small phonetic differences and boundary omissions', () => {
    for (const patch of [{ state: 'unsure' as const }, { state: 'pending' as const }, { margin: .2 }, { margin: NaN }, { distance: .45 }, { heardRatio: .2 }]) {
      expect(possibleWordIssues([word(0), { ...substitution[1], ...patch }, word(2)])).toEqual([]);
    }
    expect(possibleWordIssues([word(0, { margin: .2 }), omission[1], word(2)])).toEqual([]);
    expect(possibleWordIssues(omission.slice(1))).toEqual([]);
    expect(possibleWordIssues(omission.slice(0, 2))).toEqual([]);
    expect(possibleWordIssues([word(0), omission[1], word(2, { ayah: 4 })])).toEqual([]);
  });
  it('requires advancing frames and cancels a revised hypothesis', () => {
    const c = new CorrectionController(); c.setMode('correction');
    c.observe(omission, cursor, 30); c.observe(omission, cursor, 30); expect(c.state.phase).toBe('idle');
    c.observe(correct, cursor, 50); c.observe(omission, cursor, 60); expect(c.state.phase).toBe('idle');
    c.observe(omission, cursor, 72); expect(c.state.phase).toBe('error');
  });
  it('keeps position and distinguishes dismissal from correction', () => {
    const c = flag(); c.act('dismiss');
    expect(c.state).toMatchObject({ phase: 'idle', outcome: 'dismissed', resume: cursor });
    c.observe(omission, cursor, 60); c.observe(omission, cursor, 90); expect(c.state.phase).toBe('idle');
    c.reset(); c.observe(omission, cursor, 10); c.observe(omission, cursor, 25); expect(c.state.phase).toBe('error');
  });
  it('requires fresh clear retry prefix, rejects stale evidence and supports practicing again', () => {
    const c = flag(); const old = c.state.attempt; c.act('retry');
    c.observe(correct, cursor, 100, old); c.observe(correct, cursor, 120, old); expect(c.state.phase).toBe('retrying');
    c.observe([word(1)], cursor, 20); c.observe([word(1)], cursor, 40);
    c.observe([word(0), word(1, { margin: .2 })], cursor, 60); expect(c.state.phase).toBe('retrying');
    c.observe(correct, cursor, 70); c.observe(correct, cursor, 82);
    expect(c.state).toMatchObject({ phase: 'corrected', outcome: 'corrected', resume: cursor });
    c.act('retry'); expect(c.state.phase).toBe('retrying'); c.act('stop_retry'); expect(c.state.phase).toBe('error');
    c.act('retry'); c.observe(correct, cursor, 10); c.observe(correct, cursor, 22); c.act('continue');
    expect(c.state).toMatchObject({ phase: 'idle', outcome: 'corrected', resume: cursor });
  });
  it('raise() takes ayah-level issues and a retry must clear all their words', () => {
    const issue = { surah: 112, ayah: 3, word: 0, wordIndex: 100, kind: 'unclear_ayah' as const, words: 4 };
    const c = new CorrectionController();
    expect(c.raise(issue, cursor)).toBe(false); // tracking mode
    c.setMode('correction');
    expect(c.raise(issue, cursor)).toBe(true);
    expect(c.state).toMatchObject({ phase: 'error', issue, resume: cursor });
    expect(c.raise(issue, cursor)).toBe(false); // not idle
    c.act('retry');
    c.observe([word(0), word(1)], cursor, 10); c.observe([word(0), word(1)], cursor, 30);
    expect(c.state.phase).toBe('retrying');
    c.observe(correct, cursor, 40); c.observe(correct, cursor, 52);
    expect(c.state.phase).toBe('corrected');
    c.act('continue');
    expect(c.raise(issue, cursor)).toBe(false); // suppressed for the session
    c.reset();
    expect(c.raise({ ...issue, kind: 'possible_skipped_ayah' }, cursor)).toBe(true);
    c.act('dismiss');
    expect(c.state).toMatchObject({ phase: 'idle', outcome: 'dismissed' });
    expect(c.raise(issue, cursor)).toBe(false);
  });
  it('closing or reviewing later never claims success', () => {
    for (const action of ['close', 'review_later'] as const) {
      const c = flag(); c.act('retry'); c.act(action);
      expect(c.state).toMatchObject({ phase: 'idle', outcome: 'deferred', resume: cursor });
    }
  });
});
