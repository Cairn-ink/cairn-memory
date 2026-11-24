import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { RECEIPT_WITHHELD_CASES, runCase } from "@cairn-ink/conformance";
import { CoreError } from "@cairn-ink/core";
import { rawFactory } from "./fixtures/raw.mjs";

const testCase = RECEIPT_WITHHELD_CASES.find(({ id }) => id === "K-RCPT-W1");
assert.ok(testCase);

for (const sessionRefs of ["plain", "hashed"]) {
  for (const required of [false, true]) {
    const factory = rawFactory({ sessionRefs, required });
    test(`${factory.name} ${testCase.id} ${testCase.title}`, async () => {
      assert.equal(await runCase(factory, testCase), null);
    });
  }
}

/** @param {(adapter: ReturnType<typeof createMemoryAdapter>) => void} mutate */
function mutant(mutate) {
  return rawFactory({
    create(options) {
      const reference = createMemoryAdapter(options);
      const adapter = { ...reference, suppressions: { ...reference.suppressions } };
      mutate(adapter);
      return adapter;
    },
  });
}


/** Records each archived message's content by ID, so a mutant can tell archived from unarchived receipts.
 * @param {ReturnType<typeof createMemoryAdapter>} adapter
 */
function trackArchived(adapter) {
  const { raw } = adapter;
  assert.ok(raw);
  /** @type {Map<string, string>} */
  const archived = new Map();
  adapter.raw = {
    ...raw,
    async archive(tx, key, messages) {
      const result = await raw.archive(tx, key, messages);
      for (const { id, content } of messages) archived.set(id, content);
      return result;
    },
  };
  return archived;
}

test("K-RCPT-W1 rejects a missing receiptWithheld port", async () => {
  const factory = mutant(({ suppressions }) => { delete suppressions.receiptWithheld; });
  await assert.rejects(runCase(factory, testCase),
    /^Error: An adapter with rawArchive must implement suppressions\.receiptWithheld$/);
});

test("K-RCPT-W1 rejects a port that always allows receipts", async () => {
  const factory = mutant(({ suppressions }) => { suppressions.receiptWithheld = async () => false; });
  await assert.rejects(runCase(factory, testCase),
    /^Error: A receipt from a deleted conversation must be withheld$/);
});

test("K-RCPT-W1 rejects a port that always withholds receipts", async () => {
  const factory = mutant(({ suppressions }) => { suppressions.receiptWithheld = async () => true; });
  await assert.rejects(runCase(factory, testCase),
    /^Error: A receipt from a visible archived message must not be withheld$/);
});

test("K-RCPT-W1 rejects a port that only withholds the deleted message's exact text", async () => {
  const factory = mutant(adapter => {
    const archived = trackArchived(adapter);
    const { suppressions } = adapter;
    const { receiptWithheld } = suppressions;
    assert.ok(receiptWithheld);
    suppressions.receiptWithheld = async (tx, scope, receipt) => archived.get(receipt.messageId) === receipt.excerpt
      ? receiptWithheld.call(suppressions, tx, scope, receipt) : false;
  });
  await assert.rejects(runCase(factory, testCase),
    /^Error: A reworded receipt from a deleted conversation must be withheld$/);
});

test("K-RCPT-W1 rejects a port that allows receipts from fenced conversations", async () => {
  const factory = mutant(adapter => {
    const { raw, suppressions } = adapter;
    const { receiptWithheld } = suppressions;
    assert.ok(raw && receiptWithheld);
    const fencedSessions = new Set();
    adapter.raw = {
      ...raw,
      async fenceSession(tx, scope, session) {
        await raw.fenceSession(tx, scope, session);
        fencedSessions.add(session.sessionId);
      },
    };
    suppressions.receiptWithheld = async (tx, scope, receipt) => fencedSessions.has(receipt.sessionId)
      ? false : receiptWithheld.call(suppressions, tx, scope, receipt);
  });
  await assert.rejects(runCase(factory, testCase),
    /^Error: A receipt from a fenced conversation must be withheld$/);
});

