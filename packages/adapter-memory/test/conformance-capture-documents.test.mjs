import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import {
  CAPTURE_DOCUMENT_AMENDMENT_CASES, CAPTURE_DOCUMENT_CARD_CASES, CAPTURE_DOCUMENT_FORGET_CASES,
  CAPTURE_QUANTITY_LEDGER_CASES, runCase,
} from "@cairn-ink/conformance";
import { ledgerDropSelector, ledgerRowKey } from "@cairn-ink/core/ledger";

// Supply the optional ledger port in the fixture. Memory, receipts, Raw and cards
// still use the adapter's normal capture, forget and visibility implementations.
function withLedger(adapter) {
  const committed = new Map();
  const transactions = new WeakMap();
  function scoped(tx, scope, write = false) {
    const rows = transactions.get(tx);
    assert.ok(rows && tx.owner === scope.owner);
    if (write) assert.equal(tx.readOnly, false);
    return rows;
  }
  function rowsIn(tx, scope) {
    return [...scoped(tx, scope).values()].filter(entry => entry.namespace === scope.namespace);
  }
  return {
    ...adapter,
    capabilities: { ...adapter.capabilities, quantityLedger: true },
    uow: {
      async run(owner, options, work) {
        let pending;
        const result = await adapter.uow.run(owner, options, async tx => {
          const rows = new Map(committed.get(owner));
          transactions.set(tx, rows);
          try {
            const value = await work(tx);
            if (!tx.readOnly) pending = rows;
            return value;
          } finally {
            transactions.delete(tx);
          }
        });
        if (pending) committed.set(owner, pending);
        return result;
      },
    },
    quantityLedger: {
      async put(tx, scope, incoming) {
        const rows = scoped(tx, scope, true);
        const initial = rows.size;
        for (const row of incoming) {
          const key = JSON.stringify([scope.namespace, ledgerRowKey(row)]);
          if (!rows.has(key)) rows.set(key, { namespace: scope.namespace, row: structuredClone(row) });
        }
        return { inserted: rows.size - initial };
      },
      async listForMemory(tx, scope, id) {
        return rowsIn(tx, scope).map(({ row }) => row).filter(row => row.memoryId === id);
      },
      async list(tx, scope, { fromMs, toMs }) {
        return rowsIn(tx, scope).map(({ row }) => row).filter(({ date }) => fromMs <= date && date < toMs);
      },
      async terms(tx, scope) {
        return [...new Set(rowsIn(tx, scope).flatMap(({ row }) => [row.measure, row.category, row.group]))];
      },
      async dropWhere(tx, scope, selector) {
        const key = ledgerDropSelector(selector);
        const rows = scoped(tx, scope, true);
        const initial = rows.size;
        for (const [id, { namespace, row }] of rows) {
          if (namespace === scope.namespace && row[key] === selector.id) rows.delete(id);
        }
        return { dropped: initial - rows.size };
      },
    },
  };
}

const factory = {
  name: "capture document fixtures",
  async open({ capabilities: { quantityLedger, ...capabilities } }) {
    const base = createMemoryAdapter({ capabilities: {
      ...capabilities, ...(quantityLedger && { contextRead: true, inspect: true }),
    } });
    const adapter = quantityLedger ? withLedger(base) : base;
    return { adapter, sessionRefs: "plain", harness: base.harness, nativeErrorMap: base.nativeErrorMap,
      busyNativeCodes: [], embeddingDimensions: null, async close() {} };
  },
};

test("CAPTURE-CARD-1 also uses an adapter's hashed session identity", async () => {
  const hashSessionKey = (client, sessionId) => createHash("sha256").update(JSON.stringify([client, sessionId])).digest("hex");
  const hashed = {
    ...factory,
    async open({ capabilities }) {
      const adapter = createMemoryAdapter({ capabilities, sessionRefs: "hashed", hashSessionKey });
      return { adapter, sessionRefs: "hashed", harness: { ...adapter.harness, hashSessionKey },
        nativeErrorMap: adapter.nativeErrorMap, busyNativeCodes: [], embeddingDimensions: null, async close() {} };
    },
  };
  assert.equal(await runCase(hashed, CAPTURE_DOCUMENT_CARD_CASES[0]), null);
});

for (const testCase of [
  ...CAPTURE_DOCUMENT_CARD_CASES, ...CAPTURE_DOCUMENT_AMENDMENT_CASES,
  ...CAPTURE_QUANTITY_LEDGER_CASES, ...CAPTURE_DOCUMENT_FORGET_CASES,
]) {
  test(testCase.id + " " + testCase.title, async () => {
    assert.equal(await runCase(factory, testCase), null);
  });
}
