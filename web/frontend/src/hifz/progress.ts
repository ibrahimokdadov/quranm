export interface Passage { surah: number; start: number; end: number }
export type Outcome = 'independent' | 'assisted' | 'repair' | 'uncertain';
export interface WordHint { ayah: number; word: number }
export interface PossibleIssue { surah: number; ayah: number; word: number; kind: string; words?: number }
export interface Attempt {
  id: string;
  passage: Passage;
  mode: 'practice' | 'review';
  startedAt: string;
  finishedAt: string;
  hints: WordHint[];
  textRevealed: boolean;
  outcome: Outcome;
  listening: 'tilawa' | 'manual' | 'unavailable';
  heard: string[];
  issues: PossibleIssue[];
  /** Individual learning units are logged, but the connected passage owns its review card. */
  unit?: boolean;
}
export interface ReviewCard extends Passage {
  stage: number;
  due: string;
  lastSuccess: string | null;
  lastOutcome: Outcome;
}
export interface Progress { version: 1; cards: Record<string, ReviewCard>; attempts: Attempt[] }
export const STORAGE_KEY = 'tilawa-hifz-v1';
export const INTERVALS = [1, 3, 7, 14, 30, 60];
export const emptyProgress = (): Progress => ({ version: 1, cards: {}, attempts: [] });
export const passageId = (p: Passage): string => `${p.surah}:${p.start}-${p.end}`;
export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function afterDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + days, 12));
}
export function validPassage(p: Passage, verseCounts: Map<number, number>): boolean {
  return Number.isInteger(p.surah) && Number.isInteger(p.start) && Number.isInteger(p.end)
    && p.start >= 1 && p.end >= p.start && p.end <= (verseCounts.get(p.surah) ?? 0);
}
export function expectedReferences(p: Passage): string[] {
  return Array.from({ length: p.end - p.start + 1 }, (_, i) => `${p.surah}:${p.start + i}`);
}
export function coverage(p: Passage, heard: string[]): { missing: string[]; outside: string[] } {
  const expected = expectedReferences(p);
  return { missing: expected.filter(ref => !heard.includes(ref)), outside: [...new Set(heard)].filter(ref => !expected.includes(ref)) };
}

// Outcomes record practice support, not a pronunciation or tajwid grade.
// Supplied text or audio always prevents independent-recall credit.
export function recordAttempt(progress: Progress, attempt: Attempt): Progress {
  if (progress.attempts.some(a => a.id === attempt.id)) return progress;
  const saved = structuredClone(attempt);
  if (saved.outcome === 'independent' && (saved.hints.length || saved.textRevealed)) saved.outcome = 'assisted';
  if (saved.unit) return { ...progress, attempts: [...progress.attempts, saved] };
  const id = passageId(saved.passage);
  const day = localDay(new Date(saved.finishedAt));
  const previous = progress.cards[id];
  let card: ReviewCard = previous ? { ...previous } : {
    ...saved.passage, stage: -1, due: day, lastSuccess: null, lastOutcome: saved.outcome,
  };
  if (saved.outcome === 'independent') {
    // A retry today or an early practice cannot inflate the review interval.
    if (card.lastSuccess !== day && card.due <= day && (saved.mode === 'review' || card.stage < 0)) {
      card.stage = Math.min(card.stage + 1, INTERVALS.length - 1);
      card.lastSuccess = day;
      card.due = afterDays(day, INTERVALS[card.stage]);
    }
  } else if (saved.outcome === 'assisted' || saved.outcome === 'repair') {
    card.stage = -1;
    card.due = day;
    // Keep lastSuccess: a same-day repair never counts as a spaced success.
  }
  // Uncertain audio preserves the existing interval and remains due if overdue.
  card.lastOutcome = saved.outcome;
  return { version: 1, cards: { ...progress.cards, [id]: card }, attempts: [...progress.attempts, saved] };
}

export function parseProgress(raw: string | null, counts: Map<number, number>): Progress {
  if (!raw) return emptyProgress();
  const p = JSON.parse(raw) as Progress;
  const outcomes = ['independent', 'assisted', 'repair', 'uncertain'];
  const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
  if (p?.version !== 1 || !p.cards || typeof p.cards !== 'object' || Array.isArray(p.cards) || !Array.isArray(p.attempts)) throw new Error('Unrecognized progress format');
  for (const [id, c] of Object.entries(p.cards)) {
    if (!c || !validPassage(c, counts) || id !== passageId(c) || !Number.isInteger(c.stage) || c.stage < -1 || c.stage >= INTERVALS.length
      || !isDate(c.due) || (c.lastSuccess !== null && !isDate(c.lastSuccess)) || !outcomes.includes(c.lastOutcome)) throw new Error('Invalid review card');
  }
  for (const a of p.attempts) {
    if (!a || typeof a.id !== 'string' || !a.passage || !validPassage(a.passage, counts) || !outcomes.includes(a.outcome)
      || !['practice', 'review'].includes(a.mode) || !['tilawa', 'manual', 'unavailable'].includes(a.listening)
      || typeof a.startedAt !== 'string' || !Number.isFinite(Date.parse(a.startedAt))
      || typeof a.finishedAt !== 'string' || !Number.isFinite(Date.parse(a.finishedAt))
      || typeof a.textRevealed !== 'boolean' || !Array.isArray(a.hints) || !Array.isArray(a.heard) || !Array.isArray(a.issues)
      || (a.unit !== undefined && typeof a.unit !== 'boolean')
      || a.heard.some(ref => typeof ref !== 'string' || !/^\d+:\d+$/.test(ref))
      || a.hints.some(h => !h || !Number.isInteger(h.ayah) || !Number.isInteger(h.word) || h.word < 0)
      || a.issues.some(i => !i || !Number.isInteger(i.surah) || !Number.isInteger(i.ayah) || !Number.isInteger(i.word) || typeof i.kind !== 'string')) throw new Error('Invalid saved attempt');
  }
  return p;
}