test("K-RCPT-W1 rejects a port that checks fences only for archived messages", async () => {
  const factory = mutant(adapter => {
    const archived = trackArchived(adapter);
    const { suppressions } = adapter;
    const { receiptWithheld } = suppressions;
    assert.ok(receiptWithheld);
    suppressions.receiptWithheld = async (tx, scope, receipt) => archived.has(receipt.messageId)
      ? receiptWithheld.call(suppressions, tx, scope, receipt) : false;
  });
  await assert.rejects(runCase(factory, testCase),
    /^Error: A receipt for an unarchived message in a fenced conversation must be withheld$/);
});

test("K-RCPT-W1 rejects a port that only fails when core calls it during save", async () => {
  const factory = mutant(({ suppressions }) => {
    const { receiptWithheld } = suppressions;
    assert.ok(receiptWithheld);
    suppressions.receiptWithheld = async (tx, scope, receipt) => {
      // Core's save calls the port from its write service; the case's own probes do not.
      if (new Error().stack?.includes("service/writes.mjs")) throw new CoreError("storage_transaction_active");
      return receiptWithheld.call(suppressions, tx, scope, receipt);
    };
  });
  await assert.rejects(runCase(factory, testCase), error => {
    assert.equal(error.message, "Core save must suppress a deleted receipt (save rejected)");
    assert.equal(error.cause?.message, "storage_transaction_active");
    return true;
  });
});

test("K-RCPT-W1 rejects a port that writes while it checks a receipt", async () => {
  const factory = mutant(adapter => {
    const { raw, suppressions } = adapter;
    const { receiptWithheld } = suppressions;
    assert.ok(raw && receiptWithheld);
    let writes = 0;
    suppressions.receiptWithheld = async (tx, scope, receipt) => {
      await raw.fenceSession(tx, scope, { client: "side-effect", sessionId: `side-effect-${++writes}` });
      return receiptWithheld.call(suppressions, tx, scope, receipt);
    };
  });
  await assert.rejects(runCase(factory, testCase),
    /^Error: A suppressed deleted receipt save must leave the dump unchanged$/);
});

test("K-RCPT-W1 accepts an adapter that exposes its ports through prototype getters", async () => {
  // Like class getters over private state, each getter only works on the adapter instance itself.
  const references = new WeakMap();
  const factory = rawFactory({
    create(options) {
      const reference = createMemoryAdapter(options);
      /** @type {PropertyDescriptorMap} */
      const getters = {};
      for (const key of Object.keys(reference)) {
        getters[key] = {
          get() {
            const own = references.get(this);
            if (!own) throw new TypeError("Port read through a foreign receiver");
            return own[key];
          },
        };
      }
      const adapter = Object.create(Object.create(Object.prototype, getters));
      references.set(adapter, reference);
      return adapter;
    },
  });
  assert.equal(await runCase(factory, testCase), null);
});

for (const named of [true, false]) {
  test(`K-RCPT-W1 accepts a frozen adapter ${named ? "with" : "without"} its own name`, async () => {
    const factory = rawFactory({
      create(options) {
        const { name, ...ports } = createMemoryAdapter(options);
        assert.equal(typeof name, "string");
        return Object.freeze(named ? { name, ...ports } : ports);
      },
    });
    assert.equal(await runCase(factory, testCase), null);
  });
}

test("K-RCPT-W1 never reads adapter properties outside the storage contract", async () => {
  const factory = rawFactory({
    create(options) {
      const adapter = { ...createMemoryAdapter(options) };
      Object.defineProperty(adapter, "debugConnection", {
        enumerable: false, get() { throw new Error("Diagnostics are disabled"); },
      });
      return adapter;
    },
  });
  assert.equal(await runCase(factory, testCase), null);
});

test("K-RCPT-W1 accepts a harness whose equivalent dumps differ in key order", async () => {
  /** @param {unknown} value @param {boolean} reverse @returns {unknown} */
  function reorder(value, reverse) {
    if (Array.isArray(value)) return value.map(item => reorder(item, reverse));
    if (!value || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
    const keys = Object.keys(value);
    if (reverse) keys.reverse();
    return Object.fromEntries(keys.map(key => [key, reorder(value[key], reverse)]));
  }
  const base = rawFactory();
  let dumps = 0;
  const factory = {
    ...base,
    async open(request) {
      const opened = await base.open(request);
      const { dump } = opened.harness;
      return { ...opened, harness: { ...opened.harness, async dump() { return reorder(await dump(), ++dumps % 2 === 0); } } };
    },
  };
  assert.equal(await runCase(factory, testCase), null);
});
