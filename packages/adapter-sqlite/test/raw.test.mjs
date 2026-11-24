import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { coreDigest, factIncarnationBody, validateSuppressionFact } from "@cairn-ink/core";
import { listRawMessagesMethod } from "../../core/src/service/reads.mjs";
import { openSqliteAdapter } from "../src/adapter.mjs";
import { fixture, scratch, sha256, testAccess } from "./storage-fixtures.mjs";

const personal = { owner: "fixture-owner", namespace: null };
const project = { ...personal, namespace: "project\0synthetic" };
const other = { ...personal, owner: "second-owner" };
const session = { client: "fixture-client", sessionId: "fixture-conversation" };
const query = "garden";
const message = (id, content = "synthetic garden message") => ({ id, content, role: "user", occurredAtMs: 10 });
const key = (scope, eventId, source = session) => ({ scope, ...source, eventId, payloadDigest: "a".repeat(64) });
const readSet = scope => ({ owner: scope.owner, namespaces: [scope.namespace] });
const write = (adapter, scope, body) => adapter.uow.run(scope.owner, { pauseLock: true }, body);
const read = (adapter, scope, body) => adapter.uow.run(scope.owner, { readOnly: true }, body);
const page = (adapter, scope, limit = 20, cursor = null) =>
  read(adapter, scope, tx => adapter.raw.listRaw(tx, readSet(scope), { limit, cursor }));

async function withStore(t) {
  const opened = await fixture();
  t.after(opened.close);
  return opened;
}

async function exactFact(scope, content) {
  return { ...scope, kind: "text", mode: "exact", origin: "forget", actionId: "fixture-forget",
    text: { digests: [await coreDigest(content)] } };
}

async function persist(adapter, tx, fact) {
  const incarnation = sha256(factIncarnationBody(fact));
  const stored = await adapter.suppressions.writeFact(tx, fact, incarnation);
  return { ...stored, fact, incarnation };
}

function inspectTables(opened) {
  return testAccess(opened, personal, {}, db =>
    db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all()
      .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}"`).all()]));
}

test("Raw listing, search, final delivery and removal are scoped by owner and namespace", async t => {
  const { adapter } = await withStore(t);
  const listRawMessages = listRawMessagesMethod(adapter);
  const scopes = [personal, project, other];
  const refs = [];
  for (const [index, scope] of scopes.entries()) {
    const source = key(scope, `event-${index}`);
    await write(adapter, scope, tx => adapter.raw.archive(tx, source, [
      message("same-id", `garden item ${index}`), message("next-id", `garden next ${index}`),
    ]));
    refs.push((await page(adapter, scope)).items[0].ref);
  }

  for (const [index, scope] of scopes.entries()) {
    const selection = readSet(scope);
    const result = await page(adapter, scope, 1);
    assert.ok(result.nextCursor);
    assert.equal(result.items[0].ref.id, refs[index].id);
    for (const foreign of scopes.filter(candidate => candidate !== scope)) {
      await assert.rejects(page(adapter, foreign, 1, result.nextCursor), { code: "cursor_stale" });
    }
    const remaining = await page(adapter, scope, 1, result.nextCursor);
    assert.equal(remaining.items.length, 1);
    assert.equal(remaining.nextCursor, null);

    const fromFacade = await listRawMessages(scope, { limit: 20 });
    assert.deepEqual(fromFacade.items, (await page(adapter, scope)).items);
    await read(adapter, scope, async tx => {
      const found = await adapter.raw.raw(tx, selection, query, "search", { limit: 20 });
      assert.deepEqual(found.segments.map(item => item.content).sort(), [`garden item ${index}`, `garden next ${index}`]);
      assert.deepEqual(await adapter.fence.assertVisible(tx, selection, refs), [refs[index]]);
      const relabeled = refs.map(ref => ({ ...ref, namespace: scope.namespace }));
      assert.deepEqual(await adapter.fence.assertVisible(tx, selection, relabeled), [refs[index]]);
    });
  }

  await write(adapter, personal, async tx => {
    assert.equal(await adapter.suppressions.epoch(tx, personal.owner), null);
    await adapter.raw.fenceSession(tx, personal, session);
    await adapter.raw.fenceSession(tx, personal, session);
    assert.equal(await adapter.suppressions.epoch(tx, personal.owner), 1n);
    assert.equal(await adapter.raw.archiveAllowed(tx, key(personal, "fenced")), false);
    assert.deepEqual(await adapter.raw.deleteConversation(tx, personal, session), { rawDeleted: 2 });
    assert.deepEqual(await adapter.raw.deleteConversation(tx, personal, session), { rawDeleted: 0 });
  });

  assert.deepEqual((await listRawMessages(personal)).items, []);
  for (const scope of [project, other]) {
    assert.equal((await page(adapter, scope)).items.length, 2);
    assert.equal(await read(adapter, scope, tx => adapter.raw.archiveAllowed(tx, key(scope, "allowed"))), true);
  }
  await assert.rejects(read(adapter, other, tx => adapter.raw.listRaw(tx, readSet(personal), { limit: 20, cursor: null })),
    { code: "internal_error" });
});

