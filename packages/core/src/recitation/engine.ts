import { BUFFER_CAP, DEFAULT_CONFIG, type EngineConfig } from "./config.js";
import type { QuranCorpus } from "./corpus.js";
import { expandTokens } from "./ctcDecoder.js";
import type { QuranIndex } from "./search.js";
import { Tracker } from "./tracker.js";
import { VerdictTracer } from "./verdicts.js";
import type {
  CtcToken,
  EngineEvent,
  EngineState,
  HeardChar,
  SearchHint,
  WordVerdict,
} from "./types.js";

export class RecitationEngine {
  readonly corpus: QuranCorpus;
  readonly index: QuranIndex;
  readonly cfg: EngineConfig;
  state: EngineState = "searching";
  tracker: Tracker | null = null;
  tracer: VerdictTracer | null = null;
  framesDecoded = 0;
  heardTotal = 0;

  private buffer: HeardChar[] = [];
  private hint: SearchHint | null = null;
  private stay = false;
  private searchStartFrame = 0;
  private lastSearchFrame = 0;
  private lastSearchHeard = 0;
  private lastRelocateFrame = 0;
  private lastProgressFrame = 0;
  private lastCharFrame = 0;
  private locateFailedEmitted = false;
  private lostEmitted = false;
  private completedEmitted = false;
  private struggles = 0;
  private relocateCandidate: { surah: number; ayah: number } | null = null;
  private lastCursorWord = -1;
  private lastStates = new Map<number, string>();
  private prevSettled = false;
  private lastStruggleChars = 0;
  onBeforeRelocate: (() => void) | null = null;

  constructor(corpus: QuranCorpus, index: QuranIndex, cfg: EngineConfig = DEFAULT_CONFIG) {
    this.corpus = corpus;
    this.index = index;
    this.cfg = cfg;
  }

  setHint(hint: SearchHint | null): void {
    this.hint = hint;
  }

  setStayOnSurah(stay: boolean): void {
    this.stay = stay;
  }

  startSearch(): void {
    this.state = "searching";
    this.tracker = null;
    this.tracer = null;
    this.buffer = [];
    this.heardTotal = 0;
    this.searchStartFrame = this.framesDecoded;
    this.lastSearchFrame = this.framesDecoded;
    this.lastSearchHeard = 0;
    this.lastRelocateFrame = this.framesDecoded;
    this.lastProgressFrame = this.framesDecoded;
    this.lastCharFrame = this.framesDecoded;
    this.locateFailedEmitted = false;
    this.lostEmitted = false;
    this.completedEmitted = false;
    this.struggles = 0;
    this.relocateCandidate = null;
    this.lastCursorWord = -1;
    this.lastStates.clear();
    this.prevSettled = false;
    this.lastStruggleChars = 0;
  }

  track(surah: number, ayah: number, word = 0): EngineEvent[] {
    const wordIndex = this.corpus.wordIndex(surah, ayah, word);
    return this.lock(wordIndex, [], "located");
  }

  feed(tokens: readonly CtcToken[], framesDecoded: number): EngineEvent[] {
    if (framesDecoded < this.framesDecoded) {
      this.searchStartFrame = framesDecoded;
      this.lastSearchFrame = framesDecoded;
      this.lastRelocateFrame = framesDecoded;
      this.lastProgressFrame = framesDecoded;
      this.lastCharFrame = framesDecoded;
    }
    this.framesDecoded = framesDecoded;
    const chars = expandTokens(tokens);
    if (chars.length) {
      this.lastCharFrame = framesDecoded;
      this.heardTotal += chars.length;
      this.buffer.push(...chars);
      if (this.buffer.length > BUFFER_CAP) {
        this.buffer.splice(0, this.buffer.length - BUFFER_CAP);
      }
    }
    if (this.state === "searching") return this.feedSearching();
    return this.feedTracking(chars);
  }

  lock(
    wordIndex: number,
    replay: readonly HeardChar[],
    how: "located" | "relocated",
    from?: { surah: number; ayah: number },
  ): EngineEvent[] {
    if (how === "relocated") this.onBeforeRelocate?.();
    const surah = this.corpus.wordSurah[wordIndex]!;
    const ayah = this.corpus.wordAyah[wordIndex]!;
    const word = this.corpus.wordInAyah[wordIndex]!;
    const prev = this.tracker
      ? {
          surah: this.tracker.surah,
          ayah: this.corpus.wordAyah[this.tracker.cursorWordIndex]!,
        }
      : from;
    this.tracker = new Tracker(this.corpus, this.index.table, surah, wordIndex, this.cfg);
    this.tracer = new VerdictTracer(this.tracker, this.index.table, this.cfg);
    this.state = "tracking";
    this.lostEmitted = false;
    this.completedEmitted = false;
    this.struggles = 0;
    this.relocateCandidate = null;
    this.lastCursorWord = -1;
    this.lastStates.clear();
    this.prevSettled = false;
    this.lastRelocateFrame = this.framesDecoded;
    this.lastStruggleChars = this.heardTotal;
    const events: EngineEvent[] = [];
    if (how === "relocated" && prev) {
      events.push({
        type: "relocated",
        from: prev,
        to: { surah, ayah, word },
      });
    } else {
      events.push({
        type: "located",
        surah,
        ayah,
        word,
        replayed: replay.length,
      });
    }
    if (replay.length) this.tracker.feed(replay);
    events.push(...this.trackingEvents(false));
    return events;
  }

