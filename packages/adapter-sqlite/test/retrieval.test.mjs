import assert from "node:assert/strict";
import test from "node:test";
import { factIncarnationBody, PRIVACY_REDACTION_VERSIONS } from "@cairn-ink/core";
import { recallMethod } from "../../core/src/service/recall.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { scopeKey } from "../src/storage-values.mjs";
import { fixture, scratch, setWriteTime, sha256, testAccess } from "./storage-fixtures.mjs";

const personal = { owner: "reader-one", namespace: null };
const project = { ...personal, namespace: "project\0notes" };
const foreign = { ...personal, owner: "reader-two" };
const view = { owner: personal.owner, namespaces: [null] };
const recentPage = { cursor: null, limit: 1 };
const receipt = { client: "terminal", sessionId: "session", messageId: "message", role: "user", occurredAtMs: 14 };

const read = (adapter, scope, fn) => adapter.uow.run(scope.owner, { readOnly: true }, fn);
const textHash = text => "sha256:" + sha256(text);

async function store(adapter, scope, text, time, { receipts = [], client = null } = {}) {
  const row = { text, textHash: textHash(text), kind: "fact", origin: "explicit",
    confidence: 1, source: { kind: "mcp", client, sessionId: null }, embedding: null };
  const { id } = await adapter.uow.run(scope.owner, {}, tx => adapter.memories.insert(tx, scope, row, receipts, time));
  return { type: "memory", id, namespace: scope.namespace };
}

function setId(opened, scope, ref, id) {
  return testAccess(opened, scope, { write: true }, db => {
    assert.equal(db.prepare(`UPDATE cairn_memories SET id = ?
      WHERE owner_id = ? AND namespace_key = ? AND id = ?`).run(id, ...scopeKey(scope), ref.id).changes, 1);
    return { ...ref, id };
  });
}

function forgetText(adapter, scope, ref, text) {
  const fact = { ...scope, kind: "text", mode: "exact", origin: "forget", actionId: "forget-note",
    text: { digests: [{ alg: "sha256", value: sha256(text), pipeline: "core",
      redactionVersion: PRIVACY_REDACTION_VERSIONS.core, keyId: null }] } };
  const incarnation = sha256(factIncarnationBody(fact));
  return adapter.uow.run(scope.owner, { pauseLock: true }, async tx => {
    await adapter.suppressions.writeFact(tx, fact, incarnation);
    assert.equal(await adapter.memories.erase(tx, scope, ref.id), true);
  });
}

test("scopes lexical candidates, recent, hydration and fence by owner and namespace", async t => {
  const { adapter, close } = await fixture();
  t.after(close);
  const local = await store(adapter, personal, "orchard personal", 10, { receipts: [receipt] });
  const inProject = await store(adapter, project, "orchard project", 20);
  const inForeign = await store(adapter, foreign, "orchard private", 30);
  const refs = [inForeign, inProject, local];

  await read(adapter, view, async tx => {
    assert.deepEqual((await adapter.lexical.lexical(tx, view, "orchard", 10, {})).rows.map(r => r.ref), [local]);
    const page = await adapter.recent.recent(tx, view, recentPage);
    assert.deepEqual(page.items.map(row => row.id), [local.id]);
    assert.equal(page.nextCursor, null);
    const hydrated = await adapter.hydrate.hydrate(tx, view, refs, "read");
    assert.deepEqual(hydrated.map(r => r.ref), [local]);
    assert.deepEqual(hydrated[0].receipts, [receipt]);
    assert.deepEqual(hydrated[0].sourceDates, { firstMs: 14, lastMs: 14 });
    assert.deepEqual(await adapter.fence.assertVisible(tx, view, refs), [local]);

    const both = { ...view, namespaces: [project.namespace, null] };
    assert.deepEqual(await adapter.fence.assertVisible(tx, both, refs), [inProject, local]);
    assert.deepEqual((await adapter.lexical.lexical(tx, both, "orchard", 10, {})).rows.map(r => r.ref),
      [local, inProject]);
  });

  const otherView = { ...view, owner: foreign.owner };
  await read(adapter, otherView, async tx => {
    assert.deepEqual((await adapter.lexical.lexical(tx, otherView, "orchard", 10, {})).rows.map(r => r.ref), [inForeign]);
    assert.deepEqual((await adapter.recent.recent(tx, otherView, recentPage)).items.map(row => row.id), [inForeign.id]);
    assert.deepEqual((await adapter.hydrate.hydrate(tx, otherView, refs, "read")).map(r => r.ref), [inForeign]);
    assert.deepEqual(await adapter.fence.assertVisible(tx, otherView, refs), [inForeign]);
    for (const call of [
      () => adapter.lexical.lexical(tx, view, "orchard", 10, {}),
      () => adapter.recent.recent(tx, view, recentPage),
      () => adapter.hydrate.hydrate(tx, view, refs, "read"),
      () => adapter.fence.assertVisible(tx, view, refs),
      () => adapter.snapshot.stateToken(tx, view),
      () => adapter.snapshot.assertUnchanged(tx, view, ""),
    ]) await assert.rejects(call(), { code: "internal_error" });

    // A caller-owned getter cannot substitute an owner after the Tx check.
    const changingOwner = () => {
      let first = true;
      return {
        namespaces: [null],
        get owner() {
          if (!first) return personal.owner;
          first = false;
          return foreign.owner;
        },
      };
    };
    assert.deepEqual(await adapter.fence.assertVisible(tx, changingOwner(), refs), [inForeign]);
    assert.deepEqual((await adapter.hydrate.hydrate(tx, changingOwner(), refs, "read")).map(r => r.ref), [inForeign]);
    assert.deepEqual((await adapter.lexical.lexical(tx, changingOwner(), "orchard", 10, {})).rows.map(r => r.ref),
      [inForeign]);
    assert.deepEqual((await adapter.recent.recent(tx, changingOwner(), recentPage)).items.map(row => row.id), [inForeign.id]);
    const token = await adapter.snapshot.stateToken(tx, otherView);
    assert.equal(await adapter.snapshot.stateToken(tx, changingOwner()), token);
    await adapter.snapshot.assertUnchanged(tx, changingOwner(), token);
  });
});

