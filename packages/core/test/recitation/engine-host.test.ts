import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { requireCorpus, VECTORS } from "./paths";
import { pausalPhonemes } from "../../src/recitation/verdicts";
import { QuranCorpus } from "../../src/recitation/corpus";
import { QuranIndex } from "../../src/recitation/search";
import { RecitationEngine } from "../../src/recitation/engine";
import { wholeAyahFallback } from "../../src/recitation/fallback";
import { DEFAULT_CONFIG } from "../../src/recitation/config";
import { costTable } from "../../src/recitation/phonemeCost";
import {
  ayahMeetsGate,
  snapshotTallies,
  type EmissionVerdict,
} from "../../src/recitation/emission";
import type { CtcToken, EngineEvent } from "../../src/recitation/types";

const CORPUS_PATH = requireCorpus();

function load<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(VECTORS, name), "utf8")) as T;
}

const corpus = new QuranCorpus(JSON.parse(readFileSync(CORPUS_PATH, "utf8")));
const index = new QuranIndex(corpus, DEFAULT_CONFIG);
const table = costTable();

describe("waqf", () => {
  const vec = load<{
    examples: {
      phonemes: string;
      plain: string;
      atAyahEnd: boolean;
      pausal: string | null;
      pausalIfForcedNotAyahEnd: string | null;
    }[];
  }>("waqf.json");
  it("pausal derivations", () => {
    for (const ex of vec.examples) {
      expect(pausalPhonemes(ex.phonemes, ex.plain, ex.atAyahEnd)).toBe(ex.pausal);
      expect(pausalPhonemes(ex.phonemes, ex.plain, false)).toBe(ex.pausalIfForcedNotAyahEnd);
    }
  });
});

interface EventVec {
  finalState: string;
  cursor: {
    wordIndex: number;
    surah: number;
    ayah: number;
    word: number;
    cost: number;
  } | null;
  settledVerdicts: unknown[];
  transcript: string;
  framesDecoded: number;
  chunks: Array<{
    tokens: CtcToken[];
    framesDecoded: number;
    events: EngineEvent[];
  }>;
}

function runEvents(name: string) {
  const vec = load<EventVec>(name);
  const engine = new RecitationEngine(corpus, index, DEFAULT_CONFIG);
  engine.setStayOnSurah(false);
  engine.startSearch();
  const all: EngineEvent[] = [];
  for (let i = 0; i < vec.chunks.length; i++) {
    const ch = vec.chunks[i]!;
    const ev = engine.feed(ch.tokens, ch.framesDecoded);
    expect(ev, `chunk ${i} kind frames=${ch.framesDecoded}`).toEqual(ch.events);
    all.push(...ev);
  }
  expect(engine.state).toBe(vec.finalState);
  expect(engine.framesDecoded).toBe(vec.framesDecoded);
  if (vec.cursor) {
    expect(engine.tracker).not.toBeNull();
    expect(engine.tracker!.cursorWordIndex).toBe(vec.cursor.wordIndex);
    expect(engine.tracker!.surah).toBe(vec.cursor.surah);
    expect(engine.corpus.wordAyah[engine.tracker!.cursorWordIndex]).toBe(vec.cursor.ayah);
    expect(engine.corpus.wordInAyah[engine.tracker!.cursorWordIndex]).toBe(vec.cursor.word);
    expect(engine.tracker!.cursorCost).toBe(vec.cursor.cost);
  } else {
    expect(engine.tracker).toBeNull();
  }
  if (vec.settledVerdicts.length) {
    const got = engine.tracer!.verdicts(true);
    expect(got).toEqual(vec.settledVerdicts);
  }
  return { engine, vec, all };
}

