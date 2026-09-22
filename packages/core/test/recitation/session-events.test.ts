/**
 * `ZipformerSession` end to end with a scripted ONNX session: fbank -> runner
 * -> greedy CTC -> engine -> emission -> SDK verse events. No model file.
 *
 * The stub ignores the audio and plays back a phoneme timeline taken from the
 * corpus itself (one token every other frame, blank in between so repeated
 * letters survive CTC collapsing), which is what a perfect decode of that
 * recitation would look like.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QuranCorpus } from "../../src/recitation/corpus";
import {
  DEFAULT_ZIPFORMER_IO,
  ZipformerSession,
  createZipformerSession,
} from "../../src/recitation/session";
import { BLANK_ID, TOKENS, VOCAB_SIZE } from "../../src/recitation/tokens";
import type { OrtSessionLike, TensorLike } from "../../src/recitation/zipformerRunner";
import type { WorkerOutbound } from "../../src/types";
import { findModelIo, requireCorpus } from "./paths";

const SAMPLE_RATE = 16000;
const CHUNK = 7680; // 480 ms — one Zipformer hop worth of fbank frames
const FRAMES_PER_RUN = 12; // 48 fbank frames, subsampling factor 4
const HIGH = Math.log(0.9);
const LOW = Math.log(0.001);

const corpusJson = JSON.parse(readFileSync(requireCorpus(), "utf8"));
const corpus = new QuranCorpus(corpusJson);

const TOKEN_ID = new Map<string, number>();
for (let id = 0; id < TOKENS.length; id++) {
  const sym = TOKENS[id]!;
  if (sym.length === 1 && !TOKEN_ID.has(sym)) TOKEN_ID.set(sym, id);
}

function tokenIds(phonemes: string): number[] {
  return [...phonemes].map((ch) => {
    const id = TOKEN_ID.get(ch);
    if (id === undefined) throw new Error(`no CTC token for phoneme ${JSON.stringify(ch)}`);
    return id;
  });
}

class StubTensor implements TensorLike {
  readonly type: string;
  readonly data: Float32Array | BigInt64Array | Int32Array;
  readonly dims: readonly number[];

  constructor(
    type: string,
    data: Float32Array | BigInt64Array | Int32Array,
    dims: readonly number[],
  ) {
    this.type = type;
    this.data = data;
    this.dims = dims;
  }
}

/** Replays a fixed token queue, one token per two output frames. */
class ScriptedOrtSession implements OrtSessionLike {
  private readonly queue: number[];
  runs = 0;

  constructor(ids: readonly number[]) {
    this.queue = [...ids];
  }

  enqueue(ids: number[]): void { this.queue.push(...ids); }

  get pending(): number {
    return this.queue.length;
  }

  async run(feeds: Record<string, TensorLike>): Promise<Record<string, TensorLike>> {
    this.runs++;
    const out: Record<string, TensorLike> = {};
    for (const [name, tensor] of Object.entries(feeds)) {
      if (name !== "x") out[`new_${name}`] = tensor;
    }
    const data = new Float32Array(FRAMES_PER_RUN * VOCAB_SIZE).fill(LOW);
    for (let frame = 0; frame < FRAMES_PER_RUN; frame++) {
      const id = frame % 2 === 0 ? this.queue.shift() ?? BLANK_ID : BLANK_ID;
      data[frame * VOCAB_SIZE + id] = HIGH;
    }
    out.log_probs = new StubTensor("float32", data, [1, FRAMES_PER_RUN, VOCAB_SIZE]);
    return out;
  }
}

const TensorCtor = StubTensor as unknown as new (
  type: string,
  data: Float32Array | BigInt64Array | Int32Array,
  dims: readonly number[],
) => TensorLike;

const FATIHA = [1, 2, 3, 4, 5, 6, 7].map((ayah) => corpus.ayahPhonemes(1, ayah)).join("");

