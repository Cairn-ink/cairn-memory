import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createMemoryAdapter, TEST_FINGERPRINT_LABELS, TEST_FINGERPRINT_SECRET,
} from "@cairn-ink/adapter-memory";
import { CoreError, factIncarnationBody, userFingerprintKey } from "@cairn-ink/core";

const owner = "test-owner";
const scope = { owner, namespaces: [null] };
const clockStart = 100;
const a = "a".repeat(64);
const b = "b".repeat(64);

function identity(memoryId) {
  return { kind: "identity", owner, actionId: "test-action", origin: "forget", memoryId };
}

function coreError(code) {
  return (error) => error instanceof CoreError && error.code === code;
}

function epoch({ uow, suppressions }) {
  return uow.run(owner, { readOnly: true }, (tx) => suppressions.epoch(tx, owner));
}

function token({ uow, snapshot }) {
  return uow.run(owner, { readOnly: true }, (tx) => snapshot.stateToken(tx, scope));
}

async function incarnation(fact) {
  const bytes = new TextEncoder().encode(factIncarnationBody(fact));
  return Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
}

test("fact writes allocate an ID and read the store clock only on creation", async () => {
  let ids = 0;
  let now = clockStart;
  let clockReads = 0;
  const adapter = createMemoryAdapter({
    newId: () => `test-fact-${++ids}`,
    now() {
      clockReads++;
      return now;
    },
  });
  const { uow, suppressions, snapshot } = adapter;
  const fact = identity("test-first");
  const before = await token(adapter);
  const first = await uow.run(owner, {}, (tx) => suppressions.writeFact(tx, fact, a));
  assert.deepEqual(first, { factId: "test-fact-1", epoch: 1n, createdAtMs: clockStart, created: true });
  await assert.rejects(uow.run(owner, { readOnly: true }, (tx) =>
    snapshot.assertUnchanged(tx, scope, before)), coreError("cursor_stale"));

  now += 100;
  const retry = await uow.run(owner, {}, (tx) => suppressions.writeFact(tx, { ...fact, namespace: null }, a));
  assert.deepEqual(retry, { ...first, created: false });
  const second = await uow.run(owner, {}, (tx) => suppressions.writeFact(tx, identity("test-second"), b));
  assert.deepEqual(second, { factId: "test-fact-2", epoch: 2n, createdAtMs: now, created: true });
  assert.deepEqual(await uow.run(owner, {}, (tx) => suppressions.writeFact(tx, fact, a)), retry);
  assert.equal(await epoch(adapter), 2n);
  assert.equal(clockReads, 2);
});

test("seeding shares the fact table, canonical body hash and index revision", async () => {
  const adapter = createMemoryAdapter({ newId: () => "test-fact", now: () => clockStart });
  const { uow, suppressions, harness, snapshot } = adapter;
  const fact = identity("test-first");
  const before = await token(adapter);
  await harness.seedFact(owner, fact);
  await assert.rejects(uow.run(owner, { readOnly: true }, (tx) =>
    snapshot.assertUnchanged(tx, scope, before)), coreError("cursor_stale"));
  const version = await incarnation(fact);
  const retry = await uow.run(owner, {}, (tx) => suppressions.writeFact(tx, fact, version));
  assert.deepEqual(retry, { factId: "test-fact", epoch: 1n, createdAtMs: clockStart, created: false });

  const committed = await harness.dump();
  await harness.seedFact(owner, { ...fact, actionId: "test-retry" });
  assert.deepEqual(await harness.dump(), committed);
  await assert.rejects(harness.seedFact(owner, { ...fact, origin: "edit" }), coreError("fact_conflict"));
  assert.deepEqual(await harness.dump(), committed);
  assert.equal(await epoch(adapter), 1n);
});

