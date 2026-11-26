import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { openMemoryCore } from "../../../core/index.mjs";
import { rationaleModel } from "../../../core/testing/rationale-model.mjs";
import { rawRequest, splitRaw } from "../../../core/testing/raw-fixtures.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { editFixture, fixture, scratch } from "./legacy/fixtures.mjs";
import { coreScope, createLegacyBackup, ok, personal, prepareInput, project, sha256 } from "./migration-fixtures.mjs";

const client = "claude-code";
const source = "fenced-conversation";
const original = {
  id: "e4444529-96e4-4fd6-a597-ac907373d46c", role: "user",
  occurredAtMs: Date.now() - 3 * 60 * 60 * 1000, content: "Synthetic saffron easel witness",
};
const edited = { ...original, content: "Synthetic turn with different content" };
const rootOnly = { ...original, id: "52d3bad6-9453-40bd-893b-91ab59c533df", content: "Synthetic larch witness" };
const fresh = { ...original, id: "138d6195-0d1a-4d6a-b1cd-ea8572b2d023", content: "Synthetic cedar follow-up" };
const arrival = { ...original, id: "f383a650-a988-4fc5-b558-845bf2a9436c", content: "Synthetic elm arrival" };
const foreign = { ...project, ownerId: "another-synthetic-owner" };

const key = (namespace, sessionId = "fresh-conversation") => ({
  scope: coreScope(namespace), client, sessionId, eventId: sessionId, payloadDigest: sha256(sessionId),
});
const eligible = (adapter, namespace, batch) => {
  const fork = key(namespace);
  return adapter.uow.run(fork.scope.owner, { readOnly: true }, tx => adapter.capture.eligible(tx, fork, batch));
};
const importBatch = (adapter, namespace, batch, sessionId) => {
  const fork = key(namespace, sessionId);
  return adapter.uow.run(fork.scope.owner, { pauseLock: true }, tx =>
    adapter.raw.importArchive(tx, fork.scope, fork, batch));
};

async function legacyFixture(t, populate) {
  const directory = scratch(t);
  const input = prepareInput(directory, await fixture(directory, 29, { localPrivacy: true }));
  const engine = openMemoryCore({ path: input.path, raw: true, rawSearch: false, model: {
    ...rationaleModel(),
    extract: ({ input }) => ({ items: input.messages.map(message => ({
      content: "Derived synthetic fact for " + message.id, kind: "fact", confidence: 0.8,
      sourceIndices: [message.index],
    })) }),
  } });
  const capture = (namespace, sessionId, message, ordinal = 1) => {
    const [part] = splitRaw(message.content, {
      id: message.id, occurredAt: new Date(message.occurredAtMs).toISOString(), ordinal, role: message.role,
    });
    return engine.captureRaw(rawRequest(part, { namespace, client, sessionId, eventId: sessionId + message.id }));
  };
  const archive = async (...args) => {
    const result = ok(await capture(...args));
    ok(result.interpretation);
    return result.raw.conversationId;
  };
  const fence = sessionId => ok(engine.fenceSession({ namespace: personal, client, sessionId }));
  try {
    await populate({ archive, capture, engine, fence });
  } finally {
    await engine.close();
  }
  return input;
}

const retainedFence = ({ archive, fence }) => archive(personal, source, original).then(() => fence(source));
const legacyUuidCount = input => editFixture(input.path,
  db => db.prepare("SELECT count(*) AS n FROM local_raw_uuid_fences").get().n);
const anchorProofs = input => editFixture(input.destination,
  db => db.prepare("SELECT proof FROM cairn_raw_anchors ORDER BY proof").all().map(row => row.proof));
const assertClosedFileOmits = (path, content) => {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    if (existsSync(path + suffix)) assert.equal(readFileSync(path + suffix).includes(content), false);
  }
};