async function runFatiha(): Promise<{
  session: ZipformerSession;
  seen: WorkerOutbound[];
  returned: WorkerOutbound[];
  ort: ScriptedOrtSession;
}> {
  const ort = new ScriptedOrtSession(tokenIds(FATIHA));
  const seen: WorkerOutbound[] = [];
  const session = await createZipformerSession({
    session: ort,
    Tensor: TensorCtor,
    corpus: corpusJson,
    quran: [
      {
        surah: 1,
        ayah: 2,
        text_uthmani: "ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ",
        surah_name: "الفاتحة",
        surah_name_en: "Al-Fatihah",
      },
    ],
    onEvent: (msg) => seen.push(msg),
  });

  // 2 frames per token, 12 frames per run: enough audio to drain the queue.
  const chunks = Math.ceil((tokenIds(FATIHA).length * 2) / FRAMES_PER_RUN) + 3;
  const returned: WorkerOutbound[] = [];
  for (let i = 0; i < chunks; i++) {
    returned.push(...(await session.feed(new Float32Array(CHUNK))));
  }
  returned.push(...(await session.stop()));
  return { session, seen, returned, ort };
}

describe("ZipformerSession", () => {
  it('retains the active decoder when nonblocking practice temporarily loses its place', async () => {
    const ort = new ScriptedOrtSession(tokenIds(corpus.ayahPhonemes(1, 2)));
    const session = await ZipformerSession.create({ session: ort, Tensor: TensorCtor, corpus: corpusJson,
      config: { maxStruggles: 1 }, debug: true });
    session.reset({ start: { surah: 2, ayah: 1 }, deferCorrections: true });
    let lost = false;
    for (let i = 0; i < 20; i++) {
      const messages = await session.feed(new Float32Array(CHUNK));
      if (messages.some(m => m.type === 'debug' && m.event === 'idle' && m.data.reason === 'lost')) {
        lost = true;
        expect(session.engineState).toBe('tracking');
        break;
      }
    }
    expect(lost).toBe(true);
    // The same decoder consumes the remaining acoustic stream, including its tail.
    while (ort.pending) await session.feed(new Float32Array(CHUNK));
    expect(session.transcript).toBe(corpus.ayahPhonemes(1, 2));
  });

  it("bundles the shipped model's I/O manifest", () => {
    expect(DEFAULT_ZIPFORMER_IO.T).toBe(61);
    expect(DEFAULT_ZIPFORMER_IO.hop).toBe(48);
    expect(DEFAULT_ZIPFORMER_IO.featureDim).toBe(80);
    expect(DEFAULT_ZIPFORMER_IO.vocabSize).toBe(VOCAB_SIZE);
    expect(DEFAULT_ZIPFORMER_IO.inputs[0]?.name).toBe("x");

    const shipped = findModelIo();
    if (shipped) {
      expect(DEFAULT_ZIPFORMER_IO).toEqual(JSON.parse(readFileSync(shipped, "utf8")));
    }
  });

  it("rejects an incomplete runtime seam", async () => {
    await expect(
      createZipformerSession({ corpus: corpusJson } as never),
    ).rejects.toThrow(/pass `ort` \+ `model`/);
    await expect(
      createZipformerSession({ session: new ScriptedOrtSession([]), corpus: corpusJson }),
    ).rejects.toThrow(/`Tensor`/);
  });

  it("turns a scripted decode of al-Fatiha into SDK verse events", async () => {
    const { session, seen, returned, ort } = await runFatiha();

    expect(ort.runs).toBeGreaterThan(10);
    expect(ort.pending).toBe(0);
    expect(seen).toEqual(returned);

    expect(session.transcript).toBe(FATIHA);
    // Finishing a surah drops back to searching, ready for the next one.
    expect(session.engineState).toBe("searching");

    const types = new Set(returned.map((m) => m.type));
    expect(types).toContain("verse_candidate");
    expect(types).toContain("word_progress");
    expect(types).toContain("raw_transcript");
    expect(types).toContain("verse_match");
    expect(types).toContain("final_sequence");

    const candidate = returned.find((m) => m.type === "verse_candidate");
    expect(candidate).toMatchObject({
      stable: false,
      final_flush: false,
      candidates: [{ surah: 1, rank: 0, source: "discovery" }],
    });

    const progress = returned.filter((m) => m.type === "word_progress");
    for (const p of progress) {
      if (p.type !== "word_progress") continue;
      expect(p.surah).toBe(1);
      expect(p.total_words).toBe(corpus.ayahWordCount(p.surah, p.ayah));
      expect(p.word_index).toBeLessThan(p.total_words);
    }

    const matches = returned.filter((m) => m.type === "verse_match");
    const refs = matches.map((m) => (m.type === "verse_match" ? `${m.surah}:${m.ayah}` : ""));
    expect(refs).toContain("1:2");
    expect(refs).toContain("1:7");
    expect(new Set(refs).size).toBe(refs.length); // each ayah emitted once
    for (const m of matches) {
      if (m.type !== "verse_match") continue;
      expect(m.surah).toBe(1);
      expect(m.confidence).toBeGreaterThanOrEqual(0.5);
    }

    // Display text comes from the `quran` source; only 1:2 was provided.
    const fatiha2 = matches.find((m) => m.type === "verse_match" && m.ayah === 2);
    expect(fatiha2).toMatchObject({ surah_name: "الفاتحة" });

    const final = returned.filter((m) => m.type === "final_sequence").at(-1);
    expect(final?.type).toBe("final_sequence");
    if (final?.type !== "final_sequence") throw new Error("unreachable");
    const sequence = final.verses.map((v) => `${v.surah}:${v.ayah}`);
    expect(sequence).toEqual([...sequence].sort(byAyah));
    expect(sequence).toContain("1:2");
    expect(final.confidence).toBeGreaterThan(0.5);

    expect(session.verses.map((t) => `${t.surah}:${t.ayah}`)).toEqual(
      expect.arrayContaining(["1:2", "1:7"]),
    );
  }, 120_000);

  it("reset() clears the transcript and the emitted set", async () => {
    const { session } = await runFatiha();
    expect(session.transcript.length).toBeGreaterThan(0);

    session.reset();
    expect(session.transcript).toBe("");
    expect(session.tallies).toEqual([]);
    expect(session.verses).toEqual([]);
    expect(session.engineState).toBe("searching");
    expect(session.lastFallback).toBeNull();
  }, 120_000);
});

