import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { allDigests, CoreError, engineLegacyDigest } from "@cairn-ink/core";
import { openSqliteAdapter } from "../src/index.mjs";
import { assertForwardTarget, assertLegacyOpen, LEGACY_RULES } from "../src/legacy/refusal.mjs";
import { inventoryLegacyStore } from "../src/legacy/inventory.mjs";
import { readReceipts } from "../src/memory-rows.mjs";
import { scopeKey } from "../src/storage-values.mjs";
import { fixture as legacyFixture, scratch as legacyScratch } from "./legacy/fixtures.mjs";
import { fixture, scratch, seedFact, setWriteTime, sha256, testAccess } from "./storage-fixtures.mjs";

const left = { owner: "left", namespace: "project\0shared" };
const right = { ...left, owner: "right" };
const alternate = { ...left, namespace: "project\0separate" };
const source = { kind: "mcp", client: null, sessionId: null };
const receipt = { client: "fixture-client", sessionId: "fixture-session", messageId: "fixture-message",
  role: "user", occurredAtMs: 10 };
const near = { nearDistance: 0 };

function content(text, fields = {}) {
  return { kind: "fact", origin: "explicit", text, textHash: "sha256:" + sha256(text),
    source, confidence: 1, embedding: null, ...fields };
}

function write(adapter, scope, fn, options = {}) {
  return adapter.uow.run(scope.owner, options, fn);
}

function read(adapter, scope, fn, options = {}) {
  return adapter.uow.run(scope.owner, { ...options, readOnly: true }, fn);
}

async function withStore(t) {
  const opened = await fixture();
  t.after(opened.close);
  return opened;
}

function insert(adapter, scope, row, time, receipts = []) {
  return write(adapter, scope, tx => adapter.memories.insert(tx, scope, row, receipts, time));
}

function identity(scope, memoryId, extra = {}) {
  return { ...scope, kind: "identity", origin: "forget", actionId: "fixture-identity", memoryId, ...extra };
}

function factText(scope, row) {
  return { ...scope, kind: "text", mode: "exact", origin: "forget", actionId: "fixture-text",
    text: { digests: [{ alg: "sha256", value: row.textHash.slice(7), pipeline: "core", keyId: null, redactionVersion: 1 }] } };
}

test("isolates all memory and suppression read paths by owner and by NUL-delimited namespace", async t => {
  const opened = await withStore(t);
  const { adapter } = opened;
  const { memories, suppressions, pause, keys } = adapter;
  const row = content("shared digest");
  const first = await insert(adapter, left, row, 1, [receipt]);
  const second = await insert(adapter, right, row, 2, [receipt]);
  const third = await insert(adapter, alternate, row, 3, [receipt]);
  const query = [{ textHash: row.textHash }];
  const fact = factText(left, content("left-only denial"));

  await seedFact(adapter, fact);
  await seedFact(adapter, identity(left, "missing-target"));
  await write(adapter, left, tx => pause.set(tx, left.owner, true), { pauseLock: true });

  for (const [scope, mine, foreign, expectedEpoch, expectedPause] of [
    [left, first, [second, third], 2n, true], [right, second, [first, third], null, false],
    [alternate, third, [first, second], 2n, true],
  ]) {
    await read(adapter, scope, async tx => {
      assert.equal((await memories.get(tx, scope, mine.id)).id, mine.id);
      assert.deepEqual(await memories.readRevision(tx, scope, mine.id), { revision: 1, textHash: row.textHash });
      for (const other of foreign) {
        assert.equal(await memories.get(tx, scope, other.id), null);
        assert.equal(await memories.readRevision(tx, scope, other.id), null);
        assert.deepEqual(await suppressions.factsFor(tx, scope, { memoryId: other.id }), []);
      }

      const duplicates = await memories.findDuplicates(tx, scope, query, near);
      assert.deepEqual(duplicates[0].map(match => match.id), [mine.id]);
      const policy = await memories.readWritePolicy(tx, scope,
        [...query, { textHash: "sha256:" + fact.text.digests[0].value }], source, "full");
      assert.deepEqual(policy.matches.map(group => group.map(match => match.id)), [[mine.id], []]);
      assert.deepEqual(policy.blockedPositions, scope === left ? [1] : []);
      assert.deepEqual(policy.hiddenIds, []);

      const page = await memories.exportPage(tx, scope, { cursor: null, limit: 1 });
      assert.deepEqual(page.items.map(item => item.id), [mine.id]);
      assert.equal(page.nextCursor, null);
      const snapshot = await suppressions.snapshot(tx, scope, {});
      assert.deepEqual(snapshot.passages.map(({ fact }) => fact.actionId), scope === left ? ["fixture-text"] : []);
      const facts = await suppressions.factsFor(tx, scope, { memoryId: "missing-target" });
      assert.deepEqual(facts.map(({ fact }) => fact.owner), scope === left ? [left.owner] : []);
      assert.equal(await suppressions.epoch(tx, scope.owner), expectedEpoch);
      assert.deepEqual(await pause.get(tx, scope.owner), { paused: expectedPause, generation: Number(expectedPause) });
      assert.equal(await keys.userKey(scope.owner), null);
    }, { pauseLock: true });
    for (const other of foreign) {
      assert.deepEqual(await testAccess(opened, scope, {}, db => readReceipts(db, scope, other.id)), []);
    }
  }
  await read(adapter, right, async tx => {
    await assert.rejects(memories.exportPage(tx, left, { cursor: null, limit: 1 }), { code: "internal_error" });
    await assert.rejects(suppressions.epoch(tx, left.owner), { code: "internal_error" });
    await assert.rejects(suppressions.snapshot(tx, left, {}), { code: "internal_error" });
    await assert.rejects(suppressions.factsFor(tx, left, { memoryId: first.id }), { code: "internal_error" });
    await assert.rejects(pause.get(tx, left.owner), { code: "internal_error" });
  }, { pauseLock: true });
});

