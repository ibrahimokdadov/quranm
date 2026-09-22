import { expect, it } from 'vitest';
import { splitUthmaniWords, startsWithBismillah, BISMILLAH_WORD_COUNT } from '../src/lib/quran-words';
it('preserves diacritics and stop marks without changing word indices', () => {
  const text = 'لَمْ يَلِدْ ۖ وَلَمْ يُولَدْ';
  const words = splitUthmaniWords(text);
  expect(words.map(w => w.text)).toEqual(['لَمْ', 'يَلِدْ ۖ', 'وَلَمْ', 'يُولَدْ']);
  expect(words.map(w => w.text).join(' ')).toBe(text);
});
it('accounts for display-only bismillah, including Uthmani alif wasla', () => {
  const text = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ قُلْ هُوَ ٱللَّهُ أَحَدٌ';
  expect(startsWithBismillah(text)).toBe(true);
  expect(startsWithBismillah('قُلْ هُوَ ٱللَّهُ أَحَدٌ')).toBe(false);
  expect(splitUthmaniWords(text)[BISMILLAH_WORD_COUNT + 1].text).toBe('هُوَ');
});
