import { CoreError, decideWrite, planDuplicateMerge, validateSuppressionFact } from "../../core/src/index.mjs";
import { copyArray, pgText } from "./capture-input.mjs";
import { copyContent, copyReceipts, namespaceKey, writeTime } from "./memory-input.mjs";
import { readVisibility } from "./memory-visibility.mjs";
import { runOperation } from "./uow.mjs";

/** @import { FactMatchPolicy } from "../../core/src/index.mjs" */
/** @import { FinishItem, FinishResult } from "../../core/src/ports/capture.d.ts" */
/** @import { InsertRow, MemoryStore, Scope, SourceRef, Tx } from "../../core/src/ports/index.d.ts" */
/** @import { Query } from "./memory-rows.mjs" */

/** @type {WeakMap<Tx, {client: string, eventId: string, result: FinishResult}[]>} */
const finishedInRun = new WeakMap();

/** @param {Tx} tx @param {string} client @param {string} eventId @param {FinishResult} result */
export function trackFinish(tx, client, eventId, result) {
  const finishes = finishedInRun.get(tx) ?? [];
  finishes.push({ client, eventId, result });
  finishedInRun.set(tx, finishes);
}

/** @param {Tx} tx @param {Query} query */
export async function refreshFinishRevisions(tx, query) {
  const finishes = finishedInRun.get(tx);
  if (!finishes) return;
  const revision = await readIndexRevision(query, tx.owner);
  for (const { client, eventId, result } of finishes) {
    await query(`UPDATE capture_events SET core_result = jsonb_set(core_result, '{indexRevision}', to_jsonb($4::bigint))
      WHERE user_id = $1 AND client = $2 AND event_id = $3`, [tx.owner, client, eventId, revision]);
    result.indexRevision = revision;
  }
}

/** @param {readonly FinishItem[]} items */
export function copyFinishItems(items) {
  return copyArray(items).map((item) => {
    if (!item) throw new CoreError("invalid_input");
    /** @type {InsertRow} */
    const row = { text: item.content, kind: item.kind, origin: "inferred", confidence: item.confidence,
      textHash: item.textHash, source: { kind: "capture", client: null, sessionId: null }, embedding: item.embedding };
    const { model, vector } = copyContent(row);
    row.embedding = { model, vector: JSON.parse(vector) };
    if (item.digests !== undefined) {
      const digests = copyArray(item.digests).map(({ alg, keyId, label, pipeline, redactionVersion, value }) =>
        ({ alg, keyId, ...(label === undefined ? {} : { label }), pipeline, redactionVersion, value }));
      if (digests.some(({ alg, keyId, label }) => !pgText(alg) ||
          (keyId !== null && !pgText(keyId)) || (label !== undefined && !pgText(label)))) throw new CoreError("invalid_input");
      const fact = validateSuppressionFact({
        owner: "validation", actionId: "validation", kind: "text", mode: "exact", origin: "forget",
        text: { digests },
      });
      if (fact.kind !== "text") throw new CoreError("invalid_input");
      row.digests = digests;
    }
    const legacyDigests = row.digests?.filter(({ label }) => label === undefined);
    return { row, receipts: copyReceipts(item.receipts), legacyDigests: legacyDigests?.length ? legacyDigests : undefined };
  });
}

/** @param {Query} query @param {string} owner */
export async function readIndexRevision(query, owner) {
  const { rows: [row] } = await query("SELECT index_revision::text FROM core_owner_state WHERE user_id = $1", [owner]);
  const revision = Number(row?.index_revision ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new CoreError("internal_error");
  return revision;
}

/** @param {Tx} tx @param {Scope} scope @param {SourceRef} source
 * @param {ReturnType<typeof copyFinishItems>} items @param {number} nowMs
 * @param {MemoryStore} memories @param {FactMatchPolicy["hashSessionKey"]} hashSessionKey */
export async function finishMemories(tx, scope, source, items, nowMs, memories, hashSessionKey) {
  /** @type {FinishResult} */
  const result = { indexRevision: 0, memories: [], suppressedCount: 0, duplicateCount: 0, counters: { nearSkippedUnembedded: 0 } };
  let saved = 0;
  if (!items.length) return { result, saved };

  const candidates = items.map(({ row }) => ({ textHash: row.textHash, digests: row.digests, embedding: row.embedding?.vector }));
  // The memory store accepts five-field records. Passing labelled records through its projection
  // can conflate MACs which share a value but belong to different domains.
  const policy = await memories.readWritePolicy(tx, scope,
    candidates.map((candidate, position) => ({ ...candidate, digests: items[position].legacyDigests })), source, "full");
  const labelled = new Set(candidates.flatMap(({ digests }, index) => digests?.some(digest => digest.label !== undefined) ? [index] : []));
  if (labelled.size) {
    // The memory store's digest projection omits labels. Use the same visibility matcher with
    // the original signing domains for these positions.
    await runOperation(tx, async (query) => {
      const visibility = await readVisibility(query, scope.owner, hashSessionKey);
      policy.blockedPositions = policy.blockedPositions.filter(position => !labelled.has(position));
      for (const position of labelled) {
        if (visibility.blocks(scope, candidates[position], "full", undefined)) policy.blockedPositions.push(position);
      }
    });
  }

  const writeTimeUs = writeTime(nowMs);
  const progress = { inserted: new Map(), writeTimes: new Map() };
  for (const [position, { row, receipts, legacyDigests }] of items.entries()) {
    const decision = decideWrite(policy, position, progress);
    switch (decision.status) {
      case "suppressed":
        result.suppressedCount++;
        break;
      case "saved": {
        const { id, revision, updatedAtUs } = await memories.insert(tx, scope, { ...row, source, digests: legacyDigests }, receipts, nowMs);
        if (labelled.has(position)) {
          // Preserve the complete digest shape on the inserted row before the transaction can publish it.
          await runOperation(tx, (query) => query(`UPDATE memories SET core_digests = $4::jsonb
            WHERE user_id = $1 AND core_namespace IS NOT DISTINCT FROM $2 AND id = $3`,
          [scope.owner, namespaceKey(scope.namespace), id, JSON.stringify(row.digests)]));
        }
        progress.inserted.set(position, id);
        progress.writeTimes.set(id, updatedAtUs);
        result.memories.push({ id, revision, outcome: "inserted" });
        saved++;
        break;
      }
      case "duplicate": {
        const { id } = decision;
        const existing = await memories.get(tx, scope, id);
        if (!existing) throw new CoreError("internal_error");
        const { merge } = planDuplicateMerge(existing, row);
        const outcome = await memories.touchDuplicate(tx, scope, id, receipts, merge, nowMs);
        progress.writeTimes.set(id, writeTimeUs);
        result.memories.push({ id, ...outcome });
        result.duplicateCount++;
        break;
      }
    }
  }
  return { result, saved };
}
