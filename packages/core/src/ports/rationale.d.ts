import type { Revision, Role, Scope } from "./common.d.ts";
import type { Tx } from "./unit-of-work.d.ts";

export interface RationaleGuard {
  memoryId: string;
  revision: Revision;
}

export interface RationaleReceipt {
  /** Stable digest of (client, sessionId, messageId). */
  id: string;
  role: Role;
  excerpt: string;
}

export interface RationaleSource {
  memory: { id: string; revision: Revision };
  receipts: RationaleReceipt[];
}

export type RationaleRelation = "supports-decision" | "challenges-premise";

export interface RationaleAnchor {
  id: string;
  revision: Revision;
  receiptId: string;
  digest: string;
}

export interface RationaleEdge {
  from: RationaleAnchor;
  to: RationaleAnchor;
  relation: RationaleRelation;
}

/** Optional under rationaleEdges. Calls use one live transaction and an exact owner/namespace. */
export interface RationaleEdgeStore {
  /**
   * Complete receipts in stable order (1–100 per current memory). Read each source message
   * through Raw visibility, including retired receipts, then cut to 800 UTF-16 units on a
   * code-point boundary and check the excerpt against text facts, including containment.
   * Withhold the receipt when any applicable text fact is too short for containment or
   * the comparison is otherwise unavailable or uncertain.
   * Missing memory: memory_not_found. Wrong revision or any missing, withheld or uncertain
   * receipt text (including a known Raw key conflict): revision_conflict.
   * More than 100: context_item_too_large.
   */
  sourceEvidence(tx: Tx, scope: Scope, refs: readonly RationaleGuard[]): Promise<RationaleSource[]>;
  /**
   * Idempotent on (from.id, to.id, relation, from.receiptId, to.receiptId). A transaction with
   * successful inserts advances the owner index revision once. Conflicts leave it untouched.
   */
  insert(tx: Tx, scope: Scope, edge: RationaleEdge): Promise<{ inserted: boolean }>;
  /** Count each incident edge once, including self-support. */
  degree(tx: Tx, scope: Scope, memoryId: string): Promise<number>;
  /** Order by from id, from receipt id, to receipt id (UTF-8). Limit 1–11. */
  incoming(tx: Tx, scope: Scope, memoryId: string, relation: RationaleRelation, page: { limit: number }): Promise<RationaleEdge[]>;
  /** Order by the full insert key (UTF-8). Limit 1–11. */
  incident(tx: Tx, scope: Scope, memoryId: string, page: { limit: number }): Promise<RationaleEdge[]>;
  /**
   * Delete all incident rows in the same transaction as an invalidating write or forget.
   * Hosts must also delete edges citing a removed Raw message's receipts in the same
   * transaction as the Raw deletion or purge.
   */
  invalidate(tx: Tx, scope: Scope, memoryId: string): Promise<{ deleted: number }>;
}

/**
 * Raw-visible source text in admission order, deduplicated by raw message identity.
 * Required for relatePlaced with rationaleEdges. Follows the same scope, receipt completeness
 * and withholding rules as sourceEvidence. Used locally for discovery.
 */
export type RationaleSourceText =
  (tx: Tx, scope: Scope, refs: readonly RationaleGuard[]) => Promise<readonly string[]>;
