import { FBANK_BINS, FRAME_LENGTH, FRAME_SHIFT, SAMPLE_RATE } from "./config.js";

const FFT_SIZE = 512;
const PREEMPH = 0.97;
const LOW_FREQ = 20;
const HIGH_FREQ = 7600;
const LOG_FLOOR = 1.1920929e-7;
const TRIM_EXTRA = 1600;
const NYQUIST_BINS = FFT_SIZE / 2;

interface MelFilter {
  firstBin: number;
  weights: Float64Array;
}

const POVEY = new Float64Array(FRAME_LENGTH);
for (let i = 0; i < FRAME_LENGTH; i++) {
  const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_LENGTH - 1));
  POVEY[i] = Math.pow(hann, 0.85);
}

function hzToMel(f: number): number {
  return 1127 * Math.log(1 + f / 700);
}

function buildMelFilters(): MelFilter[] {
  const melLow = hzToMel(LOW_FREQ);
  const melHigh = hzToMel(HIGH_FREQ);
  const points = new Float64Array(FBANK_BINS + 2);
  for (let i = 0; i < points.length; i++) {
    points[i] = melLow + (i * (melHigh - melLow)) / (FBANK_BINS + 1);
  }
  const binHz = SAMPLE_RATE / FFT_SIZE;
  const filters: MelFilter[] = [];
  for (let b = 0; b < FBANK_BINS; b++) {
    const left = points[b]!;
    const center = points[b + 1]!;
    const right = points[b + 2]!;
    const weights: number[] = [];
    let first = -1;
    for (let k = 0; k < NYQUIST_BINS; k++) {
      const mel = hzToMel(k * binHz);
      if (!(mel > left && mel < right)) continue;
      let w: number;
      if (mel < center) w = (mel - left) / (center - left);
      else w = (right - mel) / (right - center);
      if (first < 0) first = k;
      weights.push(w);
    }
    filters.push({
      firstBin: first < 0 ? 0 : first,
      weights: Float64Array.from(weights),
    });
  }
  return filters;
}

const MEL = buildMelFilters();

function fft512(re: Float64Array, im: Float64Array): void {
  const n = FFT_SIZE;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < half; j++) {
        const ur = re[i + j]!;
        const ui = im[i + j]!;
        const vr = re[i + j + half]! * wRe - im[i + j + half]! * wIm;
        const vi = re[i + j + half]! * wIm + im[i + j + half]! * wRe;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + half] = ur - vr;
        im[i + j + half] = ui - vi;
        const nwRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nwRe;
      }
    }
  }
}

function reflectIndex(s: number, n: number): number {
  while (s < 0 || s >= n) {
    if (s < 0) s = -s - 1;
    else s = 2 * n - 1 - s;
  }
  return s;
}

function frameStart(f: number): number {
  return f * FRAME_SHIFT - 120;
}

function frameEnd(f: number): number {
  return f * FRAME_SHIFT + 280;
}

export class KaldiFbank {
  private buffer = new Float32Array(0);
  private stored = 0;
  private sampleOffset = 0;
  private framesProduced = 0;
  private trueLength = 0;
  private readonly samples = new Float64Array(FRAME_LENGTH);
  private readonly fftRe = new Float64Array(FFT_SIZE);
  private readonly fftIm = new Float64Array(FFT_SIZE);

  acceptWaveform(samples: ArrayLike<number>): Float32Array[] {
    this.append(samples);
    this.trueLength = this.sampleOffset + this.stored;
    const out: Float32Array[] = [];
    while (frameEnd(this.framesProduced) <= this.sampleOffset + this.stored) {
      out.push(this.computeFrame(this.framesProduced, Number.POSITIVE_INFINITY));
      this.framesProduced++;
    }
    this.trim();
    return out;
  }

  inputFinished(): Float32Array[] {
    const n = this.trueLength;
    const total = Math.floor((n + FRAME_SHIFT / 2) / FRAME_SHIFT);
    const out: Float32Array[] = [];
    while (this.framesProduced < total) {
      out.push(this.computeFrame(this.framesProduced, n));
      this.framesProduced++;
    }
    return out;
  }

  reset(): void {
    this.buffer = new Float32Array(0);
    this.stored = 0;
    this.sampleOffset = 0;
    this.framesProduced = 0;
    this.trueLength = 0;
  }

  private append(samples: ArrayLike<number>): void {
    const add = samples.length;
    if (this.stored + add > this.buffer.length) {
      const next = new Float32Array(Math.max(this.buffer.length * 2, this.stored + add, 4096));
      next.set(this.buffer.subarray(0, this.stored));
      this.buffer = next;
    }
    if (ArrayBuffer.isView(samples)) {
      this.buffer.set(samples as ArrayLike<number> as Float32Array, this.stored);
    } else {
      for (let i = 0; i < add; i++) this.buffer[this.stored + i] = samples[i]!;
    }
    this.stored += add;
  }

  private trim(): void {
    const start = frameStart(this.framesProduced);
    const firstNeeded = Math.max(0, start);
    const extra = firstNeeded - this.sampleOffset;
    if (extra <= TRIM_EXTRA) return;
    this.buffer.copyWithin(0, extra, this.stored);
    this.stored -= extra;
    this.sampleOffset += extra;
  }

  private computeFrame(f: number, n: number): Float32Array {
    const start = frameStart(f);
    const win = this.samples;
    for (let i = 0; i < FRAME_LENGTH; i++) {
      let s = start + i;
      if (s < 0 || s >= n) s = reflectIndex(s, n);
      win[i] = this.buffer[s - this.sampleOffset]!;
    }
    let mean = 0;
    for (let i = 0; i < FRAME_LENGTH; i++) mean += win[i]!;
    mean /= FRAME_LENGTH;
    for (let i = 0; i < FRAME_LENGTH; i++) win[i]! -= mean;
    for (let i = FRAME_LENGTH - 1; i >= 1; i--) win[i]! -= PREEMPH * win[i - 1]!;
    win[0]! -= PREEMPH * win[0]!;
    const re = this.fftRe;
    const im = this.fftIm;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < FRAME_LENGTH; i++) re[i] = win[i]! * POVEY[i]!;
    fft512(re, im);
    const frame = new Float32Array(FBANK_BINS);
    for (let b = 0; b < FBANK_BINS; b++) {
      const filt = MEL[b]!;
      let energy = 0;
      for (let i = 0; i < filt.weights.length; i++) {
        const k = filt.firstBin + i;
        const rr = re[k]!;
        const ii = im[k]!;
        energy += (rr * rr + ii * ii) * filt.weights[i]!;
      }
      frame[b] = Math.log(Math.max(energy, LOG_FLOOR));
    }
    return frame;
  }
}
