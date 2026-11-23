import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { KEYED_DIGEST_CASES, runCase } from "@cairn-ink/conformance";
import { allDigests, coreDigest } from "@cairn-ink/core";
import { embeddingRequiredFactory } from "./fixtures/embedding-required.mjs";

const memory = {
  name: "memory",
  async open({ capabilities }) {
    const adapter = createMemoryAdapter({ capabilities });
    return {
      adapter, sessionRefs: "plain", harness: adapter.harness,
      nativeErrorMap: adapter.nativeErrorMap, busyNativeCodes: [], embeddingDimensions: null,
      async close() {},
    };
  },
};

for (const factory of [memory, embeddingRequiredFactory()]) {
  for (const testCase of KEYED_DIGEST_CASES) {
    test(`${factory.name} ${testCase.id} ${testCase.title}`, async () => {
      assert.equal(await runCase(factory, testCase), null);
    });
  }
}

test("keyed digest cases report missing capabilities and rotation hooks", async () => {
  const disabled = {
    ...memory,
    open: ({ capabilities }) => memory.open({ capabilities: { ...capabilities, fingerprintKey: false } }),
  };
  for (const testCase of KEYED_DIGEST_CASES) {
    assert.equal(await runCase(disabled, testCase), "needs fingerprintKey");
  }
  const rotation = KEYED_DIGEST_CASES.find(({ id }) => id === "K-KD-4");
  for (const hook of ["setFingerprintSecret", "rowsMissingKeyedDigest"]) {
    const withoutHook = {
      ...memory,
      async open(options) {
        const opened = await memory.open(options);
        const { [hook]: _hook, ...harness } = opened.harness;
        return { ...opened, harness };
      },
    };
    assert.match(await runCase(withoutHook, rotation), new RegExp(`^needs harness\\.${hook}\\b`));
  }
});

test("the rotation case reports when a factory serializes key sampling behind rotation", async () => {
  const rotationCase = KEYED_DIGEST_CASES.find(({ id }) => id === "K-KD-4");
  let seeded = 0;
  const factory = {
    ...memory,
    async open(options) {
      const opened = await memory.open(options);
      const { adapter, harness } = opened;
      let rotation;
      return {
        ...opened,
        adapter: { ...adapter, keys: {
          async userKey(owner) {
            await rotation;
            return adapter.keys.userKey(owner);
          },
        } },
        harness: { ...harness,
          setFingerprintSecret(secret) {
            rotation = harness.setFingerprintSecret(secret);
            return rotation;
          },
          async seedFact(owner, fact) {
            await harness.seedFact(owner, fact);
            seeded++;
          },
        },
      };
    },
  };
  assert.match(await runCase(factory, rotationCase), /^rotation sampling skipped because no key read completed/);
  assert.equal(seeded, 2);
});

const owner = "test-owner";
const scope = { owner, namespace: null };

async function content(text, digests) {
  const sha = await coreDigest(text);
  return {
    text, digests, textHash: `sha256:${sha.value}`, kind: "fact", origin: "explicit", confidence: 1,
    embedding: null, source: { kind: "mcp", client: null, sessionId: null },
  };
}

test("insert and replace derive missing row digests from their own text", async () => {
  const { uow, keys, harness, memories } = createMemoryAdapter({ capabilities: { fingerprintKey: true } });
  const old = await content("Garden basil");
  const next = await content("Garden thyme");
  const key = await keys.userKey(owner);
  const { id, revision } = await uow.run(owner, {}, (tx) => memories.insert(tx, scope, old, [], 1));
  await harness.seedFact(owner, {
    owner, actionId: "test-forget", origin: "forget", kind: "text", mode: "exact",
    text: { digests: [await coreDigest(old.text, key)] },
  });
  const visible = () => uow.run(owner, { readOnly: true }, (tx) =>
    memories.exportPage(tx, scope, { cursor: null, limit: 10 }));
  assert.deepEqual((await visible()).items, []);
  assert.equal(await harness.rowsMissingKeyedDigest(owner), 0);
  await uow.run(owner, {}, (tx) => memories.replaceContent(tx, scope, id, revision, next, null, 2));
  const [row] = (await visible()).items;
  assert.equal(row?.text, next.text);
  assert.equal(Object.hasOwn(row, "digests"), false);
  assert.equal(await harness.rowsMissingKeyedDigest(owner), 0);
});

