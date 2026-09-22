import { DEFAULT_CONFIG, type EngineConfig } from "./config.js";
import { alignGlobal, normalizedDistance } from "./alignment.js";
import type { CostTable } from "./phonemeCost.js";
import type { Tracker } from "./tracker.js";
import type { HeardChar, VerdictState, WordVerdict } from "./types.js";

const SEGMENT_CUT = 300;
const CONTEXT_CHARS = 6;
const TANWEEN = ["ً", "ٌ", "ٍ"] as const;
const CLUSTER = new Set(["ن", "ں", "م", "۾", "و", "ۥ", "ي", "ۦ", "ل", "ر"]);
const SHORT_VOWELS = new Set(["َ", "ُ", "ِ"]);
const TANWEEN_VOWEL: Record<string, string> = { "ً": "َ", "ٌ": "ُ", "ٍ": "ِ" };

export function pausalPhonemes(
  phonemes: string,
  plain: string,
  atAyahEnd: boolean,
): string | null {
  if (atAyahEnd) return null;
  if (phonemes.length < 2) return null;
  let result: string | null = null;
  const tanween = TANWEEN.find((t) => plain.includes(t));
  if (tanween) {
    let stem = phonemes;
    if (stem.length) {
      const last = stem[stem.length - 1]!;
      if (CLUSTER.has(last)) {
        let i = stem.length - 1;
        while (i >= 0 && stem[i] === last) i--;
        stem = stem.slice(0, i + 1);
      }
    }
    const vowel = TANWEEN_VOWEL[tanween]!;
    if (!stem.endsWith(vowel)) return null;
    if (tanween === "ً" && !plain.includes("ة")) result = stem + "اا";
    else result = stem.slice(0, -1);
  } else if (SHORT_VOWELS.has(phonemes[phonemes.length - 1]!)) {
    result = phonemes.slice(0, -1);
  }
  if (!result || result.length === 0 || result === phonemes) return null;
  return result;
}

function stopBoundary(
  heard: readonly HeardChar[],
  from: number,
  to: number,
  settleFrames: number,
): number {
  const end = Math.min(heard.length, to + 4);
  for (let i = from + 1; i <= end; i++) {
    if (i === heard.length) return i;
    if (heard[i]!.frame - heard[i - 1]!.frame >= settleFrames) return i;
  }
  return -1;
}

interface Segment {
  heardFrom: number;
  heardTo: number;
  refFrom: number;
  refTo: number;
  run: number;
  contextFrom: number;
}

interface Span {
  from: number;
  to: number;
  run: number;
}

interface CachedSeg {
  spans: Map<number, Span>;
}

export class VerdictTracer {
  private readonly tracker: Tracker;
  private readonly table: CostTable;
  private readonly cfg: EngineConfig;
  private cache = new Map<string, CachedSeg>();
  private cacheRevision = -1;

  constructor(tracker: Tracker, table: CostTable, cfg: EngineConfig = DEFAULT_CONFIG) {
    this.tracker = tracker;
    this.table = table;
    this.cfg = cfg;
  }

  verdicts(settled = false): WordVerdict[] {
    const t = this.tracker;
    if (this.cacheRevision !== t.revision) {
      this.cache.clear();
      this.cacheRevision = t.revision;
    }
    const segs = this.segment(t.trail);
    const spans = new Map<number, Span>();
    for (let s = 0; s < segs.length; s++) {
      const seg = segs[s]!;
      const open = s === segs.length - 1;
      const key = `${seg.contextFrom}:${seg.heardTo}:${seg.refFrom}:${seg.refTo}`;
      let got: CachedSeg | undefined;
      if (!open) {
        got = this.cache.get(key);
        if (!got) {
          got = { spans: this.alignSegment(seg) };
          this.cache.set(key, got);
        }
      } else {
        got = { spans: this.alignSegment(seg) };
      }
      for (const [w, sp] of got.spans) spans.set(w, sp);
    }
    return this.judge(spans, settled);
  }

