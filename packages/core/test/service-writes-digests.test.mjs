import assert from "node:assert/strict";
import { test } from "node:test";
import { allDigests, CoreError } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope as scope, memory, serviceFake } from "./helpers/service-fake.mjs";

const source = { kind: "mcp", client: null, sessionId: null };
const legacyCredential = "Ｘsk-0123456789abcdef";
const target = memory("target", { text: "The lantern is stored in the cellar." });
const replacement = "Use the blue notebook for inventory.";
const page = { limit: 10, cursor: null };

function setup(options) {
  const fake = serviceFake({ writes: true, ...options });
  return { ...fake, service: createMemoryService(fake.deps) };
}

async function storedRow(id, text, key) {
  const [{ value }] = await allDigests(text, null);
  return { ...memory(id, { text }), textHash: "sha256:" + value, digests: await allDigests(text, key) };
}

async function visibleIds(service) {
  const { items } = await service.recent(scope, page);
  return items.map(({ id }) => id).sort();
}

for (const operation of ["save", "correct"]) {
  const write = (service, raw) => operation === "save" ? service.save(scope, raw, source)
    : service.correct(scope, target.id, target.revision, raw, source);

  test(`${operation} supplies the current-key digests to write policy and stored content`, async () => {
    const { service, storage, hooks, calls, mutations } = setup({ rows: [target] });
    const key = await storage.keys.userKey(scope.owner);
    const current = { ...key, id: "current-fixture-key" };
    hooks.userKey = owner => {
      assert.equal(owner, scope.owner);
      return current;
    };

    const result = await write(service, "  Sample   key sk-0123456789abcdef.  ");
    assert.equal(result.status, "saved");
    const expected = await allDigests(result.item.text, current);
    assert.ok(expected.some(({ alg, keyId }) => alg === "hmac" && keyId === current.id));
    const [, , query] = calls.find(([method]) => method === "memories.readWritePolicy");
    assert.deepEqual(query.digests, expected);
    const { args } = mutations.find(({ method }) =>
      method === (operation === "save" ? "memories.insert" : "memories.replaceContent"));
    assert.deepEqual(args[operation === "save" ? 0 : 2].digests, expected);
  });

  test(`${operation} reports retryable embedding_failed for a provider failure when embeddings are required`, async () => {
    for (const embeddingRequiredOnInsert of [true, false]) {
      const { service, hooks, committed, mutations } = setup({
        rows: [target], forgetting: { capabilities: { embeddingRequiredOnInsert } },
      });
      const before = committed(scope.owner);
      hooks.embed = () => { throw new CoreError("provider_error"); };
      await assert.rejects(() => write(service, replacement), {
        code: embeddingRequiredOnInsert ? "embedding_failed" : "provider_error", retryable: true,
      });
      assert.deepEqual(mutations, []);
      assert.deepEqual(committed(scope.owner), before);
    }
  });

  test(`${operation} rejects a missing vector and persists a valid vector when the store requires embeddings`, async () => {
    const { service, deps, hooks, committed, mutations } = setup({
      rows: [target], forgetting: { capabilities: { embeddingRequiredOnInsert: true } },
    });
    const embed = deps.embedder.embed;
    deps.embedder.embed = async (...args) => {
      await embed(...args);
      return [];
    };
    await assert.rejects(() => write(service, replacement), { code: "embedding_failed", retryable: true });
    assert.deepEqual(mutations, []);

    deps.embedder.embed = embed;
    const vector = Float32Array.of(0.5);
    hooks.embed = () => vector;
    const result = await write(service, replacement);
    assert.equal(result.status, "saved");
    assert.deepEqual(committed(scope.owner).rows.find(row => row.id === result.item.id).embedding,
      { model: deps.embedder.model, vector });
  });
}

test("a keyless save keeps the unkeyed query and insert shape", async () => {
  const { service, calls, mutations } = setup({ hasKey: false });
  assert.equal((await service.save(scope, replacement, source)).status, "saved");
  const [, , query] = calls.find(([method]) => method === "memories.readWritePolicy");
  assert.equal(Object.hasOwn(query, "digests"), false);
  assert.equal(Object.hasOwn(mutations[0].args[0], "digests"), false);
});

test("an unrelated save is visible while an HMAC-only forget fact exists", async () => {
  const { service, storage, insert, committed } = setup({ forgetting: {} });
  const key = await storage.keys.userKey(scope.owner);
  const legacy = await storedRow("legacy", legacyCredential, key);
  insert(legacy);
  assert.equal((await service.forget(scope, legacy.id, source)).status, "forgotten");
  const [{ fact }] = committed(scope.owner).facts;
  assert.ok(fact.text.digests.length && fact.text.digests.every(({ alg }) => alg === "hmac"));

  const result = await service.save(scope, replacement, source);
  assert.equal(result.status, "saved");
  assert.deepEqual(await visibleIds(service), [result.item.id]);
});

test("an HMAC-only forget fact blocks the save if query digests are omitted", async () => {
  const { service, storage, insert, mutations } = setup({ forgetting: {} });
  const key = await storage.keys.userKey(scope.owner);
  const legacy = await storedRow("legacy", legacyCredential, key);
  insert(legacy);
  assert.equal((await service.forget(scope, legacy.id, source)).status, "forgotten");
  const readWritePolicy = storage.memories.readWritePolicy;
  storage.memories.readWritePolicy = (tx, scope, [{ digests: _digests, ...query }], ...args) =>
    readWritePolicy(tx, scope, [query], ...args);

  assert.deepEqual(await service.save(scope, replacement, source), { status: "suppressed" });
  assert.equal(mutations.some(({ method }) => method === "memories.insert"), false);
});

test("correcting the legacy credential with zero prior facts keeps both rows visible", async () => {
  const { service, storage, insert, committed } = setup({ forgetting: {} });
  const key = await storage.keys.userKey(scope.owner);
  const legacy = await storedRow("legacy", legacyCredential, key);
  const unrelated = await storedRow("unrelated", "Buy more chalk.", key);
  insert(legacy);
  insert(unrelated);
  assert.deepEqual(committed(scope.owner).facts, []);
  assert.deepEqual(await visibleIds(service), [legacy.id, unrelated.id]);

  const result = await service.correct(scope, legacy.id, legacy.revision, replacement, source);
  assert.equal(result.status, "saved");
  assert.equal(result.item.revision, legacy.revision + 1);
  assert.deepEqual(await visibleIds(service), [legacy.id, unrelated.id]);
});
