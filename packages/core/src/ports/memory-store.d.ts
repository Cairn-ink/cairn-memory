import type { TextDigest } from "../suppression-fact.mjs";
import type { MemoryKind, MemoryRow, Origin, Receipt, Revision, Scope, SortKeyUs, SourceRef } from "./common.d.ts";
import type { Tx } from "./unit-of-work.d.ts";

export interface DuplicateQuery {
  textHash: string;
  /** Addenda 5 and 13. Current digests and the complete retained exact evidence with each variant's metadata. */
  digests?: TextDigest[];
  /** Digest under the legacy engine fingerprint, when it differs (lookup only). */
  legacyHash?: string;
  /** Absent when the incoming text is not embedded (near matching is then skipped and counted). */
  embedding?: Float32Array | number[] | null;
}

interface MatchBase {
  match: "exact" | "near";
  /** Cosine distance for near matches. */
  distance?: number;
}

/** A visible stored row. */
export interface StoredMatch extends MatchBase {
  kind: "stored";
  id: string;
  revision: Revision;
  /** Exact write time of the matched row. */
  writeTimeUs: SortKeyUs;
}

/** An earlier item of the same batch; it has no id or write time until core inserts it (core fills them). */
export interface PriorMatch extends MatchBase {
  kind: "prior";
  batchIndex: number;
  writeTimeUs?: SortKeyUs;
}

/**
 * Returned per query in this order: exact before near, then distance ascending, then
 * writeTimeUs descending, then (stored) id descending by UTF-8 bytes. Core's write decision
 * (exact > near > distance > write time, plus the in-batch "more recent" rule) relies on it.
 */
export type MemoryMatch = StoredMatch | PriorMatch;

export interface WritePolicy {
  /** Per batch position: duplicates of existing visible rows, in MemoryMatch order. */
  matches: MemoryMatch[][];
  /** Positions refused by a suppression (they return "suppressed", never "duplicate"). */
  blockedPositions: number[];
  /** Ids of hidden rows among matches (exact or near). An exact match on a hidden row = suppressed; a near match on one is skipped. */
  hiddenIds: string[];
  /** The source session is blocked. */
  blockedSession: boolean;
}

export interface InsertRow {
  kind: MemoryKind;
  origin: Origin;
  text: string;
  textHash: string;
  /** Addenda 5 and 13. Persist current digests and retained exact evidence with labels, pipelines and redaction versions. */
  digests?: TextDigest[];
  confidence: number;
  source: SourceRef;
  createdAtMs?: number;
  /** null when not embedded at write time (engine pump, or a store without an embedder). */
  embedding: { model: string; vector: Float32Array | number[] } | null;
}

/**
 * The merge core decided for a duplicate. Stores apply it verbatim:
 * explicit saves set kind and origin; confidence follows core's rule (max, except an inferred
 * save never changes an explicit row). Review state is parked (not in core).
 */
export interface DuplicateMerge {
  confidence: number;
  kind?: MemoryKind;
  origin?: Origin;
}