  private feedSearching(): EngineEvent[] {
    const events: EngineEvent[] = [];
    const minC = this.cfg.searchMinChars;
    const due =
      this.buffer.length >= minC &&
      (this.heardTotal - this.lastSearchHeard >= this.cfg.searchEveryChars ||
        (this.heardTotal - this.lastSearchHeard > 0 &&
          this.framesDecoded - this.lastSearchFrame >= this.cfg.searchEveryFrames));
    if (due) {
      this.lastSearchFrame = this.framesDecoded;
      this.lastSearchHeard = this.heardTotal;
      const qLen = Math.min(this.cfg.searchQueryChars, this.buffer.length);
      const qStart = this.buffer.length - qLen;
      const query = this.buffer.slice(qStart).map((c) => c.ch).join("");
      const result = this.index.search(query, this.hint);
      if (result.decisive && result.hits[0]) {
        const hit = result.hits[0];
        const replay = this.buffer.slice(qStart + hit.queryStart);
        return this.lock(hit.wordIndex, replay, "located");
      }
    }
    if (
      !this.locateFailedEmitted &&
      this.framesDecoded - this.searchStartFrame >= this.cfg.locateFailedFrames
    ) {
      this.locateFailedEmitted = true;
      events.push({ type: "locateFailed" });
    }
    return events;
  }

  private feedTracking(chars: readonly HeardChar[]): EngineEvent[] {
    if (!this.tracker || !this.tracer) return [];
    if (chars.length) this.tracker.feed(chars);
    const events = this.trackingEvents(chars.length > 0);
    if (this.tracker.lost) {
      if (!this.lostEmitted) {
        this.lostEmitted = true;
        events.push({ type: "lost" });
      }
    } else {
      this.lostEmitted = false;
    }

    if (this.framesDecoded - this.lastRelocateFrame >= this.cfg.relocateEveryFrames) {
      this.lastRelocateFrame = this.framesDecoded;
      const heardSinceTick = this.heardTotal - this.lastStruggleChars;
      this.lastStruggleChars = this.heardTotal;
      if (this.stay) {
        this.struggles = 0;
      } else {
        const moved = this.maybeRelocate();
        if (moved) return [...events, ...moved];
        if (heardSinceTick > 0) {
          const held = this.isHeld();
          this.struggles = this.tracker.lost || held ? this.struggles + 1 : 0;
          if (this.cfg.maxStruggles > 0 && this.struggles >= this.cfg.maxStruggles) {
            events.push({ type: "idle", reason: "lost" });
            this.struggles = 0;
            this.lastProgressFrame = this.framesDecoded;
          }
        }
      }
    }

    // A long word can keep the same cursor while fresh phonemes arrive. Only
    // silence after speech should abandon the lock, not a slow first word or
    // the user's initial pause before beginning a selected passage.
    if (this.tracker.heard.length > 0
      && this.framesDecoded - Math.max(this.lastProgressFrame, this.lastCharFrame) >= this.cfg.idleFrames) {
      events.push({ type: "idle", reason: "silent" });
      this.lastProgressFrame = this.framesDecoded;
    }
    return events;
  }

