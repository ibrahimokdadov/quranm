import { INSERT_DELETE_COST, type CostTable } from "./phonemeCost.js";

export interface SemiGlobalResult {
  cost: number;
  distance: number;
  refStart: number;
  refEnd: number;
  queryStart: number;
}

export function weightedLevenshtein(
  a: Uint8Array,
  b: Uint8Array,
  table: CostTable,
): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return 0;
  let prev = new Float32Array(m + 1);
  let cur = new Float32Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    const ha = a[i - 1]!;
    for (let j = 1; j <= m; j++) {
      // Float32 store: alignment.json (hamza 0.10000000149011612, 1:1-vs-1:2).
      cur[j] = prev[j - 1]! + table.cost(ha, b[j - 1]!);
      const up = prev[j]! + INSERT_DELETE_COST;
      const left = cur[j - 1]! + INSERT_DELETE_COST;
      if (up < cur[j]!) cur[j] = up;
      if (left < cur[j]!) cur[j] = left;
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return prev[m]!;
}

export function normalizedDistance(
  a: Uint8Array,
  b: Uint8Array,
  table: CostTable,
): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0 || b.length === 0) return 1;
  return weightedLevenshtein(a, b, table) / Math.max(a.length, b.length);
}

export function alignGlobal(
  heard: Uint8Array,
  ref: Uint8Array,
  from: number,
  to: number,
  table: CostTable,
): Int32Array {
  const n = heard.length;
  const m = to - from;
  const assign = new Int32Array(n);
  if (n === 0) return assign;
  if (m <= 0) {
    assign.fill(-1);
    return assign;
  }
  const cols = m + 1;
  // Float32 store: alignment.json global pairs; compare after write.
  const C = new Float32Array((n + 1) * cols);
  const T = new Uint8Array((n + 1) * cols);
  for (let j = 0; j <= m; j++) C[j] = j;
  for (let i = 1; i <= n; i++) C[i * cols] = i;
  for (let i = 1; i <= n; i++) {
    const ha = heard[i - 1]!;
    const row = i * cols;
    const prev = (i - 1) * cols;
    for (let j = 1; j <= m; j++) {
      C[row + j] = C[prev + j - 1]! + table.cost(ha, ref[from + j - 1]!);
      let tr = 0;
      const up = C[prev + j]! + INSERT_DELETE_COST;
      const left = C[row + j - 1]! + INSERT_DELETE_COST;
      if (up < C[row + j]!) {
        C[row + j] = up;
        tr = 1;
      }
      if (left < C[row + j]!) {
        C[row + j] = left;
        tr = 2;
      }
      T[row + j] = tr;
    }
  }
  let i = n;
  let j = m;
  assign.fill(-1);
  while (i > 0 || j > 0) {
    if (i === 0) {
      j--;
      continue;
    }
    if (j === 0) {
      assign[i - 1] = -1;
      i--;
      continue;
    }
    const tr = T[i * cols + j]!;
    if (tr === 0) {
      assign[i - 1] = from + j - 1;
      i--;
      j--;
    } else if (tr === 1) {
      assign[i - 1] = -1;
      i--;
    } else {
      j--;
    }
  }
  return assign;
}

export function alignSemiGlobal(
  query: Uint8Array,
  ref: Uint8Array,
  from: number,
  to: number,
  table: CostTable,
  headSkipCost = 0.5,
): SemiGlobalResult {
  const n = query.length;
  const m = Math.max(0, to - from);
  if (n === 0) {
    return { cost: 0, distance: 1, refStart: from, refEnd: from, queryStart: 0 };
  }
  // Float32 + fround: search.json fatiha@200 (0.4439999771118164).
  let prevCost = new Float32Array(m + 1);
  let curCost = new Float32Array(m + 1);
  let prevStart = new Int32Array(m + 1);
  let curStart = new Int32Array(m + 1);
  let prevQ = new Int32Array(m + 1);
  let curQ = new Int32Array(m + 1);
  for (let j = 0; j <= m; j++) prevStart[j] = j;
  for (let i = 1; i <= n; i++) {
    const h = query[i - 1]!;
    const skip = Math.fround(i * headSkipCost);
    curCost[0] = skip;
    curStart[0] = 0;
    curQ[0] = i;
    for (let j = 1; j <= m; j++) {
      const diagCost = Math.fround(prevCost[j - 1]! + table.cost(h, ref[from + j - 1]!));
      const upCost = Math.fround(prevCost[j]! + INSERT_DELETE_COST);
      const leftCost = Math.fround(curCost[j - 1]! + INSERT_DELETE_COST);
      let cost = diagCost;
      let start = prevStart[j - 1]!;
      let q = prevQ[j - 1]!;
      if (upCost < cost) {
        cost = upCost;
        start = prevStart[j]!;
        q = prevQ[j]!;
      }
      if (leftCost < cost) {
        cost = leftCost;
        start = curStart[j - 1]!;
        q = curQ[j - 1]!;
      }
      if (skip < cost) {
        cost = skip;
        start = j;
        q = i;
      }
      curCost[j] = cost;
      curStart[j] = start;
      curQ[j] = q;
    }
    let tmpC = prevCost;
    prevCost = curCost;
    curCost = tmpC;
    let tmpS = prevStart;
    prevStart = curStart;
    curStart = tmpS;
    let tmpQ = prevQ;
    prevQ = curQ;
    curQ = tmpQ;
  }
  let bestJ = 0;
  let best = prevCost[0]!;
  for (let j = 1; j <= m; j++) {
    const c = prevCost[j]!;
    if (c < best) {
      best = c;
      bestJ = j;
    }
  }
  return {
    cost: best,
    distance: best / n,
    refStart: from + prevStart[bestJ]!,
    refEnd: from + bestJ,
    queryStart: prevQ[bestJ]!,
  };
}
