import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { requireCorpus, VECTORS } from "./paths";
import { QuranCorpus } from "../../src/recitation/corpus";
import { QuranIndex, stripPreambles, fnv1aBucket } from "../../src/recitation/search";
import { costTable } from "../../src/recitation/phonemeCost";
import { DEFAULT_CONFIG } from "../../src/recitation/config";

const CORPUS_PATH = requireCorpus();

function load<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(VECTORS, name), "utf8")) as T;
}

const corpus = new QuranCorpus(JSON.parse(readFileSync(CORPUS_PATH, "utf8")));
const index = new QuranIndex(corpus, DEFAULT_CONFIG);

describe("corpus", () => {
  const vec = load<{
    surahCount: number;
    wordCount: number;
    textLength: number;
    fatiha: {
      n: number;
      name: string;
      nameEn: string;
      ayahCount: number;
      firstWord: number;
      endWord: number;
      ayah1: { phonemes: string; words: { word: number; phonemes: string; plain: string }[] };
    };
    wordAtExamples: { offset: number; wordIndex: number }[];
  }>("corpus.json");

  it("counts and Fatiha 1:1", () => {
    expect(corpus.surahs.length).toBe(vec.surahCount);
    expect(corpus.wordCount).toBe(vec.wordCount);
    expect(corpus.text.length).toBe(vec.textLength);
    const s = corpus.surahs[0]!;
    expect(s.n).toBe(vec.fatiha.n);
    expect(s.name).toBe(vec.fatiha.name);
    expect(s.nameEn).toBe(vec.fatiha.nameEn);
    expect(s.ayahCount).toBe(vec.fatiha.ayahCount);
    expect(s.firstWord).toBe(vec.fatiha.firstWord);
    expect(s.endWord).toBe(vec.fatiha.endWord);
    expect(corpus.ayahPhonemes(1, 1)).toBe(vec.fatiha.ayah1.phonemes);
    for (const w of vec.fatiha.ayah1.words) {
      const gi = corpus.wordIndex(1, 1, w.word);
      expect(corpus.wordPhonemes(gi)).toBe(w.phonemes);
      expect(corpus.plain[gi]).toBe(w.plain);
    }
  });

  it("wordAt clamps", () => {
    for (const ex of vec.wordAtExamples) {
      expect(corpus.wordAt(ex.offset)).toBe(ex.wordIndex);
    }
  });
});

describe("search", () => {
  interface SearchHitVec {
    surah: number;
    ayah: number;
    word: number;
    wordIndex: number;
    refOffset: number;
    refEnd: number;
    queryStart: number;
    distance: number;
  }
  const vec = load<{
    istiadha: string;
    basmala: string;
    queries: Array<{
      name: string;
      text: string;
      length: number;
      growingIstiadha: boolean;
      stripped: { offset: number; basmala: boolean; basmalaOffset: number };
      decisive: boolean;
      hits: SearchHitVec[];
      hintFatiha: { decisive: boolean; hits: SearchHitVec[] };
    }>;
  }>("search.json");
  const table = costTable();

  it("preamble constants", () => {
    expect(vec.istiadha.length).toBe(40);
    expect(vec.basmala.length).toBe(32);
  });

  for (const q of vec.queries) {
    it(q.name, () => {
      expect(q.text.length).toBe(q.length);
      const stripped = stripPreambles(q.text, table);
      if (!q.growingIstiadha) {
        expect(stripped).toEqual(q.stripped);
      }
      const plain = index.search(q.text);
      expect(plain.decisive).toBe(q.decisive);
      expect(plain.hits).toEqual(q.hits);
      const hinted = index.search(q.text, { surah: 1, ayah: 1 });
      expect(hinted.decisive).toBe(q.hintFatiha.decisive);
      expect(hinted.hits).toEqual(q.hintFatiha.hits);
    });
  }
});

describe("fnv-1a", () => {
  const table = costTable();
  const vec = load<{ fnv1a: { text: string; ids: number[]; bucket: number }[] }>("hash_examples.json");
  it("buckets", () => {
    for (const row of vec.fnv1a) {
      const ids = table.encode(row.text);
      expect([...ids]).toEqual(row.ids);
      expect(fnv1aBucket(ids, 0)).toBe(row.bucket);
    }
  });
});

