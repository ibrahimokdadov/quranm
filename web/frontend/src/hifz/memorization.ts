import type { Passage, PossibleIssue } from './progress';
import type { WordProgressMessage } from '../lib/types';

export interface MemoryStep { passage: Passage; stage: 'read' | 'recall' | 'connect'; round: number; unit: boolean }

/** Small study units, an immediate retrieval, then another retrieval after the
 * other ayahs. Counts are product defaults, not a validated Quran prescription. */
export function memorySteps(passage: Passage): MemoryStep[] {
  const units = Array.from({ length: passage.end - passage.start + 1 }, (_, i) => ({
    ...passage, start: passage.start + i, end: passage.start + i,
  }));
  const steps: MemoryStep[] = units.flatMap(p => [
    { passage: p, stage: 'read' as const, round: 1, unit: true },
    { passage: p, stage: 'read' as const, round: 2, unit: true },
    { passage: p, stage: 'recall' as const, round: 1, unit: true },
  ]);
  steps.push(...units.map(p => ({ passage: p, stage: 'recall' as const, round: 2, unit: units.length > 1 })));
  if (units.length > 1) steps.push({ passage, stage: 'connect', round: 1, unit: false });
  return steps;
}

/** A matched pass, not a pronunciation grade. Cursor position, a verse label,
 * silence, or the listener's uncertain result alone cannot tick a repetition. */
export function passMatched(passage: Passage, positions: Map<number, WordProgressMessage>, issues: PossibleIssue[], uncertain: boolean): boolean {
  if (uncertain || issues.length) return false;
  for (let ayah = passage.start; ayah <= passage.end; ayah++) {
    const p = positions.get(ayah);
    if (!p || p.surah !== passage.surah || p.total_words <= 0) return false;
    const matched = new Set(p.matched_indices);
    for (let word = 0; word < p.total_words; word++) if (!matched.has(word)) return false;
  }
  return true;
}

export class RevisionCoach {
  private attempts = new Map<string, { turn: number; count: number }>();
  note(issue: PossibleIssue, turn: number): number {
    const key = `${issue.surah}:${issue.ayah}:${issue.word}`;
    const previous = this.attempts.get(key);
    if (previous?.turn === turn) return previous.count;
    const count = (previous?.count ?? 0) + 1;
    this.attempts.set(key, { turn, count });
    return count;
  }
}
