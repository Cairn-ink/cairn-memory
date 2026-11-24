import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { factIncarnationBody } from "../../core/src/index.mjs";
import { createCaptureProofs } from "../src/capture-source.mjs";
import {
  createPostgresMemoryCandidates, createPostgresMemoryReads, createPostgresRawReads, createPostgresSuppressionStore,
  createPostgresUnitOfWork, query,
} from "../src/index.mjs";
import { advanceIndex, timestampUs } from "../src/memory-rows.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const owner = "retrieval-owner";
const otherOwner = "other-owner";
const lineageSecret = "test-lineage-secret";
const personal = { owner, namespaces: [null] };
const rawOptions = { lineageSecret };
const axis = new Float32Array(1536);
axis[0] = 1;

function embedding(distance) {
  const values = Array.from(axis);
  values[0] = 1 - distance;
  values[1] = Math.sqrt(1 - values[0] ** 2);
  return JSON.stringify(values);
}

function rawRef(id, namespace = null) {
  return { type: "raw", namespace, id };
}

function memoryRef(id) {
  return { type: "memory", namespace: null, id };
}

async function addMemory(pool, id, { user = owner, time = 10, client = "one", distance = 0, text = "orchard" } = {}) {
  await pool.query(`INSERT INTO memories (id, user_id, text, kind, text_hash, embedding, embedding_model,
    source_kind, source_client, created_at, updated_at)
    VALUES ($1, $2, $3, 'fact', $1, $4::vector, 'test', 'plugin', $5, ${timestampUs("$6")}, ${timestampUs("$7")})`,
  [id, user, text, embedding(distance), client, time * 1000, time * 1000 + 1]);
}

async function addRaw(pool, id, { user = owner, client = "one", session = "open", us = 10_000, content = "cedar garden",
  messageId = id } = {}) {
  await pool.query(`INSERT INTO raw_messages (id, user_id, client, session_id, message_id, occurred_at, role, content)
    VALUES ($1, $2, $3, $4, $5, ${timestampUs("$6")}, 'user', $7)`,
  [id, user, client, session, messageId, us, content]);
}

async function setup(t) {
  const database = await migrationDatabase(t);
  await database.pool.query("INSERT INTO users (id) VALUES ($1), ($2)", [owner, otherOwner]);
  return { ...database, uow: createPostgresUnitOfWork(database.source) };
}

async function addFact(uow, fact) {
  const body = { owner, namespace: null, origin: "forget", actionId: "test", ...fact };
  const incarnation = createHash("sha256").update(factIncarnationBody(body)).digest("hex");
  await uow.run(owner, {}, tx => createPostgresSuppressionStore().writeFact(tx, body, incarnation));
}

test("Postgres ranks only scoped current memories before depth and rechecks hidden refs", migrationDbTest, async (t) => {
  const { pool, uow } = await setup(t);
  const { lexical, vector } = createPostgresMemoryCandidates();
  const { fence } = createPostgresMemoryReads();
  await addMemory(pool, "before", { time: 9, text: "orchard orchard orchard orchard" });
  await addMemory(pool, "after", { time: 20, text: "orchard orchard orchard orchard" });
  await addMemory(pool, "unassigned", { time: 19, client: null, text: "orchard orchard orchard" });
  await addMemory(pool, "wrong-client", { time: 19, client: "two", text: "orchard orchard orchard" });
  await addMemory(pool, "foreign", { user: otherOwner, time: 19, text: "orchard orchard orchard" });
  await addMemory(pool, "withheld", { time: 18, text: "orchard orchard" });
  await addMemory(pool, "visible", { time: 10, distance: 1.2 });
  const selection = { ...personal, clients: ["one"], window: { sinceMs: 10, untilMs: 20 } };

  await uow.run(owner, { readOnly: true }, async tx => {
    assert.deepEqual(await fence.assertVisible(tx, selection, [memoryRef("withheld")]), [memoryRef("withheld")]);
  });
  await addFact(uow, { kind: "identity", memoryId: "withheld" });
  await uow.run(owner, { readOnly: true }, async tx => {
    const result = await lexical.lexical(tx, selection, "orchard", 1, {});
    assert.equal(result.matched, true);
    assert.deepEqual(result.rows.map(({ ref }) => ref), [memoryRef("visible")]);
    const semantic = await vector.vector(tx, selection, axis, "test", 1);
    assert.deepEqual(semantic.coverage, { eligible: 1, embedded: 1, complete: true });
    assert.deepEqual(semantic.rows.map(({ ref }) => ref), [memoryRef("visible")]);
    assert.ok(Math.abs(semantic.rows[0].distance - 1.2) < 1e-6);
    for (const intent of [undefined, "read"]) {
      assert.deepEqual(await fence.assertVisible(tx, selection,
        ["foreign", "withheld", "missing", "visible", "before"].map(memoryRef), intent), [memoryRef("visible")]);
    }
    await assert.rejects(lexical.lexical(tx, { ...selection, owner: otherOwner }, "orchard", 1, {}), { code: "internal_error" });
  });
});

