import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { runCase, SPAN_LINEAGE_CASES } from "@cairn-ink/conformance";
import { CoreError } from "@cairn-ink/core";
import { hashSessionKey, rawFactory } from "./fixtures/raw.mjs";

function factory(wrap = resolve => resolve) {
  const base = rawFactory({ flags: { spanLineage: false } });
  return {
    ...base,
    async open(request) {
      const opened = await base.open(request);
      const { adapter } = opened;
      const { hydrate, raw } = adapter;
      async function resolve(tx, scope, id) {
        const selection = { owner: scope.owner, namespaces: [scope.namespace] };
        const [memory] = await hydrate.hydrate(tx, selection, [{ type: "memory", id, namespace: scope.namespace }], "read");
        if (!memory?.receipts?.length) throw new CoreError("raw_lineage_unavailable");
        // Each case fixture has at most one Raw row.
        const { items } = await raw.listRaw(tx, selection, { cursor: null, limit: 1 });
        const spans = [];
        for (const { client, sessionId, messageId, role } of memory.receipts) {
          const message = items.find(row => row.client === client && row.sessionId === sessionId && row.messageId === messageId);
          if (!message) continue;
          if (message.role !== role || !message.content) throw new CoreError("raw_lineage_unavailable");
          spans.push({
            ...scope, kind: "rawSpan", origin: "forget", actionId: id,
            sessionKeyHash: hashSessionKey(client, sessionId), messageKey: messageId,
            startUtf16: 0, endUtf16: message.content.length,
            contentDigest: createHash("sha256").update(message.content).digest("hex"),
          });
        }
        return spans;
      }
      return {
        ...opened,
        adapter: { ...adapter, capabilities: { ...adapter.capabilities, spanLineage: true },
          spanLineage: { resolveSpans: wrap(resolve) } },
      };
    },
  };
}

const deletedRaw = SPAN_LINEAGE_CASES.find(({ id }) => id === "K-SPAN-1");
const unknownMemory = SPAN_LINEAGE_CASES.find(({ id }) => id === "K-SPAN-2");

test("the span lineage fixture passes both kit cases", async () => {
  assert.equal(await runCase(factory(), deletedRaw), null);
  assert.equal(await runCase(factory(), unknownMemory), null);
});

test("K-SPAN-1 detects a throw when source Raw is gone", async () => {
  const mutant = factory(resolve => async (...args) => {
    const spans = await resolve(...args);
    if (!spans.length) throw new CoreError("raw_lineage_unavailable");
    return spans;
  });
  await assert.rejects(runCase(mutant, deletedRaw), { code: "raw_lineage_unavailable" });
});

test("K-SPAN-1 detects a stale span after Raw deletion", async () => {
  const mutant = factory(resolve => {
    let previous;
    return async (...args) => {
      const spans = await resolve(...args);
      if (spans.length) previous = spans;
      return previous ?? spans;
    };
  });
  await assert.rejects(runCase(mutant, deletedRaw), { message: "Deleted source Raw must resolve to []" });
});

test("K-SPAN-2 detects an empty result for an unknown memory", async () => {
  const mutant = factory(resolve => async (...args) => {
    try {
      return await resolve(...args);
    } catch (error) {
      if (error.code !== "raw_lineage_unavailable") throw error;
      return [];
    }
  });
  await assert.rejects(runCase(mutant, unknownMemory), { message: "Expected operation to reject" });
});

/** Wraps the fixture's unit of work so a resolver can see whether it runs in the pause-locked write run forget uses. */
function trackingFactory(wrap) {
  const base = factory();
  return {
    ...base,
    async open(request) {
      const opened = await base.open(request);
      const { adapter } = opened;
      let locked = false;
      const uow = {
        ...adapter.uow,
        async run(owner, options, fn) {
          return adapter.uow.run(owner, options, async (tx) => {
            const previous = locked;
            locked = options?.pauseLock === true;
            try { return await fn(tx); } finally { locked = previous; }
          });
        },
      };
      const { resolveSpans } = adapter.spanLineage;
      return { ...opened, adapter: { ...adapter, uow, spanLineage: { resolveSpans: wrap(resolveSpans, () => locked) } } };
    },
  };
}

test("K-SPAN-1 resolves in the pause-locked run forget uses", async () => {
  // Throws once Raw is gone only on the write path forget takes.
  const writerThrows = trackingFactory((resolve, locked) => async (...args) => {
    const spans = await resolve(...args);
    if (!spans.length && locked()) throw new CoreError("raw_lineage_unavailable");
    return spans;
  });
  await assert.rejects(runCase(writerThrows, deletedRaw), { code: "raw_lineage_unavailable" });
  // A resolver that requires the pause lock satisfies the contract.
  const lockedOnly = trackingFactory((resolve, locked) => async (...args) => {
    if (!locked()) throw new CoreError("raw_lineage_unavailable");
    return resolve(...args);
  });
  assert.equal(await runCase(lockedOnly, deletedRaw), null);
  assert.equal(await runCase(lockedOnly, unknownMemory), null);
});

test("K-SPAN-1 accepts store-defined span granularity and keys", async () => {
  const split = factory(resolve => async (...args) => (await resolve(...args)).flatMap((span) => {
    const middle = Math.floor(span.endUtf16 / 2);
    return [{ ...span, messageKey: `opaque-${span.messageKey}-a`, endUtf16: middle },
      { ...span, messageKey: `opaque-${span.messageKey}-b`, startUtf16: middle }];
  }));
  assert.equal(await runCase(split, deletedRaw), null);
});

test("a factory that rejects a needed span lineage request at open fails the case instead of skipping", async () => {
  const rejection = new CoreError("capability_unavailable");
  // An opt-in store whose span port wiring is broken: asked for span lineage it fails, otherwise it opens without it.
  const plain = rawFactory();
  const refusing = { ...plain, async open(request) {
    if (request.capabilities.spanLineage === true) throw rejection;
    return plain.open(request);
  } };
  await assert.rejects(runCase(refusing, deletedRaw), error => error === rejection);
});