  private maybeRelocate(): EngineEvent[] | null {
    if (!this.tracker || this.buffer.length < this.cfg.searchMinChars) return null;
    const qLen = Math.min(this.cfg.relocateQueryChars, this.buffer.length);
    let qStart = this.buffer.length - qLen;
    const query = this.buffer.slice(qStart).map((c) => c.ch).join("");
    const result = this.index.search(query);
    let hit = result.hits[0];
    let rate = this.tracker.costRate();
    let recentPhrase = false;
    const currentAyah = this.corpus.wordAyah[this.tracker.cursorWordIndex]!;
    // At a selected start, a complete short ayah can be uniquely identified
    // before the ordinary cost window has enough characters. Compare the
    // entire first phrase, with an unhinted search and a real rival margin;
    // never use an older query to pull a progressing tracker backwards.
    const initialPhrase = !!this.hint && qStart === 0 && this.buffer.length === this.tracker.heard.length
      && hit?.surah === this.tracker.surah && hit.ayah !== currentAyah
      && hit.distance <= this.cfg.okDistance
      && (!result.hits[1] || result.hits[1].distance - hit.distance >= this.cfg.searchDecisiveMargin);
    if (initialPhrase && rate === null) rate = this.tracker.cursorCost / this.tracker.heard.length;
    // A short correction after a pause can be drowned out by the preceding
    // correctly followed ayah in both the search query and the long cost window.
    // Compare that new phrase separately, without clearing audio or alignment.
    // Keep the full query as fallback: an elongated word can also contain gaps.
    for (let start = this.buffer.length - 1; start > qStart; start--) {
      if (this.buffer[start]!.frame - this.buffer[start - 1]!.frame < this.cfg.settleFrames) continue;
      const recentRate = this.tracker.costRate(Math.min(this.cfg.holdWindow, this.buffer.length - start));
      if (this.buffer.length - start >= this.cfg.searchMinChars && recentRate !== null && recentRate >= this.cfg.lostRate) {
        const recent = this.index.search(this.buffer.slice(start).map(c => c.ch).join(''));
        const candidate = recent.hits[0];
        // Within the known surah, a short but uniquely identified correction
        // can be sufficient even when its onset was not decoded. It still needs
        // the ordinary distance, rival margin, and two agreeing checks.
        const uniqueInSurah = candidate?.surah === this.tracker.surah
          && (!recent.hits[1] || recent.hits[1].distance - candidate.distance >= this.cfg.searchDecisiveMargin);
        // A lesson knows which short ayah it is waiting for. A close, unique
        // match to that target can recover across surahs without requiring the
        // longer utterance used for unrestricted whole-Quran discovery.
        const uniqueExpected = candidate && this.hint && candidate.surah === this.hint.surah && candidate.ayah === this.hint.ayah
          && candidate.distance <= this.cfg.okDistance
          && (!recent.hits[1] || recent.hits[1].distance - candidate.distance >= this.cfg.searchDecisiveMargin);
        if ((recent.decisive || uniqueInSurah || uniqueExpected) && candidate && (candidate.surah !== this.tracker.surah || candidate.ayah !== currentAyah)
          && candidate.distance <= this.cfg.relocateMaxDistance
          && candidate.distance + this.cfg.relocateRateMargin <= recentRate) {
          hit = candidate;
          rate = recentRate;
          qStart = start;
          recentPhrase = true;
        }
      }
      break;
    }
    const candidate = hit ? { surah: hit.surah, ayah: hit.ayah } : null;
    const agrees =
      !!candidate &&
      !!this.relocateCandidate &&
      candidate.surah === this.relocateCandidate.surah &&
      candidate.ayah === this.relocateCandidate.ayah;
    this.relocateCandidate = candidate;
    if (
      hit &&
      rate !== null &&
      rate >= this.cfg.lostRate &&
      (hit.surah !== this.tracker.surah || ((recentPhrase || initialPhrase) && hit.ayah !== currentAyah)) &&
      hit.distance <= this.cfg.relocateMaxDistance &&
      hit.distance + this.cfg.relocateRateMargin <= rate &&
      agrees
    ) {
      const from = {
        surah: this.tracker.surah,
        ayah: this.corpus.wordAyah[this.tracker.cursorWordIndex]!,
      };
      const replay = this.buffer.slice(qStart + hit.queryStart);
      return this.lock(hit.wordIndex, replay, "relocated", from);
    }
    return null;
  }

  private isHeld(): boolean {
    if (!this.tracker) return false;
    const rate = this.tracker.costRate(this.cfg.holdWindow);
    return rate !== null && rate >= this.cfg.holdRate;
  }

  private settled(): boolean {
    return this.framesDecoded - this.lastCharFrame >= this.cfg.settleFrames;
  }

  private trackingEvents(gotChars: boolean): EngineEvent[] {
    if (!this.tracker || !this.tracer) return [];
    if (this.isHeld()) return [];
    const events: EngineEvent[] = [];
    const cursorIdx = this.tracker.cursorWordIndex;
    if (cursorIdx !== this.lastCursorWord) {
      this.lastCursorWord = cursorIdx;
      this.lastProgressFrame = this.framesDecoded;
      events.push({
        type: "cursor",
        surah: this.corpus.wordSurah[cursorIdx]!,
        ayah: this.corpus.wordAyah[cursorIdx]!,
        word: this.corpus.wordInAyah[cursorIdx]!,
        wordIndex: cursorIdx,
      });
    }
    const settled = this.settled();
    const silenceSettle = !gotChars && settled && !this.prevSettled;
    const vs = this.tracer.verdicts(settled);
    const changes: WordVerdict[] = [];
    const refreshPending = gotChars && this.prevSettled;
    for (const v of vs) {
      const key = `${v.state}:${v.distance}:${v.heardRatio}:${v.margin}`;
      const prev = this.lastStates.get(v.wordIndex);
      if (prev === key) continue;
      const wasPending = prev?.startsWith("pending:") ?? false;
      if (wasPending && v.state === "pending" && !refreshPending) continue;
      changes.push(v);
      this.lastStates.set(v.wordIndex, key);
      if (v.state !== "pending" && !silenceSettle) {
        this.lastProgressFrame = this.framesDecoded;
      }
    }
    if (changes.length) events.push({ type: "verdicts", changes });
    for (const key of this.lastStates.keys()) {
      if (!vs.some((v) => v.wordIndex === key)) this.lastStates.delete(key);
    }
    this.prevSettled = settled;
    if (!this.completedEmitted && this.tracker.reachedEnd) {
      const lastW = this.tracker.endWord - 1;
      const lastV = vs.find((v) => v.wordIndex === lastW);
      if (lastV && lastV.state !== "pending") {
        this.completedEmitted = true;
        events.push({ type: "completed", surah: this.tracker.surah });
      }
    }
    return events;
  }
}