export interface MemoryStore {
  /** Exact first, then near (capability nearDuplicate, distance from decisions). Visible rows only. */
  findDuplicates(tx: Tx, scope: Scope, batch: readonly DuplicateQuery[], options: { nearDistance: number; excludeId?: string }): Promise<MemoryMatch[][]>;
  /**
   * Suppression runs BEFORE dedupe. mode "hash" lets an explicit save pass distance-only facts.
   * nearDuplicate:false lets the adapter skip near lookups while keeping the embedding for suppression.
   */
  readWritePolicy(tx: Tx, scope: Scope, batch: readonly DuplicateQuery[], source: SourceRef, mode: "hash" | "full",
    editId?: string, options?: { nearDuplicate?: boolean }): Promise<WritePolicy>;
  /** When returned, receiptIds are the stored IDs of the attached receipts in input order. */
  insert(tx: Tx, scope: Scope, row: InsertRow, receipts: readonly Receipt[], nowMs: number): Promise<{
    id: string; revision: Revision; createdAtMs: number; updatedAtMs: number; updatedAtUs: SortKeyUs;
    receiptIds?: readonly string[];
  }>;
  /**
   * Attaches receipts and applies the merge verbatim; bumps the revision only when something
   * changed. No exemption: a store that cannot persist kind/origin/confidence does not conform.
   * A newly attached receipt counts as a change when receiptAttachAdvancesRevision is true
   * (PHASE0 addendum 18). When returned, receiptIds are the stored IDs of the attached
   * receipts in input order.
   */
  touchDuplicate(tx: Tx, scope: Scope, id: string, receipts: readonly Receipt[], merge: DuplicateMerge, nowMs: number): Promise<{
    outcome: "touched" | "changed"; revision: Revision; receiptIds?: readonly string[];
  }>;
  /** Returns the run's start revision for this owner, stable across writes in the run. */
  indexRevision?(tx: Tx): Promise<Revision>;
  readRevision(tx: Tx, scope: Scope, id: string): Promise<{ revision: Revision; textHash: string } | null>;
  /**
   * Throws revision_conflict, memory_historical, or memory_conflict (the new text collides with
   * another visible memory). A kind change or a replacement receipt counts as a change even
   * with identical text. An unchanged correction leaves the revision as-is.
   */
  replaceContent(tx: Tx, scope: Scope, id: string, expectedRevision: Revision, next: InsertRow, receipts: readonly Receipt[] | null, nowMs: number): Promise<{ outcome: "changed" | "unchanged"; revision: Revision }>;
  get(tx: Tx, scope: Scope, id: string): Promise<MemoryRow | null>;
  /**
   * Forget's row step: the row becomes permanently invisible and its content is erased.
   * Adapters may delete or tombstone (content null, deleted, revision + 1). Dependent rows
   * (receipts, placements, edges) are removed or invalidated in the same tx.
   */
  erase(tx: Tx, scope: Scope, id: string): Promise<boolean>;
  /** Paged export of visible memories in (updatedAtUs desc, id desc) order. */
  exportPage(tx: Tx, scope: Scope, page: { cursor: string | null; limit: number }): Promise<{ items: MemoryRow[]; nextCursor: string | null }>;
}

/** Optional (capability supersession). */
export interface SupersessionStore {
  record(tx: Tx, scope: Scope, edge: { previous: { id: string; revision: Revision }; replacement: { id: string; revision: Revision } }, receiptIds: readonly string[], nowMs: number): Promise<void>;
  markHistorical(tx: Tx, scope: Scope, id: string, nowMs: number): Promise<void>;
  read(tx: Tx, scope: Scope, id: string): Promise<{ supersededBy: string | null; supersedes: string[] }>;
  /** Batched read for search pages; one round trip. Ids absent from the scope map to the empty answer. */
  readMany?(tx: Tx, scope: Scope, ids: readonly string[]): Promise<Map<string, { supersededBy: string | null; supersedes: string[] }>>;
  /** Incoming supersession edges of a replacement (core checks incoming + new > limit → supersession_limit). */
  incomingCount(tx: Tx, scope: Scope, replacementId: string): Promise<number>;
}

export interface ConflictEdge {
  memoryId: string;
  revision: Revision;
  relation: "contradicts";
  source: string;
}

/**
 * Optional (capability conflictEdges). Edges are REVISION-BOUND. Canonical ids compare by
 * UTF-8 bytes (compareUtf8); the stored pair is ordered left < right.
 */
export interface ConflictEdgeStore {
  /** ON CONFLICT DO NOTHING; core derives `changed` and the epoch from `inserted`. */
  insert(tx: Tx, scope: Scope, edge: { left: { id: string; revision: Revision }; right: { id: string; revision: Revision }; relation: "contradicts"; source: string }, nowMs: number): Promise<{ inserted: boolean }>;
  /**
   * Edges of `id` whose BOTH endpoints are still at the stored revisions and visible,
   * ordered by compareUtf8(memoryId), then source.
   */
  list(tx: Tx, scope: Scope, id: string): Promise<ConflictEdge[]>;
  /** Batched read for search pages; one round trip. Ids absent from the scope map to the empty answer. */
  readMany?(tx: Tx, scope: Scope, ids: readonly string[]): Promise<Map<string, ConflictEdge[]>>;
  invalidate(tx: Tx, scope: Scope, id: string): Promise<number>;
  /** Current edge count (core enforces the relation limit → conflict_limit). */
  degree(tx: Tx, scope: Scope, id: string): Promise<number>;
}
