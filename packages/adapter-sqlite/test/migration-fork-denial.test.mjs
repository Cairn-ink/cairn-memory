import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { openMemoryCore } from "../../../core/index.mjs";
import { rationaleModel } from "../../../core/testing/rationale-model.mjs";
import { rawRequest, splitRaw } from "../../../core/testing/raw-fixtures.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { fixture, scratch } from "./legacy/fixtures.mjs";
import { coreScope, createLegacyBackup, ok, personal, prepareInput, project, sha256 } from "./migration-fixtures.mjs";
import { migratedRawVisible } from "./raw-migration-fixtures.mjs";

const client = "claude-code";
const time = Date.now() - 2 * 60 * 60 * 1000;
const shared = { id: "shared-turn", role: "user", occurredAtMs: time, content: "Synthetic cedar fork witness" };
const deleted = { ...shared, id: "root-only-turn", content: "Synthetic larch deletion witness" };
const fresh = { ...shared, id: "fresh-turn", content: "Synthetic maple follow-up" };
const foreign = { ...project, ownerId: "other-synthetic-owner" };
const rootSession = "personal-root";
const copySession = "project-copy";
const key = (namespace, sessionId, eventId = sessionId, sourceClient = client) =>
  ({ scope: coreScope(namespace), client: sourceClient, sessionId, eventId, payloadDigest: sha256(eventId) });
const write = (adapter, { scope }, fn) => adapter.uow.run(scope.owner, { pauseLock: true }, fn);
const eligible = (adapter, { scope, ...source }, batch) =>
  adapter.uow.run(scope.owner, { readOnly: true }, tx => adapter.capture.eligible(tx, { scope, ...source }, batch));

async function assertForkDenial(adapter) {
  assert.deepEqual(await migratedRawVisible(adapter, [personal]), []);
  assert.deepEqual(await migratedRawVisible(adapter, [project]), [
    { namespace: coreScope(project).namespace, messageId: shared.id, content: shared.content },
  ]);
  for (const [scope, expected] of [[project, []], [personal, []], [foreign, [0, 1]]]) {
    assert.deepEqual(await eligible(adapter, key(scope, "fresh-fork"), [shared, fresh]), expected,
      `fresh fork in ${scope.ownerId}/${scope.scope}`);
  }
  assert.deepEqual(await eligible(adapter, key(project, "fresh-fork"), [deleted, fresh]), []);
  assert.deepEqual(await eligible(adapter, key(project, "fresh-fork"), [fresh]), [0]);
  assert.deepEqual(await eligible(adapter, key(project, "fresh-fork", "other-client-event", "codex"),
    [shared, fresh]), [0, 1]);
  const fork = key(project, "fresh-fork");
  const batch = [shared, fresh];
  assert.equal((await write(adapter, fork, tx => adapter.capture.claim(tx, fork, batch, { leaseMs: 60_000 }))).status,
    "claimed");
  await assert.rejects(write(adapter, fork, tx => adapter.capture.assertEligible(tx, fork, [1])), { code: "lineage_fenced" });
  assert.deepEqual(await write(adapter, fork, tx => adapter.raw.importArchive(tx, fork.scope, fork, batch)),
    { archived: 0, existing: 0, withheld: 2 });
}

async function legacyFixture(t) {
  const directory = scratch(t);
  const input = prepareInput(directory, await fixture(directory, 29, { localPrivacy: true }));
  const engine = openMemoryCore({ path: input.path, raw: true, rawSearch: false, model: {
    ...rationaleModel(),
    extract: ({ input }) => ({ items: input.messages.map(message => ({
      content: "Derived synthetic fact for " + message.id, kind: "fact", confidence: 0.8,
      sourceIndices: [message.index],
    })) }),
  } });
  const archive = async (namespace, sessionId, message, ordinal, sourceClient = client) => {
    const occurredAt = new Date(message.occurredAtMs).toISOString();
    const [part] = splitRaw(message.content, { id: message.id, occurredAt, ordinal, role: message.role });
    const result = ok(await engine.captureRaw(rawRequest(part, { namespace, client: sourceClient, sessionId,
      eventId: sessionId + "-" + message.id })));
    ok(result.interpretation);
    return result.raw.conversationId;
  };
  return { input, engine, archive };
}