test("tombstones remove text, hashes and evidence and hide rows after a committed forget", async t => {
  const opened = await withStore(t);
  const { adapter } = opened;
  const { memories, suppressions } = adapter;
  const row = content("memory to forget");
  const keep = await insert(adapter, left, content("keep"), 3);
  const forgotten = await insert(adapter, left, row, 2, [receipt]);
  const survivor = await insert(adapter, left, content("survivor"), 1);
  const other = await insert(adapter, right, row, 2, [receipt]);
  const first = await read(adapter, left, tx => memories.exportPage(tx, left, { cursor: null, limit: 1 }));
  assert.deepEqual(first.items.map(item => item.id), [keep.id]);
  assert.ok(first.nextCursor);
  const fact = factText(left, row);
  const incarnation = sha256("fixture-forget");
  await write(adapter, left, async tx => {
    await suppressions.writeFact(tx, fact, incarnation);
    assert.equal(await memories.erase(tx, left, forgotten.id), true);
    assert.equal(await memories.erase(tx, left, forgotten.id), false);
  });

  await read(adapter, left, async tx => {
    assert.equal(await memories.get(tx, left, forgotten.id), null);
    assert.equal(await memories.readRevision(tx, left, forgotten.id), null);
    const query = [{ textHash: row.textHash }];
    assert.deepEqual(await memories.findDuplicates(tx, left, query, near), [[]]);
    assert.deepEqual(await memories.readWritePolicy(tx, left, query, source, "hash"), {
      matches: [[]], hiddenIds: [], blockedPositions: [0], blockedSession: false,
    });
    const page = await memories.exportPage(tx, left, { cursor: first.nextCursor, limit: 1 });
    assert.deepEqual(page.items.map(item => item.id), [survivor.id]);
    assert.equal(page.nextCursor, null);
    const snapshot = await suppressions.snapshot(tx, left, {});
    assert.deepEqual(snapshot.passages.map(({ fact }) => fact.text.digests), [fact.text.digests]);
    assert.deepEqual(await suppressions.factsFor(tx, left, { memoryId: forgotten.id }), []);
    assert.equal(await suppressions.epoch(tx, left.owner), 1n);
  });
  await read(adapter, right, async tx => {
    assert.equal((await memories.get(tx, right, other.id)).text, row.text);
    assert.deepEqual((await memories.findDuplicates(tx, right, [{ textHash: row.textHash }], near))[0]
      .map(match => match.id), [other.id]);
  });
  await testAccess(opened, left, {}, db => {
    assert.deepEqual(readReceipts(db, left, forgotten.id), []);
    const record = db.prepare(`SELECT deleted, body, text_hash, legacy_hash, revision FROM cairn_memories
      WHERE owner_id = ? AND namespace_key = ? AND id = ?`).get(...scopeKey(left), forgotten.id);
    assert.deepEqual({ ...record }, { deleted: 1, body: null, text_hash: null, legacy_hash: null, revision: 2 });
  });
});