test("a committed forget removes erased and still-suppressed matches from every retrieval projection", async t => {
  const { adapter, close } = await fixture();
  t.after(close);
  const text = "orchard elderberry";
  const control = await store(adapter, personal, "orchard apple", 1);
  const baseline = await read(adapter, view, tx => adapter.lexical.lexical(tx, view, "orchard", 10, {}));
  const duplicate = await store(adapter, personal, text, 2);
  const erased = await store(adapter, personal, text, 3, { receipts: [receipt] });
  const refs = [erased, duplicate, control];
  const before = await read(adapter, view, async tx => {
    assert.equal((await adapter.lexical.lexical(tx, view, "elderberry", 10, {})).rows.length, 2);
    const first = await adapter.recent.recent(tx, view, recentPage);
    assert.deepEqual(first.items.map(row => row.id), [erased.id]);
    assert.ok(first.nextCursor);
    assert.deepEqual((await adapter.hydrate.hydrate(tx, view, refs, "recall")).map(r => r.ref), refs);
    return adapter.snapshot.stateToken(tx, view);
  });

  await forgetText(adapter, personal, erased, text);

  await read(adapter, view, async tx => {
    const lexical = await adapter.lexical.lexical(tx, view, "elderberry", 10, {});
    assert.deepEqual(lexical, { rows: [], matched: false });
    // Hidden documents must not contribute to the visible term score.
    assert.deepEqual(await adapter.lexical.lexical(tx, view, "orchard", 10, {}), baseline);
    const recent = await adapter.recent.recent(tx, view, recentPage);
    assert.deepEqual(recent.items.map(row => row.id), [control.id]);
    assert.equal(recent.nextCursor, null);
    for (const intent of ["recall", "read", "export"]) {
      const items = await adapter.hydrate.hydrate(tx, view, refs, intent);
      assert.deepEqual(items.map(item => item.ref), [control]);
      assert.deepEqual(items[0].receipts, []);
    }
    assert.deepEqual(await adapter.fence.assertVisible(tx, view, refs, "read"), [control]);
    assert.deepEqual(await adapter.memories.findDuplicates(tx, personal, [{ textHash: textHash(text) }],
      { nearDistance: 0 }), [[]]);
    await assert.rejects(adapter.snapshot.assertUnchanged(tx, view, before), { code: "cursor_stale" });
  });
});