test("fork proofs survive reopen and only affect the same owner and client", async t => {
  const { path, remove } = scratch();
  t.after(remove);
  const root = key(project, "record");
  const batch = [message("anchor"), message("turn", "a new thought")];
  const first = await openSqliteAdapter(path);
  try {
    await write(first, project, async tx => {
      await first.raw.recordLineage(tx, root, [batch[0]]);
      await first.raw.fenceSession(tx, project, root);
    });
  } finally {
    await first.close();
  }

  const adapter = await openSqliteAdapter(path);
  t.after(() => adapter.close());
  const fork = key(personal, "fork", { ...session, sessionId: "different-conversation" });
  const foreignOwner = { ...fork, scope: other };
  const foreignClient = { ...fork, client: "second-client" };
  for (const [source, expected] of [[fork, []], [foreignOwner, [0, 1]], [foreignClient, [0, 1]]]) {
    const { scope } = source;
    assert.deepEqual(await read(adapter, scope, tx => adapter.capture.eligible(tx, source, batch)), expected);
    await write(adapter, scope, async tx => {
      assert.equal((await adapter.capture.claim(tx, source, batch, { leaseMs: 100_000 })).status, "claimed");
    });
    const recheck = () => write(adapter, scope, tx => adapter.capture.assertEligible(tx, source, [1]));
    if (expected.length) await recheck();
    else await assert.rejects(recheck(), { code: "lineage_fenced" });
  }
  assert.equal(await read(adapter, personal, tx => adapter.raw.archiveAllowed(tx, fork)), true);
});

test("text purge scrubs archive and outbox atomically, including outbox-only matches", async t => {
  const opened = await withStore(t);
  const { adapter } = opened;
  const secret = "quartz marmalade orchid";
  const hidden = message("hidden", secret);
  const batch = [hidden, message("outbox-only", secret), message("survivor")];
  const sources = [key(personal, "primary"), key(project, "project"), key(other, "other")];
  for (const source of sources) {
    await write(adapter, source.scope, async tx => {
      await adapter.capture.admit(tx, source, batch);
      await adapter.raw.recordLineage(tx, source, batch);
      await adapter.raw.archive(tx, source, [hidden, batch[2]]);
    });
  }

  const fact = await exactFact(personal, secret);
  const purge = () => write(adapter, personal, async tx => {
    const stored = await persist(adapter, tx, fact);
    return adapter.raw.purgeWithheld(tx, personal, [stored]);
  });

  const before = await inspectTables(opened);
  await testAccess(opened, personal, { write: true }, db => db.exec(`
    CREATE TRIGGER reject_scrub BEFORE UPDATE OF messages ON cairn_capture_outbox
    BEGIN SELECT RAISE(ABORT, 'fixture failure'); END
  `));
  await assert.rejects(purge);
  assert.deepEqual(await inspectTables(opened), before);
  await testAccess(opened, personal, { write: true }, db => db.exec("DROP TRIGGER reject_scrub"));

  assert.deepEqual(await purge(), { rawDeleted: 1, ledgerBlanked: 2 });
  assert.deepEqual(await purge(), { rawDeleted: 0, ledgerBlanked: 0 });
  const stored = await read(adapter, personal, tx => adapter.capture.load(tx, sources[0]));
  assert.deepEqual(stored.messages, [{ ...hidden, content: "" }, { ...batch[1], content: "" }, batch[2]]);
  const search = await read(adapter, personal, tx => adapter.raw.raw(tx, readSet(personal), secret, "search", { limit: 20 }));
  assert.deepEqual(search.segments, []);
  assert.deepEqual((await page(adapter, personal)).items.map(({ messageId }) => messageId), ["survivor"]);
  for (const source of sources.slice(1)) {
    assert.deepEqual((await read(adapter, source.scope, tx => adapter.capture.load(tx, source))).messages, batch);
    assert.deepEqual((await page(adapter, source.scope)).items.map(({ messageId }) => messageId), ["hidden", "survivor"]);

    // Clear the control scopes before the table-wide and file-wide checks.
    await write(adapter, source.scope, tx => adapter.raw.deleteConversation(tx, source.scope, source));
  }
  for (const [table, rows] of await inspectTables(opened)) {
    assert.ok(!JSON.stringify(rows).includes(secret), `Retained plaintext in ${table}`);
  }
  await adapter.close();
  assert.equal(readFileSync(opened.path).includes(Buffer.from(secret)), false);
});

