import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter, TEST_FINGERPRINT_LABELS } from "@cairn-ink/adapter-memory";
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
  for (const [id, hooks] of [
    ["K-KD-4", ["setFingerprintSecret", "rowsMissingKeyedDigest"]],
    ["K-KD-5", ["setFingerprintSecret"]],
    ["K-KD-6", ["setFingerprintSecret", "rowsMissingKeyedDigest"]],
  ]) {
    const rotationCase = KEYED_DIGEST_CASES.find((candidate) => candidate.id === id);
    for (const hook of hooks) {
      const withoutHook = {
        ...memory,
        async open(options) {
          const opened = await memory.open(options);
          const { [hook]: _hook, ...harness } = opened.harness;
          return { ...opened, harness };
        },
      };
      assert.match(await runCase(withoutHook, rotationCase), new RegExp(`^needs harness\\.${hook}\\b`));
    }
  }
});

test("the rotation coverage case reads keys and coverage only outside rotation", async () => {
  const rotationCase = KEYED_DIGEST_CASES.find(({ id }) => id === "K-KD-4");
  let seeded = 0;
  let gates = 0;
  const factory = {
    ...memory,
    async open(options) {
      const opened = await memory.open(options);
      const { adapter, harness } = opened;
      let rotating = false;
      return {
        ...opened,
        adapter: { ...adapter, keys: {
          async userKey(owner) {
            assert.equal(rotating, false, "K-KD-4 must not sample the current key during rotation");
            return adapter.keys.userKey(owner);
          },
        } },
        harness: { ...harness,
          async setFingerprintSecret(secret) {
            rotating = true;
            try {
              await harness.setFingerprintSecret(secret);
            } finally {
              rotating = false;
            }
          },
          async rowsMissingKeyedDigest(owner) {
            assert.equal(rotating, false, "K-KD-4 must not sample coverage during rotation");
            gates++;
            return harness.rowsMissingKeyedDigest(owner);
          },
          async seedFact(owner, fact) {
            await harness.seedFact(owner, fact);
            seeded++;
          },
        },
      };
    },
  };
  assert.equal(await runCase(factory, rotationCase), null);
  assert.equal(seeded, 2);
  assert.equal(gates, 1);
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

test("write queries use port digests and aliases across rotation", async () => {
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
  const row = await keyedContent(mint, fresh);
  const query = { textHash: row.textHash, digests: row.digests };
  const policy = (batch) => uow.run(owner, { readOnly: true }, (tx) =>
    memories.readWritePolicy(tx, scope, batch, row.source, "hash"));
  assert.deepEqual(await visible(adapter), [thyme]);
  assert.equal(await harness.rowsMissingKeyedDigest(owner), 0);
  assert.deepEqual((await policy([query])).blockedPositions, [0]);
  assert.deepEqual((await policy([{ ...query, text: mint }])).blockedPositions, [0]);
  let textReads = 0;
  const fields = new Proxy(query, {
    get(target, property, receiver) {
      if (property === "text") textReads++;
      return Reflect.get(target, property, receiver);
    },
    getOwnPropertyDescriptor(target, property) {
      if (property === "text") textReads++;
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  assert.deepEqual((await policy([fields])).blockedPositions, [0]);
  assert.equal(textReads, 0);
  const bothKeys = async (text) => ({
    textHash: (await content(text)).textHash,
    digests: [...await allDigests(text, fresh), await coreDigest(text, old)],
  });
  assert.deepEqual((await policy([await bothKeys(basil), await bothKeys(mint)])).blockedPositions, [0]);
  await insert(adapter, row);
  assert.deepEqual((await visible(adapter)).sort(), [mint, thyme].sort());
  assert.equal(await harness.rowsMissingKeyedDigest(owner), 0);
});

test("write queries retain both hash aliases when keyed digests are supplied", async () => {
  const adapter = createMemoryAdapter({ capabilities: { fingerprintKey: true } });
  const { uow, memories, keys, harness } = adapter;
  const digests = await allDigests(mint, await keys.userKey(owner));
  const { textHash, source } = await content(thyme);
  const legacyHash = (await content(basil)).textHash;
  const policy = (query) => uow.run(owner, { readOnly: true }, (tx) =>
    memories.readWritePolicy(tx, scope, [query], source, "hash"));
  for (const [text, actionId] of [[basil, "test-legacy-alias"], [thyme, "test-core-alias"]]) {
    await harness.seedFact(owner, {
      owner, actionId, origin: "forget", kind: "text", mode: "exact",
      text: { digests: [await coreDigest(text)] },
    });
  }
  assert.deepEqual((await policy({ textHash, digests })).blockedPositions, [0]);
  assert.deepEqual((await policy({ textHash: (await content(mint)).textHash, legacyHash, digests })).blockedPositions, [0]);
});

test("rotation refusal considers a retained-key fact in another owner", async () => {
  const adapter = createMemoryAdapter({ capabilities: { fingerprintKey: true, placement: true } });
  const { keys, harness } = adapter;
  const otherOwner = "test-other-owner";
  const other = { owner: otherOwner, namespace: "test-namespace" };
  const old = await keys.userKey(otherOwner);
  await insert(adapter, await content(thyme));
  await harness.setFingerprintSecret(nextSecret);
  const current = await keys.userKey(owner);
  await harness.seedFact(otherOwner, {
    owner: otherOwner, namespace: other.namespace, actionId: "test-forget", origin: "forget", kind: "text", mode: "exact",
    text: { digests: [await coreDigest(basil, old)] },
  });
  const before = await harness.dump();
  await assert.rejects(harness.setFingerprintSecret("test-secret-later"), { code: "fingerprint_key_mismatch" });
  assert.deepEqual(await harness.dump(), before);
  assert.equal((await keys.userKey(owner)).id, current.id);
  assert.equal(await harness.rowsMissingKeyedDigest(owner), 0);
  assert.equal(await harness.rowsMissingKeyedDigest(otherOwner), 0);
});

test("a second-owner derivation failure preserves rows and placement guards", async (t) => {
  const adapter = createMemoryAdapter({ capabilities: { fingerprintKey: true, placement: true } });
  const { uow, keys, harness, placement } = adapter;
  const other = { owner: "test-other-owner", namespace: null };
  const { id: memoryId, revision } = await insert(adapter, await content(thyme));
  await insert(adapter, await content(basil), other);
  const old = await keys.userKey(owner);
  const catalog = () => uow.run(owner, { readOnly: true }, (tx) =>
    placement.catalog(tx, scope, { cursor: null, limit: 10 }));
  const { indexRevision } = await catalog();
  const before = await harness.dump();
  const sign = crypto.subtle.sign.bind(crypto.subtle);
  let failed = 0;
  const fault = t.mock.method(crypto.subtle, "sign", (algorithm, key, data) => {
    if (new TextDecoder().decode(data) === TEST_FINGERPRINT_LABELS.shingleKeyPrefix + other.owner) {
      failed++;
      return Promise.reject(new Error("Owner key derivation failed"));
    }
    return sign(algorithm, key, data);
  });
  await assert.rejects(harness.setFingerprintSecret(nextSecret), { code: "fingerprint_unavailable" });
  fault.mock.restore();
  assert.equal(failed, 1);

  const after = await harness.dump();
  const current = await keys.userKey(owner);
  const afterRevision = (await catalog()).indexRevision;
  const proposal = await Promise.allSettled([uow.run(owner, {}, (tx) =>
    placement.applyPlacement(tx, scope, { indexRevision, memoryRevisions: [{ memoryId, revision }] },
      { items: [{ memoryId, parentIds: [] }] }))]);
  assert.deepEqual({
    stateUnchanged: JSON.stringify(after) === JSON.stringify(before),
    revision: afterRevision,
    keyId: current.id,
    placement: proposal.map((result) => result.status === "fulfilled" ? result.status : result.reason.code),
  }, { stateUnchanged: true, revision: indexRevision, keyId: old.id, placement: ["fulfilled"] });
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
