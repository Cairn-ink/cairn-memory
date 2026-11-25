import { CoreError, decideWrite, planDuplicateMerge } from "../../core/src/index.mjs";
import { receiptExcerpt } from "../../core/src/privacy/text.mjs";
import { copyArray } from "./capture-input.mjs";
import { copyContent, copyReceipts, writeTime } from "./memory-input.mjs";

/** @import { CaptureMessage, FinishItem, FinishResult } from "../../core/src/ports/capture.d.ts" */
/** @import { InsertRow, MemoryStore, Receipt, Scope, SourceRef, Tx } from "../../core/src/ports/index.d.ts" */
/** @import { Query } from "./memory-rows.mjs" */

/** @typedef {{scope: Scope, client: string, sessionId: string, eventId: string,
 *   messages: readonly CaptureMessage[], result: FinishResult}} FinishedCapture */

/** @type {WeakMap<Tx, FinishedCapture[]>} */
const finishedInRun = new WeakMap();

/** @param {Tx} tx @param {FinishedCapture} finish */
export function trackFinish(tx, finish) {
  const finishes = finishedInRun.get(tx) ?? [];
  finishes.push(finish);
  finishedInRun.set(tx, finishes);
}

/** @param {Tx} tx @param {Scope} scope @param {Receipt} receipt @param {string} excerpt */
export function finishedReceiptMessages(tx, scope, receipt, excerpt) {
  return (finishedInRun.get(tx) ?? []).flatMap(finish =>
    finish.scope.owner === scope.owner && finish.scope.namespace === scope.namespace &&
      finish.client === receipt.client && finish.sessionId === receipt.sessionId
      ? finish.messages.filter(message => message.id === receipt.messageId && message.role === receipt.role &&
        message.occurredAtMs === receipt.occurredAtMs && message.content !== "" && receiptExcerpt(message.content) === excerpt)
      : []);
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
    const { digests } = item;
    /** @type {InsertRow} */
    const row = { text: item.content, kind: item.kind, origin: "inferred", confidence: item.confidence,
      textHash: item.textHash, source: { kind: "capture", client: null, sessionId: null },
      embedding: item.embedding, digests: digests === undefined ? undefined : copyArray(digests) };
    const { model, vector, digests: copiedDigests } = copyContent(row);
    return { row: { ...row, digests: copiedDigests, embedding: { model, vector: JSON.parse(vector) } }, receipts: copyReceipts(item.receipts) };
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
 * @param {MemoryStore} memories */
export async function finishMemories(tx, scope, source, items, nowMs, memories) {
  /** @type {FinishResult} */
  const result = { indexRevision: 0, memories: [], suppressedCount: 0, duplicateCount: 0, counters: { nearSkippedUnembedded: 0 } };
  let saved = 0;
  if (!items.length) return { result, saved };

  const candidates = items.map(({ row }) => ({ textHash: row.textHash, digests: row.digests, embedding: row.embedding?.vector }));
  const policy = await memories.readWritePolicy(tx, scope, candidates, source, "full");

  const writeTimeUs = writeTime(nowMs);
  const progress = { inserted: new Map(), writeTimes: new Map() };
  /** @type {number[]} */
  const suppressedItems = [];
  for (const [position, { row, receipts }] of items.entries()) {
    const decision = decideWrite(policy, position, progress);
    switch (decision.status) {
      case "suppressed":
        suppressedItems.push(position);
        break;
      case "saved": {
        const { id, revision, updatedAtUs } = await memories.insert(tx, scope, { ...row, source }, receipts, nowMs);
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
  result.suppressedCount = suppressedItems.length;
  if (suppressedItems.length > 0) result.suppressedItems = suppressedItems;
  return { result, saved };
}
