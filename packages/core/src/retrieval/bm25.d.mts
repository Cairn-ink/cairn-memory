import type { ItemRef } from "../ports/common.d.ts";

type RefRow = ItemRef | { ref: ItemRef };

export const BM25_K1: 1.2;
export const BM25_B: 0.75;

export function canonicalTuple(row: RefRow): [ItemRef["namespace"], ItemRef["type"], string];
export function canonicalKey(row: RefRow): string;
export function compareCanonical(a: RefRow, b: RefRow): -1 | 0 | 1;
export function rankScores<T extends RefRow & { score: number }>(rows: T[]): T[];

export function scoreBM25(
  terms: Iterable<string>,
  document: { length: number; frequencies: ReadonlyMap<string, number> },
  stats: { N: number; totalLength: number; df: ReadonlyMap<string, number> },
): number | null;

export function createBM25<T extends RefRow & { text: string }>(documents: readonly T[]): {
  N: number;
  totalLength: number;
  avgLength: number;
  df: Map<string, number>;
  search(text: string, depth?: number): (Omit<T, "text" | "length" | "frequencies" | "score"> & { score: number })[];
};
