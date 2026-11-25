import assert from "node:assert/strict";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { ledgerDropSelector, ledgerRowKey } from "@cairn-ink/core/ledger";
import { createMemoryService } from "@cairn-ink/core/service";
import { createMemoryAdapter } from "../../src/index.mjs";

const scope = { owner: "reader", namespace: "personal\0" };
const project = { ...scope, namespace: "project\0shared" };
const foreign = { ...scope, owner: "other" };
const day = Date.UTC(2025, 0, 15);
const dayMs = 86_400_000;
const input = { query: "How much did I spend on food today?", types: ["memory"], intent: "current", raw: false };
const source = { kind: "web", client: null, sessionId: null };
const extract = content => ({ content, kind: "fact", confidence: 0.9, sourceIndices: [0] });
const amount = (category, value, group = "food") =>
  ({ item: 0, measure: "spend", group, category, value, unit: "USD", kind: "record", period: "none", comparator: "none" });

function fixture({ freezeGenerations = false, monotonicMs = () => 0, beforeTerms } = {}) {
  const base = createMemoryAdapter({ capabilities: { contextRead: true, inspect: true, documentCards: true,
    supersession: true, rawArchive: true, contextRawRead: true } });
  const committed = new Map();
  const transactions = new WeakMap();
  const scans = [];
  const readFailures = { list: false, fence: false };
  function rows(tx, target, write = false) {
    assert.equal(tx.owner, target.owner);
    if (write) assert.equal(tx.readOnly, false);
    const active = transactions.get(tx);
    assert.ok(active);
    return active;
  }
  function scoped(tx, target) {
    return [...rows(tx, target).values()].flatMap(entry => entry.namespace === target.namespace ? [entry.row] : []);
  }
  const storage = {
    ...base,
    capabilities: { ...base.capabilities, quantityLedger: true },
    uow: {
      async run(owner, options, work) {
        let writes;
        const value = await base.uow.run(owner, options, async tx => {
          const active = new Map(committed.get(owner));
          transactions.set(tx, active);
          try {
            const value = await work(tx);
            if (!tx.readOnly) writes = active;
            return value;
          } finally {
            transactions.delete(tx);
          }
        });
        if (writes) committed.set(owner, writes);
        return value;
      },
    },
    quantityLedger: {
      async put(tx, target, incoming) {
        const active = rows(tx, target, true), before = active.size;
        for (const row of incoming) {
          const key = JSON.stringify([target.namespace, ledgerRowKey(row)]);
          if (!active.has(key)) active.set(key, { namespace: target.namespace, row: structuredClone(row) });
        }
        return { inserted: active.size - before };
      },
      async dropWhere(tx, target, selector) {
        const field = ledgerDropSelector(selector);
        const active = rows(tx, target, true), before = active.size;
        for (const [key, { namespace, row }] of active) {
          if (namespace === target.namespace && row[field] === selector.id) active.delete(key);
        }
        return { dropped: before - active.size };
      },
      async listForMemory(tx, target, id) {
        return scoped(tx, target).filter(row => row.memoryId === id);
      },
      async list(tx, target, { fromMs, toMs }) {
        assert.equal(tx.readOnly, true);
        scans.push({ tx, target, fromMs, toMs });
        if (readFailures.list) throw new Error("Ledger list unavailable");
        return scoped(tx, target).filter(row => fromMs <= row.date && row.date < toMs);
      },
      async terms(tx, target) {
        assert.equal(tx.readOnly, true);
        await beforeTerms?.();
        const current = [];
        for (const row of scoped(tx, target)) {
          const memory = await base.memories.get(tx, target, row.memoryId);
          if (memory && !memory.historical) current.push(row.measure, row.group, row.category);
        }
        return [...new Set(current)];
      },
    },
  };
  const clock = { ...assemblyClock(monotonicMs), nowMs: () => day + 5000 };
  let modelOutput;
  const writer = createMemoryService({ storage, clock, config: { quantityLedger: { enabled: true } },
    model: { model: "fixture", contextWindow: 32768, countTokens: () => 1, async call(stage) {
      assert.equal(stage, "extract");
      return modelOutput;
    } },
    embedder: { model: "fixture", dimensions: 1, async embed(texts) { return texts.map(() => Float32Array.of(1)); } },
    gate: { async assertOpen() {} }, tokens: { countTokens: () => 1 },
  });
  let beforeRead;
  const readerStorage = {
    ...storage,
    uow: {
      async run(owner, options, work) {
        if (options.readOnly && beforeRead) {
          const commit = beforeRead;
          beforeRead = undefined;
          await commit();
        }
        return storage.uow.run(owner, options, work);
      },
    },
    contextRead: {
      ...base.contextRead,
      // Isolate the digest's witness from the general generation check.
      ...(freezeGenerations && { async snapshotState(_tx, { namespaces }) {
        return namespaces.map(() => ({ memory: 1, card: 1 }));
      } }),
    },
    fence: {
      async assertVisible(...args) {
        if (readFailures.fence && args[2].some(({ id }) => id === readFailures.fence)) {
          throw new Error("Ledger source visibility unavailable");
        }
        return base.fence.assertVisible(...args);
      },
    },
  };
  const reader = ({ enabled = true, port = true, afterFormatting } = {}) => {
    const { quantityLedger, ...rest } = readerStorage;
    return createMemoryService({ profile: "keyless-local", clock,
      storage: { ...rest, capabilities: { ...rest.capabilities, quantityLedger: enabled }, ...(port && { quantityLedger }) },
      contextReadCounter: { count: fixtureCount },
      contextReadFormat(value) {
        if (afterFormatting && value.ledgerDigest) beforeRead = afterFormatting;
        return formatAssembly(value);
      },
    });
  };
  const read = (api, overrides = {}, namespaces) => api.readContext(readSet(namespaces), { ...input, ...overrides });
  const ledgerRows = (id, target = scope) => storage.uow.run(target.owner, { readOnly: true },
    tx => storage.quantityLedger.listForMemory(tx, target, id));
  const write = (work, target = scope) => storage.uow.run(target.owner, { pauseLock: true }, work);
  const inject = (row, target = scope) => write(tx => storage.quantityLedger.put(tx, target, [row]), target);
  let sequence = 0;
  async function capture(content, quantities, { target = scope, date = day } = {}) {
    const id = "event-" + ++sequence;
    const address = { client: "fixture", sessionId: id, eventId: id };
    modelOutput = { items: [extract(content)], quantities };
    const messages = [{ id, role: "user", content, occurredAtMs: date }];
    assert.deepEqual(await writer.enqueueCapture(target, { ...address, messages }), { status: "accepted" });
    const finished = await writer.runCapture(target, address);
    assert.equal(finished.status, "done", JSON.stringify(finished));
    assert.equal(finished.result.memories.length, 1);
    const memory = finished.result.memories[0];
    assert.equal((await ledgerRows(memory.id, target)).length, quantities.length);
    return { ...memory, messages, address };
  }
  async function card() {
    await write(tx => base.documentCards.put(tx, scope, {
      id: "meal-card", scope, title: "Food", body: "A meal plan.", origin: "manual", contentHash: "meal-card",
      date: null, sourceMessage: null, sourceMemories: [], sentences: [], stale: [],
    }));
  }
  return { base, capture, card, inject, ledgerRows, reader, read, scans, readFailures, write, writer };
}

const readSet = (namespaces = [scope.namespace]) => ({
  owner: scope.owner, namespaces, accessGenerations: namespaces.map(() => 1),
});

export { amount, day, dayMs, fixture, foreign, project, readSet, scope, source };
