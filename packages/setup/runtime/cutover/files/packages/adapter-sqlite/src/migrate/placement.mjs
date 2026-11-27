import { titleKey } from "../../../core/src/index.mjs";
import { legacyIdentifier } from "../legacy/migration-input.mjs";
import { createPlacementVisibility } from "../placement-visibility.mjs";
import { createRawLineage } from "../raw-lineage.mjs";
import { createReceiptReadSafety } from "../receipt-read-safety.mjs";
import { scopeKey, sha256 } from "../storage-values.mjs";
import { sessionHasher } from "../suppressions.mjs";
import { fromNamespace, timestamp } from "./plan.mjs";
import { createMigratedRawPolicy } from "./raw-privacy.mjs";

/** @import { SQLInputValue } from "node:sqlite" */
/** @import { LegacyInput } from "../legacy/migration-input.mjs" */
/** @import { Connection } from "../storage-values.mjs" */
/** @import { ScopedVisibility } from "../placement-visibility.mjs" */
/** @import { Scope } from "@cairn-ink/core/ports" */

/** @param {Scope} scope @param {Scope} other */
const sameScope = (scope, other) => scope.owner === other.owner && scope.namespace === other.namespace;

/** @param {string} json */
function receiptIds(json) {
  try {
    const ids = JSON.parse(json);
    if (Array.isArray(ids) && ids.length <= 4 && ids.every(id => typeof id === "string") &&
        new Set(ids).size === ids.length) return ids;
  } catch { /* Invalid bindings carry no receipt evidence. */ }
  return [];
}

/**
 * Plan rows against the populated replacement and its converted inspect receipts.
 * Denied titles are never inserted, even temporarily. The caller attests these
 * rows and completes the migration in the same transaction.
 * @param {Connection} db @param {LegacyInput} source @param {string} sessionKey
 */