  private segment(trail: number[]): Segment[] {
    const n = trail.length;
    if (n === 0) return [];
    const segs: Segment[] = [];
    let run = 0;
    let runStart = 0;
    let segStart = 0;
    let prevSegStart = 0;
    const push = (to: number) => {
      if (to <= segStart) return;
      const cell = trail[segStart]!;
      const refFrom =
        cell <= 0
          ? 0
          : tWordStart(this.tracker, this.tracker.localWordOfPos[cell - 1]!);
      const firstOfRun = segStart === runStart;
      const contextFrom =
        firstOfRun && run === 0
          ? segStart
          : Math.max(prevSegStart, segStart - CONTEXT_CHARS);
      segs.push({
        heardFrom: segStart,
        heardTo: to,
        refFrom,
        refTo: trail[to - 1]!,
        run,
        contextFrom,
      });
      prevSegStart = segStart;
    };
    for (let g = 1; g <= n; g++) {
      const newRun = g < n && trail[g]! < trail[g - 1]!;
      const cut = g - segStart >= SEGMENT_CUT;
      if (newRun || cut || g === n) {
        push(g);
        if (newRun) {
          run++;
          runStart = g;
        }
        segStart = g;
      }
    }
    return segs;
  }

  private alignSegment(seg: Segment): Map<number, Span> {
    const t = this.tracker;
    const heard = t.heard;
    const ids = new Uint8Array(seg.heardTo - seg.contextFrom);
    for (let i = 0; i < ids.length; i++) ids[i] = this.table.id(heard[seg.contextFrom + i]!.ch);
    const assign = alignGlobal(ids, t.ref, seg.refFrom, seg.refTo, this.table);
    const first = new Map<number, number>();
    const last = new Map<number, number>();
    for (let i = 0; i < assign.length; i++) {
      const refIndex = assign[i]!;
      if (refIndex < 0) continue;
      const localWord = t.localWordOfPos[refIndex]!;
      const gi = seg.contextFrom + i;
      if (!first.has(localWord)) first.set(localWord, gi);
      last.set(localWord, gi);
    }
    const spans = new Map<number, Span>();
    for (const [w, f] of first) {
      spans.set(w, { from: f, to: last.get(w)! + 1, run: seg.run });
    }
    return spans;
  }

  private judge(spans: Map<number, Span>, settled: boolean): WordVerdict[] {
    const t = this.tracker;
    if (spans.size === 0) return [];
    let minWord = Infinity;
    let maxWord = -Infinity;
    for (const w of spans.keys()) {
      if (w < minWord) minWord = w;
      if (w > maxWord) maxWord = w;
    }
    const lastRun = t.trail.length ? this.lastRun(t.trail) : 0;
    const cursorWord = Math.max(0, t.cursorLocalWord);
    const cursorPending = !t.reachedEnd && !settled;
    const dwell = settled ? 0 : this.cfg.commitDwell;
    const heardLen = t.heard.length;
    const out: WordVerdict[] = [];
    for (let w = minWord; w <= maxWord; w++) {
      const span = spans.get(w);
      const globalWord = t.firstWord + w;
      const exp = t.corpus.wordPhonemes(globalWord);
      const expLen = exp.length;
      let pending =
        (w === cursorWord && cursorPending) ||
        (!!span && span.to > heardLen - dwell) ||
        (!!span && span.run < lastRun && w >= cursorWord);
      const heardCount = span ? span.to - span.from : 0;
      if (!pending && heardCount < this.cfg.minHeardFraction * expLen) {
        if (minWord < w && w < maxWord) {
          const ratio = expLen > 0 ? heardCount / expLen : 0;
          out.push(this.makeVerdict(globalWord, "skipped", 1, ratio, 0));
        }
        continue;
      }
      if (!span) continue;
      const from = span.from;
      let to = span.to;
      let heardSlice = sliceHeard(t.heard, from, to);
      let distance = normalizedDistance(
        this.table.encode(heardSlice),
        this.table.encode(exp),
        this.table,
      );
      const atAyahEnd =
        t.corpus.wordInAyah[globalWord]! ===
        t.corpus.ayahWordCount(t.corpus.wordSurah[globalWord]!, t.corpus.wordAyah[globalWord]!) - 1;
      const pausal = pausalPhonemes(exp, t.corpus.plain[globalWord]!, atAyahEnd);
      let expUsed = exp;
      if (distance > this.cfg.okDistance && pausal) {
        const stop = stopBoundary(t.heard, from, to, this.cfg.settleFrames);
        if (stop >= 0) {
          if (stop !== to) {
            to = stop;
            heardSlice = sliceHeard(t.heard, from, to);
          }
          const d2 = normalizedDistance(
            this.table.encode(heardSlice),
            this.table.encode(pausal),
            this.table,
          );
          if (d2 < distance) {
            distance = d2;
            expUsed = pausal;
          }
        }
      }
      const vowels = pending
        ? { errors: 0, margin: 0 }
        : vowelMismatches(t.heard, from, heardSlice, expUsed, this.table);
      let margin = 0;
      const spanHeard = span.to - span.from;
      if (spanHeard > 0) {
        for (let i = span.from; i < span.to; i++) margin += t.heard[i]!.margin;
        margin /= spanHeard;
      }
      const heardRatio = expLen > 0 ? spanHeard / expLen : 0;
      let state: VerdictState;
      if (pending) state = "pending";
      else if (distance <= this.cfg.okDistance) state = "ok";
      else if (distance <= this.cfg.unsureDistance || margin < this.cfg.minMargin) state = "unsure";
      else state = "wrong";
      out.push(
        this.makeVerdict(globalWord, state, distance, heardRatio, margin, vowels.errors, vowels.margin),
      );
    }
    return out;
  }