test("Postgres searches and pages the personal raw archive with scoped cursors", migrationDbTest, async (t) => {
  const { pool, uow } = await setup(t);
  const raw = createPostgresRawReads(rawOptions);
  await addRaw(pool, "first", { us: 9_999 });
  await addRaw(pool, "tie-a");
  await addRaw(pool, "tie-b");
  await addRaw(pool, "within", { us: 10_001, content: "cedar cedar cedar" });
  await addRaw(pool, "end", { us: 20_000 });
  await addRaw(pool, "unknown", { us: null });
  await addRaw(pool, "nonmatch", { client: "two", content: "maple" });
  await addRaw(pool, "wrong-client", { client: "two", content: "cedar cedar cedar cedar" });
  await addRaw(pool, "foreign", { user: otherOwner, content: "cedar cedar cedar cedar cedar" });
  await addRaw(pool, "fenced", { session: "closed", content: "cedar cedar cedar cedar cedar cedar" });
  await pool.query("INSERT INTO capture_raw_fences (user_id, client, session_id) VALUES ($1, 'one', 'closed')", [owner]);

  const mixed = { ...personal, namespaces: ["project", null] };
  const project = { ...personal, namespaces: ["project"] };
  const filtered = { ...mixed, clients: ["one"], window: { sinceMs: 10, untilMs: 20 } };
  const read = (selection, fn) => uow.run(selection.owner, { readOnly: true }, tx => fn(tx, selection));
  const search = (selection, limit = 20) => read(selection, (tx, scope) => raw.raw(tx, scope, "cedar", "search", { limit }));
  const list = (selection, cursor = null, limit = 2) => read(selection, (tx, scope) => raw.listRaw(tx, scope, { cursor, limit }));

  const { segments, coverage } = await search(filtered);
  assert.deepEqual(coverage, { complete: true });
  assert.deepEqual(new Set(segments.map(({ ref }) => ref.id)), new Set(["tie-a", "tie-b", "within"]));
  assert.ok(segments.every(({ ref, score }, i) => ref.namespace === null && Number.isFinite(score) &&
    (i === 0 || score <= segments[i - 1].score)));
  for (const limit of [1, 2]) assert.deepEqual((await search(filtered, limit)).segments, segments.slice(0, limit));
  assert.deepEqual((await search(project)).segments, []);
  assert.deepEqual(await list(project), { items: [], nextCursor: null });
  assert.deepEqual((await search({ ...mixed, clients: [] })).segments, []);
  assert.deepEqual((await search({ ...mixed, owner: otherOwner })).segments.map(({ ref }) => ref.id), ["foreign"]);
  assert.deepEqual((await search({ ...mixed, clients: ["two"] })).segments.map(({ ref }) => ref.id), ["wrong-client"]);

  const scope = { ...mixed, clients: ["one"] };
  const first = await list(scope);
  assert.ok(first.nextCursor);
  const second = await list(scope, first.nextCursor);
  assert.ok(second.nextCursor);
  const third = await list(scope, second.nextCursor);
  assert.equal(third.nextCursor, null);
  assert.deepEqual([first, second, third].flatMap(({ items }) => items.map(({ ref }) => ref.id)),
    ["first", "tie-a", "tie-b", "within", "end", "unknown"]);
  assert.ok([first, second, third].every(({ items }) => items.every(({ ref, score }) => ref.namespace === null && score === 0)));
  for (const changed of [personal, filtered, { ...scope, owner: otherOwner }]) {
    await assert.rejects(list(changed, first.nextCursor), { code: "cursor_stale" });
  }
  await assert.rejects(list(scope, "%%%"), { code: "invalid_cursor" });
  await uow.run(owner, {}, tx => advanceIndex((sql, values) => query(tx, sql, values), owner));
  await assert.rejects(list(scope, first.nextCursor), { code: "cursor_stale" });
});

test("Postgres applies the same raw lineage visibility during search, list, and delivery", migrationDbTest, async (t) => {
  const { pool, uow } = await setup(t);
  const raw = createPostgresRawReads(rawOptions);
  const { fence } = createPostgresMemoryReads(rawOptions);
  await addMemory(pool, "memory");
  await addRaw(pool, "ancestor", { session: "closed", messageId: "shared" });
  await addRaw(pool, "copy", { session: "fork", messageId: "shared" });
  await addRaw(pool, "other-copy", { session: "unrelated", messageId: "shared", content: "cedar differs" });
  await addRaw(pool, "id-only", { session: "redacted", messageId: "uncertain", content: "cedar reappears" });
  const captureProofs = createCaptureProofs(lineageSecret);
  const [proof, uncertain] = await captureProofs({ scope: { owner, namespace: null }, client: "one" },
    [{ id: "shared", content: "cedar garden" }, { id: "uncertain", content: "" }]);
  await pool.query(`INSERT INTO capture_raw_lineage (user_id, client, session_id, message_mac, content_mac)
    VALUES ($1, 'one', 'closed', $2, $3), ($1, 'one', 'closed', $4, NULL)`,
  [owner, proof.message_mac, proof.content_mac, uncertain.message_mac]);
  await pool.query("INSERT INTO capture_raw_fences (user_id, client, session_id) VALUES ($1, 'one', 'closed')", [owner]);

  await uow.run(owner, { readOnly: true }, async tx => {
    assert.deepEqual((await raw.raw(tx, personal, "cedar", "context", { limit: 1 })).segments.map(({ ref }) => ref),
      [rawRef("other-copy")]);
    assert.deepEqual((await raw.listRaw(tx, personal, { limit: 1, cursor: null })).items.map(({ ref }) => ref),
      [rawRef("other-copy")]);
    assert.deepEqual(await fence.assertVisible(tx, { ...personal, namespaces: [null, "project"] },
      [rawRef("copy"), rawRef("other-copy"), rawRef("other-copy", "project"), memoryRef("memory"), rawRef("ancestor"),
        rawRef("id-only"), rawRef("other-copy")]),
    [rawRef("other-copy"), memoryRef("memory"), rawRef("other-copy")]);
  });
});