test("queued row writes snapshot and validate the provided digest array", async () => {
  const { uow, keys, harness, memories } = createMemoryAdapter({ capabilities: { fingerprintKey: true } });
  const key = await keys.userKey(owner);
  const text = "Garden thyme";
  const digests = await allDigests(text, key);
  const digest = digests.find(({ alg }) => alg === "hmac");
  const expected = { ...digest };
  digests[Symbol.iterator] = () => { throw new Error("Caller iterator must not run"); };
  const input = await content(text, digests);
  const invalid = await content("Garden mint", [expected, expected]);
  await uow.run(owner, {}, async (tx) => {
    await assert.rejects(memories.insert(tx, scope, invalid, [], 1), { code: "invalid_input" });
    const queued = memories.insert(tx, scope, input, [], 2);
    digest.value = "f".repeat(64);
    digests.length = 0;
    await queued;
  });
  const [{ rows: [{ row }] }] = await harness.dump();
  assert.deepEqual(row.digests.find(({ alg }) => alg === "hmac"), expected);
});

test("rotation waits for a pending write and covers rows across owners and namespaces", async () => {
  const { uow, keys, harness, memories } = createMemoryAdapter({ capabilities: { fingerprintKey: true } });
  const otherOwner = "test-other-owner";
  const otherScope = { owner: otherOwner, namespace: "test-namespace" };
  const text = "Garden thyme";
  const oldKey = await keys.userKey(owner);
  const pending = await content(text, await allDigests(text, oldKey));
  const older = await content(text, await allDigests(text, null));
  await uow.run(otherOwner, {}, (tx) => memories.insert(tx, otherScope, older, [], 1));
  assert.equal(await harness.rowsMissingKeyedDigest(otherOwner), 0);
  const started = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const write = uow.run(owner, {}, async (tx) => {
    started.resolve();
    await resume.promise;
    await memories.insert(tx, scope, pending, [], 2);
  });
  await started.promise;
  const rotation = harness.setFingerprintSecret("test-secret-rotation");
  try {
    await keys.userKey(otherOwner);
    assert.equal((await keys.userKey(owner)).id, oldKey.id);
  } finally {
    resume.resolve();
    await Promise.all([write, rotation]);
  }
  assert.notEqual((await keys.userKey(owner)).id, oldKey.id);
  assert.equal(await harness.rowsMissingKeyedDigest(owner), 0);
  assert.equal(await harness.rowsMissingKeyedDigest(otherOwner), 0);
});

const basil = "Garden basil";
const thyme = "Garden thyme";
const mint = "Garden mint";
const nextSecret = "test-secret-rotation";

async function seedKeyedFact({ harness }, text, key) {
  await harness.seedFact(owner, {
    owner, actionId: "test-forget", origin: "forget", kind: "text", mode: "exact",
    text: { digests: [await coreDigest(text, key)], keyId: key.id },
  });
}

function insert({ uow, memories }, row, target = scope) {
  return uow.run(target.owner, {}, (tx) => memories.insert(tx, target, row, [], 1));
}

async function visible({ uow, memories }) {
  const page = await uow.run(owner, { readOnly: true }, (tx) =>
    memories.exportPage(tx, scope, { cursor: null, limit: 10 }));
  return page.items.map(({ text }) => text);
}

async function keyedContent(text, key) {
  return content(text, await allDigests(text, key));
}

