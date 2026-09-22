import type { Passage, WordHint } from './progress';

export interface TrackedPosition {
  surah: number;
  ayah: number;
  word: number;
  matched: number[];
}
export type FlowAction = { type: 'hint'; position: WordHint } | { type: 'finish' };

/** Coordinates a recitation's position, pauses and ending. It never grades recall. */
export class RecitationFlow {
  private passage: Passage;
  private wordCounts: Map<number, number>;
  private hintDelay: number | null;
  private lastVoice: number;
  private lastProgress: number;
  private lastHint: WordHint | null = null;
  private hintedThisPause = false;
  private endSeenAt: number | null = null;
  private hasVoice = false;
  private finishSent = false;
  private lastEvidence = '';
  private visited = new Set<number>();
  private nextPosition: WordHint;
  private current: WordHint;

  constructor(passage: Passage, wordCounts: Map<number, number>, hintDelay: number | null, now: number) {
    this.passage = { ...passage };
    this.wordCounts = wordCounts;
    this.hintDelay = hintDelay;
    this.lastVoice = now;
    this.lastProgress = now;
    this.current = { ayah: passage.start, word: 0 };
    this.nextPosition = { ...this.current };
  }

  voice(now: number): void {
    this.lastVoice = now;
    this.hasVoice = true;
    this.hintedThisPause = false;
  }

  track(position: TrackedPosition, now: number): void {
    const count = this.wordCounts.get(position.ayah) ?? 0;
    if (position.surah !== this.passage.surah || position.ayah < this.passage.start
      || position.ayah > this.passage.end || position.word < 0 || position.word >= count) return;
    const evidence = `${position.ayah}:${position.word}:${position.matched.join(',')}`;
    if (evidence === this.lastEvidence) return;
    this.lastEvidence = evidence;
    if (this.current.ayah !== position.ayah || this.current.word !== position.word) {
      this.lastProgress = now;
      this.hintedThisPause = false;
    }
    this.current = { ayah: position.ayah, word: position.word };
    if (position.matched.length && (position.ayah === this.passage.start || this.visited.has(position.ayah - 1))) {
      this.visited.add(position.ayah);
    }
    const following = position.matched.includes(position.word) ? position.word + 1 : position.word;
    this.nextPosition = following >= count && position.ayah < this.passage.end
      ? { ayah: position.ayah + 1, word: 0 }
      : { ayah: position.ayah, word: Math.min(following, count - 1) };
    const atEnd = position.ayah === this.passage.end && position.matched.includes(count - 1)
      && this.visited.size === this.passage.end - this.passage.start + 1;
    if (atEnd) this.endSeenAt ??= now;
    else this.endSeenAt = null;
  }

  hint(): WordHint | null {
    if (this.finishSent || this.endSeenAt !== null) return null;
    const result = { ...this.nextPosition };
    const count = this.wordCounts.get(result.ayah) ?? 0;
    if (result.word >= count || count === 0) return null;
    this.lastHint = result;
    this.hintedThisPause = true;
    // Repeated requests can step forward; automatic hints stop after one word
    // until recitation resumes, so a long silence never reveals the passage.
    if (result.word + 1 < count) this.nextPosition = { ayah: result.ayah, word: result.word + 1 };
    else if (result.ayah < this.passage.end) this.nextPosition = { ayah: result.ayah + 1, word: 0 };
    return result;
  }

  tick(now: number): FlowAction | null {
    if (this.finishSent) return null;
    if (this.endSeenAt !== null && this.hasVoice && now - this.lastVoice >= 1800 && now - this.endSeenAt >= 800) {
      this.finishSent = true;
      return { type: 'finish' };
    }
    if (this.endSeenAt === null && this.hintDelay !== null && !this.hintedThisPause
      && now - Math.max(this.lastVoice, this.lastProgress) >= this.hintDelay) {
      const position = this.hint();
      return position ? { type: 'hint', position } : null;
    }
    return null;
  }

  get position(): WordHint { return { ...this.current }; }
  get atEnd(): boolean { return this.endSeenAt !== null; }
  get hintWasPassed(): boolean {
    return this.lastHint !== null && (this.current.ayah > this.lastHint.ayah
      || (this.current.ayah === this.lastHint.ayah && this.current.word > this.lastHint.word));
  }
}