export function convertPlacement(db, source, sessionKey) {
  /** @type {Record<"cairn_topics" | "cairn_topic_sources" | "cairn_topic_outcomes" |
   * "cairn_topic_memberships" | "cairn_topic_failures" | "cairn_supersessions" | "cairn_conflicts", SQLInputValue[][]>} */
  const tables = {
    cairn_topics: [], cairn_topic_sources: [], cairn_topic_outcomes: [],
    cairn_topic_memberships: [], cairn_topic_failures: [], cairn_supersessions: [], cairn_conflicts: [],
  };
  const { topics, edges, sources, members, completed, conflicts, withheld } = source.placement;
  const byId = new Map(source.memories.map(row => [row.id, row]));
  const byTopic = new Map(topics.map(topic => [topic.id, topic]));
  const hash = sessionHasher(sessionKey, source.rawPrivacy !== null);
  const raw = source.rawPrivacy ? createMigratedRawPolicy(sessionKey, hash, source.localRawPrivacy) : undefined;
  const visibility = createPlacementVisibility(hash, createReceiptReadSafety(hash, createRawLineage(sessionKey, hash), raw), raw);
  /** @type {Map<string, ScopedVisibility>} */
  const scopes = new Map();
  /** @param {Scope} scope @param {string} id */
  function visible(scope, id) {
    const row = byId.get(id);
    if (!row || row.deleted !== 0n || withheld.has(id) || !sameScope(scope, fromNamespace(row))) return;
    const key = JSON.stringify(scopeKey(scope));
    const read = scopes.get(key) ?? visibility(db, scope);
    scopes.set(key, read);
    return read(id) ? row : undefined;
  }
  /** @param {Scope} scope @param {string} id @param {bigint} revision */
  function current(scope, id, revision) {
    const row = visible(scope, id);
    return row?.currentness === "current" && row.revision === revision ? row : undefined;
  }

  /** @type {Map<string, string[]>} */
  const parents = new Map();
  for (const edge of edges) {
    const parent = byTopic.get(edge.parent_id);
    const child = byTopic.get(edge.child_id);
    if (parent?.level !== 2n || child?.level !== 1n || parent.revision !== edge.parent_revision ||
        child.revision !== edge.child_revision || !sameScope(fromNamespace(parent), fromNamespace(child))) continue;
    const ids = parents.get(child.id) ?? [];
    ids.push(parent.id);
    parents.set(child.id, ids);
  }

  const hasSource = new Set();
  const hiddenTitles = new Set();
  for (const { moc_id, memory_id, memory_revision } of sources) {
    const topic = byTopic.get(moc_id);
    if (!topic) continue;
    const scope = fromNamespace(topic);
    if (!current(scope, memory_id, memory_revision)) {
      hiddenTitles.add(moc_id);
      const memory = visible(scope, memory_id);
      if (memory?.currentness === "current" && memory_revision < memory.revision) {
        // Legacy filing still advances groups that cite an earlier revision.
        tables.cairn_topic_sources.push([...scopeKey(scope), moc_id, memory_id, 0]);
      }
      continue;
    }
    hasSource.add(moc_id);
    tables.cairn_topic_sources.push([...scopeKey(scope), moc_id, memory_id, memory_revision]);
  }
  for (const [index, topic] of topics.entries()) {
    const { id, title, level, revision } = topic;
    tables.cairn_topics.push([...scopeKey(fromNamespace(topic)), legacyIdentifier(id), level === 1n ? "L1" : "L2",
      hasSource.has(id) && !hiddenTitles.has(id) ? title : null,
      sha256(titleKey(title)), revision, index + 1, JSON.stringify(parents.get(id) ?? [])]);
  }

  /** @type {Map<string, SQLInputValue[]>} */
  const outcomes = new Map();
  for (const { moc_id, memory_id, memory_revision, moc_revision } of members) {
    const topic = byTopic.get(moc_id);
    if (topic?.level !== 1n || topic.revision !== moc_revision) continue;
    const scope = fromNamespace(topic);
    const memory = current(scope, memory_id, memory_revision);
    if (memory?.filing_status !== "filed") continue;
    const keys = scopeKey(scope);
    outcomes.set(memory_id, [...keys, memory_id, memory_revision]);
    // The legacy edge has no timestamp. Filing advances the bound memory's update time.
    tables.cairn_topic_memberships.push([...keys, memory_id, moc_id, timestamp(memory.updated_at)]);
  }
  // Only a completed placement can establish an empty outcome. Legacy journal
  // failures have no retry code or time and leave memories eligible for filing.
  for (const row of completed) {
    const scope = fromNamespace(row);
    if (current(scope, row.id, row.revision)?.filing_status === "unfiled") {
      outcomes.set(row.id, [...scopeKey(scope), row.id, row.revision]);
    }
  }
  tables.cairn_topic_outcomes = [...outcomes.values()];

  for (const edge of source.history) {
    const scope = fromNamespace(edge);
    const previous = visible(scope, edge.previous_memory_id);
    const replacement = visible(scope, edge.replacement_memory_id);
    if (!previous || !replacement) continue;
    const ids = receiptIds(edge.receipt_ids);
    const { previous_revision, replacement_revision } = edge;
    tables.cairn_supersessions.push([...scopeKey(scope), previous.id, previous_revision,
      replacement.id, replacement_revision, JSON.stringify(ids), timestamp(previous.updated_at) / 1000n]);
  }
  for (const edge of conflicts) {
    const left = byId.get(edge.left_memory_id);
    if (!left) continue;
    const scope = fromNamespace(left);
    if (!current(scope, left.id, edge.left_revision) || !current(scope, edge.right_memory_id, edge.right_revision)) continue;
    // Legacy conflicts have no recorded creation time.
    tables.cairn_conflicts.push([...scopeKey(scope), left.id, edge.left_revision,
      edge.right_memory_id, edge.right_revision, edge.source, 0]);
  }

  return { tables, evidence: source.inspect.evidence
    .filter(item => item.qualification || item.procedural)
    .map(item => ({ ...item, filing: /** @type {const} */ ("unfiled"), supersession: null })) };
}