describe("engine events", () => {
  it('recognizes a unique short wrong ayah at a selected start without a preceding pause', () => {
    const engine = new RecitationEngine(corpus, index, { ...DEFAULT_CONFIG, relocateEveryFrames: 12 });
    engine.setHint({ surah: 112, ayah: 2 });
    engine.track(112, 2);
    let frame = 0;
    // Actual decoded 112:1 is shorter than the tracker's 24-character cost gate.
    for (const sym of 'قُلهُوَللَااهُءَحَدڇ') {
      frame += 3;
      engine.feed([{ sym, frame, margin: 1 }], frame);
    }
    engine.feed([], frame + 12);
    engine.feed([], frame + 24);
    expect(corpus.wordAyah[engine.tracker!.cursorWordIndex]).toBe(1);
    expect(engine.tracer!.verdicts(true).filter(v => v.state === 'ok').length).toBeGreaterThanOrEqual(3);
  });

  it('does not move a selected short ayah on its shared first word', () => {
    const engine = new RecitationEngine(corpus, index, { ...DEFAULT_CONFIG, relocateEveryFrames: 12 });
    engine.setHint({ surah: 112, ayah: 2 });
    engine.track(112, 2);
    const events: EngineEvent[] = [];
    let frame = 0;
    for (const sym of 'ءَللَااهُ') {
      frame += 3;
      events.push(...engine.feed([{ sym, frame, margin: 1 }], frame));
    }
    events.push(...engine.feed([], frame + 40));
    expect(events.filter(e => e.type === 'relocated')).toEqual([]);
  });
  it.each([{ surah: 1, ayah: 2, missingOnset: 0 }, { surah: 112, ayah: 3, missingOnset: 0 }, { surah: 112, ayah: 3, missingOnset: 2 }])('returns after $surah:$ayah with $missingOnset onset characters missing, without resetting', wrong => {
    const engine = new RecitationEngine(corpus, index, DEFAULT_CONFIG);
    engine.track(112, 1);
    let frame = 0;
    const recite = (surah: number, ayah: number, missingOnset = 0) => {
      for (const sym of corpus.ayahPhonemes(surah, ayah).slice(missingOnset)) {
        frame += 3;
        engine.feed([{ sym, frame, margin: 1 }], frame);
      }
      // Let the two agreeing relocation checks settle the recognized phrase.
      for (let i = 0; i < 3; i++) { frame += 40; engine.feed([], frame); }
    };
    recite(wrong.surah, wrong.ayah);
    expect(engine.tracker?.surah).toBe(wrong.surah);
    expect(engine.corpus.wordAyah[engine.tracker!.cursorWordIndex]).toBe(wrong.ayah);
    recite(112, 1, wrong.missingOnset);
    expect(engine.tracker?.surah).toBe(112);
    expect(engine.corpus.wordAyah[engine.tracker!.cursorWordIndex]).toBe(1);
    expect(engine.tracer?.verdicts(true).filter(v => v.state === 'ok').length).toBeGreaterThan(0);
  });

  it('keeps following the current surah through ordinary pauses and short shared words', () => {
    const engine = new RecitationEngine(corpus, index, DEFAULT_CONFIG);
    engine.track(1, 2);
    let frame = 0;
    const events: EngineEvent[] = [];
    for (const ayah of [2, 3, 4, 5]) {
      for (const sym of corpus.ayahPhonemes(1, ayah)) {
        frame += 3;
        events.push(...engine.feed([{ sym, frame, margin: 1 }], frame));
      }
      frame += 40;
      events.push(...engine.feed([], frame));
    }
    expect(events.filter(e => e.type === 'relocated')).toEqual([]);
    expect(engine.tracker?.surah).toBe(1);
    expect(engine.corpus.wordAyah[engine.tracker!.cursorWordIndex]).toBe(5);
  });

  it('keeps a selected start while waiting for speech and while a long word is still being recited', () => {
    const engine = new RecitationEngine(corpus, index, DEFAULT_CONFIG);
    engine.track(2, 1);
    let frame = DEFAULT_CONFIG.idleFrames + 25;
    expect(engine.feed([], frame).filter(e => e.type === 'idle')).toEqual([]);
    // Space the phonemes over more than eight seconds without changing words.
    for (const sym of corpus.ayahPhonemes(2, 1)) {
      frame += 15;
      const events = engine.feed([{ sym, frame, margin: 1 }], frame);
      expect(events.filter(e => e.type === 'idle')).toEqual([]);
    }
    expect(engine.tracker?.cursorWordIndex).toBe(corpus.wordIndex(2, 1, 0));
    // Once speech really ends, retain the ordinary idle reset.
    expect(engine.feed([], frame + DEFAULT_CONFIG.idleFrames + 1)).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'idle', reason: 'silent' })]),
    );
  });

  it("events_001002.json stays searching with zero events", () => {
    runEvents("events_001002.json");
  });
  it("events_001001.json stays searching with zero events", () => {
    runEvents("events_001001.json");
  });
  it("events_ea_alafasy_multi_001_001_007.json locates Fatiha", () => {
    runEvents("events_ea_alafasy_multi_001_001_007.json");
  });
});

describe("host policy", () => {
  function hostOf(eventFile: string, hostFile: string) {
    const { engine, vec } = runEvents(eventFile);
    const host = load<{
      tallies: Array<{
        surah: number;
        ayah: number;
        ok: number;
        unsure: number;
        wrong: number;
        skipped: number;
        pending: number;
        words: number;
        firstSeen: number;
      }>;
      verses: unknown[];
      fallback: { surah: number; ayah: number; distance: number; how: string } | null;
      engineEvents: string[];
    }>(hostFile);
    const fallback = wholeAyahFallback(vec.transcript, corpus, table);
    const wordCount = (s: number, a: number) => corpus.ayahWordCount(s, a);
    const snap = engine.tracer
      ? snapshotTallies(engine.tracer.verdicts(true) as EmissionVerdict[], wordCount)
      : new Map();
    const tallies = [...snap.values()].filter((t) => ayahMeetsGate(t));
    return { host, fallback, tallies, engine };
  }

  it("host_001002.json whole-ayah fallback", () => {
    const { host, fallback, tallies } = hostOf("events_001002.json", "host_001002.json");
    expect(tallies).toEqual(host.tallies);
    expect(fallback).toEqual(host.fallback);
  });

  it("host_001001.json basmala fallback", () => {
    const { host, fallback, tallies } = hostOf("events_001001.json", "host_001001.json");
    expect(tallies).toEqual(host.tallies);
    expect(fallback).toEqual(host.fallback);
  });

  it("host_ea_alafasy_multi gated ayahs, no fallback", () => {
    const { host, fallback, tallies } = hostOf(
      "events_ea_alafasy_multi_001_001_007.json",
      "host_ea_alafasy_multi_001_001_007.json",
    );
    expect(tallies).toEqual(host.tallies);
    expect(fallback).toBeNull();
    expect(host.fallback).toBeNull();
  });
});
