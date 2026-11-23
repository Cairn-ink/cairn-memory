import type { ErrorCode } from "../errors.mjs";
import type { PlacementProposal } from "../topics/proposal.mjs";
import type { Revision, Scope } from "./common.d.ts";
import type { Tx } from "./unit-of-work.d.ts";

export interface Topic {
  id: string;
  level: "L1" | "L2";
  /** At most 120 code points. Null when any title source is no longer current at its recorded revision. */
  title: string | null;
  /** L2 has no parents. L1 can name up to three existing L2 parents at creation, plus newly created L2 parents. */
  parentIds: string[];
}

interface MemoryGuard {
  memoryId: string;
  revision: Revision;
}

/** The exact content version eligible for card placement. */
export interface TopicCardGuard {
  cardId: string;
  contentHash: string;
}

/** A batch of up to five cards, each with up to three distinct existing L1 parents. */
export interface CardPlacementProposal {
  items: Array<{ cardId: string; parentIds: string[] }>;
}

interface TopicPage {
  cursor: string | null;
  limit: number;
}

/** Optional under the placement capability. Every operation is scoped to a live transaction. */
export interface TopicStore {
  /** Oldest current memories at their revision with no placement outcome and either no failure or a retryable failure eligible under host config. The memory store defaults to a 1-hour retry window and 3 failed attempts. Limit 1–5. */
  pending(tx: Tx, scope: Scope, query: { limit: number }): Promise<MemoryGuard[]>;
  /** Includes empty topics. A change to the owner's index revision invalidates earlier cursors. */
  catalog(tx: Tx, scope: Scope, query: TopicPage): Promise<{
    items: Topic[];
    nextCursor: string | null;
    exhausted: boolean;
    indexRevision: number;
  }>;
  /**
   * Replaces memberships atomically and records unfiled outcomes at the guarded revision.
   * Each new topic binds its title to every memory id and guarded revision in `basedOn.memoryRevisions`.
   */
  applyPlacement(tx: Tx, scope: Scope, basedOn: { memoryRevisions: MemoryGuard[]; indexRevision: number },
    proposal: PlacementProposal): Promise<{
      placed: Array<{ memoryId: string; topicIds: string[] }>;
      createdTopics: Topic[];
    }>;
  /** Stores only the failure code at each memory's current revision. */
  markFailed(tx: Tx, scope: Scope, memoryIds: readonly string[], code: ErrorCode): Promise<void>;
  /** Oldest unhidden, untombstoned cards in this exact scope, with no outcome at their content hash.
   * Uses the same retry policy as pending. Limit 1–5. Returns [] without documentCards. */
  pendingCards(tx: Tx, scope: Scope, query: { limit: number }): Promise<TopicCardGuard[]>;
  /** Atomically replaces memberships at the guarded hashes. A stale index, invisible card,
   * changed hash, or parent outside the scope's existing L1 topics fails with revision_conflict.
   * Reapplying identical memberships is idempotent. An unfiled outcome alone does not advance
   * the index. A membership change advances it once. */
  applyCardPlacement(tx: Tx, scope: Scope, basedOn: { cards: TopicCardGuard[]; indexRevision: number },
    proposal: CardPlacementProposal): Promise<{ placed: Array<{ cardId: string; topicIds: string[] }> }>;
  /** Records the code at each card's current hash using the same retry semantics as markFailed. */
  markCardsFailed(tx: Tx, scope: Scope, cardIds: readonly string[], code: ErrorCode): Promise<void>;
  /** Returns memberships only while the card and its sources are visible at their recorded versions. */
  forCard(tx: Tx, scope: Scope, cardId: string): Promise<string[]>;
  /** Forget step. The host must drop memberships in the same transaction as every card hide or tombstone. */
  dropCard(tx: Tx, scope: Scope, cardId: string): Promise<{ dropped: number }>;
  /** Topics with visible members. L2 counts distinct members across its L1 children.
   * memberCount and newestMemberIds count only memories. cardCount is present only with documentCards. */
  list(tx: Tx, scope: Scope, query: TopicPage & { level?: Topic["level"] }): Promise<{
    items: Array<Topic & { memberCount: number; newestMemberIds: string[]; cardCount?: number }>;
    nextCursor: string | null;
  }>;
  /** Newest placement first, then descending UTF-8 id, with memory before card on an identical id and time. */
  members(tx: Tx, scope: Scope, topicId: string, query: TopicPage): Promise<{
    items: Array<{ kind: "memory" | "card"; id: string; placedAtUs: bigint }>;
    nextCursor: string | null;
  }>;
  forMemory(tx: Tx, scope: Scope, memoryId: string): Promise<string[]>;
  dropMemory(tx: Tx, scope: Scope, memoryId: string): Promise<{ dropped: number }>;
}
