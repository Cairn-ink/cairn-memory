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
  /** Nonempty topics. L2 counts and recency use distinct visible memories across its children. */
  list(tx: Tx, scope: Scope, query: TopicPage & { level?: Topic["level"] }): Promise<{
    items: Array<Topic & { memberCount: number; newestMemberIds: string[] }>;
    nextCursor: string | null;
  }>;
  members(tx: Tx, scope: Scope, topicId: string, query: TopicPage): Promise<{
    items: Array<{ kind: "memory"; id: string; placedAtUs: bigint }>;
    nextCursor: string | null;
  }>;
  forMemory(tx: Tx, scope: Scope, memoryId: string): Promise<string[]>;
  /**
   * One batch query for L1 topic annotations. Callers skip annotations if this method is absent.
   * A row requires a placement outcome and a current, visible memory in scope at the outcome's
   * recorded revision, using the same visibility rule as `forMemory` and `list`. A filed or
   * unfiled outcome without topics returns `topics: []` if it meets that rule.
   * Unknown ids and ids from other owners or namespaces yield no row. Each id yields at most
   * one row, in first-occurrence input order. Topics follow `forMemory` order, and a title is
   * null when any title source is no longer current at its recorded revision, as in `list` and `catalog`.
   * Accepts 1–100 ids, including duplicates in the limit. Other batch sizes throw `invalid_input`.
   */
  forMemories?(tx: Tx, scope: Scope, memoryIds: readonly string[]): Promise<
    Array<{ memoryId: string; topics: Array<{ id: string; title: string | null }> }>
  >;
  dropMemory(tx: Tx, scope: Scope, memoryId: string): Promise<{ dropped: number }>;
}
