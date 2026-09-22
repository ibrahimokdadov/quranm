import { normalizedDistance } from './alignment.js';
import type { CostTable } from './phonemeCost.js';
import { BASMALA } from './search.js';
import type { CtcToken } from './types.js';

/** Keeps an optional opening out of a selected ayah's alignment. Buffer only
 * while the initial phonemes could be Bismillah; replay non-openings unchanged.
 * This never runs during ordinary discovery or when 1:1 itself is selected. */
export class OpeningBasmala {
  private buffered: CtcToken[] = [];
  private done = false;
  private table: CostTable;
  constructor(table: CostTable) { this.table = table; }

  feed(tokens: readonly CtcToken[]): { tokens: CtcToken[]; opening?: 'listening' | 'complete' } {
    if (this.done) return { tokens: [...tokens] };
    if (!tokens.length) return { tokens: [] };
    this.buffered.push(...tokens);
    const text = this.buffered.map(t => t.sym).join('');
    if (text.length < 4) return { tokens: [] };

    // Require the final consonant as well as a close whole-phrase match. A
    // partial "ar-Rahim" must not consume the first phonemes of the next ayah.
    let end = -1;
    let distance = .2;
    for (let n = BASMALA.length - 6; n <= Math.min(text.length, BASMALA.length + 6); n++) {
      if (text[n - 1] !== BASMALA.at(-1)) continue;
      const d = normalizedDistance(this.table.encode(text.slice(0, n)), this.table.encode(BASMALA), this.table);
      if (d < distance) { end = n; distance = d; }
    }
    if (end >= 0) {
      const remainder: CtcToken[] = [];
      let skipped = 0;
      for (const token of this.buffered) {
        const cut = Math.max(0, end - skipped);
        skipped += token.sym.length;
        if (cut < token.sym.length) remainder.push({ ...token, sym: token.sym.slice(cut) });
      }
      this.done = true;
      this.buffered = [];
      return { tokens: remainder, opening: 'complete' };
    }

    let prefixDistance = 1;
    for (let n = Math.max(1, text.length - 3); n <= Math.min(BASMALA.length, text.length + 3); n++) {
      prefixDistance = Math.min(prefixDistance,
        normalizedDistance(this.table.encode(text), this.table.encode(BASMALA.slice(0, n)), this.table));
    }
    if (text.length <= BASMALA.length + 6 && prefixDistance <= .3) {
      return { tokens: [], ...(text.length >= 5 ? { opening: 'listening' as const } : {}) };
    }
    const buffered = this.buffered;
    this.buffered = [];
    this.done = true;
    return { tokens: buffered };
  }
}
