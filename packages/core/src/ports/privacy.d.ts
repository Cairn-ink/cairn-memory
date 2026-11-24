import type { CaptureMessage } from "./capture.d.ts";
import type { OwnerId, Receipt, Scope } from "./common.d.ts";
import type { RawSpanFact, StoredFact, SuppressionFact, TextDigest } from "../suppression-fact.mjs";
import type { Tx } from "./unit-of-work.d.ts";

/** A passage fingerprint computed by core (privacy module); holds no plaintext. Same digest shape as TextFact. */
export interface PassageFingerprint {
  digests: readonly TextDigest[];
  shingles: string[] | null;
  keyId: string | null;
  /** Shingles signed by retained Core HMAC keys, scoped to the spelling of this passage. */
  retainedShingles?: readonly RetainedShingles[];
}

export interface RetainedShingles {
  keyId: string;
  shingles: readonly string[];
}

export interface SuppressionSnapshot {
  blockedSession: boolean;
  /** Capture message positions blocked by session/window/lineage facts. */
  blockedMessages: number[];
  /** Live text facts per the snapshot contract, including their shingle evidence. */
  passages: Array<StoredFact<Extract<SuppressionFact, { kind: "text" }>>>;
}

export interface SuppressionStore {
  /**
   * Writes a fact into its slot (the store's natural key for the fact's target + kind + mode).
   * Same incarnation already present → returns the original {factId, epoch, createdAtMs},
   * created:false. Different incarnation in the slot → throws fact_conflict (tx rolls back).
   * A new fact advances the owner epoch by exactly 1.
   */
  writeFact(tx: Tx, fact: SuppressionFact, incarnation: string): Promise<{ factId: string; epoch: bigint; createdAtMs: number; created: boolean }>;
  /**
   * For capture, returns live text facts with their shingle evidence, in `passages`,
   * filtered only by owner/namespace and by a definite false from core's own capture matcher.
   * Use `factBlocksIncoming` in capture mode with shingles enabled on the same candidate
   * `passages` Core supplied. Keep exact and containment matches, ineligible results,
   * and facts requiring legacy-domain handling. Core applies the same match, so a definite
   * miss leaves its decision unchanged. Fact mode, `rowShingles`, and missing row shingles
   * are forbidden as independent capture filters.
   * When neither side has a key or shingle evidence, capture matching is exact-only,
   * with weaker protection without a key. When `candidates.passages` is omitted, only owner
   * and namespace scope the text facts. Client, session and time candidates govern
   * `blockedSession` and `blockedMessages`.
   * Uncertain or unbounded → throws ineligible (fail closed).
   */
  snapshot(tx: Tx, scope: Scope, candidates: { client?: string; sessionId?: string; occurredAtMs?: ReadonlyArray<number | null>; passages?: readonly PassageFingerprint[] }): Promise<SuppressionSnapshot>;
  /**
   * Checks a receipt against source withholding and tombstones. Before a capture archives its
   * admitted source, the optional message supplies the evidence to check when a Raw row is absent.
   */
  receiptWithheld?(tx: Tx, scope: Scope, receipt: Receipt & { excerpt: string }, admitted?: CaptureMessage): Promise<boolean>;
  /** Facts that target one item; "ineligible" when the store cannot decide. */
  factsFor(tx: Tx, scope: Scope, target: { memoryId: string }): Promise<StoredFact[] | "ineligible">;
  /** Current owner epoch, or null before the first fact. */
  epoch(tx: Tx, owner: OwnerId): Promise<bigint | null>;
}

/** A session-level lineage closure proven by message MAC AND content proof. Only provenClosure creates it. */
export type ProvenClosure = ReadonlyArray<{ client: string; sessionId: string }> & { readonly __proven: unique symbol };

export interface FenceResult {
  fenced: boolean;
  /** proven: linked by id + content proof. id-only: linked by id only. unknown: missing key or any error. */
  proof: "proven" | "id-only" | "unknown";
}

/** Optional (capability sessionLineage): hosted message-MAC lineage with keyed content proofs. */
export interface SessionLineageStore {
  recordAnchors(tx: Tx, scope: Scope, session: { client: string; sessionId: string }, anchors: ReadonlyArray<{ messageMac: string; contentMac: string | null }>): Promise<void>;
  /** Bounded proven closure. Over LINEAGE_CLOSURE_MAX_* → throws lineage_closure_limit (callers roll back; never partial). */
  provenClosure(tx: Tx, scope: Scope, roots: ReadonlyArray<{ client: string; sessionId: string }>): Promise<ProvenClosure>;
  /** Missing key or any error → { fenced: true, proof: "unknown" }. id-only and unknown fences HIDE, never delete. */
  isFenced(tx: Tx, scope: Scope, session: { client: string; sessionId: string }): Promise<FenceResult>;
}

/** Optional (capability spanLineage): engine span-level receipt lineage. */
export interface SpanLineageStore {
  /**
   * Resolves the raw spans a memory came from. Runs BEFORE receipts are deleted (forget step
   * lineage.resolve). Returns [] when the memory's source Raw rows no longer exist.
   * In that case, forget still erases the memory. Throws raw_lineage_unavailable on any other doubt.
   */
  resolveSpans(tx: Tx, scope: Scope, memoryId: string): Promise<RawSpanFact[]>;
}

export interface RawStore {
  fenceSession(tx: Tx, scope: Scope, session: { client: string; sessionId: string }): Promise<void>;
  /** Deletes raw rows and blanks ledger text for a PROVEN closure only (type-level guard). */
  eraseSessions(tx: Tx, scope: Scope, closure: ProvenClosure): Promise<{ rawDeleted: number; ledgerBlanked: number }>;
  /** Deletes raw rows and blanks ledger messages withheld by the given text facts. */
  purgeWithheld(tx: Tx, scope: Scope, facts: ReadonlyArray<StoredFact>): Promise<{ rawDeleted: number; ledgerBlanked: number }>;
  deleteConversation(tx: Tx, scope: Scope, session: { client: string; sessionId: string }): Promise<{ rawDeleted: number }>;
}

export interface PauseState {
  paused: boolean;
  /** Increments only on pause. */
  generation: number;
}

export interface PauseStore {
  /** Must be called inside a pauseLock run. */
  get(tx: Tx, owner: OwnerId): Promise<PauseState>;
  set(tx: Tx, owner: OwnerId, paused: boolean): Promise<PauseState>;
}

export interface FingerprintKeyProvider {
  /** null when no key is active: the store then uses FORGET_POLICY.withoutKey. Key ids stay stable. */
  userKey(owner: OwnerId): Promise<{ id: string; signingKey: CryptoKey } | null>;
  /** Select the active key in a write transaction that serializes with publication. */
  userKeyForWrite?(tx: Tx): ReturnType<FingerprintKeyProvider["userKey"]>;
  /** Signers for non-current domains with live HMAC-only facts or retained Core shingle evidence for this owner. */
  retainedDigesters?(owner: OwnerId): Promise<ReadonlyArray<RetainedDigester>>;
}

export interface RetainedDigester {
  alg: string;
  keyId: string;
  label: string;
  /** Signs the supplied spelling or shingle locally. Never persists, logs or transmits the input. */
  mac(text: string): Promise<string>;
}

/** Cutover-only (capability forgetLog). Removed after the hosted cutover is final. */
export interface ForgetLog {
  record(tx: Tx, owner: OwnerId, memoryId: string, atMs: number): Promise<void>;
}
