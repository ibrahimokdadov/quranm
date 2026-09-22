const WAQF_MARKS = new Set([
  "\u06D6", "\u06D7", "\u06D8", "\u06D9", "\u06DA", "\u06DB", "\u06DC",
]);

function isWaqfToken(token: string): boolean {
  return token.length <= 2 && [...token].every((c) => WAQF_MARKS.has(c));
}

interface WordToken {
  text: string;
  isRealWord: boolean;
}

export function splitUthmaniWords(text: string): WordToken[] {
  const raw = text.split(/\s+/).filter((w) => w.length > 0);
  const result: WordToken[] = [];

  for (const token of raw) {
    if (isWaqfToken(token) && result.length > 0) {
      result[result.length - 1].text += " " + token;
    } else {
      result.push({ text: token, isRealWord: true });
    }
  }

  return result;
}

export const BISMILLAH_WORD_COUNT = 4;
const BISMILLAH_BASE = "بسم الله الرحمن الرحيم";

function stripDiacritics(s: string): string {
  return s.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/g, "");
}

export function startsWithBismillah(text: string): boolean {
  const stripped = stripDiacritics(text).replace(/ٱ/g, "ا");
  return stripped.startsWith(BISMILLAH_BASE) || stripped.startsWith(stripDiacritics(BISMILLAH_BASE));
}
