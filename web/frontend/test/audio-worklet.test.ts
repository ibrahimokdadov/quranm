import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('microphone worklet final samples', () => {
  it('discards playback samples before acknowledging a fresh repetition', () => {
    const messages: Array<ArrayBuffer | { type: string }> = [];
    let Worklet: new () => { port: { onmessage: (event: { data: { type: string } }) => void }; process: (input: Float32Array[][]) => boolean };
    runInNewContext(readFileSync(new URL('../public/audio-processor.js', import.meta.url), 'utf8'), {
      sampleRate: 16000, Float32Array,
      AudioWorkletProcessor: class { port = { onmessage: () => {}, postMessage: (m: ArrayBuffer | { type: string }) => messages.push(m) }; },
      registerProcessor: (_name: string, implementation: typeof Worklet) => { Worklet = implementation; },
    });
    const processor = new Worklet!();
    processor.process([[new Float32Array(1000).fill(.9)]]);
    processor.port.onmessage({ data: { type: 'discard' } });
    expect(messages).toEqual([{ type: 'discarded' }]);
    processor.process([[new Float32Array(4800).fill(.1)]]);
    const fresh = new Float32Array(messages[1] as ArrayBuffer);
    expect(fresh.length).toBe(4800);
    expect([...fresh].every(v => Math.abs(v - .1) < .00001)).toBe(true);
  });
  it.each([16000, 48000])('flushes the %i Hz stream before acknowledging stop, with no later samples', rate => {
    const messages: Array<ArrayBuffer | { type: string }> = [];
    let Worklet: new () => { port: { onmessage: (event: { data: { type: string } }) => void }; process: (input: Float32Array[][]) => boolean };
    runInNewContext(readFileSync(new URL('../public/audio-processor.js', import.meta.url), 'utf8'), {
      sampleRate: rate, Float32Array,
      AudioWorkletProcessor: class { port = { onmessage: () => {}, postMessage: (message: ArrayBuffer | { type: string }) => messages.push(message) }; },
      registerProcessor: (_name: string, implementation: typeof Worklet) => { Worklet = implementation; },
    });
    const processor = new Worklet!();
    for (let i = 0; i < 100; i++) processor.process([[new Float32Array(128).fill(.1)]]);
    processor.port.onmessage({ data: { type: 'flush' } });
    expect(messages.at(-1)).toEqual({ type: 'flushed' });
    const samples = messages.slice(0, -1).reduce((total, message) => total + (message as ArrayBuffer).byteLength / 4, 0);
    expect(Math.abs(samples - 12800 * 16000 / rate)).toBeLessThan(1);
    const count = messages.length;
    processor.process([[new Float32Array(128)]]);
    expect(messages).toHaveLength(count);
  });
});
