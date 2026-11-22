import { CoreError } from "../errors.mjs";
import { compareSortKey, compareUtf8 } from "../utf8.mjs";
import { RELATION_LIMIT } from "./relation-limits.mjs";

/** @typedef {import("../ports/common.d.ts").MemoryRow} MemoryRow */
/** @typedef {import("../ports/common.d.ts").Revision} Revision */
/** @typedef {import("../ports/common.d.ts").SortKeyUs} SortKeyUs */
/** @typedef {import("../ports/memory-store.d.ts").WritePolicy} WritePolicy */
/** @typedef {import("../ports/memory-store.d.ts").DuplicateMerge} DuplicateMerge */
/** @typedef {{inserted: Map<number, string>, writeTimes: Map<string, SortKeyUs>}} WriteProgress */
/** @typedef {{status: "suppressed"} | {status: "saved"} | {status: "duplicate", id: string}} WriteDecision */
/** @typedef {{id: string, match: "exact" | "near", distance?: number, time: SortKeyUs, wasWritten: boolean}} Choice */

/** @param {Choice} first @param {Choice} second */
function moreRecent(first, second) {
  return (compareSortKey(first.time, second.time) || compareUtf8(first.id, second.id)) > 0;
}

/**
 * The port supplies exact matches first, then near matches, with distance and recency ties ordered.
 * @param {WritePolicy} policy
 * @param {number} position
 * @param {WriteProgress} [progress]
 * @returns {WriteDecision}
 */
export function decideWrite(policy, position, progress) {
  if (policy.blockedSession || policy.blockedPositions.includes(position)) return { status: "suppressed" };

  /** @type {Choice | undefined} */
  let best;
  for (const match of policy.matches[position]) {
    if (match.kind === "stored" && policy.hiddenIds.includes(match.id)) {
      if (match.match === "exact") return { status: "suppressed" };
      continue;
    }

    const id = match.kind === "stored" ? match.id : progress?.inserted.get(match.batchIndex);
    if (id === undefined) continue;
    const writtenAt = progress?.writeTimes.get(id);
    const time = match.kind === "prior" ? writtenAt : writtenAt ?? match.writeTimeUs;
    if (time === undefined) continue;

    const choice = { id, match: match.match, distance: match.distance, time, wasWritten: writtenAt !== undefined };
    if (!best || (choice.match === best.match && choice.distance === best.distance &&
        (choice.wasWritten || best.wasWritten) && moreRecent(choice, best))) {
      best = choice;
    }
  }
  return best ? { status: "duplicate", id: best.id } : { status: "saved" };
}

/**
 * @param {MemoryRow} existing
 * @param {Pick<MemoryRow, "kind" | "origin" | "confidence">} incoming
 * @returns {{merge: DuplicateMerge, changed: boolean}}
 */
export function planDuplicateMerge(existing, incoming) {
  const explicit = incoming.origin === "explicit";
  const confidence = !explicit && existing.origin === "explicit"
    ? existing.confidence : Math.max(existing.confidence, incoming.confidence);
  const changed = confidence !== existing.confidence ||
    (explicit && (incoming.kind !== existing.kind || incoming.origin !== existing.origin));
  const merge = explicit ? { kind: incoming.kind, origin: incoming.origin, confidence } : { confidence };
  return { merge, changed };
}

/** @param {MemoryRow | null} row @param {Revision} expectedRevision @returns {asserts row is MemoryRow} */
function requireCurrentRevision(row, expectedRevision) {
  if (row === null) throw new CoreError("memory_not_found");
  if (row.revision !== expectedRevision) throw new CoreError("revision_conflict");
  if (row.historical) throw new CoreError("memory_historical");
}

/** @typedef {Pick<MemoryRow, "textHash" | "kind" | "origin" | "confidence" | "revision">} ContentFields */

/**
 * @param {MemoryRow | null} current The visible row, including historical rows.
 * @param {Revision} expectedRevision
 * @param {Pick<MemoryRow, "textHash" | "kind">} next
 * @param {boolean} collidesWithOther
 * @returns {{outcome: "changed" | "unchanged"} & ContentFields}
 */
export function planCorrect(current, expectedRevision, next, collidesWithOther) {
  requireCurrentRevision(current, expectedRevision);
  const { textHash, kind, origin, confidence, revision } = current;
  if (textHash === next.textHash) return { outcome: "unchanged", textHash, kind, origin, confidence, revision };
  if (collidesWithOther) throw new CoreError("memory_conflict");
  return { outcome: "changed", textHash: next.textHash, kind: next.kind, origin: "explicit", confidence: 1, revision: revision + 1 };
}

/**
 * @param {MemoryRow | null} previous The visible row, including historical rows.
 * @param {Revision} expectedRevision
 * @param {string} replacementTextHash
 * @param {number} incomingCount Incoming supersessions on the replacement before this write.
 */
export function planSupersede(previous, expectedRevision, replacementTextHash, incomingCount) {
  requireCurrentRevision(previous, expectedRevision);
  if (previous.textHash === replacementTextHash) {
    // CR: invalid_ref
    throw new CoreError("invalid_input");
  }
  if (incomingCount + 1 > RELATION_LIMIT) {
    // CR: supersession_limit
    throw new CoreError("invalid_input");
  }
}

/** @param {string} a @param {string} b @returns {[left: string, right: string]} */
export function canonicalPair(a, b) {
  const order = compareUtf8(a, b);
  if (order === 0) {
    // CR: invalid_ref
    throw new CoreError("invalid_input");
  }
  return order < 0 ? [a, b] : [b, a];
}

/**
 * The caller supplies validated target IDs and projected degrees for both endpoints in one snapshot.
 * The store binds the canonical pairs to the validated revisions when it inserts them.
 * @param {string} memoryId
 * @param {readonly string[]} hints
 * @param {ReadonlyMap<string, number>} degreeAfter
 * @returns {[left: string, right: string][]}
 */
export function planConflictInsert(memoryId, hints, degreeAfter) {
  const pairs = Array.from(new Set(hints), targetId => canonicalPair(memoryId, targetId));
  for (const [left, right] of pairs) {
    for (const id of [left, right]) {
      const degree = degreeAfter.get(id);
      if (degree === undefined) throw new CoreError("invalid_input");
      if (degree > RELATION_LIMIT) {
        // CR: conflict_limit
        throw new CoreError("invalid_input");
      }
    }
  }
  return pairs;
}
