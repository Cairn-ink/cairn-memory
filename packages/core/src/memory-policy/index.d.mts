import type { MemoryRow, Revision, SortKeyUs } from "../ports/common.d.ts";
import type { DuplicateMerge, WritePolicy } from "../ports/memory-store.d.ts";

export { RELATION_LIMIT } from "./relation-limits.mjs";

/** Batch positions already inserted, and the recorded insert time of each written id. */
export interface WriteProgress {
  inserted: Map<number, string>;
  writeTimes: Map<string, SortKeyUs>;
}

export type WriteDecision = { status: "suppressed" } | { status: "saved" } | { status: "duplicate"; id: string };

type ContentFields = Pick<MemoryRow, "textHash" | "kind" | "origin" | "confidence" | "revision">;

/** The port supplies exact matches first, then near matches, with distance and recency ties ordered. */
export function decideWrite(policy: WritePolicy, position: number, progress?: WriteProgress): WriteDecision;

export function planDuplicateMerge(
  existing: MemoryRow,
  incoming: Pick<MemoryRow, "kind" | "origin" | "confidence">,
): { merge: DuplicateMerge; changed: boolean };

/** `current` is the visible row, including historical rows. */
export function planCorrect(
  current: MemoryRow | null,
  expectedRevision: Revision,
  next: Pick<MemoryRow, "textHash" | "kind">,
  collidesWithOther: boolean,
): { outcome: "changed" | "unchanged" } & ContentFields;

/** `incomingCount` is the replacement's current count from SupersessionStore.incomingCount. */
export function planSupersede(
  previous: MemoryRow | null,
  expectedRevision: Revision,
  replacementTextHash: string,
  incomingCount: number,
): void;

export function canonicalPair(a: string, b: string): [left: string, right: string];

/** The caller supplies validated target IDs and projected degrees for both endpoints in one snapshot. */
export function planConflictInsert(
  memoryId: string,
  hints: readonly string[],
  degreeAfter: ReadonlyMap<string, number>,
): [left: string, right: string][];