test("migration retains opaque fork denials after physical legacy conversation deletion", async t => {
  const { input, engine, archive } = await legacyFixture(t);
  try {
    const root = await archive(personal, rootSession, shared, 1);
    assert.equal(await archive(personal, rootSession, deleted, 2), root);
    assert.notEqual(await archive(project, copySession, shared, 1), root);
    const { conversations } = ok(engine.listRawConversations({ namespace: personal, client }));
    const { revision } = conversations.find(({ id }) => id === root);
    const result = ok(await engine.deleteConversation({ namespace: personal, conversationId: root,
      expectedRevision: revision, actionId: "delete-personal-root" }));
    assert.equal(result.conversationId, root);
    assert.deepEqual(ok(engine.listRawConversations({ namespace: personal, client })).conversations, []);
  } finally {
    await engine.close();
  }

  await createLegacyBackup(input);
  await migrateLegacyStore(input);
  const adapter = await openSqliteAdapter(input.destination);
  try {
    await assertForkDenial(adapter);
  } finally {
    await adapter.close();
  }
  // The scoped project copy is still readable. The root-only bytes must be gone.
  assert.equal(readFileSync(input.destination).includes(deleted.content), false);
});

test("migration keeps exact proof for retained turns in a fenced legacy conversation", async t => {
  const { input, engine, archive } = await legacyFixture(t);
  const sourceClient = "codex";
  try {
    await archive(personal, rootSession, deleted, 1, sourceClient);
    ok(engine.fenceSession({ namespace: personal, client: sourceClient, sessionId: rootSession }));
  } finally {
    await engine.close();
  }
  await createLegacyBackup(input);
  const interrupted = new Error("Synthetic interruption after copying privacy rows");
  await assert.rejects(migrateLegacyStore({ ...input, onCheckpoint(name) {
    if (name === "privacy") throw interrupted;
  } }), error => error === interrupted);
  await migrateLegacyStore(input);
  const adapter = await openSqliteAdapter(input.destination);
  try {
    const fork = key(project, "fresh-fork", "codex-fork", sourceClient);
    assert.deepEqual(await migratedRawVisible(adapter), []);
    assert.deepEqual(await eligible(adapter, fork, [deleted, fresh]), []);
    assert.deepEqual(await eligible(adapter, fork, [{ ...deleted, content: "Edited synthetic message" }, fresh]), [0, 1]);
  } finally {
    await adapter.close();
  }
  assert.equal(readFileSync(input.destination).includes(deleted.content), false);
});

test("live SQLite denies the same fresh forks after conversation deletion", async t => {
  const path = join(scratch(t), "live.sqlite");
  const adapter = await openSqliteAdapter(path);
  const root = key(personal, rootSession);
  const copy = key(project, copySession);
  try {
    for (const [source, messages] of [[root, [shared, deleted]], [copy, [shared]]]) {
      await write(adapter, source, async tx => {
        await adapter.raw.recordLineage(tx, source, messages);
        assert.deepEqual(await adapter.raw.archive(tx, source, messages), { archived: messages.length });
      });
    }
    assert.deepEqual(await eligible(adapter, key(project, "fresh-fork"), [shared, fresh]), [0, 1]);
    assert.deepEqual(await write(adapter, root, tx => adapter.raw.deleteConversation(tx, root.scope, root)),
      { rawDeleted: 2 });
    await assertForkDenial(adapter);
    assert.deepEqual(await eligible(adapter, key(project, "fresh-fork"),
      [{ ...shared, content: "Edited synthetic message" }, fresh]), [0, 1]);
  } finally {
    await adapter.close();
  }
  assert.equal(readFileSync(path).includes(deleted.content), false);
});
