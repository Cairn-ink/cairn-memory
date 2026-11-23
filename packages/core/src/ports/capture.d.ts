import type { TextDigest } from "../suppression-fact.mjs";
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
  /** Stores the redacted messages as the admission row and outbox, under the pause lock and without taking a lease. A different digest for the same event throws event_payload_conflict. */
  admit?(tx: Tx, key: CaptureKey, messages: readonly CaptureMessage[]): Promise<
    { status: "admitted" | "duplicate" | "processing" } | { status: "rawReplay"; result: FinishResult }
  >;
  /** Loads the stored admission for the runner. */
  load?(tx: Tx, selection: Pick<CaptureKey, "scope" | "client" | "sessionId" | "eventId">): Promise<{ key: CaptureKey; messages: CaptureMessage[] } | null>;
  /** Read-only, per event. Without client, pending takes precedence over failed (with its code), then done. No row means unknown. */
  status?(tx: Tx, scope: Scope, eventId: string, client?: string): Promise<{ status: "pending" | "done" | "failed" | "unknown"; code?: string }>;
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
  /** Core's allDigests(text, key) under the owner's current key. Stores persist row digests. */
  digests?: TextDigest[];
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
  /** Checks session, window, lineage and text eligibility, failing closed. Counts refused messages without storing them and ignores existing message ids. */
  importArchive?(tx: Tx, scope: Scope, session: Pick<CaptureKey, "client" | "sessionId">, messages: readonly CaptureMessage[]): Promise<{ archived: number; existing: number; withheld: number }>;
}

/** Optional (capability stagedEvidence). */
export interface StagedEvidence {
  claimEvidence(tx: Tx, key: CaptureKey): Promise<{ claimId: string } | { status: "busy" }>;
  assertEvidence(tx: Tx, claimId: string): Promise<void>;
  release(tx: Tx, claimId: string): Promise<void>;
}

/** Optional (capability orderedCapture). */
export interface CausalStream {
  highWater(tx: Tx, scope: Scope, client: string, sessionId: string): Promise<number>;
  bind(tx: Tx, key: CaptureKey, sequence: number): Promise<void>;
  advance(tx: Tx, key: CaptureKey, sequence: number): Promise<void>;
  /** At most 13 candidate predecessors. */
  listCandidatePredecessors(tx: Tx, scope: Scope, query: { textHash: string }): Promise<Array<{ id: string; revision: Revision }>>;
}
