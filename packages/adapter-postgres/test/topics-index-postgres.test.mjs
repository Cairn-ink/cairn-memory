import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createPostgresMemoryReads, createPostgresMemoryStore, createPostgresSuppressionStore,
  createPostgresTopicStore, createPostgresUnitOfWork,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const owner = "owner";
const scope = { owner, namespace: null };
const readSet = { owner, namespaces: [null] };
const page = { cursor: null, limit: 10 };
const sha = (text) => createHash("sha256").update(text).digest("hex");

async function setup(t) {
  const { pool, source } = await migrationDatabase(t);
  const { run } = createPostgresUnitOfWork(source);
  const topics = createPostgresTopicStore();
  const memories = createPostgresMemoryStore();
  const facts = createPostgresSuppressionStore();
  const { snapshot } = createPostgresMemoryReads();
  await pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
  await pool.query("INSERT INTO topic_index_state (user_id, revision) VALUES ($1, 7)", [owner]);
  const write = (body) => run(owner, {}, body);
  const read = (body) => run(owner, { readOnly: true }, body);
  const catalog = (tx) => topics.catalog(tx, scope, page);
  const token = (tx) => snapshot.stateToken(tx, readSet);
  const status = async (tx) => ({ ...await catalog(tx), stateToken: await token(tx) });

  async function seed(tx, text) {
    const { id, revision } = await memories.insert(tx, scope, {
      text, textHash: `sha256:${sha(text)}`, confidence: 1, kind: "fact", origin: "explicit",
      source: { kind: "mcp", client: null, sessionId: null },
      embedding: { model: "fixture", vector: [1, ...Array(1535).fill(0)] },
    }, [], 1);
    return { memoryId: id, revision };
  }

  function place(tx, guard, title, indexRevision) {
    return topics.applyPlacement(tx, scope, { indexRevision, memoryRevisions: [guard] }, {
      items: [{ memoryId: guard.memoryId, parentIds: [], newL1: { title, parentL2Ids: [] } }],
    });
  }

  async function counters() {
    const { rows: [row] } = await pool.query(`SELECT t.revision::int AS hosted,
      COALESCE(o.index_revision, 0)::int AS core, COALESCE(o.fact_epoch, 0)::int AS facts
      FROM topic_index_state t LEFT JOIN core_owner_state o USING (user_id) WHERE t.user_id = $1`, [owner]);
    return row;
  }

  return { write, read, catalog, token, status, seed, place, counters, facts };
}

test("two placements in one Postgres run accept the starting revision and advance once", migrationDbTest, async (t) => {
  const db = await setup(t);
  const a = await db.write((tx) => db.seed(tx, "First source"));
  const b = await db.write((tx) => db.seed(tx, "Second source"));
  const counters = await db.counters();
  const start = await db.read(db.status);
  assert.equal(start.indexRevision, counters.hosted + counters.core);

  await db.write(async (tx) => {
    const first = await db.place(tx, a, "First topic", start.indexRevision);
    const second = await db.place(tx, b, "Second topic", start.indexRevision);
    assert.equal(first.placed[0].memoryId, a.memoryId);
    assert.equal(second.placed[0].memoryId, b.memoryId);
    assert.equal((await db.catalog(tx)).indexRevision, start.indexRevision);
    assert.equal(await db.token(tx), start.stateToken);
  });

  const after = await db.read(db.status);
  assert.deepEqual(after.items.map(({ title }) => title), ["First topic", "Second topic"]);
  assert.equal(after.indexRevision, start.indexRevision + 1);
  assert.notEqual(after.stateToken, start.stateToken);
  assert.deepEqual(await db.counters(), { ...counters, core: counters.core + 1 });
});

test("a memory insert and placement share the same Postgres index advance", migrationDbTest, async (t) => {
  const db = await setup(t);
  const start = await db.read(db.status);
  await db.write(async (tx) => {
    const guard = await db.seed(tx, "Source created in this run");
    assert.equal((await db.catalog(tx)).indexRevision, start.indexRevision);
    assert.equal(await db.token(tx), start.stateToken);
    await db.place(tx, guard, "Newly seeded topic", start.indexRevision);
  });
  assert.equal((await db.read(db.catalog)).indexRevision, start.indexRevision + 1);
  assert.deepEqual(await db.counters(), { hosted: 7, core: 1, facts: 0 });
});

test("another Postgres run sees the index advance only after commit", migrationDbTest, async (t) => {
  const db = await setup(t);
  const guard = await db.write((tx) => db.seed(tx, "Source for concurrent read"));
  const start = await db.read(db.status);
  const written = Promise.withResolvers();
  const commit = Promise.withResolvers();
  const writer = db.write(async (tx) => {
    await db.place(tx, guard, "Committed topic", start.indexRevision);
    written.resolve();
    await commit.promise;
  });

  try {
    await Promise.race([writer, written.promise]);
    assert.deepEqual(await db.read(db.status), start);
  } finally {
    commit.resolve();
    await writer;
  }
  const after = await db.read(db.status);
  assert.equal(after.indexRevision, start.indexRevision + 1);
  assert.notEqual(after.stateToken, start.stateToken);
  assert.equal(after.items[0].title, "Committed topic");
});

test("Postgres suppression facts retain individual epochs while sharing a run index advance", migrationDbTest, async (t) => {
  const db = await setup(t);
  const start = await db.read(db.status);
  await db.write(async (tx) => {
    for (const i of [1, 2]) {
      const id = `hidden-${i}`;
      const { epoch } = await db.facts.writeFact(tx,
        { ...scope, kind: "identity", origin: "forget", actionId: id, memoryId: id }, sha(id));
      assert.equal(epoch, BigInt(i));
    }
    const guard = await db.seed(tx, "Source unaffected by the two facts");
    await db.place(tx, guard, "Topic after two facts", start.indexRevision);
    assert.equal(await db.token(tx), start.stateToken);
  });
  assert.deepEqual(await db.counters(), { hosted: 7, core: 1, facts: 2 });
});
