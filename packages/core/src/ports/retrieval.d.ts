import type { CallOptions, ItemRef, MemoryRow, Namespace, OwnerId, Receipt, SortKeyUs } from "./common.d.ts";
import type { Tx } from "./unit-of-work.d.ts";

/**
 * A read set: one owner, one or more namespaces fused into one ranking (engine: personal +
 * project; hosted: [null]). After fusion, core orders ties canonically by (namespace bytes, type,
 * id bytes) under its preset. Within a lexical candidate list, tie order is store-defined
 * (scores are store-specific); vector candidates order by distance, updatedAtUs desc, id desc.
 */
export interface RetrievalScope {
  owner: OwnerId;
  namespaces: readonly Namespace[];
  /** Restrict memories to matching source.client values (null never matches) and raw to matching clients. */
  clients?: readonly string[];
  /**
   * Half-open time range: memory createdAtMs, card date, raw occurredAtMs.
   * Raw segments with unknown time are excluded whenever set.
   * Candidate ports apply both window and clients before depth or pool cuts.
   */
  window?: { sinceMs?: number; untilMs?: number };
}

export interface LexicalRow {
  ref: ItemRef;
  /** Store-specific relevance; NOT comparable across stores (contract). */
  score: number;
  updatedAtUs: SortKeyUs;
}

export interface VectorRow {
  ref: ItemRef;
  /** Cosine distance. */
  distance: number;
  updatedAtUs: SortKeyUs;
}

/** Candidate ports return rows already filtered by the visibility predicate in the same snapshot. */
export interface LexicalCandidates {
  lexical(tx: Tx, scope: RetrievalScope, query: string, depth: number, options: CallOptions): Promise<{ rows: LexicalRow[]; matched: boolean }>;
}

export interface VectorCandidates {
  /** coverage.complete must be true for core to use semantic ranking; otherwise core falls back to lexical. */
  vector(tx: Tx, scope: RetrievalScope, query: Float32Array, model: string, depth: number): Promise<{
    rows: VectorRow[];
    coverage: {
      eligible: number;
      embedded: number;
      complete: boolean;
      /** Sum of ANN statement limits and row counts before JavaScript filtering. */
      pool?: { requested: number; returned: number };
    };
  }>;
}

export interface RawSegment {
  ref: ItemRef;
  client: string;
  sessionId: string;
  messageId: string;
  role: "user" | "assistant";
  content: string;
  occurredAtMs: number | null;
  score: number;
}

export interface RawCandidates {
  raw(tx: Tx, scope: RetrievalScope, query: string, intent: "search" | "context", options: CallOptions & {
    limit: number;
    queryVector?: Float32Array;
    /** When present, take a page of the first 100 ranked candidates after store visibility checks. */
    offset?: number;
  }): Promise<{
    segments: RawSegment[];
    coverage: { complete: boolean };
    /** Present for paged reads. State identifies the ranked pool in this snapshot. */
    page?: { state: string; hasMore: boolean };
    /** Store row witnesses by ref id, when available. */
    witnesses?: ReadonlyMap<string, string>;
  }>;
}

export type RawVersionMatch = (current: Omit<RawSegment, "score">, witness?: string) => boolean;

/** Final fence: re-checks refs in the same snapshot right before delivery; drops anything now hidden. */
export interface VisibilityFence {
  /** The "read" intent includes historical memories that pass the other visibility checks. */
  assertVisible(tx: Tx, scope: RetrievalScope, refs: readonly ItemRef[], intent?: "read"): Promise<ItemRef[]>;
  /** Return current visible Raw rows whose versions match in this transaction. */
  readVisibleRaw?(tx: Tx, scope: RetrievalScope, refs: readonly ItemRef[],
    matchesVersion: RawVersionMatch): Promise<Omit<RawSegment, "score">[]>;
}

export interface ReadSnapshot {
  /** A token binding a cursor to (request, scope including clients and window, index state). */
  stateToken(tx: Tx, scope: RetrievalScope): Promise<string>;
  /** Throws cursor_stale when the token no longer matches. */
  assertUnchanged(tx: Tx, scope: RetrievalScope, token: string): Promise<void>;
  /** Memory-only snapshot for Find when the general revision also tracks other indexes. */
  findMemory?: Pick<ReadSnapshot, "stateToken" | "assertUnchanged">;
}

export interface HydratedItem {
  ref: ItemRef;
  memory?: MemoryRow;
  receipts?: Receipt[];
  sourceDates?: { firstMs: number | null; lastMs: number | null };
}

export interface HydrateItems {
  hydrate(tx: Tx, scope: RetrievalScope, refs: readonly ItemRef[], intent: "recall" | "read" | "export"): Promise<HydratedItem[]>;
}

export interface ListRecent {
  /** (updatedAtUs desc, id desc); the cursor keeps the exact µs key. */
  recent(tx: Tx, scope: RetrievalScope, page: { cursor: string | null; limit: number }): Promise<{ items: MemoryRow[]; nextCursor: string | null }>;
}

/** Paged raw export (export, migration). Only visible rows; same predicate as raw reads. */
export interface ListRawMessages {
  listRaw(tx: Tx, scope: RetrievalScope, page: { cursor: string | null; limit: number }): Promise<{ items: RawSegment[]; nextCursor: string | null }>;
}

/** Optional (capability relations). Absent: core reports index_unavailable for relation reads. */
export interface RelationSource {
  relations(tx: Tx, scope: RetrievalScope, refs: readonly ItemRef[], depth: number): Promise<Array<{ from: ItemRef; to: ItemRef; kind: string }>>;
  mocRank(tx: Tx, scope: RetrievalScope, query: string, limit: number): Promise<Array<{ mocId: string; score: number }>>;
}

export interface EmbedQuery {
  embedQuery(owner: OwnerId, text: string, options: CallOptions & { budgetClass: "recall" }): Promise<{ vector: Float32Array; model: string }>;
}
