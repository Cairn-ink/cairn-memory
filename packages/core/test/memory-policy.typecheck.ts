// Compile-only: the write policy is typed through the package entry. Run with `npm run typecheck`.
import {
  RELATION_LIMIT, canonicalPair, decideWrite, planConflictInsert, planCorrect, planDuplicateMerge, planSupersede,
} from "../src/index.mjs";
import type { DuplicateMerge, MemoryRow, WriteDecision, WritePolicy, WriteProgress } from "../src/index.mjs";

declare const policy: WritePolicy;
declare const row: MemoryRow;

export function writeShape(progress: WriteProgress): string | null {
  const decision: WriteDecision = decideWrite(policy, 0, progress);
  const merged: { merge: DuplicateMerge; changed: boolean } = planDuplicateMerge(row, row);
  const corrected = planCorrect(row, row.revision, row, false);
  planSupersede(row, row.revision, corrected.textHash, RELATION_LIMIT - 1);
  const [left, right] = canonicalPair("a", "b");
  const pairs: [string, string][] = planConflictInsert(left, [right], new Map([[left, 1], [right, 1]]));
  const limit: 5 = RELATION_LIMIT;
  return decision.status === "duplicate" && merged.changed && pairs.length < limit ? decision.id : null;
}
