import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { CAPTURE_CASES, runCase } from "@cairn-ink/conformance";

const leaseMs = 60_000;
const retryable = { code: "storage_error", retryable: true };
const terminal = { code: "invalid_input", retryable: false };

function factory(mutant = (opened) => opened) {
  return {
    name: "memory capture",
    async open({ capabilities }) {
      const adapter = createMemoryAdapter({ capabilities, now: () => 0 });
      return mutant({
        adapter, harness: adapter.harness, nativeErrorMap: adapter.nativeErrorMap,
        sessionRefs: "plain", busyNativeCodes: [], embeddingDimensions: null,
        async close() {},
      });
    },
  };
}

function withCapture(opened, changes) {
  return { ...opened, adapter: { ...opened.adapter, capture: { ...opened.adapter.capture, ...changes } } };
}

function identity({ scope, client, eventId }) {
  return JSON.stringify([scope.owner, scope.namespace ?? null, client, eventId]);
}

function mapReplay(opened, replace) {
  const { capture } = opened.adapter;
  return withCapture(opened, {
    async claim(...args) {
      const result = await capture.claim(...args);
      return result.status === "rawReplay" ? replace(result) : result;
    },
  });
}

function checksLeaseBeforeDigest(opened) {
  const { capture } = opened.adapter;
  const known = new Map();
  return withCapture(opened, {
    async claim(tx, key, messages, options) {
      const slot = identity(key);
      const previous = known.get(slot);
      if (previous && previous.payloadDigest !== key.payloadDigest) {
        const lease = await capture.claim(tx, previous, messages, options);
        if (lease.status === "processing") return lease;
      }
      const result = await capture.claim(tx, key, messages, options);
      if (result.status === "claimed") known.set(slot, key);
      return result;
    },
  });
}

function changesLeaseReplacement(opened, { keepProcessing, acceptOld, ignoreOldAbandon }) {
  const { capture } = opened.adapter;
  const byIdentity = new Map();
  const byToken = new Map();
  const replacements = new Map();
  const resolve = (token) => acceptOld ? replacements.get(token) ?? token : token;
  return withCapture(opened, {
    async claim(tx, key, messages, options) {
      const result = await capture.claim(tx, key, messages, options);
      if (result.status !== "claimed") return result;
      const slot = identity(key);
      const previous = byIdentity.get(slot);
      byIdentity.set(slot, result.token);
      byToken.set(result.token, slot);
      if (previous === undefined) return result;
      replacements.set(previous, result.token);
      return keepProcessing ? { status: "processing" } : result;
    },
    async abandon(tx, token, failure) {
      if (ignoreOldAbandon && replacements.has(token)) return;
      const current = resolve(token);
      await capture.abandon(tx, current, failure);
      const slot = byToken.get(current);
      if (byIdentity.get(slot) === current) byIdentity.delete(slot);
    },
    beginDispatch: (tx, token) => capture.beginDispatch(tx, resolve(token)),
    finish: (tx, token, items) => capture.finish(tx, resolve(token), items),
  });
}

function changesAbandon(opened, fromRetryable) {
  const { capture } = opened.adapter;
  return withCapture(opened, {
    abandon: (tx, token, failure) => capture.abandon(tx, token, {
      ...failure, retryable: failure.retryable === fromRetryable ? !fromRetryable : failure.retryable,
    }),
  });
}

function bumpIndex(memories, tx) {
  // Force an index write without leaving a visible row.
  return memories.erase(tx, { owner: tx.owner, namespace: null }, "absent");
}

function advancesWithoutMemories(opened, whenEmpty) {
  const { capture, memories } = opened.adapter;
  return withCapture(opened, {
    async finish(tx, token, items) {
      const result = await capture.finish(tx, token, items);
      if (!result.memories.length && (items.length === 0) === whenEmpty) await bumpIndex(memories, tx);
      return result;
    },
  });
}

function advancesPerItem(opened) {
  const { uow, capture, memories } = opened.adapter;
  const finishes = new WeakMap();
  const mutant = withCapture(opened, {
    async finish(tx, token, items) {
      const result = await capture.finish(tx, token, items);
      if (result.memories.length > 1) finishes.set(tx, result);
      return result;
    },
  });
  return { ...mutant, adapter: { ...mutant.adapter, uow: {
    async run(owner, options, fn) {
      let tx;
      const value = await uow.run(owner, options, (issued) => {
        tx = issued;
        return fn(tx);
      });
      const finish = finishes.get(tx);
      if (finish) {
        for (const _ of finish.memories.slice(1)) {
          await uow.run(owner, {}, (next) => bumpIndex(memories, next));
          finish.indexRevision++;
        }
      }
      return value;
    },
  } } };
}

