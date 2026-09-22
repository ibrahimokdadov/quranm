/**
 * Verse emission policy: turns the engine's per-word verdicts into the SDK's
 * ayah-level events. Pure bookkeeping — no audio, no model, no I/O.
 */
import type { FallbackHit, VerdictState } from "./types.js";

export const MIN_WORD_FRACTION = 0.5;
export const FALLBACK_MAX_DISTANCE = 0.5;

/**
 * The slice of a tracker `WordVerdict` emission needs. Widened on purpose so
 * callers can hand over partial verdicts (tests, replayed vectors).
 */
export interface EmissionVerdict {
  surah: number;
  ayah: number;
  word: number;
  wordIndex?: number;
  state: VerdictState;
}

/** {@link FallbackHit} with `how` relaxed — emission only reads the distance. */
export type EmissionFallback = Pick<FallbackHit, "surah" | "ayah" | "distance"> & {
  how?: string;
};

export interface AyahTally {
  surah: number;
  ayah: number;
  ok: number;
  unsure: number;
  wrong: number;
  skipped: number;
  pending: number;
  words: number;
  firstSeen: number;
}

/** Where the tracker's cursor sits, as far as emission cares. */
export interface EmissionCursor {
  surah: number;
  ayah: number;
  word: number;
}

export type WordCountFn = (surah: number, ayah: number) => number;

export function ayahKey(t: { surah: number; ayah: number }): string {
  return `${t.surah}:${t.ayah}`;
}

export function ayahConfidence(t: AyahTally): number {
  if (t.words <= 0) return 0;
  return (t.ok + t.unsure) / t.words;
}

export function ayahMeetsGate(
  t: AyahTally,
  minWordFraction = MIN_WORD_FRACTION,
): boolean {
  return (
    t.ok + t.unsure >= Math.max(1, minWordFraction * t.words) &&
    t.wrong <= t.ok + t.unsure
  );
}

/** Rebuild per-ayah counts from one tracker snapshot. Does not increment. */
export function snapshotTallies(
  verdicts: readonly EmissionVerdict[],
  wordCount: WordCountFn,
): Map<string, AyahTally> {
  const order = new Map<string, AyahTally>();
  for (const v of verdicts) {
    const key = ayahKey(v);
    let t = order.get(key);
    if (!t) {
      t = {
        surah: v.surah,
        ayah: v.ayah,
        ok: 0,
        unsure: 0,
        wrong: 0,
        skipped: 0,
        pending: 0,
        words: wordCount(v.surah, v.ayah),
        firstSeen: order.size,
      };
      order.set(key, t);
    }
    t[v.state]++;
  }
  return order;
}

/** Add `src` counts into `dest` (harness tallyAyahs dump). Keeps earlier firstSeen. */
export function accumulateSnapshot(
  dest: Map<string, AyahTally>,
  src: Map<string, AyahTally>,
): void {
  for (const [key, s] of src) {
    const existing = dest.get(key);
    if (!existing) {
      dest.set(key, { ...s, firstSeen: dest.size });
      continue;
    }
    existing.ok += s.ok;
    existing.unsure += s.unsure;
    existing.wrong += s.wrong;
    existing.skipped += s.skipped;
    existing.pending += s.pending;
    existing.words = Math.max(existing.words, s.words);
  }
}

export function mergeTallies(
  accumulated: Map<string, AyahTally>,
  current: Map<string, AyahTally>,
): Map<string, AyahTally> {
  const out = new Map<string, AyahTally>();
  for (const [key, t] of accumulated) out.set(key, { ...t });
  accumulateSnapshot(out, current);
  return out;
}

export function newlyEligibleAyahs(
  tallies: Map<string, AyahTally> | Iterable<AyahTally>,
  alreadyEmitted: Set<string>,
  minWordFraction = MIN_WORD_FRACTION,
): AyahTally[] {
  const values = tallies instanceof Map ? [...tallies.values()] : [...tallies];
  return values
    .filter((t) => ayahMeetsGate(t, minWordFraction) && !alreadyEmitted.has(ayahKey(t)))
    .sort((a, b) => a.firstSeen - b.firstSeen);
}

export function shouldRunFallback(emitted: readonly unknown[]): boolean {
  return emitted.length === 0;
}

export const GAP_MAX_WORDS = 3;

/** An {@link AyahTally} flagged as filled in by {@link bridgeGapAyahs}. */
export interface BridgedAyahTally extends AyahTally {
  bridged?: boolean;
}

/**
 * Inject a below-gate short ayah only when both its neighbours already emit.
 *
 * Prefix fill is forbidden: a tally for ayah 3 with accepted [4, 5] stays out.
 * Off by default (`allowGaps`) — it trades precision for recall on the very
 * short ayahs the tracker skates over (e.g. 55:64 "mudhāmmatān").
 */
export function bridgeGapAyahs(
  accepted: readonly AyahTally[],
  tallies: readonly AyahTally[],
  gapMaxWords = GAP_MAX_WORDS,
): BridgedAyahTally[] {
  const have = new Set(accepted.map(ayahKey));
  const extra: BridgedAyahTally[] = [];
  for (const t of tallies) {
    const key = ayahKey(t);
    if (have.has(key)) continue;
    if (t.words > gapMaxWords) continue;
    if (t.ok + t.unsure < 1) continue;
    if (t.wrong > t.ok + t.unsure) continue;
    if (!have.has(`${t.surah}:${t.ayah - 1}`)) continue;
    if (!have.has(`${t.surah}:${t.ayah + 1}`)) continue;
    extra.push({ ...t, bridged: true });
    have.add(key);
  }
  if (!extra.length) return [...accepted];
  return [...accepted, ...extra].sort((a, b) => a.firstSeen - b.firstSeen);
}

export function fallbackConfidence(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  return Math.min(1, Math.max(0, 1 - distance));
}

export function buildFinalSequence(
  tallies: readonly AyahTally[],
  fallback: EmissionFallback | null,
  minWordFraction = MIN_WORD_FRACTION,
): { verses: { surah: number; ayah: number; confidence: number }[]; confidence: number } {
  const gated = [...tallies]
    .filter((t) => ayahMeetsGate(t, minWordFraction))
    .sort((a, b) => a.firstSeen - b.firstSeen)
    .map((t) => ({
      surah: t.surah,
      ayah: t.ayah,
      confidence: ayahConfidence(t),
    }));

  if (gated.length > 0) {
    const confidence = gated.reduce((s, v) => s + v.confidence, 0) / gated.length;
    return { verses: gated, confidence };
  }

  if (fallback) {
    const confidence = fallbackConfidence(fallback.distance);
    return {
      verses: [{ surah: fallback.surah, ayah: fallback.ayah, confidence }],
      confidence,
    };
  }

  return { verses: [], confidence: 0 };
}

export function wordProgressFromCursor(
  cursor: EmissionCursor,
  verdicts: readonly EmissionVerdict[],
  totalWords: number,
): {
  type: "word_progress";
  surah: number;
  ayah: number;
  word_index: number;
  total_words: number;
  matched_indices: number[];
} {
  const matched_indices = verdicts
    .filter(
      (v) =>
        v.surah === cursor.surah &&
        v.ayah === cursor.ayah &&
        (v.state === "ok" || v.state === "unsure"),
    )
    .map((v) => v.word)
    .sort((a, b) => a - b);
  return {
    type: "word_progress",
    surah: cursor.surah,
    ayah: cursor.ayah,
    word_index: cursor.word,
    total_words: totalWords,
    matched_indices,
  };
}
