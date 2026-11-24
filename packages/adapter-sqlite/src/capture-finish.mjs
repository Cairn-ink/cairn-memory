import { CoreError, decideWrite, planDuplicateMerge } from "@cairn-ink/core";
import { insertMemory, readEntry } from "./memory-rows.mjs";
import { readWritePolicy, touchDuplicate } from "./memories.mjs";
import { copyReceipts, encodeContent, invalidInput } from "./storage-values.mjs";

/** @import { CaptureKey, FinishItem, FinishResult, SourceRef } from "@cairn-ink/core/ports" */
/** @import { Connection } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */

/** @param {readonly FinishItem[]} items */
export function validateFinishItems(items) {
  /** @type {SourceRef} */
  const source = { kind: "capture", client: null, sessionId: null };
  return items.map(item => {
    if (!item) invalidInput();
    const { content, kind, confidence, textHash, digests, embedding, receipts } = item;
    if (embedding !== null && !(embedding?.vector instanceof Float32Array)) invalidInput();
    return {
      content: encodeContent({ text: content, kind, confidence, textHash, digests, embedding, origin: "inferred", source }),
      receipts: copyReceipts(receipts),
    };
  });
}

/** @param {Connection} db @param {CaptureKey} key @param {ReturnType<typeof validateFinishItems>} batch
 * @param {number} nowMs @param {SessionHasher} hashSession @returns {Omit<FinishResult, "indexRevision">}
 */
export function finishCapture(db, { scope, client, sessionId }, batch, nowMs, hashSession) {
  /** @type {SourceRef} */
  const source = { kind: "capture", client, sessionId };
  // Match the incoming text using the same digest aliases that an inserted
  // row would carry, including legacy exact denials.
  const queries = batch.map(({ content: { textHash, body } }) => ({
    textHash, digests: body.digests, embedding: body.embedding?.vector,
  }));
  const policy = readWritePolicy(db, scope, queries, source, "full", hashSession, undefined,
    batch.map(({ receipts }) => receipts));
  const progress = { inserted: new Map(), writeTimes: new Map() };
  /** @type {FinishResult["memories"]} */
  const memories = [];
  const updatedAtUs = BigInt(nowMs) * 1000n;
  let suppressedCount = 0;
  let duplicateCount = 0;

  for (const [position, { content, receipts }] of batch.entries()) {
    const decision = decideWrite(policy, position, progress);
    switch (decision.status) {
      case "suppressed":
        suppressedCount++;
        break;
      case "saved": {
        const inserted = insertMemory(db, scope, { ...content, body: { ...content.body, source } }, receipts, nowMs);
        progress.inserted.set(position, inserted.id);
        progress.writeTimes.set(inserted.id, inserted.updatedAtUs);
        memories.push({ id: inserted.id, revision: inserted.revision, outcome: "inserted" });
        break;
      }
      case "duplicate": {
        const { id } = decision;
        const existing = readEntry(db, scope, id);
        if (!existing) throw new CoreError("internal_error");
        const { merge } = planDuplicateMerge(existing.row, content.body);
        const { outcome, revision } = touchDuplicate(db, scope, id, receipts, merge, nowMs);
        progress.writeTimes.set(id, updatedAtUs);
        memories.push({ id, outcome, revision });
        duplicateCount++;
        break;
      }
    }
  }

  return {
    memories, suppressedCount, duplicateCount, counters: { nearSkippedUnembedded: 0 },
  };
}
