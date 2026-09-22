import type { WorkerInbound, WorkerOutbound, WordProgressMessage } from '../lib/types';
import type { PossibleIssue } from './progress';

interface ListenerCallbacks {
  status: (text: string) => void;
  heard: (ref: string, confidence: number) => void;
  decoded: (text: string) => void;
  preamble: (complete: boolean) => void;
  issue: (issue: PossibleIssue, totalWords: number) => void;
  level: (level: number, durationMs: number) => void;
  progress: (position: WordProgressMessage) => void;
  failure: (message: string) => void;
}
export class HifzListener {
  private worker: Worker | null = null;
  private ready = false;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private processor: AudioWorkletNode | null = null;
  private active = false;
  private inputPaused = false;
  private eventsPaused = false;
  private requestId = 0;
  private workletUrl: string | null = null;
  private generation = 0;
  private expectedRef = '';
  private pending = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
  private initialized: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private callbacks: ListenerCallbacks;
  constructor(callbacks: ListenerCallbacks) { this.callbacks = callbacks; }
  private post(message: WorkerInbound, transfer: Transferable[] = []): void { this.worker?.postMessage(message, transfer); }

  private handle(message: WorkerOutbound): void {
    if (message.type === 'ready') {
      this.ready = true;
      this.initialized?.resolve();
      this.initialized = null;
    } else if (message.type === 'error') {
      this.fail(new Error(message.message));
    } else if (message.type === 'loading_status') {
      this.callbacks.status('Preparing your listener…');
    } else if (message.type === 'loading') {
      this.callbacks.status(`Preparing offline listening · ${message.percent}%`);
    } else if (message.type === 'stopped' || message.type === 'reset_done') {
      this.pending.get(message.requestId)?.resolve();
      this.pending.delete(message.requestId);
    } else if (this.eventsPaused) {
      return;
    } else if (this.active && message.type === 'verse_match') {
      this.callbacks.heard(`${message.surah}:${message.ayah}`, message.confidence);
    } else if (this.active && message.type === 'word_progress') {
      this.callbacks.progress(message);
    } else if (this.active && message.type === 'final_sequence') {
      for (const verse of message.verses) this.callbacks.heard(`${verse.surah}:${verse.ayah}`, verse.confidence);
    } else if (this.active && message.type === 'raw_transcript') {
      this.callbacks.decoded(message.text);
    } else if (this.active && message.type === 'recitation_preamble') {
      this.callbacks.preamble(message.complete);
    } else if (this.active && message.type === 'correction' && message.state.phase === 'error' && message.state.issue) {
      this.callbacks.issue(message.state.issue, message.totalWords);
    }
  }
  private fail(error: Error): void {
    this.generation++;
    const wasActive = this.active;
    this.active = false;
    this.initialized?.reject(error);
    this.initialized = null;
    for (const waiting of this.pending.values()) waiting.reject(error);
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.releaseAudio();
    if (wasActive) this.callbacks.failure(error.message);
  }
  private async prepare(): Promise<void> {
    if (this.ready) return;
    const ready = new Promise<void>((resolve, reject) => { this.initialized = { resolve, reject }; });
    this.worker = new Worker(new URL('../worker/zipformer-backend.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = event => this.handle(event.data as WorkerOutbound);
    this.worker.onerror = event => this.fail(new Error(event.message || 'The listener could not start.'));
    this.post({ type: 'set_mode', mode: 'correction' });
    this.post({ type: 'init' });
    const timer = setTimeout(() => this.fail(new Error('Listening setup timed out. Retry or practise without a microphone.')), 180_000);
    try { await ready; } finally { clearTimeout(timer); }
  }
  async start(start: { surah: number; ayah: number }): Promise<void> {
    const generation = ++this.generation;
    let context: AudioContext;
    try { context = new AudioContext({ sampleRate: 16000 }); }
    catch { context = new AudioContext(); }
    const ensureCurrent = () => { if (generation !== this.generation) throw new Error('Listening setup was cancelled.'); };
    try {
      // Resume within the user gesture before waiting for the model download.
      this.context = context;
      await context.resume();
      ensureCurrent();
      await this.prepare();
      ensureCurrent();
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs localhost or HTTPS.');
      this.callbacks.status('Allow microphone access to begin.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); ensureCurrent(); }
      this.stream = stream;
      if (!this.workletUrl) {
        const response = await fetch(`/audio-processor.js?v=${__BUILD_ID__}`);
        if (!response.ok) throw new Error('Could not prepare the microphone.');
        this.workletUrl = URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }));
      }
      await context.audioWorklet.addModule(this.workletUrl);
      ensureCurrent();
      this.processor = new AudioWorkletNode(context, 'audio-stream-processor');
      this.processor.port.onmessage = event => {
        if (!(event.data instanceof ArrayBuffer)) return;
        if (this.inputPaused) return;
        const samples = new Float32Array(event.data);
        let sum = 0;
        for (const sample of samples) sum += sample * sample;
        this.callbacks.level(Math.min(1, Math.sqrt(sum / samples.length) * 12), samples.length / 16);
        this.post({ type: 'audio', samples }, [samples.buffer]);
      };
      this.post({ type: 'reset', start, deferCorrections: true });
      this.expectedRef = `${start.surah}:${start.ayah}`;
      this.post({ type: 'set_mode', mode: 'correction' });
      this.active = true;
      this.inputPaused = false;
      this.eventsPaused = false;
      context.createMediaStreamSource(this.stream).connect(this.processor);
      // The processor outputs silence, keeping the graph alive without mic feedback.
      this.processor.connect(context.destination);
      this.stream.getAudioTracks()[0].onended = () => {
        if (this.active) this.fail(new Error('Microphone disconnected. This attempt needs a manual check.'));
      };
      this.callbacks.status('Listening · recite at your own pace');
    } catch (error) {
      if (generation === this.generation) this.releaseAudio();
      else if (context.state !== 'closed') void context.close();
      throw error;
    }
  }
  /** Keep the microphone open, but never recognize the app's own audio cue. */
  pauseInput(): void { this.inputPaused = true; this.eventsPaused = true; }

