import type { SurahRecord } from "./types.js";

interface RawWord {
  0: string;
  1: string;
  2: string;
}

interface RawAyah {
  n: number;
  m: string;
  w: Array<[string, string, string] | RawWord>;
}

interface RawSurah {
  n: number;
  name: string;
  nameEn: string;
  ayahs: RawAyah[];
}

interface RawCorpus {
  v: number;
  surahs: RawSurah[];
}

export class QuranCorpus {
  readonly text: string;
  readonly wordStart: Int32Array;
  readonly wordSurah: Int32Array;
  readonly wordAyah: Int32Array;
  readonly wordInAyah: Int32Array;
  readonly mushaf: string[];
  readonly plain: string[];
  readonly ayahFirst: Int32Array[];
  readonly ayahWords: Int32Array[];
  readonly markers: string[][];
  readonly surahs: SurahRecord[];
  readonly wordCount: number;

  constructor(data: unknown) {
    const raw = data as RawCorpus;
    if (!raw || raw.v !== 2) throw new Error("quran.json must be v2");
    if (!Array.isArray(raw.surahs) || raw.surahs.length !== 114) {
      throw new Error("quran.json must contain 114 surahs");
    }

    const chunks: string[] = [];
    const wordStart: number[] = [];
    const wordSurah: number[] = [];
    const wordAyah: number[] = [];
    const wordInAyah: number[] = [];
    const mushaf: string[] = [];
    const plain: string[] = [];
    const ayahFirst: Int32Array[] = [];
    const ayahWords: Int32Array[] = [];
    const markers: string[][] = [];
    const surahs: SurahRecord[] = [];
    let offset = 0;
    let w = 0;

    for (let si = 0; si < raw.surahs.length; si++) {
      const s = raw.surahs[si]!;
      const firstWord = w;
      const firstArr = new Int32Array(s.ayahs.length);
      const countArr = new Int32Array(s.ayahs.length);
      const marks: string[] = [];
      for (let ai = 0; ai < s.ayahs.length; ai++) {
        const a = s.ayahs[ai]!;
        if (a.n !== ai + 1) {
          throw new Error(`surah ${s.n} ayah index ${ai} has n=${a.n}`);
        }
        firstArr[ai] = w;
        const words = a.w;
        countArr[ai] = words.length;
        marks.push(a.m);
        for (let wi = 0; wi < words.length; wi++) {
          const triple = words[wi]!;
          const gly = triple[0];
          const ph = triple[1];
          const pl = triple[2];
          wordStart.push(offset);
          wordSurah.push(s.n);
          wordAyah.push(a.n);
          wordInAyah.push(wi);
          mushaf.push(gly);
          plain.push(pl);
          chunks.push(ph);
          offset += ph.length;
          w++;
        }
      }
      ayahFirst.push(firstArr);
      ayahWords.push(countArr);
      markers.push(marks);
      surahs.push({
        n: s.n,
        name: s.name,
        nameEn: s.nameEn,
        ayahCount: s.ayahs.length,
        firstWord,
        endWord: w,
      });
    }
    wordStart.push(offset);
    this.text = chunks.join("");
    this.wordStart = Int32Array.from(wordStart);
    this.wordSurah = Int32Array.from(wordSurah);
    this.wordAyah = Int32Array.from(wordAyah);
    this.wordInAyah = Int32Array.from(wordInAyah);
    this.mushaf = mushaf;
    this.plain = plain;
    this.ayahFirst = ayahFirst;
    this.ayahWords = ayahWords;
    this.markers = markers;
    this.surahs = surahs;
    this.wordCount = w;
  }

  wordAt(offset: number): number {
    if (offset < 0) return 0;
    if (offset >= this.text.length) return this.wordCount - 1;
    const starts = this.wordStart;
    let lo = 0;
    let hi = this.wordCount;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  wordIndex(surah: number, ayah: number, word: number): number {
    if (!this.hasAyah(surah, ayah)) {
      throw new RangeError(`no ayah ${surah}:${ayah}`);
    }
    const count = this.ayahWordCount(surah, ayah);
    if (word < 0 || word >= count) {
      throw new RangeError(`word ${word} out of range for ${surah}:${ayah}`);
    }
    return this.ayahFirstWord(surah, ayah) + word;
  }

  hasAyah(surah: number, ayah: number): boolean {
    if (surah < 1 || surah > 114) return false;
    const s = this.surahs[surah - 1];
    return !!s && ayah >= 1 && ayah <= s.ayahCount;
  }

  ayahFirstWord(surah: number, ayah: number): number {
    return this.ayahFirst[surah - 1]![ayah - 1]!;
  }

  ayahWordCount(surah: number, ayah: number): number {
    return this.ayahWords[surah - 1]![ayah - 1]!;
  }

  ayahPhonemes(surah: number, ayah: number): string {
    const first = this.ayahFirstWord(surah, ayah);
    const end = first + this.ayahWordCount(surah, ayah);
    return this.text.slice(this.wordStart[first]!, this.wordStart[end]!);
  }

  wordPhonemes(wordIndex: number): string {
    return this.text.slice(this.wordStart[wordIndex]!, this.wordStart[wordIndex + 1]!);
  }
}
