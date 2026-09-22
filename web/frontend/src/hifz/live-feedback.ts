import type { WordProgressMessage } from '../lib/types';
import { splitUthmaniWords } from '../lib/quran-words';
import { recitationWords, wordOffset, type Verse } from './lesson';
import type { Passage, PossibleIssue } from './progress';

export const issueLabels: Record<string, string> = {
  different_ayah: 'Different ayah detected', unmatched_recitation: 'Recitation could not be matched',
  possible_omission: 'Possible missed word', possible_substitution: 'Check this word',
  possible_vowel: 'Check the vowel', possible_skipped_ayah: 'Possibly skipped ayah', unclear_ayah: 'This ayah was unclear',
};
export type WordFeedback = 'unheard' | 'following' | 'heard' | 'flagged';

export function inPassage(position: { surah: number; ayah: number }, passage: Passage): boolean {
  return position.surah === passage.surah && position.ayah >= passage.start && position.ayah <= passage.end;
}

export function validProgress(position: WordProgressMessage, verse: Verse): boolean {
  const count = recitationWords(verse).length;
  return position.surah === verse.surah && position.ayah === verse.ayah && position.total_words === count
    && Number.isInteger(position.word_index) && position.word_index >= 0 && position.word_index < count;
}

/** Keep the words already followed when a later audio window or ayah arrives.
 * This is display history only; finishing still uses the live engine evidence. */
export function mergeWordProgress(previous: WordProgressMessage | undefined, incoming: WordProgressMessage): WordProgressMessage {
  const same = previous?.surah === incoming.surah && previous.ayah === incoming.ayah && previous.total_words === incoming.total_words;
  return { ...incoming, matched_indices: [...new Set([...(same ? previous.matched_indices : []), ...incoming.matched_indices])]
    .filter(i => Number.isInteger(i) && i >= 0 && i < incoming.total_words).sort((a, b) => a - b) };
}

/** Only matched Quran words enter the recall view. A gap is not a supplied answer;
 * neither cursor movement nor a correction flag reveals an unrecognized word. */
export function recitedWords(verse: Verse, position: WordProgressMessage | undefined): Array<{ index: number; text: string } | null> {
  if (!position || !validProgress(position, verse)) return [];
  const words = splitUthmaniWords(verse.text_uthmani);
  const offset = wordOffset(verse);
  const matched = new Set(position.matched_indices.filter(i => Number.isInteger(i) && i >= 0 && i < position.total_words));
  const result: Array<{ index: number; text: string } | null> = [];
  const last = Math.max(-1, ...matched);
  for (let i = 0; i <= last; i++) {
    if (matched.has(i)) {
      const index = i + offset;
      result.push({ index, text: words[index].text });
    } else if (result.at(-1) !== null) result.push(null);
  }
  return result;
}

/** Display indices include the basmalah; acoustic indices do not. A cursor alone
 * never turns a word green, and a correction flag overrides a word match. */
export function wordFeedback(verse: Verse, displayIndex: number, position: WordProgressMessage | undefined, issues: PossibleIssue[]): WordFeedback {
  if (issues.some(i => i.surah === verse.surah && i.ayah === verse.ayah && i.word >= 0
    && displayIndex >= i.word && displayIndex < i.word + (i.words ?? 1))) return 'flagged';
  if (!position || !validProgress(position, verse)) return 'unheard';
  const word = displayIndex - wordOffset(verse);
  if (word < 0) return 'unheard';
  if (position.matched_indices.includes(word)) return 'heard';
  return position.word_index === word ? 'following' : 'unheard';
}