function byAyah(a: string, b: string): number {
  const [as, aa] = a.split(":").map(Number) as [number, number];
  const [bs, ba] = b.split(":").map(Number) as [number, number];
  return as - bs || aa - ba;
}


describe('live correction through the injected ONNX boundary', () => {
  it.each(['omission', 'substitution'] as const)('detects a %s, isolates fresh retries, and preserves main verse history', async (kind) => {
    const first = corpus.wordIndex(112, 3, 0);
    const ayah = Array.from({ length: 4 }, (_, i) => corpus.wordPhonemes(first + i));
    const intro = corpus.ayahPhonemes(112, 1) + corpus.ayahPhonemes(112, 2);
    const changed = ayah.map((ph, i) => i !== 1 ? ph : kind === 'omission' ? '' : corpus.wordPhonemes(corpus.wordIndex(109, 1, 2)));
    const ort = new ScriptedOrtSession(tokenIds(intro + changed.join('')));
    const session = await ZipformerSession.create({ session: ort, Tensor: TensorCtor, corpus: corpusJson });
    session.setMode('correction');
    const seen: WorkerOutbound[] = [];
    for (let i = 0; i < 60 && session.correction.state.phase === 'idle'; i++) {
      seen.push(...await session.feed(new Float32Array(CHUNK)));
    }
    expect(seen.find(m => m.type === 'correction')).toMatchObject({
      state: { phase: 'error', issue: { surah: 112, ayah: 3, word: 1, kind: `possible_${kind}` } }, totalWords: 4,
    });
    const resume = { ...session.correction.state.resume! };
    const transcript = session.transcript;
    const verses = session.verses;
    expect(verses.map(v => `${v.surah}:${v.ayah}`)).toEqual(["112:1", "112:2", "112:3"]);
    session.correct('retry');
    // Silence and a cursor lock must not produce a successful retry.
    for (let i = 0; i < 5; i++) await session.feed(new Float32Array(CHUNK));
    expect(session.correction.state.phase).toBe('retrying');
    ort.enqueue(tokenIds(ayah.join('')));
    const practice: WorkerOutbound[] = [];
    for (let i = 0; i < 30 && session.correction.state.phase === 'retrying'; i++) {
      practice.push(...await session.feed(new Float32Array(CHUNK)));
    }
    expect(session.correction.state.phase).toBe('corrected');
    expect(practice.every(m => m.type === 'correction')).toBe(true);
    expect(session.transcript).toBe(transcript);
    expect(session.verses).toEqual(verses);
    session.correct('continue');
    expect(session.correction.state).toMatchObject({ phase: 'idle', outcome: 'corrected', resume });
    ort.enqueue(tokenIds(corpus.ayahPhonemes(112, 4)));
    const continued: WorkerOutbound[] = [];
    for (let i = 0; i < 20; i++) continued.push(...await session.feed(new Float32Array(CHUNK)));
    expect(continued.some(m => m.type === 'word_progress' && m.surah === 112 && m.ayah === 4)).toBe(true);
  });
});