function indexNames(plan) {
  return [plan["Index Name"], ...(plan.Plans ?? []).flatMap(indexNames)].filter(Boolean);
}

test("Postgres retrieval plans use hosted search and scoped indexes on populated tables", migrationDbTest, async (t) => {
  const { pool, source, uow: writes } = await setup(t);
  await addMemory(pool, "hit", { text: "quartzneedle" });
  await addRaw(pool, "hit", { content: "quartzneedle" });
  await addRaw(pool, "fenced", { session: "closed", content: "quartzneedle" });
  await pool.query(`INSERT INTO memories (id, user_id, text, kind, text_hash, embedding, embedding_model, source_kind, source_client)
    SELECT 'noise-' || i, $1, 'background ' || i, 'fact', 'noise-' || i, $2::vector, 'test', 'plugin', 'one'
    FROM generate_series(1, 300) i`, [otherOwner, embedding(0.5)]);
  await pool.query(`INSERT INTO raw_messages (id, user_id, client, session_id, message_id, role, content)
    SELECT 'noise-' || i, $1, 'one', 'open', 'noise-' || i, 'user', 'background ' || i
    FROM generate_series(1, 300) i`, [owner]);
  await pool.query("INSERT INTO capture_raw_fences (user_id, client, session_id) VALUES ($1, 'one', 'closed')", [owner]);
  await pool.query(`INSERT INTO core_memory_receipts (user_id, memory_id, client, session_id, message_id, role)
    VALUES ($1, 'hit', 'one', 'open', 'hit', 'user')`, [owner]);
  await pool.query(`INSERT INTO capture_raw_fences (user_id, client, session_id)
    SELECT $1, 'one', 'noise-' || i FROM generate_series(1, 4000) i`, [otherOwner]);
  await pool.query(`INSERT INTO core_memory_receipts (user_id, memory_id, client, session_id, message_id, role)
    SELECT $1, 'noise-' || i, 'one', 'open', 'noise-' || i, 'user' FROM generate_series(1, 4000) i`, [otherOwner]);
  await addFact(writes, { kind: "session", session: { client: "one", sessionId: "closed" } });
  await pool.query("ANALYZE");

  const plans = new Map();
  const uow = createPostgresUnitOfWork({
    async connect() {
      const connection = await source.connect();
      return {
        release: connection.release,
        async query(sql, args) {
          const kind = sql.includes("pgroonga_score") ? (sql.includes("FROM raw_messages") ? "raw" : "lexical")
            : sql.includes("<=>") ? "vector" : sql.includes("FROM core_memory_receipts") ? "receipts" : null;
          if (kind) {
            const { rows } = await connection.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, args);
            plans.set(kind, indexNames(rows[0]["QUERY PLAN"][0].Plan));
          }
          return connection.query(sql, args);
        },
      };
    },
  });
  const { lexical, vector } = createPostgresMemoryCandidates();
  const raw = createPostgresRawReads(rawOptions);
  const scope = { ...personal, clients: ["one"], window: { sinceMs: 10, untilMs: 20 } };
  await uow.run(owner, { readOnly: true }, async tx => {
    assert.deepEqual((await lexical.lexical(tx, scope, "quartzneedle", 1, {})).rows.map(({ ref }) => ref.id), ["hit"]);
    assert.deepEqual((await vector.vector(tx, scope, axis, "test", 1)).rows.map(({ ref }) => ref.id), ["hit"]);
    assert.deepEqual((await raw.raw(tx, scope, "quartzneedle", "search", { limit: 1 })).segments.map(({ ref }) => ref.id), ["hit"]);
  });

  assert.ok(plans.get("lexical").includes("memories_text_idx"), JSON.stringify([...plans]));
  assert.ok(plans.get("raw").includes("raw_messages_content_idx"), JSON.stringify([...plans]));
  assert.ok(plans.get("raw").includes("capture_raw_fences_user_id_client_session_id_pk"), JSON.stringify([...plans]));
  assert.ok(plans.get("vector").some(name => name.startsWith("memories_user_")), JSON.stringify([...plans]));
  assert.ok(plans.get("receipts").some(name => name.startsWith("core_memory_receipts_")), JSON.stringify([...plans]));
  t.diagnostic(JSON.stringify(Object.fromEntries(plans)));
});
