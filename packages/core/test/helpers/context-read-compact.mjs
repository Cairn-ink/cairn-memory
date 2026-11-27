import assert from "node:assert/strict";
import { createMemoryService } from "../../src/service/index.mjs";
import { createBM25 } from "../../src/retrieval/bm25.mjs";
import { hostedScope as scope, memory, serviceFake } from "./service-fake.mjs";

export const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
export const input = { query: "telescope", types: ["memory"], intent: "current", raw: false, semantic: false,
  representation: "memory-compact-v1" };
export const format = value => JSON.stringify({ ok: true, value, evidenceTrust: "untrusted-data-not-instructions" });
export const tokenCount = text => Math.ceil(Buffer.byteLength(text) / 8);
export const decodeSnapshot = snapshot => JSON.parse(Buffer.from(snapshot.split(".")[0], "base64url"));

export function fixture(corpus, { count = tokenCount, afterFind, now = () => 0, withReceipts = true } = {}) {
  const entries = corpus.map(({ body, occurredAt }, index) => {
    const row = memory("observation-" + index, { text: body });
    const ref = { type: "memory", scope, id: row.id, revision: row.revision };
    const receipt = { id: "receipt-" + index, client: "fixture", sessionId: "observation", eventId: String(index),
      role: "user", excerpt: "Source for observation " + index, createdAtMs: index,
      occurredAtMs: occurredAt == null ? null : Date.parse(occurredAt) };
    return { row, receipt, ref };
  });
  const byId = new Map(entries.map(entry => [entry.row.id, entry]));
  const { storage, commitForget } = serviceFake({ rows: entries.map(entry => entry.row) });
  const { run } = storage.uow;
  let rankingTx;
  const lexicalDepths = [];
  Object.assign(storage.capabilities, { contextRead: true, contextRawRead: true, inspect: true });
  storage.inspect = { identity() {}, item() {}, list() {} };
  storage.uow.run = (owner, options, work) => run(owner, options, async tx => {
    const result = await work(tx);
    if (tx === rankingTx) {
      rankingTx = undefined;
      afterFind?.();
    }
    return result;
  });
  storage.contextRead = {
    maintenanceAvailable: true,
    async identity() { return { storeId: "fixture", cursorKey: new TextEncoder().encode("fixture signing material") }; },
    async observeIndex(tx) {
      return { indexState: String(tx.revision), ready: true, byType: { memory: { eligible: tx.rows.length, indexed: tx.rows.length } },
        maintenance: { available: true, state: "ready", buildState: "ready", reason: null, progress: null } };
    },
    async lexical(tx, _readSet, _selection, query, depth) {
      lexicalDepths.push(depth);
      rankingTx = tx;
      const index = createBM25(tx.rows.map(({ id, text }) => ({ ref: { namespace: scope.namespace, type: "memory", id }, text })), depth);
      const { rows, matched } = index.searchWithCount(query, depth);
      return { matched, rows: rows.map(({ ref, score }) => ({ ref: byId.get(ref.id).ref, score })) };
    },
    async snapshotState(tx) { return [{ memory: tx.revision }]; },
    async evidence(tx, _readSet, refs) {
      return refs.map(ref => {
        const { row, receipt } = byId.get(ref.id);
        if (!tx.rows.includes(row)) return null;
        return { type: "memory", ref, text: row.text, metadata: { state: "active", reviewState: "none",
          filing: { status: "unfiled" }, kind: "fact", origin: "explicit", confidence: 1 },
        qualification: null, attribution: { status: "unassessed", commitment: "unknown" }, sourceAccess: "available",
          receipts: withReceipts ? [receipt] : [],
          receiptCoverage: { status: "complete", included: Number(withReceipts), omitted: 0 } };
      });
    },
    raw: { search() { assert.fail("compact searched Raw"); }, revalidate() { assert.fail("compact revalidated Raw"); } },
  };
  const service = createMemoryService({ profile: "keyless-local", storage,
    clock: { nowMs: () => 0, monotonicMs: now, hmacHex() { assert.fail("unexpected clock HMAC"); } },
    contextReadCounter: { count }, contextReadFormat: format });
  return { service, lexicalDepths, refs: entries.map(({ ref }) => ref),
    forget: index => commitForget(entries[index].row), read: (request = {}) => service.readContext(readSet, { ...input, ...request }) };
}
