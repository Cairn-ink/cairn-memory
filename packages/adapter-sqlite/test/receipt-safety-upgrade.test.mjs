import assert from "node:assert/strict";
import { test } from "node:test";
import { receiptExcerpt } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { openMemoryCore } from "../../../core/index.mjs";
import { createMemoryAdapter } from "../../adapter-memory/src/index.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { editFixture, fixture as legacyFixture, scratch } from "./legacy/fixtures.mjs";
import { admit, coreScope, createLegacyBackup, ok, personal, prepareInput, service, sha256 } from "./migration-fixtures.mjs";
import { scratch as sqliteScratch } from "./storage-fixtures.mjs";

const scope = coreScope(personal);
const source = { kind: "mcp", client: null, sessionId: null };
const receipt = (messageId, excerpt) => ({
  client: "fixture-client", sessionId: "fixture-session", messageId, role: "user", occurredAtMs: null, excerpt,
});
const legacyReceipt = ({ messageId, occurredAtMs: _time, ...rest }) => ({ ...rest, eventId: messageId });

function insert(storage, text, receipts = []) {
  return storage.uow.run(scope.owner, { pauseLock: true }, tx => storage.memories.insert(tx, scope,
    { text, textHash: "sha256:" + sha256(text.toLowerCase()), origin: "explicit", kind: "fact",
      confidence: 1, source, embedding: null }, receipts, 1));
}

async function open(t, path) {
  const storage = await openSqliteAdapter(path);
  t.after(() => storage.close());
  return storage;
}

function sqlitePath(t) {
  const { path, remove } = sqliteScratch();
  t.after(remove);
  return path;
}

const inspect = storage => createMemoryService({
  profile: "keyless-local", storage, clock: { async hmacHex() { throw new Error("Unexpected cursor"); } },
}).inspect;

async function receiptView(storage, memoryId) {
  const read = inspect(storage);
  const list = await read(scope, {});
  const item = await read(scope, { memoryId });
  return {
    listCount: list.memories.find(memory => memory.id === memoryId)?.receiptCount,
    itemCount: item.memory.receiptCount,
    excerpts: item.receipts.map(row => row.excerpt).sort(),
  };
}

function view(...excerpts) {
  return { listCount: excerpts.length, itemCount: excerpts.length, excerpts: excerpts.sort() };
}

async function forgetUnarchivedTurn(storage) {
  const full = "Synthetic full source turn " + "z".repeat(900);
  const excerpt = receiptExcerpt(full);
  assert.equal(excerpt.length, 800);
  const { id: forgotten } = await insert(storage, full);
  const other = "An independent receipt remains available.";
  const { id: visible } = await insert(storage, "A still-visible summary of the long turn.",
    [receipt("unarchived-turn", excerpt), receipt("independent-turn", other)]);
  assert.deepEqual(await receiptView(storage, visible), view(excerpt, other));
  assert.equal((await service(storage).forget(scope, forgotten, source)).status, "forgotten");
  assert.deepEqual(await receiptView(storage, visible), view(other));
}

test("P1 SQLite withholds a forgotten full-turn excerpt without an archive or its own receipt", async t => {
  await forgetUnarchivedTurn(await open(t, sqlitePath(t)));
});

test("Memory adapter already withholds the same forgotten full-turn excerpt", async () => {
  await forgetUnarchivedTurn(createMemoryAdapter({ capabilities: { inspect: true, rawArchive: true } }));
});

async function convert(t, seed) {
  const directory = scratch(t);
  const legacy = await legacyFixture(directory, 29);
  const engine = openMemoryCore({ path: legacy.path });
  let data;
  try {
    data = seed(engine);
  } finally {
    await engine.close();
  }
  const input = prepareInput(directory, legacy);
  await createLegacyBackup(input);
  await migrateLegacyStore(input);
  return { ...data, legacyPath: legacy.path, path: input.destination };
}

test("P2 conversion records an unknown legacy receipt origin as uncertain", async t => {
  const independent = receipt("explicit-turn", "Independently saved source.");
  const unknown = receipt("admission-turn", "Source passed to admission.");
  const { legacyPath, path, independentId, unknownId } = await convert(t, engine => {
    const { id: independentId } = admit(engine, "An explicit Memory.", personal, [legacyReceipt(independent)]);
    const key = { namespace: personal, client: unknown.client, eventId: "admission-event", payloadDigest: "a".repeat(64) };
    const { token } = ok(engine.claimAdmission({ ...key, leaseMs: 125_000 }));
    const { memories: [{ id: unknownId }] } = ok(engine.finishAdmission({ ...key, token, items: [
      { content: "A Memory from an automatic admission.", kind: "fact", confidence: 0.8,
        receipts: [legacyReceipt(unknown)] },
    ] }));
    return { independentId, unknownId };
  });
  editFixture(legacyPath, db => {
    const origin = db.prepare("SELECT kind FROM raw_receipt_origins JOIN receipts ON receipt_id = id WHERE memory_id = ?");
    assert.equal(origin.get(independentId).kind, "independent");
    assert.equal(origin.get(unknownId).kind, "unknown");
  });
  const storage = await open(t, path);
  assert.deepEqual(await receiptView(storage, independentId), view(independent.excerpt));
  const proof = editFixture(path, db => JSON.parse(db.prepare("SELECT body FROM cairn_receipts WHERE memory_id = ?")
    .get(unknownId).body).legacyRawAncestryEmpty);
  assert.deepEqual([proof, await receiptView(storage, unknownId)], [false, view()]);
});