function completesOnRollback(opened) {
  const { uow, capture } = opened.adapter;
  const finished = new WeakMap();
  const mutant = withCapture(opened, {
    async finish(tx, token, items) {
      const result = await capture.finish(tx, token, items);
      finished.set(tx, token);
      return result;
    },
  });
  return { ...mutant, adapter: { ...mutant.adapter, uow: {
    async run(owner, options, fn) {
      let tx;
      try {
        return await uow.run(owner, options, (issued) => {
          tx = issued;
          return fn(tx);
        });
      } catch (error) {
        const token = finished.get(tx);
        if (token) await uow.run(owner, options, (retryTx) => capture.finish(retryTx, token, []));
        throw error;
      }
    },
  } } };
}

function countsDuplicateAsInsert(opened) {
  const { capture } = opened.adapter;
  return withCapture(opened, {
    async finish(...args) {
      const result = await capture.finish(...args);
      return {
        ...result, duplicateCount: 0,
        memories: result.memories.map((entry) => ({ ...entry, outcome: "inserted" })),
      };
    },
  });
}

function keyFor(ctx, eventId) {
  return { scope: ctx.scope(null), client: "test-client", sessionId: "test-session", eventId,
    payloadDigest: "a".repeat(64) };
}

function write(ctx, fn) {
  return ctx.adapter.uow.run(ctx.owner, { pauseLock: true }, fn);
}

function claim(ctx, key, duration = leaseMs) {
  return write(ctx, (tx) => ctx.adapter.capture.claim(tx, key, [], { leaseMs: duration }));
}

async function tokenFor(ctx, key) {
  const admitted = await claim(ctx, key);
  assert.equal(admitted.status, "claimed");
  return admitted.token;
}

function finish(ctx, token, items) {
  return write(ctx, (tx) => ctx.adapter.capture.finish(tx, token, items));
}

async function itemFor(ctx, content) {
  return { content, kind: "fact", confidence: 0.4, textHash: await ctx.hash(content), embedding: null, receipts: [] };
}

async function checksLiveClaim(ctx) {
  const key = keyFor(ctx, "live");
  await tokenFor(ctx, key);
  assert.equal((await claim(ctx, key)).status, "processing");
}

async function checksFinishWithoutReplay(ctx) {
  const key = keyFor(ctx, "finish");
  const token = await tokenFor(ctx, key);
  const result = await finish(ctx, token, [await itemFor(ctx, "Memory")]);
  assert.equal(result.memories.length, 1);
  return key;
}

async function checksReplayStatus(ctx) {
  const key = await checksFinishWithoutReplay(ctx);
  assert.equal((await claim(ctx, key)).status, "rawReplay");
}

async function checksReplacementOnly(ctx) {
  const key = keyFor(ctx, "expire");
  const first = await tokenFor(ctx, key);
  await ctx.harness.advanceClock(leaseMs);
  assert.notEqual(await tokenFor(ctx, key), first);
}

async function checksAbandon(ctx, failure, status) {
  const key = keyFor(ctx, "abandon");
  const token = await tokenFor(ctx, key);
  await write(ctx, (tx) => ctx.adapter.capture.abandon(tx, token, failure));
  assert.equal((await claim(ctx, key)).status, status);
}

async function checksOrdinaryRevision(ctx) {
  const first = await tokenFor(ctx, keyFor(ctx, "first"));
  const second = await tokenFor(ctx, keyFor(ctx, "second"));
  const result = await finish(ctx, first, [await itemFor(ctx, "First memory")]);
  const later = await finish(ctx, second, [await itemFor(ctx, "Second memory")]);
  assert.equal(later.indexRevision, result.indexRevision + 1);
}

async function checksRollbackRowsOnly(ctx) {
  const token = await tokenFor(ctx, keyFor(ctx, "rollback"));
  const item = await itemFor(ctx, "Rolled back memory");
  const abort = new Error("abort");
  await assert.rejects(write(ctx, async (tx) => {
    await ctx.adapter.capture.finish(tx, token, [item]);
    throw abort;
  }), (error) => error === abort);
  const page = await ctx.adapter.uow.run(ctx.owner, { readOnly: true },
    (tx) => ctx.adapter.memories.exportPage(tx, ctx.scope(null), { cursor: null, limit: 10 }));
  assert.equal(page.items.length, 0);
}