test("by-ID and revision reads resolve live rows hidden from duplicates and exports", async t => {
  const { adapter } = await withStore(t);
  const { memories, suppressions } = adapter;
  const row = content("suppressed passages");
  const hidden = await insert(adapter, left, row, 3);
  const sourceHidden = await insert(adapter, left, content("suppressed source"), 2, [receipt]);
  const sourceOther = await insert(adapter, left, content("retained source"), 1, [{ ...receipt, sessionId: "other" }]);
  const sameDigest = await insert(adapter, right, row, 3);
  await seedFact(adapter, factText(left, row));
  const sessionKeyHash = adapter.hashSessionKey(left, receipt.client, receipt.sessionId);
  await seedFact(adapter, { ...left, kind: "session", origin: "forget", actionId: "fixture-session",
    session: { client: receipt.client, sessionKeyHash } });
  assert.notEqual(adapter.hashSessionKey(right, receipt.client, receipt.sessionId), sessionKeyHash);
  assert.notEqual(adapter.hashSessionKey(alternate, receipt.client, receipt.sessionId), sessionKeyHash);

  await read(adapter, left, async tx => {
    for (const [id, textHash, reason] of [[hidden.id, row.textHash, "text"],
      [sourceHidden.id, content("suppressed source").textHash, "session"]]) {
      assert.equal((await memories.get(tx, left, id)).textHash, textHash);
      assert.deepEqual(await memories.readRevision(tx, left, id), { revision: 1, textHash });
      const query = [{ textHash }];
      assert.deepEqual(await memories.findDuplicates(tx, left, query, near), [[]]);
      // Write policy intentionally reports hidden match IDs to let Core refuse dedupe.
      const policy = await memories.readWritePolicy(tx, left, query, source, "full");
      assert.deepEqual(policy.hiddenIds, [id]);
      assert.deepEqual(Object.keys(policy.matches[0][0]).sort(), ["distance", "id", "kind", "match", "revision", "writeTimeUs"]);
      assert.deepEqual((await suppressions.factsFor(tx, left, { memoryId: id })).map(({ fact }) => fact.kind), [reason]);
    }
    const page = await memories.exportPage(tx, left, { cursor: null, limit: 1 });
    assert.deepEqual(page.items.map(item => item.id), [sourceOther.id]);
    assert.equal(page.nextCursor, null);
  });
  assert.equal((await read(adapter, right, tx => memories.get(tx, right, sameDigest.id))).text, row.text);
});

test("matches stored canonical hashes and preserves legacy denial evidence in scope", async t => {
  const opened = await withStore(t);
  const { adapter } = opened;
  const { memories, suppressions } = adapter;
  const raw = "Synthetic ＦＩＸＴＵＲＥ text";
  const [canonical] = await allDigests(raw);
  const legacy = await engineLegacyDigest(raw);
  // Use a separate normalized display and a supplied legacy alias, as a migration can.
  const row = content("normalized display text", {
    textHash: "sha256:" + canonical.value,
    digests: [{ ...legacy, value: sha256("historical fingerprint") }],
  });
  const kept = await insert(adapter, left, row, 1);
  const similarlyNamed = await insert(adapter, right, row, 1);
  const legacyQuery = [{ textHash: "sha256:" + row.digests[0].value }];
  const canonicalQuery = [{ textHash: row.textHash }];
  await read(adapter, left, async tx => {
    const [matches] = await memories.findDuplicates(tx, left, legacyQuery, near);
    assert.deepEqual(matches, []);
    const aliasOnly = [{ textHash: "sha256:" + sha256("different normalize"), legacyHash: row.textHash }];
    assert.equal((await memories.findDuplicates(tx, left, aliasOnly, near))[0][0].id, kept.id);
    assert.deepEqual(await memories.findDuplicates(tx, left, canonicalQuery, { ...near, excludeId: kept.id }), [[]]);
  });
  await testAccess(opened, left, { write: true }, db => {
    db.prepare("INSERT INTO cairn_legacy_denials VALUES (?, ?, ?)").run(...scopeKey(left), row.digests[0].value);
  });
  await read(adapter, left, async tx => {
    assert.equal((await memories.get(tx, left, kept.id)).text, row.text);
    assert.deepEqual(await memories.readRevision(tx, left, kept.id), { revision: 1, textHash: row.textHash });
    assert.deepEqual(await memories.findDuplicates(tx, left, canonicalQuery, near), [[]]);
    assert.deepEqual(await memories.exportPage(tx, left, { cursor: null, limit: 1 }), { items: [], nextCursor: null });
    assert.deepEqual((await memories.readWritePolicy(tx, left, canonicalQuery, source, "hash")).hiddenIds, [kept.id]);
    assert.deepEqual((await memories.readWritePolicy(tx, left, legacyQuery, source, "hash")).blockedPositions, [0]);
    assert.equal(await suppressions.factsFor(tx, left, { memoryId: kept.id }), "ineligible");
    await assert.rejects(suppressions.snapshot(tx, left,
      { passages: [{ digests: row.digests, keyId: null, shingles: null }] }), { code: "ineligible" });
    assert.equal(await suppressions.epoch(tx, left.owner), null);
  });
  assert.equal((await read(adapter, right, tx => memories.get(tx, right, similarlyNamed.id))).text, row.text);
});