test("P3 old conversions require integer zero for every absence count", async t => {
  const independent = receipt("independent-turn", "An old-format independent source.");
  const { path, id } = await convert(t, engine => admit(engine, "An independent old-format Memory.",
    personal, [legacyReceipt(independent)]));
  const evidence = editFixture(path, db => {
    db.exec("UPDATE cairn_receipts SET body = json_remove(body, '$.legacyRawAncestryEmpty')");
    return db.prepare("SELECT source_evidence FROM cairn_migration").get().source_evidence;
  });
  const storage = await open(t, path);
  assert.deepEqual(await receiptView(storage, id), view(independent.excerpt));
  const unexpected = [];
  for (const count of ["rawConversations", "rawReceiptLineage", "episodes", "captureAdmissions"]) {
    const field = "$.dropped." + count;
    for (const value of ["false", '"0"', "0.0", "null", "missing", "1"]) {
      editFixture(path, db => {
        if (value === "missing") db.prepare("UPDATE cairn_migration SET source_evidence = json_remove(?, ?)").run(evidence, field);
        else db.prepare("UPDATE cairn_migration SET source_evidence = json_set(?, ?, json(?))").run(evidence, field, value);
      });
      const { listCount, itemCount, excerpts } = await receiptView(storage, id);
      if (listCount || itemCount || excerpts.length) unexpected.push({ count, value, listCount, itemCount });
    }
  }
  assert.deepEqual(unexpected, []);
});

test("P4 opening a pre-identity v3 inspect store preserves two receipts and redacts before keying", async t => {
  const path = sqlitePath(t);
  const first = receipt("first-turn", "The first explicit-save receipt.");
  const historical = '{ "refresh_token": "synthetic-fixture-value" }';
  const second = receipt("second-turn", receiptExcerpt(historical));
  assert.ok(second.excerpt.includes("[REDACTED]"));
  const initial = await openSqliteAdapter(path);
  let id;
  try {
    ({ id } = await insert(initial, "A Memory with two explicit-save receipts.", [first, second]));
    assert.deepEqual(await receiptView(initial, id), view(first.excerpt, second.excerpt));
  } finally {
    await initial.close();
  }
  editFixture(path, db => {
    // Simulate the old v3 writer and inspect schema, which predate receipt identities.
    for (const { name } of db.prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger' AND name GLOB '*_inspect_raw_*'").all()) {
      db.exec(`DROP TRIGGER "${name}"`);
    }
    db.exec("UPDATE cairn_receipts SET body = json_remove(body, '$.receiptKey')");
    db.prepare("UPDATE cairn_inspect_receipts SET excerpt = ? WHERE memory_id = ? AND ordinal = 2").run(historical, id);
  });

  const upgraded = await openSqliteAdapter(path);
  try {
    assert.deepEqual(await receiptView(upgraded, id), view(first.excerpt, second.excerpt));
    editFixture(path, db => {
      const rows = db.prepare(`SELECT i.excerpt, r.body FROM cairn_inspect_receipts i
        JOIN cairn_receipts r USING (owner_id, namespace_key, memory_id, ordinal) WHERE i.memory_id = ? ORDER BY ordinal`).all(id);
      assert.deepEqual(rows.map(({ excerpt, body }) => {
        const { client, sessionId, messageId, role, receiptKey } = JSON.parse(body);
        return [excerpt, receiptKey === sha256(JSON.stringify({ client, sessionId, eventId: messageId, role, excerpt }))];
      }), [[first.excerpt, true], [second.excerpt, true]]);
    });
  } finally {
    await upgraded.close();
  }

  editFixture(path, db => db.exec(`UPDATE cairn_receipts SET body = CASE ordinal
    WHEN 1 THEN json_remove(body, '$.receiptKey')
    ELSE json_set(body, '$.messageId', 'changed-after-upgrade') END`));
  const reopened = await open(t, path);
  assert.deepEqual(await receiptView(reopened, id), view());
});