  private lastRun(trail: number[]): number {
    let run = 0;
    for (let g = 1; g < trail.length; g++) {
      if (trail[g]! < trail[g - 1]!) run++;
    }
    return run;
  }

  private makeVerdict(
    globalWord: number,
    state: VerdictState,
    distance: number,
    heardRatio: number,
    margin: number,
    vowelErrors = 0,
    vowelMargin = 0,
  ): WordVerdict {
    const c = this.tracker.corpus;
    return {
      surah: c.wordSurah[globalWord]!,
      ayah: c.wordAyah[globalWord]!,
      word: c.wordInAyah[globalWord]!,
      wordIndex: globalWord,
      state,
      distance,
      heardRatio,
      margin,
      vowelErrors,
      vowelMargin,
    };
  }
}

/** Count aligned short-vowel substitutions inside one word. Only positions where
 * the heard char and the expected char are both short vowels count; consonant
 * errors, insertions and deletions are the distance's job. The expected word's
 * final vowel is always ignored: waqf drops it, and the model's Quranic prior
 * confidently rewrites case endings (e.g. الأرضَ heard as الأرضِ at p=0.99 on a
 * clean reference clip), so it cannot be trusted as evidence against the reciter. */
export function vowelMismatches(
  heard: readonly HeardChar[],
  from: number,
  heardSlice: string,
  expected: string,
  table: CostTable,
): { errors: number; margin: number } {
  if (!heardSlice.length || !expected.length) return { errors: 0, margin: 0 };
  const h = table.encode(heardSlice);
  const e = table.encode(expected);
  const assign = alignGlobal(h, e, 0, e.length, table);
  let errors = 0;
  let margin = Infinity;
  const lastVowel = SHORT_VOWELS.has(expected[expected.length - 1]!) ? expected.length - 1 : -1;
  for (let i = 0; i < assign.length; i++) {
    const j = assign[i]!;
    if (j < 0) continue;
    const hc = heardSlice[i]!;
    const ec = expected[j]!;
    if (hc === ec || !SHORT_VOWELS.has(hc) || !SHORT_VOWELS.has(ec)) continue;
    if (j === lastVowel) continue;
    errors++;
    const heardChar = heard[from + i];
    // Prefer the direct contrast p(heard vowel) - p(expected vowel) at the
    // token's peak frame; fall back to the token margin when unavailable.
    let m = heardChar?.margin ?? 0;
    if (heardChar?.vowels) {
      const hi = VOWEL_INDEX[hc];
      const ei = VOWEL_INDEX[ec];
      if (hi !== undefined && ei !== undefined) m = heardChar.vowels[hi]! - heardChar.vowels[ei]!;
    }
    if (m < margin) margin = m;
  }
  return { errors, margin: errors ? margin : 0 };
}

const VOWEL_INDEX: Record<string, number> = { "َ": 0, "ُ": 1, "ِ": 2 };

function tWordStart(t: Tracker, localWord: number): number {
  return t.wordStarts[localWord]!;
}

function sliceHeard(heard: readonly HeardChar[], from: number, to: number): string {
  let s = "";
  for (let i = from; i < to && i < heard.length; i++) s += heard[i]!.ch;
  return s;
}
