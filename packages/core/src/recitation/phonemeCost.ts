export const ALPHABET =
  "ءابتثجحخدذرزسشصضطظعغفقكلمنهويۥۦں۾ٲأإآؤئٱىَُِڇؙۣ۪ٞۜـ";
export const ALPHABET_SIZE = 51;
export const TABLE_SIZE = 52;
export const UNKNOWN_ID = 51;
export const INSERT_DELETE_COST = 1;

const CANONICAL: Record<string, string> = {
  "ۦ": "ي",
  "ۥ": "و",
  "ں": "ن",
  "۾": "م",
  "ٱ": "ا",
  "ى": "ي",
};

const HAMZA = new Set(["ء", "أ", "إ", "آ", "ا", "ؤ", "ئ", "ٲ"]);
const SHORT_VOWELS = new Set(["َ", "ُ", "ِ"]);
const OTHER_MARKS = new Set(["ڇ", "ؙ", "ۣ", "ٞ", "ۜ", "۪", "ـ"]);
const MARKS = new Set([...SHORT_VOWELS, ...OTHER_MARKS]);

const NEIGHBOR_GROUPS = ["ذدضتط", "ظزذصسث", "جزش", "ةهت", "قكغ", "فبم"];
const NEIGHBOR_PAIRS: Array<[string, string]> = [
  ["ه", "ح"],
  ["غ", "خ"],
  ["ء", "ع"],
  ["ن", "م"],
  ["ن", "ل"],
  ["ظ", "ض"],
];

function buildNeighborSet(): Set<string> {
  const s = new Set<string>();
  const key = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);
  for (const g of NEIGHBOR_GROUPS) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) s.add(key(g[i]!, g[j]!));
    }
  }
  for (const [a, b] of NEIGHBOR_PAIRS) s.add(key(a, b));
  return s;
}

const NEIGHBORS = buildNeighborSet();

function neighborKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

export function charId(ch: string): number {
  const i = ALPHABET.indexOf(ch);
  return i < 0 ? UNKNOWN_ID : i;
}

export function canonical(ch: string): string {
  return CANONICAL[ch] ?? ch;
}

export function charCost(heard: string, expected: string): number {
  if (heard === expected) return 0;
  const ch = canonical(heard);
  const ce = canonical(expected);
  if (ch === ce) return 0;
  const hm = MARKS.has(heard);
  const em = MARKS.has(expected);
  if (hm || em) {
    if (hm && em) {
      if (SHORT_VOWELS.has(heard) && SHORT_VOWELS.has(expected)) return 0.1;
      return 0.25;
    }
    return 1;
  }
  if (HAMZA.has(ch) && HAMZA.has(ce)) return 0.1;
  if (NEIGHBORS.has(neighborKey(ch, ce))) return 0.25;
  return 1;
}

export class CostTable {
  readonly size = TABLE_SIZE;
  readonly unknownId = UNKNOWN_ID;
  readonly matrix: Float32Array;

  constructor() {
    this.matrix = new Float32Array(TABLE_SIZE * TABLE_SIZE);
    for (let i = 0; i < ALPHABET_SIZE; i++) {
      for (let j = 0; j < ALPHABET_SIZE; j++) {
        this.matrix[i * TABLE_SIZE + j] = charCost(ALPHABET[i]!, ALPHABET[j]!);
      }
    }
    for (let i = 0; i < TABLE_SIZE; i++) {
      this.matrix[UNKNOWN_ID * TABLE_SIZE + i] = 1;
      this.matrix[i * TABLE_SIZE + UNKNOWN_ID] = 1;
    }
  }

  id(ch: string): number {
    return charId(ch);
  }

  encode(text: string): Uint8Array {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = charId(text[i]!);
    return out;
  }

  cost(heardId: number, expectedId: number): number {
    return this.matrix[heardId * TABLE_SIZE + expectedId]!;
  }
}

let cached: CostTable | null = null;

export function costTable(): CostTable {
  if (!cached) cached = new CostTable();
  return cached;
}