test("resolved UTF-16 span facts hide every dependent memory within their scope", async t => {
  const { adapter } = await withStore(t);
  const memory = async (scope, text, receipts) => {
    const { value } = await coreDigest(text);
    return write(adapter, scope, tx =>
      adapter.memories.insert(tx, scope, { kind: "fact", origin: "inferred", text,
        textHash: "sha256:" + value, confidence: 0.9, embedding: null,
        source: { kind: "capture", ...session } }, receipts, 20));
  };
  const original = message("shared", "garden 🌱");
  const unrelated = message("unrelated");
  const receipt = ({ id, role, occurredAtMs }) => ({ ...session, messageId: id, role, occurredAtMs });
  const [sourceReceipt, otherReceipt] = [receipt(original), receipt(unrelated)];
  for (const [index, scope] of [personal, project, other].entries()) {
    await write(adapter, scope, tx => adapter.raw.archive(tx, key(scope, `span-${index}`), [original, unrelated]));
  }

  const forgotten = await memory(personal, "garden root", [sourceReceipt]);
  const dependent = await memory(personal, "garden dependent", [otherReceipt, sourceReceipt]);
  const control = await memory(personal, "garden control", [otherReceipt]);
  const external = await Promise.all([project, other].map(scope => memory(scope, "garden dependent", [sourceReceipt])));
  const dangling = await memory(personal, "missing receipt source", [{ ...otherReceipt, messageId: "missing" }]);
  const unproven = await memory(personal, "no receipt source", []);

  const resolve = (scope, id) => read(adapter, scope, tx => adapter.spanLineage.resolveSpans(tx, scope, id));
  for (const scope of [project, other]) {
    await assert.rejects(resolve(scope, forgotten.id), { code: "raw_lineage_unavailable" });
  }
  assert.deepEqual(await resolve(personal, dangling.id), []);
  await assert.rejects(resolve(personal, unproven.id), { code: "raw_lineage_unavailable" });

  const [span] = await resolve(personal, forgotten.id);
  assert.deepEqual(validateSuppressionFact(span), { ...personal, kind: "rawSpan", origin: "forget", actionId: forgotten.id,
    sessionKeyHash: adapter.hashSessionKey(personal, session.client, session.sessionId), messageKey: original.id,
    startUtf16: 0, endUtf16: original.content.length, contentDigest: sha256(original.content) });
  await write(adapter, personal, async tx => {
    const spans = await adapter.spanLineage.resolveSpans(tx, personal, forgotten.id);
    for (const fact of spans) await persist(adapter, tx, fact);
    assert.equal(await adapter.memories.erase(tx, personal, forgotten.id), true);
  });

  for (const [scope, shown] of [[personal, control], [project, external[0]], [other, external[1]]]) {
    const selection = readSet(scope);
    const refs = [dependent, shown].map(({ id }) => ({ type: "memory", namespace: scope.namespace, id }));
    const lexical = await read(adapter, scope, async tx => {
      const visible = await adapter.fence.assertVisible(tx, selection, refs);
      assert.deepEqual(visible, [refs[1]]);
      const hydrated = await adapter.hydrate.hydrate(tx, selection, refs, "read");
      assert.deepEqual(hydrated.map(({ ref }) => ref), [refs[1]]);
      return adapter.lexical.lexical(tx, selection, "garden", 20);
    });
    assert.deepEqual(lexical.rows.map(({ ref }) => ref.id), [shown.id]);
  }
  const candidate = key(personal, "replay-span");
  assert.deepEqual(await read(adapter, personal, tx => adapter.capture.eligible(tx, candidate, [original, unrelated])), [1]);
  assert.deepEqual((await page(adapter, personal)).items.map(({ messageId }) => messageId), ["unrelated"]);
});
