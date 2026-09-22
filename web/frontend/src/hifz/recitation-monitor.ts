import type { WordProgressMessage } from '../lib/types';
import type { Passage } from './progress';
import { inPassage } from './live-feedback';

interface Reference { surah: number; ayah: number }
export type RecitationMismatch = { kind: 'different'; expected: Reference; detected: Reference }
  | { kind: 'unmatched'; expected: Reference };

/** Separates a recognized wrong location from audio that cannot yet be matched.
 * Silence and cursor movement are never evidence of a recitation mistake. */
export class RecitationMonitor {
  mismatch: RecitationMismatch | null = null;
  opening: 'listening' | 'complete' | null = null;
  private passage: Passage;
  private ayah: number;
  private positions = new Map<number, WordProgressMessage>();
  private lastProgress: number;
  private speechSince: number | null = null;
  private voicedMs = 0;
  private decodedChars = 0;
  private transcript = '';
  private revision = 0;
  private mismatchRevision = 0;

  constructor(passage: Passage, now: number) {
    this.passage = { ...passage };
    this.ayah = passage.start;
    this.lastProgress = now;
  }

  get expected(): Reference {
    const current = this.positions.get(this.ayah);
    const complete = current?.matched_indices.includes(current.total_words - 1);
    return { surah: this.passage.surah, ayah: complete ? Math.min(this.ayah + 1, this.passage.end) : this.ayah };
  }

  private allowed(ref: Reference): boolean {
    if (!inPassage(ref, this.passage)) return false;
    if (ref.ayah <= this.ayah) return true; // Rereading earlier words is allowed.
    const previous = this.positions.get(this.ayah);
    // The engine can enter the next ayah before settling the last word of this one.
    return ref.ayah === this.ayah + 1 && !!previous
      && previous.word_index >= previous.total_words - 2
      && previous.matched_indices.length >= Math.ceil(previous.total_words / 2);
  }

  private isPreamble(ref: Reference): boolean {
    return ref.surah === 1 && ref.ayah === 1 && this.positions.size === 0
      && !(this.passage.surah === 1 && this.passage.start === 1);
  }

  recognized(ref: Reference, confidence: number): void {
    if (this.isPreamble(ref) || this.allowed(ref) || !Number.isFinite(confidence) || confidence < .5) return;
    if (confidence >= .75) this.different(ref);
    else if (!this.mismatch) {
      this.mismatch = { kind: 'unmatched', expected: this.expected };
      this.mismatchRevision = this.revision;
    }
  }

  /** Returns false for words outside the expected part of the lesson. */
  progress(position: WordProgressMessage, now: number): boolean {
    const matched = [...new Set(position.matched_indices)]
      .filter(i => Number.isInteger(i) && i >= 0 && i < position.total_words);
    if (!this.allowed(position)) {
      // Confirm a phrase, not a percentage of an arbitrarily long ayah. A
      // cursor jump or scattered/shared words alone must not turn the UI red.
      const needed = Math.min(3, Math.max(2, Math.ceil(position.total_words * .75)));
      const phrase = matched.some(start => Array.from({ length: needed }, (_, n) => start + n).every(i => matched.includes(i)));
      if (!this.isPreamble(position) && phrase) this.different(position);
      return false;
    }
    this.opening = null;
    if (!matched.length) return true;
    const previous = this.positions.get(position.ayah);
    const fresh = matched.some(i => !previous?.matched_indices.includes(i));
    const recovery = this.mismatch && this.revision > this.mismatchRevision
      && matched.length >= Math.ceil(position.total_words * .75);
    this.positions.set(position.ayah, { ...position,
      matched_indices: [...new Set([...(previous?.matched_indices ?? []), ...matched])] });
    this.ayah = Math.max(this.ayah, position.ayah);
    if (fresh || recovery) {
      this.mismatch = null;
      this.lastProgress = now;
      this.speechSince = null;
      this.voicedMs = 0;
      this.decodedChars = 0;
    }
    return true;
  }

  audio(level: number, durationMs: number, now: number): void {
    if (level <= .14) return;
    this.speechSince ??= now;
    this.voicedMs += Math.max(0, Math.min(durationMs, 1000));
  }

  preamble(complete: boolean, now: number): void {
    if (this.positions.size || this.mismatch?.kind === 'different') return;
    this.opening = complete ? 'complete' : 'listening';
    this.mismatch = null;
    this.lastProgress = now;
    this.speechSince = null;
    this.voicedMs = 0;
    this.decodedChars = 0;
  }

  decoded(text: string, now: number): void {
    if (!text || text === this.transcript) return;
    const added = text.startsWith(this.transcript) ? text.length - this.transcript.length : text.length;
    this.transcript = text;
    this.revision++;
    this.speechSince ??= now;
    this.decodedChars += added;
  }

  tick(now: number): void {
    if (this.mismatch || this.speechSince === null) return;
    if (now - this.lastProgress >= 4500 && now - this.speechSince >= 3000
      && (this.voicedMs >= 1800 || this.decodedChars >= 12)) {
      this.mismatch = { kind: 'unmatched', expected: this.expected };
      this.mismatchRevision = this.revision;
    }
  }

  private different(ref: Reference): void {
    this.mismatch = { kind: 'different', expected: this.expected, detected: { surah: ref.surah, ayah: ref.ayah } };
    this.mismatchRevision = this.revision;
  }
}
