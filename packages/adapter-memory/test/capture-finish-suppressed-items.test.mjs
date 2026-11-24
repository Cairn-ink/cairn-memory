import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { coreDigest } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";

const scope = { owner: "owner", namespace: null };
const selection = { client: "client", sessionId: "session", eventId: "event" };
const key = { scope, ...selection, payloadDigest: "a".repeat(64) };
const forgotten = "The discarded notebook is on the shelf.";

async function finishBatch(adapter, suppress) {
  const { uow, capture, harness } = adapter;
  const contents = ["First memory", forgotten, "Another memory", forgotten, "Final memory"];
  const items = await Promise.all(contents.map(async (content) => ({
    content, kind: "fact", confidence: 0.9, textHash: `sha256:${(await coreDigest(content)).value}`,
    embedding: null, receipts: [],
  })));
  if (suppress) {
    await harness.seedFact(scope.owner, {
      ...scope, actionId: "forget-text", origin: "forget", kind: "text", mode: "exact",
      text: { digests: [await coreDigest(forgotten)] },
    });
  }
  return uow.run(scope.owner, { pauseLock: true }, async (tx) => {
    const claim = await capture.claim(tx, key, [], { leaseMs: 60_000 });
    assert.equal(claim.status, "claimed");
    return capture.finish(tx, claim.token, items);
  });
}

async function assertMixedFinish(adapter) {
  const result = await finishBatch(adapter, true);
  assert.equal(result.suppressedCount, 2);
  assert.equal(result.memories.length, 3);
  assert.deepEqual(result.suppressedItems, [1, 3], "Finish must report the exact suppressed positions");
  return result;
}

test("finish reports the exact suppressed positions and preserves them on replay", async () => {
  const adapter = createMemoryAdapter();
  const { capture, uow } = adapter;
  const result = await assertMixedFinish(adapter);
  const expected = structuredClone(result);
  const replay = () => uow.run(scope.owner, { pauseLock: true },
    (tx) => capture.claim(tx, key, [], { leaseMs: 60_000 }));

  result.suppressedItems[0] = 0;
  const first = await replay();
  assert.deepEqual(first, { status: "rawReplay", result: expected });
  first.result.suppressedItems.push(4);
  assert.deepEqual(await replay(), { status: "rawReplay", result: expected });
  const readmitted = await uow.run(scope.owner, { pauseLock: true }, (tx) => capture.admit(tx, key, []));
  assert.deepEqual(readmitted, { status: "rawReplay", result: expected });
});

test("finish omits suppression positions when no items were suppressed", async () => {
  const result = await finishBatch(createMemoryAdapter(), false);
  assert.equal(result.suppressedCount, 0);
  assert.equal(Object.hasOwn(result, "suppressedItems"), false);
});

function mutateFinish(t, adapter, mutate) {
  const { finish } = adapter.capture;
  t.mock.method(adapter.capture, "finish", async (tx, token, items) => {
    const result = await finish(tx, token, items);
    result.suppressedItems = mutate(result.suppressedItems);
    return result;
  });
}

for (const [label, mutate] of [
  ["omits a suppressed position", (positions) => positions.slice(0, 1)],
  ["reports off-by-one positions", (positions) => positions.map((position) => position + 1)],
  ["duplicates a suppressed position", ([first]) => [first, first]],
]) {
  test(`the mixed finish assertion catches a result that ${label}`, async (t) => {
    const adapter = createMemoryAdapter();
    mutateFinish(t, adapter, mutate);
    await assert.rejects(assertMixedFinish(adapter), {
      code: "ERR_ASSERTION", message: /^Finish must report the exact suppressed positions/,
    });
  });
}

function archiveAdapter(fingerprintKey) {
  return createMemoryAdapter({ capabilities: { rawArchive: true, fingerprintKey } });
}

