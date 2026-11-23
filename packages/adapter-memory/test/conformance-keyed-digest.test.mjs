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
  assert.equal(await harness.rowsMissingKeyedDigest(otherOwner), 1);
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
