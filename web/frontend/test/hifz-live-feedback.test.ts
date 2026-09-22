import { describe, expect, it } from 'vitest';
import { inPassage, mergeWordProgress, recitedWords, validProgress, wordFeedback } from '../src/hifz/live-feedback';
import { displayIssue, type Verse } from '../src/hifz/lesson';
import type { WordProgressMessage } from '../src/lib/types';

const verse: Verse = { surah: 112, ayah: 1, text_uthmani: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ قُلْ هُوَ ٱللَّهُ أَحَدٌ', surah_name: '', surah_name_en: '' };
const position: WordProgressMessage = { type: 'word_progress', surah: 112, ayah: 1, word_index: 1, total_words: 4, matched_indices: [0] };
describe('live recitation feedback', () => {
  it('reveals only matched Quran words, excluding the basmalah and leaving gaps', () => {
    expect(recitedWords(verse, position)).toEqual([{ index: 4, text: 'قُلْ' }]);
    expect(recitedWords(verse, { ...position, matched_indices: [2] })).toEqual([null, { index: 6, text: 'ٱللَّهُ' }]);
    expect(recitedWords(verse, { ...position, matched_indices: [0, 2] })).toEqual([{ index: 4, text: 'قُلْ' }, null, { index: 6, text: 'ٱللَّهُ' }]);
    expect(recitedWords(verse, { ...position, matched_indices: [] })).toEqual([]);
    expect(recitedWords(verse, { ...position, total_words: 8 })).toEqual([]);
    expect(recitedWords(verse, { ...position, matched_indices: [-1, 4, 1.5] })).toEqual([]);
  });
  it('retains earlier matched words across windows without leaking another ayah', () => {
    expect(mergeWordProgress(position, { ...position, matched_indices: [2, 2, -1, 4, 1.5] }).matched_indices).toEqual([0, 2]);
    expect(mergeWordProgress(position, { ...position, ayah: 2, matched_indices: [] }).matched_indices).toEqual([]);
  });
  it('distinguishes matched words from the cursor and does not color the basmalah', () => {
    expect(wordFeedback(verse, 0, position, [])).toBe('unheard');
    expect(wordFeedback(verse, 4, position, [])).toBe('heard');
    expect(wordFeedback(verse, 5, position, [])).toBe('following');
    expect(wordFeedback(verse, 6, position, [])).toBe('unheard');
  });
  it('lets a vowel warning override matching text and marks whole-ayah issues', () => {
    const issue = displayIssue({ surah: 112, ayah: 1, word: 0, kind: 'possible_vowel' }, 4, verse);
    expect(wordFeedback(verse, 4, position, [issue])).toBe('flagged');
    const gap = displayIssue({ surah: 112, ayah: 1, word: 0, kind: 'unclear_ayah', words: 4 }, 4, verse);
    expect(wordFeedback(verse, 7, position, [gap])).toBe('flagged');
    expect(wordFeedback(verse, 3, position, [gap])).toBe('unheard');
  });
  it('rejects mismatched counts and positions outside the selected range', () => {
    expect(validProgress({ ...position, total_words: 5 }, verse)).toBe(false);
    expect(validProgress({ ...position, word_index: 4 }, verse)).toBe(false);
    expect(wordFeedback(verse, 4, { ...position, total_words: 5 }, [])).toBe('unheard');
    expect(inPassage(position, { surah: 112, start: 2, end: 4 })).toBe(false);
    expect(inPassage(position, { surah: 113, start: 1, end: 4 })).toBe(false);
  });
});