test("legacy text and receipt denials exclude stored rows before matching and paging", async t => {
  const opened = await fixture();
  t.after(opened.close);
  const { adapter } = opened;
  const deniedText = "orchard lychee";
  const visible = await store(adapter, personal, "orchard apple", 1);
  const textRef = await store(adapter, personal, deniedText, 2);
  const receiptRef = await store(adapter, personal, "orchard mulberry", 3, { receipts: [receipt] });
  const address = sha256(JSON.stringify(["receipt-source-address-v1",
    receipt.client, receipt.sessionId, receipt.messageId, receipt.role]));
  const before = await read(adapter, view, tx => adapter.snapshot.stateToken(tx, view));
  await testAccess(opened, personal, { write: true }, db => {
    const insert = db.prepare("INSERT INTO cairn_legacy_denials VALUES (?, ?, ?)");
    insert.run(...scopeKey(personal), sha256(deniedText));
    insert.run(...scopeKey(personal), "rs1:a:" + address);
  });

  await read(adapter, view, async tx => {
    const refs = [textRef, receiptRef, visible];
    assert.deepEqual((await adapter.lexical.lexical(tx, view, "orchard", 10, {})).rows.map(r => r.ref), [visible]);
    const page = await adapter.recent.recent(tx, view, recentPage);
    assert.deepEqual(page.items.map(row => row.id), [visible.id]);
    assert.equal(page.nextCursor, null);
    assert.deepEqual((await adapter.hydrate.hydrate(tx, view, refs, "export")).map(r => r.ref), [visible]);
    assert.deepEqual(await adapter.fence.assertVisible(tx, view, refs), [visible]);
    await assert.rejects(adapter.snapshot.assertUnchanged(tx, view, before), { code: "cursor_stale" });
  });
});

test("core recall rechecks visibility in a fresh snapshot after an intervening forget", async t => {
  const { adapter, close } = await fixture();
  t.after(close);
  const text = "orchard elders";
  const removed = await store(adapter, personal, text, 2);
  const kept = await store(adapter, personal, "orchard apples", 1);
  let reads = 0;
  const storage = { ...adapter, uow: {
    async run(owner, options, fn) {
      assert.equal(options.readOnly, true);
      const result = await adapter.uow.run(owner, options, fn);
      if (++reads === 1) await forgetText(adapter, personal, removed, text);
      return result;
    },
  } };
  const recall = recallMethod({ storage, clock: { sha256Hex: sha256 } });
  const result = await recall(personal, "orchard", { mode: "search", limit: 2 });
  assert.equal(reads, 2);
  assert.deepEqual(result.items.map(row => row.id), [kept.id]);
  assert.equal(result.scores.length, 1);
  assert.equal(result.nextCursor, null);
});

test("recent uses exact UTF-8 tie order and a keyset cursor across inserts", async t => {
  const opened = await fixture();
  t.after(opened.close);
  const { adapter } = opened;
  const supplementary = "\u{10000}";
  const bmp = "\uE000";
  const sameIdLaterNamespace = { ...personal, namespace: "project\0" + supplementary };
  const sameIdEarlierNamespace = { ...personal, namespace: "project\0" + bmp };
  const selection = { ...view, namespaces: [sameIdLaterNamespace.namespace, sameIdEarlierNamespace.namespace, null] };
  const time = 9_007_199_254_740_993n;

  async function insert(scope, id, sortKey = time) {
    const ref = await setId(opened, scope, await store(adapter, scope, "orchard", 1), id);
    await setWriteTime(opened, scope, id, sortKey);
    return ref;
  }

  const first = await insert(personal, supplementary);
  const second = await insert(sameIdEarlierNamespace, supplementary);
  const third = await insert(sameIdLaterNamespace, supplementary);
  const fourth = await insert(personal, bmp);
  const ids = page => page.items.map(({ id, scope }) => ({ type: "memory", id, namespace: scope.namespace }));
  const fetch = (cursor, limit) => read(adapter, selection, tx =>
    adapter.recent.recent(tx, selection, { cursor, limit }));

  const page = await fetch(null, 2);
  assert.deepEqual(ids(page), [first, second]);
  assert.equal(page.items[0].updatedAtUs, time);
  assert.equal(page.nextCursor, Buffer.from(JSON.stringify([String(time), second.id, second.namespace])).toString("base64url"));
  const formerToken = await read(adapter, selection, tx => adapter.snapshot.stateToken(tx, selection));
  await insert(personal, "newer", time + 1n);
  const last = await insert(personal, "older", time - 1n);

  const next = await fetch(page.nextCursor, 2);
  assert.deepEqual(ids(next), [third, fourth]);
  const tail = await fetch(next.nextCursor, 2);
  assert.deepEqual(ids(tail), [last]);
  assert.equal(tail.nextCursor, null);
  await read(adapter, selection, async tx => {
    await assert.rejects(adapter.snapshot.assertUnchanged(tx, selection, formerToken), { code: "cursor_stale" });
    const lexical = await adapter.lexical.lexical(tx, selection, "orchard", 10, {});
    assert.deepEqual(lexical.rows.map(row => row.ref.id), ["newer", "older", bmp, supplementary, supplementary, supplementary]);
    assert.deepEqual(lexical.rows.slice(-2).map(({ ref }) => ref), [second, third]);
  });
});