async function assertCaptureArchive(storage) {
  const messages = [
    { id: "orchids", content: "The orchids get water on Mondays." },
    { id: "lantern", content: "The lantern is beneath the steps." },
    { id: "mugs", content: "The mugs are beside the kettle." },
  ].map((message, index) => ({ ...message, role: "user", occurredAtMs: index + 1 }));
  const contents = ["Water the orchids each Monday.", "Keep the lantern under the stairs.", "Store the mugs by the kettle."];
  const textHash = `sha256:${(await coreDigest(contents[1])).value}`;
  const { id: memoryId } = await storage.uow.run(scope.owner, {}, (tx) => storage.memories.insert(tx, scope, {
    text: contents[1], kind: "fact", confidence: 0.9, textHash, embedding: null,
    origin: "explicit", source: { kind: "capture", client: null, sessionId: null },
  }, [], 1));
  const service = createMemoryService({
    storage,
    model: {
      model: "fixture", contextWindow: 16_384, countTokens: () => 1,
      async call(stage) {
        assert.equal(stage, "extract");
        return { items: contents.map((content, position) => ({
          content, kind: "fact", confidence: 0.9, sourceIndices: [position],
        })) };
      },
    },
    embedder: {
      model: "fixture", dimensions: 1,
      async embed(inputs) {
        assert.equal(inputs.length, contents.length);
        // Finish suppresses an exact duplicate of a hidden memory. Passage checks only see text facts.
        await storage.harness.seedFact(scope.owner, {
          ...scope, actionId: "forget-identity", origin: "forget", kind: "identity", memoryId,
        });
        return inputs.map(() => Float32Array.of(1));
      },
    },
    gate: { async assertOpen() {} },
    clock: {
      nowMs: () => 100, monotonicMs: () => 100,
      async sha256Hex(text) { return createHash("sha256").update(text).digest("hex"); },
      hmacHex: () => assert.fail("Expected the owner fingerprint provider"),
    },
    tokens: { countTokens: () => 1 },
    config: {},
  });
  assert.deepEqual(await service.enqueueCapture(scope, { ...selection, messages }), { status: "accepted" });
  const completed = await service.runCapture(scope, selection);
  assert.equal(completed.status, "done");
  assert.equal(completed.result.suppressedCount, 1);
  assert.equal(completed.result.memories.length, 2);
  const [{ rows, rawRows }] = await storage.harness.dump();
  assert.deepEqual(rows.filter(({ row }) => row.id !== memoryId).map(({ row }) => row.text).sort(),
    [contents[0], contents[2]].sort());
  assert.deepEqual(rawRows.map(({ messageId }) => messageId).sort(), ["mugs", "orchids"],
    "Raw must contain exactly the sources cited by written items");
  return completed.result;
}

for (const fingerprintKey of [true, false]) {
  test(`finish suppression excludes its source from Raw ${fingerprintKey ? "with" : "without"} an owner key`, async () => {
    const result = await assertCaptureArchive(archiveAdapter(fingerprintKey));
    assert.deepEqual(result.suppressedItems, [1]);
  });
}

test("the Raw assertion catches a written position reported as suppressed", async (t) => {
  const adapter = archiveAdapter(true);
  mutateFinish(t, adapter, (positions) => [0, ...positions]);
  await assert.rejects(assertCaptureArchive(adapter), {
    code: "ERR_ASSERTION", message: /^Raw must contain exactly the sources cited by written items/,
    actual: ["mugs"], expected: ["mugs", "orchids"],
  });
});

test("K-CLM-6 reads reported positions by index, as core does, not through the iterator", async () => {
  const { CAPTURE_CASES, runCase } = await import("@cairn-ink/conformance");
  const { rawFactory } = await import("./fixtures/raw.mjs");
  const testCase = CAPTURE_CASES.find(({ id }) => id === "K-CLM-6");
  assert.ok(testCase);
  assert.equal(await runCase(rawFactory(), testCase), null);
  // Core reads entry 0 and would exclude the first item's sources; the iterator claims the middle one.
  const crafted = () => {
    const positions = [0];
    positions[Symbol.iterator] = function* () { yield 1; };
    return positions;
  };
  const create = (options) => {
    const adapter = createMemoryAdapter(options);
    const { finish, claim } = adapter.capture;
    adapter.capture.finish = async (tx, token, items) => ({ ...await finish(tx, token, items), suppressedItems: crafted() });
    // The replay reports the same crafted list, so only the finish-time reading can catch it.
    adapter.capture.claim = async (...args) => {
      const replay = await claim.apply(adapter.capture, args);
      if (replay.status !== "rawReplay") return replay;
      return { ...replay, result: { ...replay.result, suppressedItems: crafted() } };
    };
    return adapter;
  };
  await assert.rejects(runCase(rawFactory({ create }), testCase),
    /Finish must report exactly the suppressed middle position/);
});