describe('selected passage recall', () => {
  it('reports a different surah during the phrase instead of waiting for slow relocation polls', async () => {
    const ort = new ScriptedOrtSession(tokenIds(corpus.ayahPhonemes(1, 2)));
    const session = await ZipformerSession.create({ session: ort, Tensor: TensorCtor, corpus: corpusJson });
    session.reset({ start: { surah: 112, ayah: 1 }, deferCorrections: true });
    const seen: WorkerOutbound[] = [];
    // 3.84 seconds of streaming input: enough distinctive speech to show three
    // matched words, without waiting for the old second relocation poll at 6 s.
    for (let i = 0; i < 8; i++) seen.push(...await session.feed(new Float32Array(CHUNK)));
    expect(seen.some(m => m.type === 'word_progress' && m.surah === 1 && m.ayah === 2
      && m.matched_indices.length >= 3)).toBe(true);
    expect(session.engineState).toBe('tracking');
    expect(session.transcript.length).toBeGreaterThan(0);
  });

  it('updates the expected ayah without clearing history or treating a shared word as recovery', async () => {
    const ort = new ScriptedOrtSession(tokenIds(corpus.ayahPhonemes(1, 2)));
    const session = await ZipformerSession.create({ session: ort, Tensor: TensorCtor, corpus: corpusJson });
    session.reset({ start: { surah: 112, ayah: 1 }, deferCorrections: true });
    for (let i = 0; i < 35; i++) await session.feed(new Float32Array(CHUNK));
    const before = session.transcript;
    const verses = session.verses;
    session.setExpectedAyah({ surah: 112, ayah: 2 });
    expect(session.transcript).toBe(before);
    expect(session.verses).toEqual(verses);
    expect(() => session.setExpectedAyah({ surah: 112, ayah: 99 })).toThrow('Invalid expected ayah');
    ort.enqueue(tokenIds(corpus.wordPhonemes(corpus.ayahFirstWord(112, 2))));
    const partial: WorkerOutbound[] = [];
    for (let i = 0; i < 12; i++) partial.push(...await session.feed(new Float32Array(CHUNK)));
    expect(partial.some(m => m.type === 'word_progress' && m.surah === 112 && m.ayah === 2 && m.matched_indices.length)).toBe(false);
    ort.enqueue(tokenIds(corpus.ayahPhonemes(112, 2)));
    const complete: WorkerOutbound[] = [];
    for (let i = 0; i < 16; i++) complete.push(...await session.feed(new Float32Array(CHUNK)));
    expect(complete).toEqual(expect.arrayContaining([expect.objectContaining({
      type: 'word_progress', surah: 112, ayah: 2, matched_indices: [0, 1],
    })]));
  });

  it.each([{ surah: 112, ayah: 1 }, { surah: 1, ayah: 2 }])('picks up 112:2 after wrong $surah:$ayah and a long pause in the same recording', async wrong => {
    const ort = new ScriptedOrtSession(tokenIds(corpus.ayahPhonemes(wrong.surah, wrong.ayah)));
    const session = await ZipformerSession.create({ session: ort, Tensor: TensorCtor, corpus: corpusJson });
    session.reset({ start: { surah: 112, ayah: 2 }, deferCorrections: true });
    session.setMode('correction');
    for (let i = 0; i < 35; i++) await session.feed(new Float32Array(CHUNK));
    // The reader pauses on the warning, then recites the requested short ayah.
    ort.enqueue(tokenIds(corpus.ayahPhonemes(112, 2)));
    const resumed: WorkerOutbound[] = [];
    for (let i = 0; i < 16; i++) resumed.push(...await session.feed(new Float32Array(CHUNK)));
    expect(resumed).toEqual(expect.arrayContaining([expect.objectContaining({
      type: 'word_progress', surah: 112, ayah: 2, matched_indices: [0, 1],
    })]));
  });

  it('accepts an optional Bismillah without losing the selected 2:1 or awarding it early', async () => {
    const ort = new ScriptedOrtSession(tokenIds(corpus.ayahPhonemes(1, 1)));
    const session = await ZipformerSession.create({ session: ort, Tensor: TensorCtor, corpus: corpusJson });
    session.reset({ start: { surah: 2, ayah: 1 }, deferCorrections: true });
    session.setMode('correction');
    const opening: WorkerOutbound[] = [];
    for (let i = 0; i < 16; i++) opening.push(...await session.feed(new Float32Array(CHUNK)));
    expect(opening).toEqual(expect.arrayContaining([{ type: 'recitation_preamble', kind: 'basmala', complete: true }]));
    expect(opening.some(m => m.type === 'verse_match'
      || (m.type === 'word_progress' && m.matched_indices.length > 0))).toBe(false);
    ort.enqueue(tokenIds(corpus.ayahPhonemes(2, 1)));
    const ayah: WorkerOutbound[] = [];
    for (let i = 0; i < 20; i++) ayah.push(...await session.feed(new Float32Array(CHUNK)));
    expect(ayah).toEqual(expect.arrayContaining([expect.objectContaining({
      type: 'word_progress', surah: 2, ayah: 1, matched_indices: [0],
    })]));
    expect(ayah.filter(m => m.type === 'verse_match').map(m => m.type === 'verse_match' ? `${m.surah}:${m.ayah}` : '')).toEqual(['2:1']);
  });

  it('counts Bismillah as the actual ayah when 1:1 is selected', async () => {
    const ort = new ScriptedOrtSession(tokenIds(corpus.ayahPhonemes(1, 1)));
    const session = await ZipformerSession.create({ session: ort, Tensor: TensorCtor, corpus: corpusJson });
    session.reset({ start: { surah: 1, ayah: 1 } });
    const messages: WorkerOutbound[] = [];
    for (let i = 0; i < 20; i++) messages.push(...await session.feed(new Float32Array(CHUNK)));
    expect(messages.some(m => m.type === 'recitation_preamble')).toBe(false);
    expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'verse_match', surah: 1, ayah: 1 })]));
  });

  it('does not turn a standalone optional opening into a verse match on Finish', async () => {
    const ort = new ScriptedOrtSession(tokenIds(corpus.ayahPhonemes(1, 1)));
    const session = await ZipformerSession.create({ session: ort, Tensor: TensorCtor, corpus: corpusJson });
    session.reset({ start: { surah: 2, ayah: 1 } });
    const messages: WorkerOutbound[] = [];
    for (let i = 0; i < 16; i++) messages.push(...await session.feed(new Float32Array(CHUNK)));
    messages.push(...await session.stop());
    expect(messages.filter(m => m.type === 'verse_match')).toEqual([]);
    expect(messages.find(m => m.type === 'final_sequence')).toMatchObject({ verses: [] });
  });

  it.each([{ surah: 2, ayah: 1 }, { surah: 55, ayah: 64 }])('reports the first word of a selected one-word ayah $surah:$ayah', async (start) => {
    const ort = new ScriptedOrtSession([]);
    const session = await ZipformerSession.create({ session: ort, Tensor: TensorCtor, corpus: corpusJson });
    session.setMode('correction');
    // Include a fresh retry: reset must restore the session cursor each time.
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(session.reset({ start, deferCorrections: true })).toEqual([]);
      const silence: WorkerOutbound[] = [];
      for (let i = 0; i < 4; i++) silence.push(...await session.feed(new Float32Array(CHUNK)));
      expect(silence.some(m => m.type === 'verse_match'
        || (m.type === 'word_progress' && m.matched_indices.length > 0))).toBe(false);
      ort.enqueue(tokenIds(corpus.ayahPhonemes(start.surah, start.ayah)));
      const messages: WorkerOutbound[] = [];
      for (let i = 0; i < 20; i++) messages.push(...await session.feed(new Float32Array(CHUNK)));
      expect(messages).toEqual(expect.arrayContaining([expect.objectContaining({
        type: 'word_progress', ...start, word_index: 0, total_words: 1, matched_indices: [0],
      })]));
    }
  });

  it('seeds a short ayah without awarding recognition, and resets back to discovery', async () => {
    const ort = new ScriptedOrtSession([]);
    const session = await ZipformerSession.create({ session: ort, Tensor: TensorCtor, corpus: corpusJson });
    expect(session.reset({ start: { surah: 1, ayah: 2 } })).toEqual([]);
    expect(session.verses).toEqual([]);
    for (let i = 0; i < 4; i++) expect((await session.feed(new Float32Array(CHUNK))).filter(m => m.type === 'verse_match')).toEqual([]);
    ort.enqueue(tokenIds(corpus.ayahPhonemes(1, 2)));
    const messages: WorkerOutbound[] = [];
    for (let i = 0; i < 25; i++) messages.push(...await session.feed(new Float32Array(CHUNK)));
    expect(messages.some(m => m.type === 'word_progress' && m.surah === 1 && m.ayah === 2 && m.matched_indices.length > 0)).toBe(true);
    expect(messages.some(m => m.type === 'verse_match' && m.surah === 1 && m.ayah === 2)).toBe(true);
    session.reset();
    expect(session.engineState).toBe('searching');
    expect(session.verses).toEqual([]);
    expect(() => session.reset({ start: { surah: 112, ayah: 5 } })).toThrow('Invalid recitation');
  });

  it('reports a skipped ayah and continues decoding the following ayahs without an acoustic reset', async () => {
    const script = [1, 3, 4, 5].map(a => corpus.ayahPhonemes(104, a)).join('');
    const ort = new ScriptedOrtSession(tokenIds(script));
    const session = await ZipformerSession.create({ session: ort, Tensor: TensorCtor, corpus: corpusJson });
    session.setMode('correction');
    session.reset({ start: { surah: 104, ayah: 1 }, deferCorrections: true });
    const messages: WorkerOutbound[] = [];
    for (let i = 0; i < 65; i++) {
      messages.push(...await session.feed(new Float32Array(CHUNK)));
      expect(session.correction.state.phase).toBe('idle');
    }
    messages.push(...await session.stop());
    expect(messages.filter(m => m.type === 'correction')).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: expect.objectContaining({ phase: 'error', issue: expect.objectContaining({ surah: 104, ayah: 2, kind: 'possible_skipped_ayah' }) }) }),
    ]));
    expect(messages.filter(m => m.type === 'verse_match').map(m => m.type === 'verse_match' ? m.ayah : 0)).toEqual([1, 3, 4, 5]);
    expect(session.transcript).toBe(script);
    expect(messages.some(m => m.type === 'final_sequence')).toBe(true);
  });
});

