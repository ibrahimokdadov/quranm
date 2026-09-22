import { describe, expect, it } from "vitest";
import { GreedyCtcDecoder, expandTokens } from "../../src/recitation/ctcDecoder";
import { costTable } from "../../src/recitation/phonemeCost";
import { BLANK_ID, TOKENS } from "../../src/recitation/tokens";
import { vowelMismatches } from "../../src/recitation/verdicts";
import type { HeardChar } from "../../src/recitation/types";

const table = costTable();
const heardOf = (text: string, margin = 0.9): HeardChar[] =>
  [...text].map((ch, i) => ({ ch, frame: i * 4, margin }));

describe("vowelMismatches", () => {
  it("counts an interior short-vowel swap and reports its margin", () => {
    // لِرَبِّكَ heard as لِرَببُكَ (rabbuka for rabbika)
    const heard = heardOf("لِرَببُكَ");
    heard[[..."لِرَببُكَ"].indexOf("ُ")]!.vowels = [0, 0.54, 0.44];
    const r = vowelMismatches(heard, 0, "لِرَببُكَ", "لِرَببِكَ", table);
    expect(r.errors).toBe(1);
    expect(r.margin).toBeCloseTo(0.1, 5);
  });
  it("falls back to the token margin without vowel alternatives", () => {
    const r = vowelMismatches(heardOf("مَاالُوو", 0.7), 0, "مَاالُوو", "مَاالَوو", table);
    expect(r).toEqual({ errors: 1, margin: 0.7 });
  });
  it("ignores the word-final vowel (case ending) entirely", () => {
    expect(vowelMismatches(heardOf("كَوثَرُ"), 0, "كَوثَرُ", "كَوثَرَ", table).errors).toBe(0);
    expect(vowelMismatches(heardOf("وَلءَرضِ"), 0, "وَلءَرضِ", "وَلءَرضَ", table).errors).toBe(0);
  });
  it("does not count consonant errors, insertions or deletions as vowel errors", () => {
    expect(vowelMismatches(heardOf("جَمَعَ"), 0, "جَمَعَ", "جَمَعَ", table).errors).toBe(0);
    expect(vowelMismatches(heardOf("جُمَع"), 0, "جُمَع", "جَمَعَ", table).errors).toBe(1);
    expect(vowelMismatches(heardOf("حَمَعَ"), 0, "حَمَعَ", "جَمَعَ", table).errors).toBe(0);
  });
});

describe("decoder vowel alternatives", () => {
  it("attaches sibling-vowel probabilities to tokens ending in a short vowel", () => {
    const dec = new GreedyCtcDecoder(TOKENS, BLANK_ID);
    const id = (s: string) => TOKENS.indexOf(s);
    const row = new Float32Array(TOKENS.length + 1).fill(Math.log(1e-6));
    row[id("ببُ")] = Math.log(0.5);
    row[id("ببِ")] = Math.log(0.4);
    row[BLANK_ID] = Math.log(0.05);
    const blank = new Float32Array(TOKENS.length + 1).fill(Math.log(1e-6));
    blank[BLANK_ID] = 0;
    const lp = new Float32Array([...row, ...blank]);
    const tokens = dec.consume(lp, 2, TOKENS.length + 1);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.sym).toBe("ببُ");
    const v = tokens[0]!.vowels!;
    expect(v[1]).toBeCloseTo(0.5, 3);
    expect(v[2]).toBeCloseTo(0.4, 3);
    expect(v[0]).toBeLessThan(0.001);
    const chars = expandTokens(tokens);
    expect(chars.map((c) => c.vowels !== undefined)).toEqual([false, false, true]);
  });
  it("leaves consonant-only tokens without alternatives", () => {
    const dec = new GreedyCtcDecoder(TOKENS, BLANK_ID);
    const row = new Float32Array(TOKENS.length + 1).fill(Math.log(1e-6));
    row[TOKENS.indexOf("ر")] = 0;
    expect(dec.consume(row, 1, TOKENS.length + 1)).toHaveLength(0);
    const tokens = dec.flush();
    expect(tokens[0]!.sym).toBe("ر");
    expect(tokens[0]!.vowels).toBeUndefined();
  });
});
