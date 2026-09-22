import { DEFAULT_CONFIG } from "./config.js";
import { QuranCorpus } from "./corpus.js";
import { normalizedDistance } from "./alignment.js";
import { costTable, type CostTable } from "./phonemeCost.js";
import { stripPreambles } from "./search.js";
import type { FallbackHit } from "./types.js";

export function wholeAyahFallback(
  text: string,
  corpus: QuranCorpus,
  table: CostTable = costTable(),
  minChars = DEFAULT_CONFIG.searchMinChars,
  maxDistance = 0.5,
): FallbackHit | null {
  if (!text) return null;
  const stripped = stripPreambles(text, table);
  const rest = text.slice(stripped.offset);
  if (stripped.basmala && rest.length < minChars) {
    return { surah: 1, ayah: 1, distance: 0, how: "basmala" };
  }
  const q = table.encode(rest.length >= 3 ? rest : text);
  let best: FallbackHit | null = null;
  for (const s of corpus.surahs) {
    for (let a = 1; a <= s.ayahCount; a++) {
      const ids = table.encode(corpus.ayahPhonemes(s.n, a));
      if (ids.length > 2.5 * q.length + 8 || q.length > 2.5 * ids.length + 8) continue;
      const d = normalizedDistance(q, ids, table);
      if (!best || d < best.distance) {
        best = { surah: s.n, ayah: a, distance: d, how: "whole-ayah" };
      }
    }
  }
  if (!best || best.distance > maxDistance) return null;
  return best;
}
