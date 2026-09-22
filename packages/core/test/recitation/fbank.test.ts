import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KaldiFbank } from "../../src/recitation/fbank";
import { findClip, findPython, findPythonRoot, VECTORS } from "./paths";

const CHUNK = 7680;

const PY = findPython();
const CLIP = findClip();
const PY_ROOT = findPythonRoot();

function loadVector<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(VECTORS, name), "utf8")) as T;
}

function maxAbs(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
}

function synthWave(): Float32Array {
  const dir = mkdtempSync(join(tmpdir(), "fbank-"));
  const out = join(dir, "synth.f32");
  const script = `
import numpy as np
SR=16000
rng=np.random.default_rng(0)
n=int(round(3.7*SR))
t=np.arange(n, dtype=np.float64)/SR
wave=(0.25*np.sin(2*np.pi*220.0*t)+0.15*np.sin(2*np.pi*440.0*t)+0.10*np.sin(2*np.pi*880.0*t)+0.05*rng.standard_normal(n))
np.clip(wave,-0.5,0.5).astype(np.float32).tofile(${JSON.stringify(out)})
`;
  execFileSync(PY!, ["-c", script]);
  const buf = readFileSync(out);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function loadMp3(path: string): Float32Array {
  const dir = mkdtempSync(join(tmpdir(), "fbank-"));
  const out = join(dir, "clip.f32");
  const script = `
import sys
sys.path.insert(0, ${JSON.stringify(PY_ROOT)})
from shared.audio import load_audio
w = load_audio(${JSON.stringify(path)}, sr=16000)
w.astype("float32").tofile(${JSON.stringify(out)})
`;
  execFileSync(PY!, ["-c", script]);
  const buf = readFileSync(out);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function runChunked(pcm: Float32Array): { streaming: Float32Array[]; flushed: Float32Array[] } {
  const fbank = new KaldiFbank();
  const streaming: Float32Array[] = [];
  for (let i = 0; i < pcm.length; i += CHUNK) {
    streaming.push(...fbank.acceptWaveform(pcm.subarray(i, Math.min(pcm.length, i + CHUNK))));
  }
  const flushed = fbank.inputFinished();
  return { streaming, flushed };
}

describe("kaldi fbank", () => {
  it("matches fbank_readiness.json frame counts", () => {
    const vec = loadVector<{
      rows: { samples: number; streamingReady: number; inputFinishedTotal: number }[];
    }>("fbank_readiness.json");
    for (const row of vec.rows) {
      const pcm = new Float32Array(row.samples);
      for (let i = 0; i < pcm.length; i++) pcm[i] = ((i * 17) % 100) / 200 - 0.25;
      const fbank = new KaldiFbank();
      const streaming = fbank.acceptWaveform(pcm);
      const flushed = fbank.inputFinished();
      expect(streaming.length, `streaming n=${row.samples}`).toBe(row.streamingReady);
      expect(streaming.length + flushed.length, `flush n=${row.samples}`).toBe(row.inputFinishedTotal);
    }
  });

  it.skipIf(!PY)("matches fbank_synthetic.json first 200 frames within 1e-3", () => {
    const vec = loadVector<{
      sampleCount: number;
      streamingFrames: number;
      flushedFrames: number;
      totalFrames: number;
      frames: number[][];
    }>("fbank_synthetic.json");
    const pcm = synthWave();
    expect(pcm.length).toBe(vec.sampleCount);
    const { streaming, flushed } = runChunked(pcm);
    expect(streaming.length).toBe(vec.streamingFrames);
    expect(flushed.length).toBe(vec.flushedFrames);
    expect(streaming.length + flushed.length).toBe(vec.totalFrames);
    const all = [...streaming, ...flushed];
    for (let f = 0; f < vec.frames.length; f++) {
      const got = all[f]!;
      const exp = vec.frames[f]!;
      expect(got.length).toBe(80);
      const d = maxAbs(got, exp);
      expect(d, `frame ${f} maxAbs=${d}`).toBeLessThan(1e-3);
    }
  });

  it.skipIf(!PY || !CLIP)("matches fbank_001002.json first 5 frames within 1e-3", () => {
    const vec = loadVector<{
      sampleCount: number;
      streamingFrames: number;
      flushedFrames: number;
      totalFrames: number;
      frames: number[][];
    }>("fbank_001002.json");
    const pcm = loadMp3(CLIP!);
    expect(pcm.length).toBe(vec.sampleCount);
    const { streaming, flushed } = runChunked(pcm);
    expect(streaming.length).toBe(vec.streamingFrames);
    expect(flushed.length).toBe(vec.flushedFrames);
    expect(streaming.length + flushed.length).toBe(vec.totalFrames);
    const all = [...streaming, ...flushed];
    for (let f = 0; f < vec.frames.length; f++) {
      const d = maxAbs(all[f]!, vec.frames[f]!);
      expect(d, `frame ${f} maxAbs=${d}`).toBeLessThan(1e-3);
    }
  });
});
