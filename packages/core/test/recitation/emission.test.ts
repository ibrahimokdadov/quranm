import { describe, expect, it } from "vitest";
import {
  accumulateSnapshot,
  ayahConfidence,
  ayahKey,
  ayahMeetsGate,
  buildFinalSequence,
  mergeTallies,
  MIN_WORD_FRACTION,
  newlyEligibleAyahs,
  shouldRunFallback,
  snapshotTallies,
  wordProgressFromCursor,
  type AyahTally,
  type EmissionVerdict,
} from "../../src/recitation/emission";

const wordCount = (_surah: number, ayah: number): number => {
  if (ayah === 1) return 4;
  if (ayah === 2) return 3;
  if (ayah === 7) return 1;
  return 4;
};

function v(
  ayah: number,
  word: number,
  state: EmissionVerdict["state"],
  surah = 1,
): EmissionVerdict {
  return { surah, ayah, word, wordIndex: word, state };
}

function tally(
  partial: Partial<AyahTally> & Pick<AyahTally, "surah" | "ayah" | "words">,
): AyahTally {
  return {
    ok: 0,
    unsure: 0,
    wrong: 0,
    skipped: 0,
    pending: 0,
    firstSeen: 0,
    ...partial,
  };
}

describe("recitation emission", () => {
  it("keeps the harness 50% gate", () => {
    expect(MIN_WORD_FRACTION).toBe(0.5);
  });

  it("snapshots per-ayah counts from a verdict list (not incremental)", () => {
    const verdicts: EmissionVerdict[] = [
      v(1, 0, "ok"),
      v(1, 1, "unsure"),
      v(1, 2, "wrong"),
      v(1, 3, "pending"),
      v(2, 0, "ok"),
    ];
    const tallies = snapshotTallies(verdicts, wordCount);
    expect(tallies.get("1:1")).toMatchObject({
      surah: 1,
      ayah: 1,
      ok: 1,
      unsure: 1,
      wrong: 1,
      pending: 1,
      words: 4,
      firstSeen: 0,
    });
    expect(tallies.get("1:2")).toMatchObject({
      ok: 1,
      words: 3,
      firstSeen: 1,
    });
    const again = snapshotTallies(verdicts, wordCount);
    expect(again.get("1:1")?.ok).toBe(1);
  });

  it("emits only when ok+unsure clears 50% and wrong does not dominate", () => {
    expect(ayahMeetsGate(tally({ surah: 1, ayah: 1, words: 4, ok: 2 }))).toBe(true);
    expect(ayahMeetsGate(tally({ surah: 1, ayah: 1, words: 4, ok: 1, unsure: 1 }))).toBe(true);
    expect(ayahMeetsGate(tally({ surah: 1, ayah: 1, words: 4, ok: 1 }))).toBe(false);
    expect(
      ayahMeetsGate(tally({ surah: 1, ayah: 1, words: 4, ok: 2, wrong: 3 })),
    ).toBe(false);
    expect(
      ayahMeetsGate(tally({ surah: 1, ayah: 1, words: 4, ok: 2, wrong: 2 })),
    ).toBe(true);
    expect(ayahMeetsGate(tally({ surah: 1, ayah: 7, words: 1, unsure: 1 }))).toBe(true);
    expect(ayahMeetsGate(tally({ surah: 1, ayah: 7, words: 1 }))).toBe(false);
  });

  it("returns ayahs the first time they meet the gate, in firstSeen order", () => {
    const tallies = new Map<string, AyahTally>([
      ["2:2", tally({ surah: 2, ayah: 2, words: 3, ok: 2, firstSeen: 1 })],
      ["2:1", tally({ surah: 2, ayah: 1, words: 4, ok: 3, firstSeen: 0 })],
      ["2:3", tally({ surah: 2, ayah: 3, words: 4, ok: 1, firstSeen: 2 })],
    ]);
    const emitted = new Set<string>();
    const first = newlyEligibleAyahs(tallies, emitted);
    expect(first.map(ayahKey)).toEqual(["2:1", "2:2"]);
    first.forEach((t) => emitted.add(ayahKey(t)));
    const second = newlyEligibleAyahs(tallies, emitted);
    expect(second).toEqual([]);
    tallies.set(
      "2:3",
      tally({ surah: 2, ayah: 3, words: 4, ok: 2, unsure: 1, firstSeen: 2 }),
    );
    expect(newlyEligibleAyahs(tallies, emitted).map(ayahKey)).toEqual(["2:3"]);
  });

  it("merges a discarded-tracker dump with the live snapshot without double-counting current", () => {
    const dumped = snapshotTallies([v(1, 0, "ok"), v(1, 1, "ok")], wordCount);
    const accumulated = new Map<string, AyahTally>();
    accumulateSnapshot(accumulated, dumped);
    accumulateSnapshot(accumulated, dumped);
    expect(accumulated.get("1:1")?.ok).toBe(4);

    const live = snapshotTallies(
      [v(1, 0, "ok"), v(1, 1, "ok"), v(1, 2, "unsure"), v(2, 0, "ok")],
      wordCount,
    );
    const fresh = new Map<string, AyahTally>();
    accumulateSnapshot(fresh, dumped);
    const merged = mergeTallies(fresh, live);
    expect(merged.get("1:1")).toMatchObject({ ok: 4, unsure: 1, words: 4 });
    expect(merged.get("1:2")).toMatchObject({ ok: 1, words: 3, firstSeen: 1 });
  });

  it("gates fallback to empty live emissions", () => {
    expect(shouldRunFallback([])).toBe(true);
    expect(shouldRunFallback([tally({ surah: 1, ayah: 1, words: 4, ok: 4 })])).toBe(
      false,
    );
  });

  it("builds final_sequence from gated tallies then fallback", () => {
    const tallies = [
      tally({ surah: 2, ayah: 2, words: 3, ok: 2, firstSeen: 1 }),
      tally({ surah: 2, ayah: 1, words: 4, ok: 3, firstSeen: 0 }),
    ];
    const seq = buildFinalSequence(tallies, null);
    expect(seq.verses.map((v) => `${v.surah}:${v.ayah}`)).toEqual(["2:1", "2:2"]);
    expect(seq.confidence).toBeCloseTo((3 / 4 + 2 / 3) / 2);

    const empty = buildFinalSequence([], { surah: 1, ayah: 2, distance: 0.1 });
    expect(empty.verses).toEqual([{ surah: 1, ayah: 2, confidence: 0.9 }]);
    expect(shouldRunFallback([])).toBe(true);

    const blocked = buildFinalSequence(tallies, { surah: 114, ayah: 1, distance: 0 });
    expect(blocked.verses).toHaveLength(2);
  });

  it("maps cursor + verdicts onto word_progress matched ok/unsure indices", () => {
    const msg = wordProgressFromCursor(
      { surah: 1, ayah: 2, word: 1 },
      [
        v(2, 0, "ok"),
        v(2, 1, "unsure"),
        v(2, 2, "wrong"),
        v(1, 0, "ok"),
      ],
      3,
    );
    expect(msg).toEqual({
      type: "word_progress",
      surah: 1,
      ayah: 2,
      word_index: 1,
      total_words: 3,
      matched_indices: [0, 1],
    });
  });

  it("confidence is (ok+unsure)/words", () => {
    expect(ayahConfidence(tally({ surah: 1, ayah: 1, words: 4, ok: 2, unsure: 1 }))).toBe(
      0.75,
    );
  });
});