describe('ayah-level gaps in correction mode', () => {
  /** Deterministic scramble of one ayah: audio was heard, but it matches nothing. */
  function mush(phonemes: string): string {
    const chars = [...phonemes];
    let seed = 7;
    for (let i = chars.length - 1; i > 0; i--) {
      seed = (seed * 48271) % 2147483647;
      const j = seed % (i + 1);
      [chars[i], chars[j]] = [chars[j]!, chars[i]!];
    }
    return chars.join('');
  }
  async function run(script: string, silentChunks = 0, tail = '') {
    const ort = new ScriptedOrtSession(tokenIds(script));
    const session = await ZipformerSession.create({ session: ort, Tensor: TensorCtor, corpus: corpusJson });
    session.setMode('correction');
    const seen: WorkerOutbound[] = [];
    const drain = async (max: number) => {
      for (let i = 0; i < max && session.correction.state.phase === 'idle'; i++) {
        seen.push(...await session.feed(new Float32Array(CHUNK)));
      }
    };
    await drain(Math.ceil(script.length * 2 / FRAMES_PER_RUN) + 4);
    if (silentChunks) {
      for (let i = 0; i < silentChunks; i++) seen.push(...await session.feed(new Float32Array(CHUNK)));
      ort.enqueue(tokenIds(tail));
      await drain(Math.ceil(tail.length * 2 / FRAMES_PER_RUN) + 4);
    }
    const flags = seen.filter(m => m.type === 'correction');
    const refs = seen.filter(m => m.type === 'verse_match').map(m => m.type === 'verse_match' ? `${m.surah}:${m.ayah}` : '');
    return { ort, session, seen, flags, refs };
  }
  const a = (n: number) => corpus.ayahPhonemes(104, n);

  it('case A: ayah 2 never heard → possible_skipped_ayah for 104:2, whole ayah', async () => {
    const { flags, refs } = await run(a(1) + a(3));
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ state: { phase: 'error', issue: {
      surah: 104, ayah: 2, word: 0, wordIndex: corpus.wordIndex(104, 2, 0), kind: 'possible_skipped_ayah', words: 4,
    }, resume: { surah: 104, ayah: 3 } }, totalWords: 4 });
    expect(refs).toEqual(['104:1', '104:3']);
  });

  it('case B: ayah 2 heard but not followed → unclear_ayah, and a retry must clear the whole ayah', async () => {
    const { ort, session, flags } = await run(a(1) + mush(a(2)) + a(3));
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ state: { phase: 'error', issue: { surah: 104, ayah: 2, word: 0, kind: 'unclear_ayah', words: 4 } } });
    session.correct('retry');
    // Only the first word: not enough for an ayah-level issue.
    ort.enqueue(tokenIds(corpus.wordPhonemes(corpus.wordIndex(104, 2, 0))));
    for (let i = 0; i < 8; i++) await session.feed(new Float32Array(CHUNK));
    expect(session.correction.state.phase).toBe('retrying');
    session.correct('stop_retry');
    session.correct('retry');
    ort.enqueue(tokenIds(a(2)));
    for (let i = 0; i < 30 && session.correction.state.phase === 'retrying'; i++) await session.feed(new Float32Array(CHUNK));
    expect(session.correction.state.phase).toBe('corrected');
  });

  it('clean 1→2→3 does not fire', async () => {
    const { flags, refs } = await run(a(1) + a(2) + a(3));
    expect(flags).toEqual([]);
    expect(refs).toEqual(['104:1', '104:2', '104:3']);
  });

  it('a gap across a tracker re-locate does not fire', async () => {
    // Ayah 1, then enough silence for the engine to go idle and search again, then ayah 3.
    const { flags, seen, refs } = await run(a(1), 40, a(3));
    expect(seen.filter(m => m.type === 'verse_candidate').length).toBeGreaterThanOrEqual(2);
    expect(refs).toEqual(['104:1', '104:3']);
    expect(flags).toEqual([]);
  });

  it('dismiss suppresses the ayah for the session and only fires once per ayah', async () => {
    const { ort, session, flags } = await run(a(1) + a(3));
    expect(flags).toHaveLength(1);
    const first = flags[0]!;
    session.correct('dismiss');
    expect(session.correction.state).toMatchObject({ phase: 'idle', outcome: 'dismissed' });
    expect(session.correction.raise((first as Extract<WorkerOutbound, { type: 'correction' }>).state.issue!, { surah: 104, ayah: 3, word: 0 })).toBe(false);
    ort.enqueue(tokenIds(a(4) + a(5)));
    const later: WorkerOutbound[] = [];
    for (let i = 0; i < 30; i++) later.push(...await session.feed(new Float32Array(CHUNK)));
    expect(later.filter(m => m.type === 'correction')).toEqual([]);
    expect(later.filter(m => m.type === 'verse_match').map(m => m.type === 'verse_match' ? m.ayah : 0)).toEqual([4, 5]);
  });

  it('never fires in tracking mode', async () => {
    const ort = new ScriptedOrtSession(tokenIds(a(1) + a(3)));
    const session = await ZipformerSession.create({ session: ort, Tensor: TensorCtor, corpus: corpusJson });
    const seen: WorkerOutbound[] = [];
    for (let i = 0; i < 40; i++) seen.push(...await session.feed(new Float32Array(CHUNK)));
    expect(seen.filter(m => m.type === 'correction')).toEqual([]);
  });
});
