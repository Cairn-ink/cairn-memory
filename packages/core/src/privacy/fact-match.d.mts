import type { Scope } from "../ports/common.d.ts";
import type { RetainedShingles } from "../ports/privacy.d.ts";
import type { SessionRef, StoredFact, TextDigest } from "../suppression-fact.mjs";

export { NEAR_DUPLICATE_DISTANCE, SUPPRESSION_DISTANCE } from "../decisions.mjs";

/** One-sided cutoff tolerance for pgvector's float32 storage. */
export declare const SUPPRESSION_DISTANCE_TOLERANCE: 1e-6;

export type FactMatchResult = boolean | "ineligible";
export type FactMatchEmbedding = readonly number[] | Float32Array | Float64Array;

export interface FactMatchPolicy {
  containmentThreshold?: number;
  /**
   * Defaults to true. Set to false to skip full-text shingle containment for stores without row shingles.
   * Row reads can keep paraphrases visible when both exact digests and enabled vectors miss.
   */
  rowShingles?: boolean | undefined;
  /** Omit to disable vector suppression. */
  vectorSuppression?: boolean;
  /** For enabled vector suppression, a finite distance in [0, 2]. Omit to use the default. */
  suppressionDistance?: number;
  /** Synchronous hash of a plain session reference. Null means the hash is unavailable. */
  hashSessionKey?: (client: string, id: string) => string | null;
}

export interface IncomingFactMatchPolicy extends FactMatchPolicy {
  mode: "capture" | "explicitSave";
  /** Active key for the hosted-compatible explicit-save passage check, when known. */
  key?: { id: string } | null;
}

export interface FactMatchSource {
  client: string;
  sessionId?: string | null;
  sessionKeyHash?: string | null;
  occurredAtMs?: number | null;
}

interface FactMatchRowFields {
  scope: Scope;
  digests?: readonly TextDigest[];
  shingles?: readonly string[] | null;
  keyId?: string | null;
  embedding?: FactMatchEmbedding | null;
  source?: FactMatchSource;
}

export type FactMatchRow = FactMatchRowFields & (
  | { type?: "memory"; memoryId: string; revision?: number }
  | { type: "raw"; sessionKeyHash: string; messageKey: string; startUtf16: number; endUtf16: number }
);

export interface FactMatchIncoming {
  scope: Scope;
  passages: readonly (Pick<FactMatchRowFields, "shingles" | "keyId" | "embedding"> & {
    digests: readonly TextDigest[];
    retainedShingles?: readonly RetainedShingles[];
  })[];
  session?: SessionRef;
  occurredAtMs?: number | null;
  /** Memory incarnation being edited, if this is an explicit edit. */
  sourceMemory?: { id: string; createdAtMs: number } | null;
}

/** An ineligible comparison provides no permission to reveal the row. */
export declare function factHidesRow(storedFact: StoredFact, row: FactMatchRow, policy?: FactMatchPolicy): FactMatchResult;
/** An ineligible comparison provides no permission to admit the input. */
export declare function factBlocksIncoming(
  storedFact: StoredFact, incoming: FactMatchIncoming, policy: IncomingFactMatchPolicy,
): FactMatchResult;