const mutants = [
  ["a finished claim returns duplicate", "K-CLM-1", (opened) => mapReplay(opened, () => ({ status: "duplicate" })),
    checksFinishWithoutReplay, /A finished claim must return rawReplay/],
  ["a live lease masks a digest conflict", "K-CLM-1", checksLeaseBeforeDigest,
    checksLiveClaim, /Expected operation to reject/],
  ["an expired lease reports processing", "K-CLM-2", (opened) => changesLeaseReplacement(opened, { keepProcessing: true }),
    checksLiveClaim, /An expired lease must allow another claim/],
  ["the old token remains live after reclaim", "K-CLM-2", (opened) => changesLeaseReplacement(opened, { acceptOld: true }),
    checksReplacementOnly, /Expected operation to reject/],
  ["retryable abandon returns duplicate", "K-CLM-2", (opened) => changesAbandon(opened, true),
    (ctx) => checksAbandon(ctx, terminal, "duplicate"), /Expected a fresh claim/],
  ["terminal abandon allows a claim", "K-CLM-2", (opened) => changesAbandon(opened, false),
    (ctx) => checksAbandon(ctx, retryable, "claimed"), /Terminal abandon must return duplicate/],
  ["a suppressed-only finish advances the index", "K-CLM-3", (opened) => advancesWithoutMemories(opened, false),
    checksOrdinaryRevision, /A suppressed-only finish must preserve the index revision/],
  ["an empty finish advances the index", "K-CLM-3", (opened) => advancesWithoutMemories(opened, true),
    checksOrdinaryRevision, /An empty finish must preserve the index revision/],
  ["the index advances per item", "K-CLM-3", advancesPerItem,
    checksOrdinaryRevision, /A finish with multiple writes must advance the index once/],
  ["claim completion survives rollback", "K-CLM-3", completesOnRollback,
    checksRollbackRowsOnly, /Rollback must restore the live claim/],
  ["a duplicate counts as inserted", "K-CLM-3", countsDuplicateAsInsert,
    checksFinishWithoutReplay, /The stored duplicate must count as a duplicate/],
  ["replay alters the finish result", "K-CLM-1", (opened) =>
    mapReplay(opened, ({ result }) => ({ status: "rawReplay", result: { ...result, suppressedCount: result.suppressedCount + 1 } })),
    checksReplayStatus, /Replay must preserve the finish result/],
  ["abandoning a dead token succeeds", "K-CLM-2", (opened) => changesLeaseReplacement(opened, { ignoreOldAbandon: true }),
    checksReplacementOnly, /Expected operation to reject/],
];

for (const [label, id, mutant, naive, failure] of mutants) {
  test(`${id} detects when ${label} after the naive case passes`, async () => {
    const candidate = factory(mutant);
    const real = CAPTURE_CASES.find((entry) => entry.id === id);
    assert.ok(real);
    assert.equal(await runCase(candidate, { id, title: "naive", needs: [], async run(ctx) { await naive(ctx); } }), null);
    await assert.rejects(runCase(candidate, real), failure);
  });
}

test("capture cases accept SHA-256 claim identities", async () => {
  const control = factory((opened) => {
    const { capture } = opened.adapter;
    return withCapture(opened, {
      claim(tx, key, messages, options) {
        // Back the alternate identity with an opaque key in the transaction store.
        const eventId = createHash("sha256").update(identity(key)).digest("hex");
        return capture.claim(tx, { ...key, eventId }, messages, options);
      },
    });
  });
  for (const testCase of CAPTURE_CASES) assert.equal(await runCase(control, testCase), null, testCase.id);
});

test("lease expiry reports a skip after the abandon checks run when clock control is absent", async () => {
  let abandons = 0;
  const control = factory((opened) => {
    const { advanceClock, ...harness } = opened.harness;
    const { capture } = opened.adapter;
    return { ...withCapture(opened, {
      abandon(...args) {
        abandons++;
        return capture.abandon(...args);
      },
    }), harness };
  });
  const testCase = CAPTURE_CASES.find(({ id }) => id === "K-CLM-2");
  assert.equal(await runCase(control, testCase), "lease expiry requires harness.advanceClock");
  assert.equal(abandons, 4);
});