test("reads both receipt denial forms while isolating their scope", async t => {
  const opened = await withStore(t);
  const { adapter } = opened;
  const { memories } = adapter;
  const oldKey = sha256("legacy receipt");
  const address = sha256(JSON.stringify(["receipt-source-address-v1", receipt.client, receipt.sessionId,
    receipt.messageId, receipt.role]));
  const addressRow = await insert(adapter, left, content("denied address"), 1, [receipt]);
  const byKey = await insert(adapter, left, content("denied receipt key"), 2, [{ ...receipt, messageId: "newer-message" }]);
  const rightRow = await insert(adapter, right, content("retained receipt"), 1, [receipt]);
  await testAccess(opened, left, { write: true }, db => {
    db.prepare("UPDATE cairn_receipts SET legacy_receipt_key = ? WHERE owner_id = ? AND namespace_key = ? AND memory_id = ?")
      .run(oldKey, ...scopeKey(left), byKey.id);
    const insert = db.prepare("INSERT INTO cairn_legacy_denials VALUES (?, ?, ?)");
    insert.run(...scopeKey(left), "rs1:i:" + oldKey);
    insert.run(...scopeKey(left), "rs1:a:" + address);
  });
  await read(adapter, left, async tx => {
    assert.equal((await memories.get(tx, left, addressRow.id)).text, "denied address");
    assert.equal((await memories.get(tx, left, byKey.id)).text, "denied receipt key");
    assert.deepEqual(await memories.exportPage(tx, left, { cursor: null, limit: 1 }), { items: [], nextCursor: null });
  });
  assert.equal((await read(adapter, right, tx => memories.get(tx, right, rightRow.id))).text, "retained receipt");
});

test("orders exact microseconds and UTF-8 ID ties, including beyond safe JS integers", async t => {
  const opened = await withStore(t);
  const { adapter } = opened;
  const row = content("identical key");
  const time = 9007199254740990999n;
  const fixtures = [["supplementary-😀", time], ["supplementary-\uE000", time], ["newest", time + 1n]];
  for (const [id, sortKey] of fixtures) {
    const saved = await insert(adapter, left, row, 1);
    await testAccess(opened, left, { write: true }, db => db.prepare(`UPDATE cairn_memories SET id = ?
      WHERE owner_id = ? AND namespace_key = ? AND id = ?`).run(id, ...scopeKey(left), saved.id));
    await setWriteTime(opened, left, id, sortKey);
  }
  const expected = [fixtures[2], fixtures[0], fixtures[1]];
  const { memories } = adapter;
  await read(adapter, left, async tx => {
    const [matches] = await memories.findDuplicates(tx, left, [{ textHash: row.textHash }], near);
    assert.deepEqual(matches.map(({ id, writeTimeUs }) => [id, writeTimeUs]), expected);
    let cursor = null;
    for (const [index, target] of expected.entries()) {
      const page = await memories.exportPage(tx, left, { cursor, limit: 1 });
      assert.deepEqual(page.items.map(({ id, updatedAtUs }) => [id, updatedAtUs]), [target]);
      cursor = page.nextCursor;
      assert.equal(cursor, index === expected.length - 1 ? null :
        Buffer.from(JSON.stringify([target[1].toString(), target[0]])).toString("base64url"));
    }
  });
});

test("rolls back memory and pause together if a caught write conflict poisons a pause-locked run", async t => {
  const { adapter } = await withStore(t);
  const { memories, pause, suppressions } = adapter;
  const first = content("conflict source");
  const second = content("conflict target");
  const one = await insert(adapter, left, first, 1);
  await insert(adapter, left, second, 2);
  const sentinel = new CoreError("memory_conflict");

  await assert.rejects(write(adapter, left, async tx => {
    await pause.set(tx, left.owner, true);
    assert.equal((await pause.get(tx, left.owner)).paused, true);
    await assert.rejects(memories.replaceContent(tx, left, one.id, 1, second, null, 3), { code: sentinel.code });
    await suppressions.writeFact(tx, identity(left, one.id), sha256("fixture-fact"));
    await memories.erase(tx, left, one.id);
  }, { pauseLock: true }), { code: sentinel.code });
  await read(adapter, left, async tx => {
    assert.deepEqual(await pause.get(tx, left.owner), { paused: false, generation: 0 });
    assert.equal((await memories.get(tx, left, one.id)).text, first.text);
    assert.equal(await suppressions.epoch(tx, left.owner), null);
  }, { pauseLock: true });
});