test("K-CLM-6 compares the replay against the positions checked at finish", async () => {
  const { CAPTURE_CASES, runCase } = await import("@cairn-ink/conformance");
  const { rawFactory } = await import("./fixtures/raw.mjs");
  const testCase = CAPTURE_CASES.find(({ id }) => id === "K-CLM-6");
  assert.ok(testCase);
  const create = (options) => {
    const adapter = createMemoryAdapter(options);
    const { finish, claim } = adapter.capture;
    /** @type {number[] | undefined} */
    let shared;
    adapter.capture.finish = async (tx, token, items) => {
      const result = await finish(tx, token, items);
      shared = [...result.suppressedItems];
      return { ...result, suppressedItems: shared };
    };
    adapter.capture.claim = async (...args) => {
      const replay = await claim.apply(adapter.capture, args);
      if (replay.status !== "rawReplay" || !shared) return replay;
      // The store changes the array it returned earlier and hands the same array back on replay.
      shared[0] = 0;
      return { ...replay, result: { ...replay.result, suppressedItems: shared } };
    };
    return adapter;
  };
  await assert.rejects(runCase(rawFactory({ create }), testCase),
    /Replay must preserve the reported suppression positions/);
});

/** Runs K-CLM-6 on a memory adapter whose finish result carries `suppressedItems` from `define`; replay stays correct. */
async function runWithFinishField(define) {
  const { CAPTURE_CASES, runCase } = await import("@cairn-ink/conformance");
  const { rawFactory } = await import("./fixtures/raw.mjs");
  const testCase = CAPTURE_CASES.find(({ id }) => id === "K-CLM-6");
  assert.ok(testCase);
  const create = (options) => {
    const adapter = createMemoryAdapter(options);
    const { finish } = adapter.capture;
    adapter.capture.finish = async (tx, token, items) => {
      const { suppressedItems, ...rest } = await finish(tx, token, items);
      assert.deepEqual(suppressedItems, [1]);
      return define(rest);
    };
    return adapter;
  };
  return runCase(rawFactory({ create }), testCase);
}

test("K-CLM-6 reads the finish field once, as core does", async () => {
  let reads = 0;
  // Core reads the field once and would see [0]; a second read would see the expected [1].
  const result = runWithFinishField((rest) => Object.defineProperty(rest, "suppressedItems", {
    enumerable: true, get: () => (reads++ === 0 ? [0] : [1]),
  }));
  await assert.rejects(result, /Finish must report exactly the suppressed middle position/);
});

test("K-CLM-6 reads each entry before checking that it is the list's own, as core does", async () => {
  const result = runWithFinishField((rest) => {
    const positions = [9];
    // Core reads 1 here, then finds no own entry and fails the capture.
    Object.defineProperty(positions, 0, { configurable: true, enumerable: true,
      get() { delete positions[0]; return 1; } });
    return { ...rest, suppressedItems: positions };
  });
  await assert.rejects(result, /Finish suppression positions must not have holes/);
});

test("K-CLM-6 reads the list length in core's order", async () => {
  let lengthReads = 0;
  // Core's bounds check sees 1, then its loop sees 0 and excludes nothing.
  const result = runWithFinishField((rest) => ({ ...rest, suppressedItems: new Proxy([1], {
    get: (target, property, receiver) => property === "length" ? (lengthReads++ === 0 ? 1 : 0)
      : Reflect.get(target, property, receiver),
  }) }));
  await assert.rejects(result, /Finish must report exactly the suppressed middle position/);
});

test("K-CLM-6 reads the list before the other result fields", async () => {
  const positions = [0];
  // Core reads [0]; reading the count first would turn it into the expected [1].
  const result = runWithFinishField((rest) => Object.defineProperties({ ...rest, suppressedItems: positions }, {
    suppressedCount: { enumerable: true, get() { positions[0] = 1; return 1; } },
  }));
  await assert.rejects(result, /Finish must report exactly the suppressed middle position/);
});

test("K-CLM-6 reads the list inside the finish transaction", async () => {
  const { CAPTURE_CASES, runCase } = await import("@cairn-ink/conformance");
  const { rawFactory } = await import("./fixtures/raw.mjs");
  const testCase = CAPTURE_CASES.find(({ id }) => id === "K-CLM-6");
  assert.ok(testCase);
  const create = (options) => {
    const adapter = createMemoryAdapter(options);
    const { finish } = adapter.capture;
    const { run } = adapter.uow;
    /** @type {number[] | undefined} */
    let returned;
    adapter.capture.finish = async (tx, token, items) => {
      const { suppressedItems, ...rest } = await finish(tx, token, items);
      assert.deepEqual(suppressedItems, [1]);
      returned = [0];
      return { ...rest, suppressedItems: returned };
    };
    // Core archives from [0] inside the transaction; the store changes the list only after it commits.
    adapter.uow.run = async (...args) => {
      const value = await run.apply(adapter.uow, args);
      if (returned) returned[0] = 1;
      return value;
    };
    return adapter;
  };
  await assert.rejects(runCase(rawFactory({ create }), testCase),
    /Finish must report exactly the suppressed middle position/);
});
