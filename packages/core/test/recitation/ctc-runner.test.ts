import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VECTORS } from "./paths";
import { GreedyCtcDecoder } from "../../src/recitation/ctcDecoder";
import { TOKENS, BLANK_ID, VOCAB_SIZE } from "../../src/recitation/tokens";
import { ZipformerRunner, type TensorLike, type ZipformerIo } from "../../src/recitation/zipformerRunner";


function load<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(VECTORS, name), "utf8")) as T;
}

describe("ctc vocab", () => {
  const vec = load<{ blankId: number; vocabSize: number; tokens: string[] }>("tokens.json");
  it("matches tokens.json", () => {
    expect(BLANK_ID).toBe(vec.blankId);
    expect(VOCAB_SIZE).toBe(vec.vocabSize);
    expect([...TOKENS]).toEqual(vec.tokens);
    expect(TOKENS[BLANK_ID]).toBe("<blank>");
  });
});

describe("greedy CTC", () => {
  it("argmax ties pick lowest class; blank ends a run", () => {
    const dec = new GreedyCtcDecoder(TOKENS, BLANK_ID);
    const C = VOCAB_SIZE;
    const frames = 4;
    const lp = new Float32Array(frames * C);
    lp.fill(-20);
    // frame 0: class 1 wins
    lp[1] = 0;
    lp[2] = -1;
    // frame 1: same class, higher peak
    lp[C + 1] = 1;
    lp[C + 2] = -1;
    // frame 2: blank
    lp[2 * C + BLANK_ID] = 0;
    lp[2 * C + 1] = -5;
    // frame 3: class 3
    lp[3 * C + 3] = 0;
    lp[3 * C + 4] = -0.5;
    const tokens = [...dec.consume(lp, frames, C), ...dec.flush()];
    expect(tokens.map((t) => t.sym)).toEqual([TOKENS[1], TOKENS[3]]);
    expect(tokens[0]!.frame).toBe(0);
    expect(dec.framesDecoded).toBe(4);
  });
});

class FakeTensor implements TensorLike {
  constructor(
    readonly type: string,
    readonly data: Float32Array | BigInt64Array | Int32Array,
    readonly dims: readonly number[],
  ) {}
}

describe("zipformer runner bookkeeping", () => {
  const vec = load<{
    T: number;
    hop: number;
    featureDim: number;
    vocabSize: number;
    probe: { clip: string; windows: Array<{
      fbankIn: number;
      bufferedBefore: number;
      leftoverAfter: number;
      logProbFrames: number;
      processedLensBefore: number;
      processedLensAfter: number;
    }> }[];
  }>("zipformer_windows.json");
  const io = load<ZipformerIo>("zipformer_io.json");

  it("T/hop/vocab", () => {
    expect(io.T).toBe(vec.T);
    expect(io.hop).toBe(vec.hop);
    expect(io.featureDim).toBe(vec.featureDim);
    expect(io.vocabSize).toBe(vec.vocabSize);
  });

  it("window leftover and processed_lens copy-through", async () => {
    let lens = 0n;
    const session = {
      async run(feeds: Record<string, TensorLike>) {
        const pl = feeds.processed_lens!.data as BigInt64Array;
        lens = (pl[0] ?? 0n) + 24n;
        const out: Record<string, TensorLike> = {
          log_probs: new FakeTensor("float32", new Float32Array(12 * io.vocabSize), [1, 12, io.vocabSize]),
        };
        for (const inp of io.inputs) {
          if (inp.name === "x") continue;
          if (inp.name === "processed_lens") {
            out[`new_${inp.name}`] = new FakeTensor("int64", BigInt64Array.from([lens]), inp.dims);
          } else {
            out[`new_${inp.name}`] = feeds[inp.name]!;
          }
        }
        return out;
      },
    };
    const runner = ZipformerRunner.fromSession(session, io, FakeTensor);
    const dim = io.featureDim;
    const frame = () => new Float32Array(dim);
    // first host chunk: 47 frames, no forward
    let r = await runner.accept(Array.from({ length: 47 }, frame));
    expect(r.frames).toBe(0);
    expect(runner.leftoverFrames).toBe(47);
    for (const win of vec.probe[0]!.windows) {
      expect(Number(runner.processedLens)).toBe(win.processedLensBefore);
      expect(runner.leftoverFrames).toBe(win.bufferedBefore);
      r = await runner.accept(Array.from({ length: win.fbankIn }, frame));
      expect(r.frames).toBe(win.logProbFrames);
      expect(runner.leftoverFrames).toBe(win.leftoverAfter);
      expect(Number(runner.processedLens)).toBe(win.processedLensAfter);
    }
  });

  it('starts a new phrase with fresh state while retaining unconsumed lookahead', async () => {
    const inputs: { firstFrame: number; lens: bigint }[] = [];
    const session = { async run(feeds: Record<string, TensorLike>) {
      inputs.push({ firstFrame: Number(feeds.x!.data[0]), lens: (feeds.processed_lens!.data as BigInt64Array)[0]! });
      const out: Record<string, TensorLike> = {
        log_probs: new FakeTensor('float32', new Float32Array(12 * io.vocabSize), [1, 12, io.vocabSize]),
      };
      for (const inp of io.inputs) if (inp.name !== 'x') out[`new_${inp.name}`] = inp.name === 'processed_lens'
        ? new FakeTensor('int64', BigInt64Array.from([24n]), inp.dims) : feeds[inp.name]!;
      return out;
    } };
    const runner = ZipformerRunner.fromSession(session, io, FakeTensor);
    const frames = Array.from({ length: io.T + io.hop }, (_, i) => new Float32Array(io.featureDim).fill(i));
    await runner.accept(frames.slice(0, io.T));
    runner.resetContext();
    await runner.accept(frames.slice(io.T));
    expect(inputs).toEqual([{ firstFrame: 0, lens: 0n }, { firstFrame: io.hop, lens: 0n }]);
  });
});
