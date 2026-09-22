import { BISMILLAH_WORD_COUNT, splitUthmaniWords, startsWithBismillah } from '../lib/quran-words';
import type { Passage, PossibleIssue } from './progress';

export interface Verse { surah: number; ayah: number; text_uthmani: string; surah_name: string; surah_name_en: string }
export interface LessonStep { passage: Passage; kind: 'learn' | 'connect' | 'review'; unit: boolean }

export function lessonSteps(passage: Passage, review: boolean, oneAtATime: boolean): LessonStep[] {
  if (review || !oneAtATime || passage.start === passage.end) {
    return [{ passage: { ...passage }, kind: review ? 'review' : 'learn', unit: false }];
  }
  return [
    ...Array.from({ length: passage.end - passage.start + 1 }, (_, i): LessonStep => ({
      passage: { ...passage, start: passage.start + i, end: passage.start + i }, kind: 'learn', unit: true,
    })),
    { passage: { ...passage }, kind: 'connect', unit: false },
  ];
}

export function wordOffset(verse: Verse): number {
  return verse.ayah === 1 && verse.surah !== 1 && verse.surah !== 9 && startsWithBismillah(verse.text_uthmani)
    ? BISMILLAH_WORD_COUNT : 0;
}
export function recitationWords(verse: Verse): string[] {
  return splitUthmaniWords(verse.text_uthmani).slice(wordOffset(verse)).map(w => w.text);
}
export function displayIssue(issue: PossibleIssue, totalWords: number, verse?: Verse): PossibleIssue {
  if (!verse || verse.surah !== issue.surah || verse.ayah !== issue.ayah
    || recitationWords(verse).length !== totalWords || issue.word < 0 || issue.word >= totalWords) return { ...issue, word: -1 };
  return { ...issue, word: issue.word + wordOffset(verse) };
}
