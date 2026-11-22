import type { Counters, MemoryKind, Receipt, Revision, Role, Scope } from "./common.d.ts";
import type { Tx } from "./unit-of-work.d.ts";

export interface CaptureMessage {
  /** Client message id (free-form, ≤ 512 chars). */
  id: string;
  role: Role;
  /** Normalized (NFKC, no lone surrogates, no NUL) and redacted before it reaches a port. */
  content: string;
  occurredAtMs: number | null;
}

export interface CaptureKey {
  scope: Scope;
  client: string;
  sessionId: string;
  /** Idempotency key for the capture (hosted capture_id / engine event id). */
  eventId: string;
  /** sha256 of the canonical payload; a different payload under the same eventId is a conflict. */
  payloadDigest: string;
}

export type ClaimResult =
  | { status: "claimed"; token: string }
  | { status: "duplicate" }
  | { status: "processing" }
  /** The capture was already admitted; core returns this stored result unchanged. */
  | { status: "rawReplay"; result: FinishResult };

/** Admission and lease of one capture. Runs inside UnitOfWork with pauseLock. */
export interface CaptureClaim {
  claim(tx: Tx, key: CaptureKey, messages: readonly CaptureMessage[], options: { leaseMs: number }): Promise<ClaimResult>;
  /** Releases a claim. retryable=false records a terminal code-only failure. */
  abandon(tx: Tx, token: string, failure: { code: string; retryable: boolean }): Promise<void>;
  /**
   * Called once per claim, before the first model dispatch. Marks the claim dispatched and
   * returns the token to use from now on (staged stores rotate it; others return it unchanged).
   * Fails if the lease was lost.
   */
  beginDispatch(tx: Tx, token: string): Promise<{ token: string }>;
}

export interface FinishItem {
  content: string;
  kind: MemoryKind;
  confidence: number;
  textHash: string;
  /** null when not embedded at write time (rule 10). */
  embedding: { model: string; vector: Float32Array } | null;
  receipts: Receipt[];
}

export interface FinishResult {
  /** Owner index revision after the finish (public capture result key). */
  indexRevision: number;
  memories: Array<{ id: string; revision: Revision; outcome: "inserted" | "touched" | "changed" }>;
  suppressedCount: number;
  duplicateCount: number;
  counters: Counters;
}

/** Writes the capture's memories and completes the claim in one transaction. */
export interface CaptureFinish {
  finish(tx: Tx, token: string, items: readonly FinishItem[]): Promise<FinishResult>;
}

/** Which captured messages may reach the model and the archive. Fails closed on any doubt. */
export interface SourceFilter {
  /** Returns the positions of messages that are eligible (not suppressed, not fenced, not windowed). */
  eligible(tx: Tx, key: CaptureKey, messages: readonly CaptureMessage[]): Promise<number[]>;
  /** Re-checks the same positions inside the write transaction; throws suppressed / lineage_fenced. */
  assertEligible(tx: Tx, key: CaptureKey, positions: readonly number[]): Promise<void>;
}

export interface RawCapture {
  /** Records message lineage (message MAC / span) for fork detection. */
  recordLineage(tx: Tx, key: CaptureKey, messages: readonly CaptureMessage[]): Promise<void>;
  /** False when the session is fenced (or lineage cannot be checked). */
  archiveAllowed(tx: Tx, key: CaptureKey): Promise<boolean>;
  archive(tx: Tx, key: CaptureKey, messages: readonly CaptureMessage[]): Promise<{ archived: number }>;
}

/** Optional (capability stagedEvidence). */
export interface StagedEvidence {
  claimEvidence(tx: Tx, key: CaptureKey): Promise<{ claimId: string } | { status: "busy" }>;
  assertEvidence(tx: Tx, claimId: string): Promise<void>;
  release(tx: Tx, claimId: string): Promise<void>;
}

/** Optional (capability placement): MOC placement journal. */
export interface PlacementJournal {
  get(tx: Tx, scope: Scope, memoryId: string): Promise<{ mocIds: string[]; revision: Revision } | null>;
  map(tx: Tx, scope: Scope): Promise<Array<{ mocId: string; level: 1 | 2; parentId: string | null; title: string }>>;
  begin(tx: Tx, scope: Scope, memoryIds: readonly string[]): Promise<{ jobId: string }>;
  apply(tx: Tx, jobId: string, placements: ReadonlyArray<{ memoryId: string; mocIds: string[] }>): Promise<void>;
  fail(tx: Tx, jobId: string, code: string): Promise<void>;
}

/** Optional (capability orderedCapture). */
export interface CausalStream {
  highWater(tx: Tx, scope: Scope, client: string, sessionId: string): Promise<number>;
  bind(tx: Tx, key: CaptureKey, sequence: number): Promise<void>;
  advance(tx: Tx, key: CaptureKey, sequence: number): Promise<void>;
  /** At most 13 candidate predecessors. */
  listCandidatePredecessors(tx: Tx, scope: Scope, query: { textHash: string }): Promise<Array<{ id: string; revision: Revision }>>;
}