test("seeding a text fact preserves its original embedding on retry", async () => {
  const adapter = createMemoryAdapter({ newId: () => "test-fact", now: () => clockStart });
  const { uow, suppressions, harness } = adapter;
  const fact = {
    kind: "text", owner, actionId: "test-action", origin: "forget", mode: "exact",
    text: {
      digests: [{ alg: "sha256", value: a, pipeline: "core", redactionVersion: 1, keyId: null }],
      embedding: [1, 0],
    },
  };
  const refreshed = { ...fact, text: { ...fact.text, embedding: [0, 1] } };
  await harness.seedFact(owner, fact);
  const committed = await harness.dump();
  assert.deepEqual(committed[0].facts[0].fact.text.embedding, fact.text.embedding);

  await harness.seedFact(owner, refreshed);
  const version = await incarnation(refreshed);
  const retry = await uow.run(owner, {}, (tx) => suppressions.writeFact(tx, refreshed, version));
  assert.deepEqual(retry, { factId: "test-fact", epoch: 1n, createdAtMs: clockStart, created: false });
  assert.equal(await epoch(adapter), 1n);
  assert.deepEqual(await harness.dump(), committed);
});

test("an identity fact without a namespace hides only the null-namespace row", async () => {
  const adapter = createMemoryAdapter({ newId: () => "test-memory" });
  const { uow, memories, fence, harness } = adapter;
  const namespaces = [null, "test-project"];
  const readSet = { owner, namespaces };
  const row = {
    kind: "fact", origin: "explicit", text: "test memory", textHash: `sha256:${a}`,
    confidence: 1, source: { kind: "mcp", client: null, sessionId: null }, embedding: null,
  };
  const refs = await uow.run(owner, {}, async (tx) => {
    const inserted = [];
    for (const namespace of namespaces) {
      const { id } = await memories.insert(tx, { owner, namespace }, row, [], clockStart);
      inserted.push({ id, namespace, type: "memory" });
    }
    return inserted;
  });
  await harness.seedFact(owner, identity(refs[0].id));
  const visible = await uow.run(owner, { readOnly: true }, (tx) => fence.assertVisible(tx, readSet, refs));
  assert.deepEqual(visible, [refs[1]]);
});

test("catching a fact conflict inside a run still aborts it", async () => {
  const adapter = createMemoryAdapter();
  const { uow, suppressions, harness } = adapter;
  const fact = identity("test-first");
  await uow.run(owner, {}, (tx) => suppressions.writeFact(tx, fact, a));
  const committed = await harness.dump();
  const before = await token(adapter);
  await assert.rejects(uow.run(owner, {}, async (tx) => {
    await suppressions.writeFact(tx, identity("test-rollback"), b);
    await assert.rejects(suppressions.writeFact(tx, fact, b), coreError("fact_conflict"));
  }), coreError("fact_conflict"));
  assert.deepEqual(await harness.dump(), committed);
  assert.equal(await epoch(adapter), 1n);
  assert.equal(await token(adapter), before);
});

test("validates facts and session profile restrictions for writes and seeding", async () => {
  const adapter = createMemoryAdapter({ sessionRefs: "hashed" });
  const { uow, suppressions, harness } = adapter;
  const plain = {
    ...identity("test-memory"), kind: "session", session: { client: "test-client", sessionId: a },
  };
  const invalid = { ...identity("test-memory"), throughRevision: -1 };
  for (const fact of [plain, invalid]) {
    await assert.rejects(uow.run(owner, {}, (tx) => suppressions.writeFact(tx, fact, a)), coreError("invalid_input"));
    await assert.rejects(harness.seedFact(owner, fact), coreError("invalid_input"));
  }
  assert.equal(await epoch(adapter), null);
});

test("caught fact refusals preserve the retrieval token and epoch", async () => {
  const adapter = createMemoryAdapter({ sessionRefs: "hashed" });
  const { uow, suppressions, snapshot } = adapter;
  const refused = [
    { ...identity("test-memory"), throughRevision: -1 },
    { ...identity("test-memory"), kind: "session", session: { client: "test-client", sessionId: a } },
  ];
  const before = await token(adapter);
  for (const fact of refused) {
    await uow.run(owner, {}, async (tx) => {
      await assert.rejects(suppressions.writeFact(tx, fact, a), coreError("invalid_input"));
    });
    await uow.run(owner, { readOnly: true }, (tx) => snapshot.assertUnchanged(tx, scope, before));
    assert.equal(await token(adapter), before);
    assert.equal(await epoch(adapter), null);
  }
});

