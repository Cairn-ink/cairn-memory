import type { ItemRef } from "../ports/common.d.ts";
import type { LexicalRow, VectorRow } from "../ports/retrieval.d.ts";

type ScoredRow = (ItemRef | { ref: ItemRef }) & { score: number };
type ChannelRank = { rank: number; rawScore: number };
type Preset = Readonly<{ k: number; depth: number; weights: readonly number[]; unionMaximum: number }>;
type Page = { offset: number; limit: number };

type FusedRow<T> = T extends ScoredRow ? Omit<T, "score" | "channels" | "fusionScore"> & {
  score: number;
  fusionScore: number;
  channels: { lexical: ChannelRank | null; semantic: ChannelRank | null; moc?: ChannelRank | null };
} : never;

export const RRF_PRESETS: Readonly<Record<"rrf-k60-d12" | "rrf-k60-d12-moc-v1" | "rrf-k10", Preset>>;
export const COMPACT_RRF_PRESETS: Readonly<
  Record<"rrf-k60-d64-compact" | "rrf-k60-d64-moc-compact" | "rrf-k10-d64-compact", Preset>
>;

export function fuseCandidates<L extends ScoredRow, S extends ScoredRow, M extends ScoredRow = never>(
  lexical: readonly L[],
  semantic: readonly S[],
  opts?: { preset?: string; limit?: number; semanticState?: string; coverageComplete?: boolean; moc?: readonly M[] },
): {
  mode: "lexical";
  preset: string;
  unionSize: number;
  rows: (Omit<L, "channels" | "fusionScore"> & {
    fusionScore: null;
    channels: { lexical: ChannelRank; semantic: null };
  })[];
} | {
  mode: "hybrid";
  preset: string;
  unionSize: number;
  rows: FusedRow<L | S | M>[];
};

export function fuseHosted(
  lexicalRows: readonly LexicalRow[],
  vectorRows: readonly VectorRow[],
  opts: Page & { floor?: boolean },
): {
  rows: (LexicalRow & { lexicalRank: number | null; vectorRank: number | null })[];
  total: number;
};

export function fuseHostedLexicalOnly(rows: readonly LexicalRow[], opts: Page): { rows: LexicalRow[]; total: number };

export interface HostedCardChannels {
  memoryLexical: readonly LexicalRow[];
  /** Null when the memory vector channel is unavailable or its coverage is incomplete. */
  memoryVector: readonly VectorRow[] | null;
  cardLexical: readonly LexicalRow[];
  /** Null when the card vector channel is unavailable or its coverage is incomplete. */
  cardVector: readonly VectorRow[] | null;
}

/** Fuses separately ranked memory and card channels before applying the hosted page. */
export function fuseHostedWithCards(
  channels: HostedCardChannels & ({ memoryVector: readonly VectorRow[] } | { cardVector: readonly VectorRow[] }),
  opts: Page & { floor?: boolean },
): ReturnType<typeof fuseHosted>;

/** With both vector channels null and no card candidates, returns the legacy lexical page. */
export function fuseHostedWithCards(
  channels: HostedCardChannels,
  opts: Page & { floor?: boolean },
): ReturnType<typeof fuseHosted> | ReturnType<typeof fuseHostedLexicalOnly>;
