import assert from "node:assert/strict";
import test from "node:test";
import { allDigests, engineLegacyDigest } from "@cairn-ink/core";
import { createMemoryAdapter } from "../../adapter-memory/src/index.mjs";
import { forgetMethod } from "../../core/src/service/forget.mjs";
import { scopeKey } from "../src/storage-values.mjs";
import { fixture, seedFact, sha256, testAccess } from "./storage-fixtures.mjs";

const scope = { owner: "fixture-owner", namespace: null };
const source = { kind: "mcp", client: null, sessionId: null };

async function content(text) {
  const [canonical] = await allDigests(text);
  const legacy = await engineLegacyDigest("Historical spelling for " + text);
  return { kind: "fact", origin: "explicit", text, textHash: "sha256:" + canonical.value,
    source, confidence: 1, embedding: null, digests: [canonical, legacy] };
}

function insert(adapter, row) {
  return adapter.uow.run(scope.owner, {}, tx => adapter.memories.insert(tx, scope, row, [], 1));
}

function read(adapter, fn) {
  return adapter.uow.run(scope.owner, { readOnly: true }, fn);
}

test("Core forget erases a live SQLite row that is already suppressed", async t => {
  const opened = await fixture();
  t.after(opened.close);
  const { adapter } = opened;
  const { memories } = adapter;
  const row = await content("Synthetic ＣＡＩＲＮ text for forget");
  const { id } = await insert(adapter, row);
  await seedFact(adapter, { ...scope, kind: "identity", origin: "forget",
    actionId: "fixture-suppress", memoryId: id });
  await read(adapter, async tx => {
    const query = [{ textHash: row.textHash }];
    assert.equal((await memories.get(tx, scope, id)).text, row.text);
    assert.deepEqual(await memories.readRevision(tx, scope, id), { revision: 1, textHash: row.textHash });
    assert.deepEqual(await memories.findDuplicates(tx, scope, query, { nearDistance: 0 }), [[]]);
    assert.deepEqual(await memories.exportPage(tx, scope, { limit: 10, cursor: null }), { items: [], nextCursor: null });
    assert.deepEqual((await memories.readWritePolicy(tx, scope, query, source, "full")).hiddenIds, [id]);
  });

  const storedRow = () => testAccess(opened, scope, {}, db =>
    db.prepare(`SELECT deleted, text_hash, legacy_hash, body FROM cairn_memories
      WHERE owner_id = ? AND namespace_key = ? AND id = ?`).get(...scopeKey(scope), id));
  const before = await storedRow();
  assert.equal(before.text_hash, row.textHash);
  assert.equal(before.legacy_hash, "sha256:" + row.digests[1].value);
  assert.equal(JSON.parse(before.body).text, row.text);

  // Core forget requires a fingerprint provider. Borrow the memory fixture's
  // synthetic key while running the forget sequence against SQLite storage.
  const { keys } = createMemoryAdapter({ capabilities: { fingerprintKey: true } });
  const forget = forgetMethod({ storage: { ...adapter, keys }, clock: { sha256Hex: sha256 } });
  assert.deepEqual(await forget(scope, id, source), { status: "forgotten", removedSimilar: 0 });
  assert.deepEqual({ ...await storedRow() }, { deleted: 1, text_hash: null, legacy_hash: null, body: null });
  await read(adapter, async tx => {
    assert.equal(await memories.get(tx, scope, id), null);
    assert.equal(await memories.readRevision(tx, scope, id), null);
  });
});

test("exact duplicate lookup in both adapters compares only stored canonical hashes", async t => {
  const opened = await fixture();
  t.after(opened.close);
  const row = await content("Synthetic ＣＡＩＲＮ text for duplicates");
  const storedLegacy = "sha256:" + row.digests[1].value;
  assert.notEqual(row.textHash, storedLegacy);
  const unrelated = "sha256:" + sha256("unrelated fixture text");
  const queries = [
    { textHash: row.textHash },
    { textHash: unrelated, legacyHash: row.textHash },
    { textHash: storedLegacy },
    { textHash: unrelated, legacyHash: storedLegacy },
  ];

  async function observe(adapter) {
    const { id } = await insert(adapter, row);
    return read(adapter, async tx => {
      const groups = [];
      // Each query gets its own batch so earlier queries cannot supply a prior match.
      for (const query of queries) {
        const [matches] = await adapter.memories.findDuplicates(tx, scope, [query], { nearDistance: 0 });
        assert.ok(matches.every(match => match.id === id));
        groups.push(matches.map(({ id: _id, ...match }) => match));
      }
      return groups;
    });
  }

  const exact = { kind: "stored", match: "exact", distance: 0, revision: 1, writeTimeUs: 1000n };
  const reference = await observe(createMemoryAdapter());
  assert.deepEqual(reference, [[exact], [exact], [], []]);
  assert.deepEqual(await observe(opened.adapter), reference);
});

test("replacement still rejects a collision with a stored legacy digest", async t => {
  const opened = await fixture();
  t.after(opened.close);
  const { adapter } = opened;
  const original = await content("Original fixture memory");
  const next = await content("Replacement text");
  const other = await content("Another fixture memory");
  other.digests[1].value = next.textHash.slice(7);
  assert.notEqual(other.textHash, next.textHash);
  const { id } = await insert(adapter, original);
  await insert(adapter, other);

  await assert.rejects(adapter.uow.run(scope.owner, {}, tx =>
    adapter.memories.replaceContent(tx, scope, id, 1, next, null, 2)), { code: "memory_conflict" });
  assert.deepEqual(await read(adapter, tx => adapter.memories.readRevision(tx, scope, id)),
    { revision: 1, textHash: original.textHash });
});