test("rotation retains old facts without hiding unrelated rows or blocking keyed saves with text", async () => {
  const adapter = createMemoryAdapter({ capabilities: { fingerprintKey: true } });
  const { uow, memories, keys, harness } = adapter;
  const old = await keys.userKey(owner);
  await insert(adapter, await keyedContent(basil, old));
  await insert(adapter, await keyedContent(thyme, old));
  await seedKeyedFact(adapter, basil, old);
  assert.deepEqual(await visible(adapter), [thyme]);

  await harness.setFingerprintSecret(nextSecret);
  const fresh = await keys.userKey(owner);
  assert.notEqual(fresh.id, old.id);
  const query = await keyedContent(mint, fresh);
  const policy = (batch) => uow.run(owner, { readOnly: true }, (tx) =>
    memories.readWritePolicy(tx, scope, batch, query.source, "hash"));
  assert.deepEqual(await visible(adapter), [thyme]);
  assert.equal(await harness.rowsMissingKeyedDigest(owner), 0);
  assert.deepEqual((await policy([query])).blockedPositions, []);
  assert.deepEqual((await policy([await keyedContent(basil, fresh)])).blockedPositions, [0]);
  assert.deepEqual((await policy([{ ...query, text: basil }])).blockedPositions, [0]);
  assert.deepEqual((await policy([{ textHash: query.textHash, digests: query.digests }])).blockedPositions, [0]);
  await insert(adapter, query);
  assert.deepEqual((await visible(adapter)).sort(), [mint, thyme].sort());
  assert.equal(await harness.rowsMissingKeyedDigest(owner), 0);
});

test("a write submitted during rotation covers the pending key despite supplied old digests", async () => {
  const adapter = createMemoryAdapter({ capabilities: { fingerprintKey: true } });
  const { keys, harness } = adapter;
  const row = await keyedContent(thyme, await keys.userKey(owner));
  const rotation = harness.setFingerprintSecret(nextSecret);
  await Promise.all([rotation, insert(adapter, row)]);

  assert.equal(await harness.rowsMissingKeyedDigest(owner), 0);
  await seedKeyedFact(adapter, basil, await keys.userKey(owner));
  assert.deepEqual(await visible(adapter), [thyme]);
});

test("rotation lets a write holding one owner lock await a write for another owner", async () => {
  const adapter = createMemoryAdapter({ capabilities: { fingerprintKey: true } });
  const { uow, memories, keys, harness } = adapter;
  const other = { owner: "test-other-owner", namespace: null };
  const row = await content(thyme);
  await insert(adapter, row, other);
  const old = await keys.userKey(owner);
  const writing = Promise.withResolvers();
  const nested = Promise.withResolvers();
  const outer = uow.run(owner, {}, async (tx) => {
    const pending = memories.insert(tx, scope, row, [], 1);
    writing.resolve();
    await pending;
    await nested.promise;
    await insert(adapter, row, other);
  });
  await writing.promise;
  const rotation = harness.setFingerprintSecret(nextSecret);
  nested.resolve();
  let timeout;
  try {
    await Promise.race([Promise.all([outer, rotation]), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Nested run and rotation did not complete")), 2000);
    })]);
  } finally {
    clearTimeout(timeout);
  }
  assert.notEqual((await keys.userKey(owner)).id, old.id);
  assert.equal(await harness.rowsMissingKeyedDigest(owner), 0);
  assert.equal(await harness.rowsMissingKeyedDigest(other.owner), 0);
});

test("catching a rejected insert leaves the index revision unchanged", async () => {
  const { uow, memories, placement } = createMemoryAdapter({
    capabilities: { placement: true },
    newId() { throw new Error("ID generation failed"); },
  });
  const catalog = () => uow.run(owner, { readOnly: true }, (tx) =>
    placement.catalog(tx, scope, { cursor: null, limit: 10 }));
  const row = await content(thyme);
  const before = (await catalog()).indexRevision;
  await uow.run(owner, {}, async (tx) => {
    await assert.rejects(memories.insert(tx, scope, row, [], 1), { code: "internal_error" });
  });
  assert.equal((await catalog()).indexRevision, before);
});