  private async acknowledged(message: { type: 'stop' } | { type: 'reset'; start: { surah: number; ayah: number }; deferCorrections: true }): Promise<void> {
    const requestId = ++this.requestId;
    let timer: ReturnType<typeof setTimeout>;
    const done = new Promise<void>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      timer = setTimeout(() => this.fail(new Error('Listening took too long. Please try again.')), 30_000);
    });
    this.post({ ...message, requestId });
    try { await done; } finally { clearTimeout(timer!); this.pending.delete(requestId); }
  }

  async checkpoint(): Promise<void> {
    this.inputPaused = true;
    await this.acknowledged({ type: 'stop' });
    this.eventsPaused = true;
  }

  /** Ordered reset between repetitions; old queued results and playback samples
   * cannot count toward the next pass. The mic and permission stay unchanged. */
  async restart(start: { surah: number; ayah: number }): Promise<void> {
    if (!this.active || !this.processor) throw new Error('Microphone is not active');
    this.pauseInput();
    await this.acknowledged({ type: 'reset', start, deferCorrections: true });
    const processor = this.processor;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { processor.port.removeEventListener('message', discarded); reject(new Error('Microphone did not resume')); }, 3000);
      const discarded = (event: MessageEvent) => {
        if (event.data?.type !== 'discarded') return;
        clearTimeout(timer); processor.port.removeEventListener('message', discarded); resolve();
      };
      processor.port.addEventListener('message', discarded);
      processor.port.postMessage({ type: 'discard' });
    });
    this.expectedRef = `${start.surah}:${start.ayah}`;
    this.eventsPaused = false;
    this.inputPaused = false;
  }
  async stop(): Promise<void> {
    if (!this.active) return;
    try {
      if (this.processor) {
        const processor = this.processor;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Could not finish capturing audio. Check this attempt manually.')), 3000);
          const flushed = (event: MessageEvent) => {
            if (event.data?.type !== 'flushed') return;
            clearTimeout(timer);
            processor.port.removeEventListener('message', flushed);
            resolve();
          };
          processor.port.addEventListener('message', flushed);
          processor.port.postMessage({ type: 'flush' });
        });
      }
      this.releaseAudio();
      const id = ++this.requestId;
      let timer: ReturnType<typeof setTimeout>;
      const finished = new Promise<void>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        timer = setTimeout(() => this.fail(new Error('Listening took too long to finish. Check this attempt manually.')), 60_000);
      });
      this.post({ type: 'stop', requestId: id });
      try { await finished; } finally { clearTimeout(timer!); this.pending.delete(id); }
    } finally {
      this.active = false;
      this.releaseAudio();
    }
  }
  expectAyah(ref: { surah: number; ayah: number }): void {
    const key = `${ref.surah}:${ref.ayah}`;
    if (!this.active || this.expectedRef === key) return;
    this.expectedRef = key;
    this.post({ type: 'set_expected_ayah', ref });
  }
  private releaseAudio(): void {
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.stream = null;
    this.processor?.disconnect();
    this.processor = null;
    if (this.context && this.context.state !== 'closed') void this.context.close();
    this.context = null;
  }
  dispose(): void {
    this.active = false;
    this.fail(new Error('Listening stopped.'));
    if (this.workletUrl) URL.revokeObjectURL(this.workletUrl);
    this.workletUrl = null;
  }
}