test("reports matching reads as unavailable", async () => {
  const { uow, suppressions } = createMemoryAdapter();
  await uow.run(owner, { readOnly: true }, async (tx) => {
    const factScope = { owner, namespace: null };
    await assert.rejects(suppressions.snapshot(tx, factScope, {}), coreError("capability_unavailable"));
    await assert.rejects(suppressions.factsFor(tx, factScope, { memoryId: "test-memory" }),
      coreError("capability_unavailable"));
  });
});

test("pause state is detached and access requires a live owner transaction", async () => {
  const { uow, pause } = createMemoryAdapter();
  const expired = await uow.run(owner, { pauseLock: true }, async (tx) => {
    const result = await pause.set(tx, owner, true);
    result.paused = false;
    const state = await pause.get(tx, owner);
    assert.deepEqual(state, { paused: true, generation: 1 });
    state.generation = 100;
    await assert.rejects(pause.get(tx, "test-other-owner"), coreError("internal_error"));
    await assert.rejects(pause.set(tx, "test-other-owner", false), coreError("internal_error"));
    return tx;
  });
  await assert.rejects(pause.get(expired, owner), coreError("internal_error"));
  await assert.rejects(pause.set(expired, owner, false), coreError("internal_error"));
  const committed = await uow.run(owner, { pauseLock: true, readOnly: true }, (tx) => pause.get(tx, owner));
  assert.deepEqual(committed, { paused: true, generation: 1 });
});

test("fingerprint configuration follows the enabled flag and uses core derivation", async () => {
  const capabilities = { fingerprintKey: true };
  const labels = Object.freeze({
    keyIdDomain: "test-custom-key-id",
    shingleKeyPrefix: "test-custom-shingle:",
    legacyExactPrefix: "test-custom-exact:",
  });
  const fingerprint = { secret: "test-secret-b", labels };
  const off = createMemoryAdapter({ fingerprint: null });
  assert.equal(await off.keys.userKey(owner), null);
  await assert.rejects(off.harness.setFingerprintSecret("test-secret-c"), coreError("capability_unavailable"));
  assert.throws(() => createMemoryAdapter({ fingerprint }), coreError("capability_unavailable"));
  assert.throws(() => createMemoryAdapter({ capabilities, fingerprint: { ...fingerprint, secret: "" } }), coreError("invalid_input"));
  assert.throws(() => createMemoryAdapter({ capabilities, fingerprint: { ...fingerprint, labels: { ...labels } } }),
    coreError("invalid_input"));

  const defaults = createMemoryAdapter({ capabilities, fingerprint: null });
  const configured = createMemoryAdapter({ capabilities, fingerprint });
  const probe = new TextEncoder().encode("test-probe");
  for (const [adapter, expectedSecret, expectedLabels] of [
    [defaults, TEST_FINGERPRINT_SECRET, TEST_FINGERPRINT_LABELS],
    [configured, fingerprint.secret, fingerprint.labels],
  ]) {
    const expected = await userFingerprintKey(expectedSecret, owner, expectedLabels);
    const actual = await adapter.keys.userKey(owner);
    assert.equal(actual.id, expected.id);
    assert.deepEqual(
      await crypto.subtle.sign("HMAC", actual.signingKey, probe),
      await crypto.subtle.sign("HMAC", expected.signingKey, probe),
    );
    await assert.rejects(adapter.harness.setFingerprintSecret(""), coreError("invalid_input"));
    assert.equal((await adapter.keys.userKey(owner)).id, expected.id);
    await adapter.harness.setFingerprintSecret("test-secret-c");
    assert.notEqual((await adapter.keys.userKey(owner)).id, expected.id);
  }
});