test("historical rows require read or export intent and still respect the visibility filters", async t => {
  const opened = await fixture();
  t.after(opened.close);
  const { adapter } = opened;
  const ref = await store(adapter, personal, "orchard", 10, { client: "terminal" });
  await testAccess(opened, personal, { write: true }, db => {
    db.prepare(`UPDATE cairn_memories SET historical = 1
      WHERE owner_id = ? AND namespace_key = ? AND id = ?`).run(...scopeKey(personal), ref.id);
  });

  await read(adapter, view, async tx => {
    const matches = { ...view, clients: ["terminal"], window: { sinceMs: 10, untilMs: 11 } };
    const excludes = { ...matches, window: { untilMs: 10 } };
    assert.deepEqual(await adapter.lexical.lexical(tx, matches, "orchard", 10, {}), { rows: [], matched: false });
    assert.deepEqual(await adapter.recent.recent(tx, matches, recentPage), { items: [], nextCursor: null });
    assert.deepEqual(await adapter.fence.assertVisible(tx, matches, [ref]), []);
    assert.deepEqual(await adapter.fence.assertVisible(tx, matches, [ref], "read"), [ref]);
    assert.deepEqual(await adapter.fence.assertVisible(tx, excludes, [ref], "read"), []);
    assert.deepEqual(await adapter.hydrate.hydrate(tx, matches, [ref], "recall"), []);
    for (const intent of ["read", "export"]) {
      assert.deepEqual((await adapter.hydrate.hydrate(tx, matches, [ref], intent)).map(r => r.ref), [ref]);
      assert.deepEqual(await adapter.hydrate.hydrate(tx, excludes, [ref], intent), []);
    }
  });
});

test("lexical scores and snapshot tokens survive a cold reopen", async t => {
  const file = scratch();
  t.after(file.remove);
  const capture = adapter => read(adapter, view, async tx => ({
    lexical: await adapter.lexical.lexical(tx, view, "orchard", 40, {}),
    token: await adapter.snapshot.stateToken(tx, view),
  }));
  const adapter = await openSqliteAdapter(file.path);
  let warm;
  try {
    await store(adapter, personal, "orchard orchard apple", 1);
    await store(adapter, personal, "orchard", 2);
    warm = await capture(adapter);
    assert.equal(warm.lexical.rows.length, 2);
    assert.deepEqual(await capture(adapter), warm);
  } finally {
    await adapter.close();
  }
  const reopened = await openSqliteAdapter(file.path);
  try {
    assert.deepEqual(await capture(reopened), warm);
  } finally {
    await reopened.close();
  }
});

test("receipt-only touches invalidate snapshot tokens without changing revision or sort time", async t => {
  const { adapter, close } = await fixture();
  t.after(close);
  const ref = await store(adapter, personal, "orchard", 5);
  const before = await read(adapter, view, tx => adapter.snapshot.stateToken(tx, view));
  await adapter.uow.run(personal.owner, {}, async tx => {
    const touch = await adapter.memories.touchDuplicate(tx, personal, ref.id, [receipt], { confidence: 1 }, 5);
    assert.deepEqual(touch, { outcome: "touched", revision: 1 });
  });
  await read(adapter, view, async tx => {
    await assert.rejects(adapter.snapshot.assertUnchanged(tx, view, before), { code: "cursor_stale" });
    const [item] = await adapter.hydrate.hydrate(tx, view, [ref], "read");
    assert.deepEqual(item.receipts, [receipt]);
    assert.equal(item.memory.updatedAtUs, 5000n);
  });
});