test("a complete fenced Claude turn denies the original and permits edited UUID reuse", async t => {
  const input = await legacyFixture(t, retainedFence);
  assert.equal(legacyUuidCount(input), 0);
  const saved = editFixture(input.path, db => db.prepare(
    "SELECT assembly_state, saved, format FROM raw_messages JOIN raw_parts USING (conversation_id, message_id)").get());
  assert.deepEqual({ ...saved }, { assembly_state: "complete", saved: 1, format: "local-plain-v1" });

  await createLegacyBackup(input);
  const stop = new Error("Synthetic pause after the privacy copy");
  await assert.rejects(migrateLegacyStore({ ...input, onCheckpoint(phase) {
    if (phase === "privacy") throw stop;
  } }), error => error === stop);
  await migrateLegacyStore({ ...input, reportCutoverEvidence: true });
  const proofs = anchorProofs(input);
  assert.equal(proofs.length, 1);
  assert.match(proofs[0], /^[0-9a-f]{64}$/u);

  const adapter = await openSqliteAdapter(input.destination);
  let observed;
  try {
    observed = {
      original: await eligible(adapter, project, [original, fresh]),
      edited: await eligible(adapter, project, [edited, fresh]),
      editedInSourceNamespace: await eligible(adapter, personal, [edited, fresh]),
      imported: await importBatch(adapter, project, [edited, fresh]),
    };
    if (observed.edited.length) {
      const fork = key(project, "claimed-conversation");
      await adapter.uow.run(fork.scope.owner, { pauseLock: true }, async tx => {
        assert.equal((await adapter.capture.claim(tx, fork, [edited, fresh], { leaseMs: 60_000 })).status, "claimed");
        await adapter.capture.assertEligible(tx, fork, [0, 1]);
      });
    }
  } finally {
    await adapter.close();
  }
  assertClosedFileOmits(input.destination, original.content);
  t.diagnostic(JSON.stringify(observed));
  assert.deepEqual(observed, {
    original: [], edited: [0, 1], editedInSourceNamespace: [0, 1],
    imported: { archived: 2, existing: 0, withheld: 0 },
  });
});

test("hard-deleted Claude turns still deny edited UUIDs, including a turn with an exact fenced copy", async t => {
  const input = await legacyFixture(t, async ({ archive, engine, fence }) => {
    const root = await archive(personal, source, original);
    await archive(personal, source, rootOnly, 2);
    await archive(project, "project-copy", original);
    await archive(personal, "retained-copy", { ...original, content: "Different retained copy" });
    const { conversations } = ok(engine.listRawConversations({ namespace: personal, client }));
    const { revision } = conversations.find(({ id }) => id === root);
    ok(await engine.deleteConversation({
      namespace: personal, conversationId: root, expectedRevision: revision, actionId: "delete-source",
    }));
    fence("retained-copy");
  });
  assert.equal(legacyUuidCount(input), 2);
  await createLegacyBackup(input);
  await migrateLegacyStore(input);
  const adapter = await openSqliteAdapter(input.destination);
  try {
    for (const [namespace, expected] of [[project, []], [personal, []], [foreign, [0, 1]]]) {
      assert.deepEqual(await eligible(adapter, namespace, [original, fresh]), expected);
      assert.deepEqual(await eligible(adapter, namespace, [edited, fresh]), expected);
    }
    assert.deepEqual(await eligible(adapter, project, [{ ...rootOnly, content: edited.content }, fresh]), []);

    assert.deepEqual(await importBatch(adapter, personal, [edited, arrival], "refused-after-migration"),
      { archived: 0, existing: 0, withheld: 2 });
    const editedArrival = { ...arrival, content: edited.content };
    assert.deepEqual(await eligible(adapter, personal, [editedArrival, fresh]), []);
    assert.deepEqual(await eligible(adapter, project, [editedArrival, fresh]), [0, 1]);
  } finally {
    await adapter.close();
  }
  assertClosedFileOmits(input.destination, rootOnly.content);
});

for (const [label, scrub] of [
  ["pending assembly", "UPDATE raw_messages SET assembly_state='pending'"],
  ["closed assembly", "UPDATE raw_messages SET assembly_state='closed'"],
  ["empty part set", "DELETE FROM raw_parts"],
  ["unsaved part", "UPDATE raw_parts SET saved=0, reason='raw_disabled', format=NULL, key_version=NULL, sealed=NULL"],
]) {
  test(`a fenced Claude turn with ${label} still denies edited UUID reuse`, async t => {
    const input = await legacyFixture(t, retainedFence);
    editFixture(input.path, db => db.exec(scrub));
    assert.equal(legacyUuidCount(input), 0);
    await createLegacyBackup(input);
    await migrateLegacyStore(input);
    assert.deepEqual(anchorProofs(input), [""]);
    const adapter = await openSqliteAdapter(input.destination);
    try {
      assert.deepEqual(await eligible(adapter, project, [edited, fresh]), []);
      assert.deepEqual(await eligible(adapter, project, [fresh]), [0]);
    } finally {
      await adapter.close();
    }
  });
}

test("an unmarked legacy UUID from a refused arrival denies edited reuse without a Raw anchor", async t => {
  const input = await legacyFixture(t, async ({ capture, fence }) => {
    fence(source);
    assert.equal((await capture(personal, source, original)).error?.code, "conversation_deleted");
  });
  assert.equal(legacyUuidCount(input), 1);
  await createLegacyBackup(input);
  await migrateLegacyStore(input);
  assert.deepEqual(anchorProofs(input), []);
  const adapter = await openSqliteAdapter(input.destination);
  try {
    assert.deepEqual(await eligible(adapter, project, [edited, fresh]), []);
    assert.deepEqual(await eligible(adapter, project, [fresh]), [0]);
  } finally {
    await adapter.close();
  }
});
