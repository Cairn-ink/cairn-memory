import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { capabilities, CoreError } from "@cairn-ink/core";
import { ledgerRowKey } from "@cairn-ink/core/ledger";
import { createMemoryService } from "@cairn-ink/core/service";
import { coreDigest, factIncarnationBody } from "../../core/src/index.mjs";
import {
  applyMigrations, createPostgresCapturePorts, createPostgresMemoryReads, createPostgresMemoryStore,
  createPostgresPauseStore, createPostgresQuantityLedgerStore, createPostgresRawPorts, createPostgresSupersessionStore,
  createPostgresSuppressionStore, createPostgresUnitOfWork,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const scope = { owner: "owner", namespace: null };
const other = { owner: "other", namespace: null };
const readOnly = { readOnly: true };
const range = { fromMs: -100, toMs: 100 };
const namespaces = { allowNonNullNamespace: true };
const memorySource = { kind: "mcp", client: null, sessionId: null };
const vector = Float32Array.of(1, ...Array(1535).fill(0));
const sha256Hex = (text) => createHash("sha256").update(text).digest("hex");
const hash = (text) => `sha256:${sha256Hex(text)}`;

function amount(fields = {}) {
  return {
    memoryId: "memory", receiptId: "receipt", textHash: hash("quantity"), date: 10, ordinal: 0,
    kind: "record", measure: "spend", category: "tea", value: 6.25, unit: "USD", group: "food",
    period: "none", comparator: "none", ...fields,
  };
}

async function setup(t, options) {
  const database = await migrationDatabase(t, options);
  await database.pool.query("INSERT INTO users (id) VALUES ($1), ($2)", [scope.owner, other.owner]);
  const uow = createPostgresUnitOfWork(database.source);
  const ledger = createPostgresQuantityLedgerStore(namespaces);
  const memories = createPostgresMemoryStore(namespaces);
  const run = (work, options = readOnly, target = scope) => uow.run(target.owner, options, work);
  const insert = (tx, target, text) => memories.insert(tx, target, {
    text, textHash: hash(text), kind: "fact", origin: "explicit", confidence: 1,
    source: memorySource, embedding: { model: "fixture", vector },
  }, [], 1);
  return { ...database, uow, ledger, memories, run, insert };
}

function serviceFor({ uow, memories }, quantityLedger, diagnostics, { rawOptions, extract } = {}) {
  const content = "Tea cost 6.25 USD.";
  const { kind, measure, category, value, unit, group, period, comparator } = amount();
  const options = rawOptions ?? { lineageSecret: randomUUID() };
  return createMemoryService({
    storage: {
      name: "postgres", uow, memories, ...createPostgresMemoryReads(),
      capture: createPostgresCapturePorts({ ...options, nearDuplicate: false }),
      pause: createPostgresPauseStore(), suppressions: createPostgresSuppressionStore(options),
      keys: { async userKey() { return null; } },
      capabilities: capabilities({ embeddingRequiredOnInsert: true, quantityLedger: !!quantityLedger,
        rawArchive: !!rawOptions, sessionLineage: !!rawOptions }),
      ...(quantityLedger && { quantityLedger }),
      ...(rawOptions && createPostgresRawPorts(rawOptions)),
    },
    config: { quantityLedger: { enabled: !!quantityLedger } }, diagnostics,
    model: { model: "fixture", contextWindow: 32_768, countTokens: () => 1, call: extract ?? (async () => {
      return {
        items: [{ content, kind: "fact", confidence: 1, sourceIndices: [0] }],
        quantities: [{ item: 0, kind, measure, category, value, unit, group, period, comparator }],
      };
    }) },
    embedder: { model: "fixture", dimensions: vector.length, async embed(texts) { return texts.map(() => vector); } },
    gate: { async assertOpen() {} }, tokens: { countTokens: () => 1 },
    clock: { nowMs: Date.now, monotonicMs: () => performance.now(), sha256Hex, hmacHex: assert.fail },
  });
}

async function capturePair(t) {
  const fixture = await setup(t);
  const { ledger, memories, run, pool } = fixture;
  const rawOptions = { lineageSecret: randomUUID() };
  const { raw } = createPostgresRawPorts(rawOptions);
  const event = { client: "mcp", sessionId: randomUUID(), eventId: randomUUID() };
  const messages = ["Tea cost 6.25 USD.", "A bus ticket cost 3 USD."].map((content, index) =>
    ({ id: randomUUID(), content, role: "user", occurredAtMs: 10 + index }));
  const service = serviceFor(fixture, ledger, undefined, { rawOptions, async extract() {
    return {
      items: messages.map(({ content }, index) => ({ content, kind: "fact", confidence: 1, sourceIndices: [index] })),
      quantities: [
        { ...amount(), item: 0 },
        { ...amount(), item: 1, measure: "fare", category: "bus", group: "transport", value: 3 },
      ].map(({ memoryId, receiptId, textHash, date, ordinal, ...quantity }) => quantity),
    };
  } });
  assert.equal((await service.enqueueCapture(scope, { ...event, messages })).status, "accepted");
  const captured = await service.runCapture(scope, event);
  assert.equal(captured.status, "done");
  assert.equal(captured.result.memories.length, 2);
  const ids = captured.result.memories.map(({ id }) => id);
  const readLedger = () => run(async tx => ({
    byMemory: await Promise.all(ids.map(id => ledger.listForMemory(tx, scope, id))),
    rows: await ledger.list(tx, scope, range),
    terms: await ledger.terms(tx, scope),
  }));
  const before = await readLedger();
  assert.deepEqual(before.byMemory.map(rows => rows.length), [1, 1]);
  assert.deepEqual(before.terms, ["bus", "fare", "food", "spend", "tea", "transport"]);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM raw_messages")).rows[0].count, 2);
  return { raw, service, event, messages, ids, before, readLedger, pool,
    write: (work) => run(work, { pauseLock: true }),
    revision: () => run(tx => memories.indexRevision(tx)) };
}

test("deleting a conversation removes quantities from both captured memories", migrationDbTest, async t => {
  const { raw, event, readLedger, write, revision } = await capturePair(t);
  const before = await revision();
  assert.deepEqual(await write(tx => raw.deleteConversation(tx, scope, event)), { rawDeleted: 2 });
  assert.deepEqual(await readLedger(), { byMemory: [[], []], rows: [], terms: [] });
  assert.equal(await revision(), before + 1);
});

test("forgetting a memory erases quantities from its shared source session", migrationDbTest, async t => {
  const { service, ids, readLedger, pool } = await capturePair(t);
  assert.equal((await service.forget(scope, ids[0], memorySource)).status, "forgotten");
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM raw_messages")).rows[0].count, 0);
  assert.deepEqual(await readLedger(), { byMemory: [[], []], rows: [], terms: [] });
});

test("purging one source message removes only its quantities", migrationDbTest, async t => {
  const { raw, messages, before, readLedger, write, revision } = await capturePair(t);
  const fact = { ...scope, actionId: randomUUID(), origin: "forget", kind: "text", mode: "exact",
    text: { digests: [await coreDigest(messages[0].content)] } };
  await write(tx => createPostgresSuppressionStore().writeFact(tx, fact, sha256Hex(factIncarnationBody(fact))));
  const index = await revision();
  assert.deepEqual(await write(tx => raw.purgeWithheld(tx, scope, [{ fact }])), { rawDeleted: 1, ledgerBlanked: 1 });
  const survivor = before.byMemory[1];
  assert.deepEqual(await readLedger(), { byMemory: [[], survivor], rows: survivor, terms: ["bus", "fare", "transport"] });
  assert.equal(await revision(), index + 1);
});

test("Postgres quantity ledger isolates both owners and namespaces in reads, deletes and terms", migrationDbTest, async t => {
  const { ledger, run, insert } = await setup(t);
  const named = { ...scope, namespace: "project\0shared" };
  const targets = [scope, named, other, { ...other, namespace: named.namespace }];
  const owned = [];
  for (const [index, target] of targets.entries()) {
    const measure = `measure-${index}`;
    const { id } = await run(tx => insert(tx, target, measure), {}, target);
    owned.push(amount({ memoryId: id, measure, receiptId: "shared-receipt" }));
  }
  // The same identity in each scope must insert. Only the owning namespace has
  // a current memory for this row, even when the memory ID is known elsewhere.
  const shared = amount({ memoryId: owned[0].memoryId, receiptId: "shadow-receipt", category: "shadow" });
  for (const [index, target] of targets.entries()) {
    await run(async tx => assert.deepEqual(await ledger.put(tx, target, [owned[index], shared]), { inserted: 2 }), {}, target);
  }
  for (const [index, target] of targets.entries()) {
    await run(async tx => {
      const row = owned[index];
      const listed = await ledger.list(tx, target, range);
      assert.equal(listed.length, 2);
      assert.deepEqual(new Set(listed), new Set([row, shared]));
      for (const peer of owned.slice(1).filter(peer => peer !== row)) {
        assert.deepEqual(await ledger.listForMemory(tx, target, peer.memoryId), []);
      }
      assert.deepEqual((await ledger.terms(tx, target)).sort(),
        [row.measure, row.category, row.group, ...(index === 0 ? [shared.measure, shared.category] : [])].sort());
      assert.deepEqual(await ledger.dropWhere(tx, target, { by: "memoryId", id: shared.memoryId }),
        { dropped: index === 0 ? 2 : 1 });
      assert.deepEqual(await ledger.dropWhere(tx, target, { by: "receiptId", id: row.receiptId }),
        { dropped: index === 0 ? 0 : 1 });
    }, {}, target);
  }

  for (const [local, foreign] of [[scope, other], [other, scope]]) {
    await run(async tx => {
      const error = { code: "internal_error" };
      await assert.rejects(ledger.put(tx, foreign, []), error);
      await assert.rejects(ledger.listForMemory(tx, foreign, shared.memoryId), error);
      await assert.rejects(ledger.list(tx, foreign, range), error);
      await assert.rejects(ledger.terms(tx, foreign), error);
      await assert.rejects(ledger.dropWhere(tx, foreign, { by: "receiptId", id: shared.receiptId }), error);
    }, {}, local);
  }
});

test("Postgres quantity ledger deduplicates the full key and preserves every field of the first row", migrationDbTest, async t => {
  const { ledger, run } = await setup(t);
  const first = amount({ kind: "goal", period: "week", comparator: "at_most", value: -0 });
  const replay = { ...first, value: 0, textHash: hash("replacement"), date: 20, group: "bills" };
  const variants = [
    { receiptId: "another-receipt" }, { measure: "買\0" + "x".repeat(3_000) }, { category: "coffee" },
    { value: Number.MIN_VALUE }, { value: Number.MAX_VALUE }, { value: 6.25 }, { unit: "EUR" }, { period: "month" },
    { comparator: "at_least" }, { ordinal: Number.MAX_SAFE_INTEGER }, { memoryId: "another-memory" },
  ].map(field => ({ ...first, ...field }));
  assert.deepEqual(await run(tx => ledger.put(tx, scope, [first, replay, ...variants]), {}), { inserted: 1 + variants.length });
  assert.deepEqual(await run(tx => ledger.put(tx, scope, [replay, first, ...variants]), {}), { inserted: 0 });
  const rows = await run(tx => ledger.list(tx, scope, range));
  const byKey = (items) => new Map(items.map(row => [ledgerRowKey(row), row]));
  assert.equal(rows.length, 1 + variants.length);
  assert.deepEqual(byKey(rows), byKey([first, ...variants]));
});

test("Postgres quantity ledger deletes by memory or receipt and rejects invalid selectors", migrationDbTest, async t => {
  const { ledger, run } = await setup(t);
  const first = amount();
  const second = amount({ memoryId: "different-memory" });
  const third = amount({ receiptId: "different-receipt" });
  const fourth = amount({ memoryId: "retained-memory", receiptId: "retained-receipt" });
  await run(async tx => {
    await ledger.put(tx, scope, [first, second, third, fourth]);
    for (const invalid of [null, { by: "textHash", id: first.textHash }, { by: "memoryId", id: "" },
      { by: "memoryId", id: 1 }, { by: "receiptId", id: first.receiptId, extra: true },
      Object.create({ by: "memoryId", id: first.memoryId }), { by: "receiptId", get id() { assert.fail("accessor read"); } }]) {
      await assert.rejects(ledger.dropWhere(tx, scope, invalid), { code: "invalid_input" });
    }
    assert.equal((await ledger.list(tx, scope, range)).length, 4);
    assert.deepEqual(await ledger.dropWhere(tx, scope, { by: "receiptId", id: first.receiptId }), { dropped: 2 });
    assert.deepEqual(await ledger.listForMemory(tx, scope, first.memoryId), [third]);
    assert.deepEqual(await ledger.dropWhere(tx, scope, { by: "memoryId", id: first.memoryId }), { dropped: 1 });
    assert.deepEqual(await ledger.list(tx, scope, range), [fourth]);
  }, {});
});

test("Postgres quantity ledger advances the owner revision once per changing call", migrationDbTest, async t => {
  const { ledger, memories, run } = await setup(t);
  const first = amount();
  const second = amount({ ordinal: 1 });
  const third = amount({ receiptId: "second-receipt" });
  await run(async tx => {
    const check = async (end) => {
      assert.equal(await memories.indexRevision(tx), 0);
      assert.equal(await memories.committedIndexRevision(tx), end);
    };
    await check(0);
    assert.deepEqual(await ledger.put(tx, scope, [first, second]), { inserted: 2 });
    await check(1);
    assert.deepEqual(await ledger.put(tx, scope, []), { inserted: 0 });
    assert.deepEqual(await ledger.put(tx, scope, [first]), { inserted: 0 });
    assert.deepEqual(await ledger.dropWhere(tx, scope, { by: "memoryId", id: "missing" }), { dropped: 0 });
    await ledger.list(tx, scope, range);
    await ledger.terms(tx, scope);
    await ledger.listForMemory(tx, scope, first.memoryId);
    await check(1);
    assert.deepEqual(await ledger.put(tx, scope, [first, third]), { inserted: 1 });
    await check(2);
    assert.deepEqual(await ledger.dropWhere(tx, scope, { by: "receiptId", id: first.receiptId }), { dropped: 2 });
    await check(3);
    assert.deepEqual(await ledger.dropWhere(tx, scope, { by: "memoryId", id: third.memoryId }), { dropped: 1 });
    await check(4);
  }, {});
  assert.equal(await run(tx => memories.indexRevision(tx)), 4);
  assert.equal(await run(tx => memories.indexRevision(tx), readOnly, other), 0);
});

test("Postgres quantity ledger lists the half-open millisecond range in its read snapshot", migrationDbTest, async t => {
  const { ledger, run } = await setup(t);
  const fromMs = -8_639_999_999_999_999;
  const toMs = fromMs + 2;
  const [before, first, last, after] = [fromMs - 1, fromMs, toMs - 1, toMs].map((date, ordinal) => amount({ date, ordinal }));
  const added = { ...last, ordinal: after.ordinal + 1 };
  await run(tx => ledger.put(tx, scope, [after, last, before, first]), {});
  await run(async tx => {
    assert.deepEqual(await ledger.list(tx, scope, { fromMs, toMs }), [first, last]);
    assert.deepEqual(await run(writeTx => ledger.put(writeTx, scope, [added]), {}), { inserted: 1 });
    assert.deepEqual(await ledger.list(tx, scope, { fromMs, toMs }), [first, last]);
    assert.deepEqual(await ledger.list(tx, scope, { fromMs, toMs: fromMs }), []);
    assert.deepEqual(await ledger.list(tx, scope, { fromMs: toMs, toMs: toMs + 1 }), [after]);
  });
  assert.deepEqual(await run(tx => ledger.list(tx, scope, { fromMs, toMs })), [first, last, added]);
});

test("Postgres quantity ledger terms exclude forgotten, erased and historical memories in the snapshot", migrationDbTest, async t => {
  const fixture = await setup(t);
  const { ledger, memories, run, insert } = fixture;
  const [current, forgotten, erased, historical] = await run(async tx => {
    const rows = [];
    for (const [term, group] of [["current\0term", "food"], ["forgotten", "other"], ["erased", "work"], ["historical", "health"]]) {
      const { id } = await insert(tx, scope, term.replace("\0", " "));
      rows.push(amount({ memoryId: id, measure: term, category: term, group }));
    }
    await ledger.put(tx, scope, [...rows, { ...rows[0], ordinal: 1 }]);
    return rows;
  }, {});
  const allTerms = [current, forgotten, erased, historical].flatMap(row => [row.measure, row.group]).sort();
  await run(async tx => {
    assert.deepEqual((await ledger.terms(tx, scope)).sort(), allTerms);
    // Exercise the currentness join even if a host forgot the memory without the optional ledger port.
    assert.equal((await serviceFor(fixture).forget(scope, forgotten.memoryId, memorySource)).status, "forgotten");
    await run(async writeTx => {
      assert.equal(await memories.erase(writeTx, scope, erased.memoryId), true);
      await createPostgresSupersessionStore().markHistorical(writeTx, scope, historical.memoryId, 2);
    }, {});
    assert.deepEqual((await ledger.terms(tx, scope)).sort(), allTerms);
  });
  await run(async tx => {
    assert.equal((await ledger.list(tx, scope, range)).length, 5);
    assert.deepEqual((await ledger.terms(tx, scope)).sort(), [current.measure, current.group].sort());
  });
});

test("Postgres quantity ledger rolls back with a failed capture finish", migrationDbTest, async t => {
  const fixture = await setup(t);
  const { ledger, memories, run } = fixture;
  let fail = true;
  let attempted = 0;
  const diagnostics = [];
  const service = serviceFor(fixture, {
    ...ledger,
    async put(...args) {
      const result = await ledger.put(...args);
      attempted += result.inserted;
      if (fail) throw new CoreError("internal_error");
      return result;
    },
  }, event => diagnostics.push(event.reason));
  const capture = async (eventId) => {
    const event = { client: "client", sessionId: "session", eventId };
    const messages = [{ id: "message", role: "user", content: "Tea cost 6.25 USD.", occurredAtMs: 10 }];
    assert.equal((await service.enqueueCapture(scope, { ...event, messages })).status, "accepted");
    return service.runCapture(scope, event);
  };
  const initial = await run(tx => memories.indexRevision(tx));
  assert.equal((await capture("failed")).status, "failed", diagnostics.join(", "));
  assert.equal(attempted, 1);
  await run(async tx => {
    assert.deepEqual(await ledger.list(tx, scope, range), []);
    assert.deepEqual((await memories.exportPage(tx, scope, { limit: 10, cursor: null })).items, []);
    assert.equal(await memories.indexRevision(tx), initial);
  });
  fail = false;
  const completed = await capture("successful");
  assert.equal(completed.status, "done");
  assert.equal(attempted, 2);
  assert.equal(completed.result.indexRevision, initial + 2);
  await run(async tx => {
    assert.equal((await ledger.list(tx, scope, range)).length, 1);
    assert.equal(await memories.indexRevision(tx), completed.result.indexRevision);
    const receipt = { client: "client", sessionId: "session", messageId: "message", role: "user",
      occurredAtMs: 10, excerpt: "Tea cost 6.25 USD." };
    assert.equal(await createPostgresSuppressionStore().receiptWithheld(tx, scope, receipt), true);
  });
  const status = await service.runCapture(scope, { client: "client", sessionId: "session", eventId: "successful" });
  assert.equal(status.result.indexRevision, completed.result.indexRevision);
});

test("Postgres quantity ledger migration upgrades a populated store and preserves data on reapply", migrationDbTest, async t => {
  const { pool, source, migrations, ledger, memories, run, insert } = await setup(t, { migrate: false });
  const ledgerMigration = migrations.findIndex(({ id }) => id === "0025_core_quantity_ledger.sql");
  assert.ok(ledgerMigration > 0);
  assert.equal(migrations[ledgerMigration].concurrent, false);
  await applyMigrations(source, migrations.slice(0, ledgerMigration));
  const { id } = await run(tx => insert(tx, scope, "Preexisting quantity memory"), {});
  const before = await run(async tx => ({ memory: await memories.get(tx, scope, id), revision: await memories.indexRevision(tx) }));
  assert.equal((await pool.query("SELECT to_regclass('core_quantity_ledger') AS relation")).rows[0].relation, null);

  await applyMigrations(source, migrations);
  await run(async tx => {
    assert.deepEqual(await memories.get(tx, scope, id), before.memory);
    assert.equal(await memories.indexRevision(tx), before.revision);
    assert.deepEqual(await ledger.listForMemory(tx, scope, id), []);
  });
  const row = amount({ memoryId: id, textHash: before.memory.textHash });
  assert.deepEqual(await run(tx => ledger.put(tx, scope, [row]), {}), { inserted: 1 });
  await applyMigrations(source, migrations);
  assert.deepEqual(await run(tx => ledger.listForMemory(tx, scope, id)), [row]);
  assert.equal(await run(tx => memories.indexRevision(tx)), before.revision + 1);
});