test("fresh file metadata, facts, pause, and hashed fences survive factory reopen", async t => {
  const { path, remove } = scratch();
  t.after(remove);
  const initial = await openSqliteAdapter(path);
  const row = content("retained across restarts");
  let saved;
  try {
    saved = await insert(initial, left, row, 1, [receipt]);
    const sessionKeyHash = initial.hashSessionKey(left, receipt.client, receipt.sessionId);
    await seedFact(initial, { ...left, kind: "session", origin: "forget", actionId: "hashed-fence",
      session: { client: receipt.client, sessionKeyHash } });
    await write(initial, left, tx => initial.pause.set(tx, left.owner, true), { pauseLock: true });
  } finally {
    await initial.close();
  }
  const reopened = await openSqliteAdapter(path);
  try {
    await read(reopened, left, async tx => {
      assert.equal((await reopened.memories.get(tx, left, saved.id)).text, row.text);
      assert.deepEqual(await reopened.memories.exportPage(tx, left, { cursor: null, limit: 1 }), { items: [], nextCursor: null });
      assert.equal(await reopened.suppressions.epoch(tx, left.owner), 1n);
      assert.deepEqual(await reopened.pause.get(tx, left.owner), { paused: true, generation: 1 });
    }, { pauseLock: true });
    assert.equal(reopened.capabilities.rawSpans, true);
    for (const flag of ["rawArchive", "rawWindowHide", "sessionLineage", "spanLineage", "fingerprintKey",
      "semanticRetrieval", "nearDuplicate", "shingleSuppression", "vectorSuppression"]) {
      assert.equal(reopened.capabilities[flag], false);
    }
  } finally {
    await reopened.close();
  }
});

test("refuses an inventoried legacy file before changing its database bytes", async t => {
  const { path } = await legacyFixture(legacyScratch(t), 29);
  const inventory = inventoryLegacyStore(path);
  const before = readFileSync(path);
  await assert.rejects(openSqliteAdapter(path), { code: "storage_error" });
  assert.deepEqual(readFileSync(path), before);
  assert.deepEqual(inventoryLegacyStore(path), inventory);
  const legacySuccessor = LEGACY_RULES.firstPossibleSuccessor;
  assert.doesNotThrow(() => assertForwardTarget(inventory.physical, legacySuccessor));
  assert.throws(() => assertLegacyOpen({ ...inventory, physical: legacySuccessor }, inventory),
    { name: "LegacyRefusal", code: "legacy_downgrade" });
});

test("serving storage uses SQLite for file data", async () => {
  // This check catches accidental first-party use. Deliberate evasion is out
  // of scope. Offline legacy inspection has a separate raw-fd boundary.
  const { readdirSync } = await import("node:fs");
  const { parse } = await import("../../../tools/testing/vendor/acorn/acorn.mjs");
  const directory = new URL("../src/", import.meta.url);
  const allowedMetadata = new Set(["chmodSync", "realpathSync", "statSync"]);
  const fsModule = /^(?:node:)?fs(?:\/.*)?$/u;
  const files = readdirSync(directory, { recursive: true })
    .filter(path => path.endsWith(".mjs") && !path.startsWith("legacy/"));
  assert.ok(files.includes("schema/open.mjs"));
  for (const path of files) {
    const text = readFileSync(new URL(path, directory), "utf8");
    const tree = parse(text, { ecmaVersion: "latest", sourceType: "module" });
    const modules = tree.body.filter(node => typeof node.source?.value === "string" && fsModule.test(node.source.value));
    for (const node of modules) {
      assert.equal(node.type, "ImportDeclaration", path);
      assert.ok(node.specifiers.length && node.specifiers.every(specifier =>
        specifier.type === "ImportSpecifier" && allowedMetadata.has(specifier.imported.name)), path);
      if (node.source.value !== "node:fs") assert.fail(path);
    }
    // Catch ordinary dynamic loaders in the serving adapter too.
    assert.doesNotMatch(text, /\b(?:import|require|getBuiltinModule)\s*\(\s*['"`](?:node:)?fs\b/u, path);
  }
});
