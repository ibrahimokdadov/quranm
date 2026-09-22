class AudioStreamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 4800; // send every 300ms at 16kHz
    // Resampler state, carried across 128-sample render quanta. Resetting the
    // phase per block (the old `for (i = 0; i < 128; i += 3)`) emitted 43
    // samples per 128 instead of 42.67: a 0.78% tempo stretch plus a 375 Hz
    // glitch train, enough to flip a short vowel in the CTC output.
    this._phase = 0;
    this._last = 0;
    this._closed = false;
    this.port.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'discard') {
        this._buffer = [];
        this.port.postMessage({ type: 'discarded' });
      }
      if (msg.type === 'flush') {
        this._closed = true;
        if (this._buffer.length) {
          const tail = new Float32Array(this._buffer);
          this.port.postMessage(tail.buffer, [tail.buffer]);
          this._buffer = [];
        }
        this.port.postMessage({ type: 'flushed' });
      }
      if (msg.type === "set_config") {
        const chunkMs = Number(msg.audioChunkMs);
        if (Number.isFinite(chunkMs)) {
          const clamped = Math.min(1000, Math.max(100, chunkMs));
          this._bufferSize = Math.max(1, Math.round((16000 * clamped) / 1000));
        }
      }
    };
  }

  process(inputs) {
    if (this._closed) return true;
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];
    const ratio = sampleRate / 16000;

    if (ratio === 1) {
      for (let i = 0; i < channelData.length; i++) this._buffer.push(channelData[i]);
    } else {
      // Linear interpolation at a continuous fractional position. `_phase` is
      // the read position relative to this block's first sample; it may start
      // negative (between the previous block's last sample and this one).
      let pos = this._phase;
      const n = channelData.length;
      while (pos < n) {
        const i0 = Math.floor(pos);
        const frac = pos - i0;
        const s0 = i0 < 0 ? this._last : channelData[i0];
        const s1 = i0 + 1 < n ? channelData[i0 + 1] : channelData[n - 1];
        this._buffer.push(s0 + (s1 - s0) * frac);
        pos += ratio;
      }
      this._phase = pos - n;
      this._last = channelData[n - 1];
    }

    if (this._buffer.length >= this._bufferSize) {
      const chunk = new Float32Array(this._buffer);
      this.port.postMessage(chunk.buffer, [chunk.buffer]);
      this._buffer = [];
    }

    return true;
  }
}

registerProcessor("audio-stream-processor", AudioStreamProcessor);
