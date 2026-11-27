import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { capabilities, CoreError, coreDigest, coreFingerprintLabels, factIncarnationBody, userFingerprintKey } from "@cairn-ink/core";
import { buildDocumentCard, documentCardVisible } from "@cairn-ink/core/routing";
import { forgetMethod } from "../../core/src/service/forget.mjs";
import {
  applyMigrations, createPostgresDocumentCardStore, createPostgresDocumentCardCandidates,
  createPostgresMemoryStore, createPostgresRawPorts, createPostgresSuppressionStore, createPostgresUnitOfWork, query,
} from "../src/index.mjs";
import { readCatalog } from "./catalog.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const owner = "owner";
const scope = { owner, namespace: null };
const selection = { owner, namespaces: [null] };
const embedding = { model: "fixture", vector: Float32Array.from([1, ...Array(1535).fill(0)]) };
const ref = id => ({ id, type: "card", namespace: null });
const digest = text => createHash("sha256").update(text).digest("hex");
const sourceMessage = { client: "client", sessionId: "source-session", messageId: "message" };

const card = (id, body = "Cabinet inventory") => ({
  id, scope, origin: "manual", title: "Workshop notes", body, contentHash: digest(body),
  date: null, sourceMessage: null, sourceMemories: [], sentences: [], stale: [],
});

const amendment = (id = "amendment") => ({
  amendmentId: id, date: "2025-02-01", sentence: "Check the latch.", quote: "Remember to check the latch.",
  sourceMessage: { client: "client", sessionId: "revision-session", messageId: id },
});

async function shapeProduction(pool) {
  await pool.query(`
    ALTER TABLE document_cards ADD COLUMN scope_id text NOT NULL,
      ADD CONSTRAINT document_cards_scope_id_id_unique UNIQUE (scope_id, id),
      ADD COLUMN embedding vector(1536), ADD COLUMN embedding_model text,
      ADD COLUMN embedding_text_version smallint, ADD COLUMN embedding_content_hash text,
      ADD CONSTRAINT document_cards_embedding_check
        CHECK (num_nonnulls(embedding, embedding_model, embedding_text_version, embedding_content_hash) IN (0, 4));
    CREATE FUNCTION public.default_document_card_scope() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.scope_id IS NULL THEN
        NEW.scope_id := NEW.user_id;
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER document_cards_default_scope BEFORE INSERT ON document_cards
      FOR EACH ROW EXECUTE FUNCTION public.default_document_card_scope();
    CREATE INDEX document_cards_scope_created_idx ON document_cards (scope_id, created_at DESC NULLS LAST, id);
    CREATE FUNCTION document_card_search_text(title text, body text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
      SELECT CASE WHEN title IS NULL OR title = '' THEN body ELSE title || E'\\n\\n' || body END;
    $$;
    CREATE INDEX document_cards_search_text_idx ON document_cards
      USING pgroonga (document_card_search_text(title, body)) WHERE hidden_reason IS NULL AND NOT tombstoned;
    CREATE INDEX document_cards_live_source_idx ON document_cards
      USING btree (user_id, source_client, source_session_id, source_message_id) WHERE hidden_reason IS NULL AND NOT tombstoned;
  `);
}

test("Postgres card migration preserves the production schema and writer defaults", migrationDbTest, async t => {
  const { pool, source, migrations } = await migrationDatabase(t, { migrate: false });
  const last = migrations.findIndex(({ id }) => id === "0026_core_document_card_search.sql");
  assert.ok(last > 0);
  await applyMigrations(source, migrations.slice(0, last));
  await shapeProduction(pool);
  await pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
  const insert = id => pool.query(`INSERT INTO document_cards
    (user_id, id, content_hash, title, body, origin, source_memories, sentences, stale)
    VALUES ($1, $2, 'hash', '', 'Notes', 'manual', '[]', '[]', '[]') RETURNING scope_id`, [owner, id]);
  assert.equal((await insert("before")).rows[0].scope_id, owner);
  const definitions = async () => (await pool.query(`SELECT
    (SELECT jsonb_agg(jsonb_build_array(attrelid, attnum, attname, atttypid, atttypmod, attnotnull) ORDER BY attnum)
      FROM pg_attribute WHERE attrelid = 'document_cards'::regclass AND attnum > 0 AND NOT attisdropped) AS columns,
    (SELECT jsonb_agg(jsonb_build_array(oid, pg_get_constraintdef(oid)) ORDER BY oid)
      FROM pg_constraint WHERE conrelid = 'document_cards'::regclass) AS constraints,
    (SELECT jsonb_agg(jsonb_build_array(indexrelid, pg_get_indexdef(indexrelid)) ORDER BY indexrelid)
      FROM pg_index WHERE indrelid = 'document_cards'::regclass) AS indexes,
    (SELECT jsonb_agg(jsonb_build_array(oid, xmin::text, pg_get_functiondef(oid)) ORDER BY oid)
      FROM pg_proc WHERE oid IN ('document_card_search_text(text,text)'::regprocedure, 'default_document_card_scope()'::regprocedure)) AS functions,
    (SELECT jsonb_agg(jsonb_build_array(oid, xmin::text, pg_get_triggerdef(oid)) ORDER BY oid)
      FROM pg_trigger WHERE tgrelid = 'document_cards'::regclass AND NOT tgisinternal) AS triggers`)).rows[0];
  const before = await definitions();
  const writer = await pool.connect();
  let checkedLock = false;
  try {
    await writer.query("BEGIN");
    await writer.query("UPDATE document_cards SET title = 'Concurrent update' WHERE user_id = $1", [owner]);
    // Migration 0027 changes the keys and is covered by k4.
    await applyMigrations({
      async connect() {
        const connection = await source.connect();
        return {
          ...connection,
          async query(sql, values) {
            const result = await connection.query(sql, values);
            if (sql === migrations[last].sql) {
              const { rows } = await connection.query(`SELECT mode FROM pg_locks
                WHERE relation = 'public.document_cards'::regclass AND pid = pg_backend_pid()`);
              assert.deepEqual(rows, []);
              checkedLock = true;
            }
            return result;
          },
        };
      },
    }, migrations.slice(0, last + 1));
  } finally {
    try { await writer.query("ROLLBACK"); } finally { writer.release(); }
  }
  assert.equal(checkedLock, true);
  assert.deepEqual(await definitions(), before);
  assert.equal((await insert("after")).rows[0].scope_id, owner);
  const store = createPostgresDocumentCardStore();
  const { run } = createPostgresUnitOfWork(source);
  const beforeCard = await run(owner, { readOnly: true }, tx => store.get(tx, scope, "before"));
  assert.equal(beforeCard.title, "");
  assert.equal(beforeCard.body, "Notes");
  const replacement = card("before", "Replacement notes");
  assert.deepEqual(await run(owner, {}, tx => store.put(tx, scope, replacement, embedding)), { status: "replaced" });
  const { rows: [updated] } = await pool.query(`SELECT scope_id, embedding_model, embedding_text_version, embedding_content_hash
    FROM document_cards WHERE user_id = $1 AND id = $2`, [owner, replacement.id]);
  assert.deepEqual(updated, { scope_id: owner, embedding_model: embedding.model, embedding_text_version: 1,
    embedding_content_hash: replacement.contentHash });
  const { rows: [state] } = await pool.query(`SELECT to_regclass('core_document_card_amendments') AS amendments,
    document_card_search_text('Title', 'Body') AS titled, document_card_search_text(NULL, 'Body') AS untitled`);
  assert.deepEqual(state, { amendments: "core_document_card_amendments", titled: "Title\n\nBody", untitled: "Body" });
});

test("Postgres installs the document card team keys", migrationDbTest, async t => {
  const { pool } = await migrationDatabase(t);
  const catalog = await readCatalog(pool, ["document_cards"]);
  const entries = new Set(catalog.map(entry => entry.split("\t").slice(1).join("\t")));
  for (const entry of [
    "column\tuser_id\ttext NULL",
    "constraint\tdocument_cards_scope_id_id_pk\tPRIMARY KEY (scope_id, id)",
    "constraint\tdocument_cards_user_id_id_pk\tUNIQUE (user_id, id)",
    "constraint\tdocument_cards_scope_id_id_unique\tUNIQUE (scope_id, id)",
    "constraint\tdocument_cards_team_author_check\tCHECK (((user_id IS NOT NULL) OR (scope_id ~~ 'team:%'::text)))",
    "constraint\tdocument_cards_user_id_users_id_fk\tFOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL",
  ]) {
    assert.ok(entries.has(entry), entry);
  }
  const { rows } = await pool.query(`SELECT pg_get_triggerdef(oid) AS definition, tgenabled AS enabled
    FROM pg_trigger WHERE tgrelid = 'public.users'::regclass
      AND tgname = 'document_cards_delete_personal' AND NOT tgisinternal`);
  assert.deepEqual(rows, [{
    definition: "CREATE TRIGGER document_cards_delete_personal BEFORE DELETE ON public.users "
      + "FOR EACH ROW EXECUTE FUNCTION delete_personal_document_cards()",
    enabled: "O",
  }]);
});

test("Postgres retains team cards when their author is deleted", migrationDbTest, async t => {
  const { pool } = await migrationDatabase(t);
  await pool.query(`
    INSERT INTO users (id) VALUES ('owner'), ('other');
    INSERT INTO document_cards (user_id, scope_id, id, content_hash, title, body, origin, source_memories, sentences, stale)
    VALUES ('owner', 'owner', 'personal', 'hash', 'Title', 'Personal', 'manual', '[]', '[]', '[]'),
           ('owner', 'team:x', 'team', 'hash', 'Title', 'Shared', 'manual', '[]', '[]', '[]'),
           ('other', 'other', 'personal', 'hash', 'Title', 'Other', 'manual', '[]', '[]', '[]'),
           ('other', 'team:x', 'other-team', 'hash', 'Title', 'Other shared', 'manual', '[]', '[]', '[]');
    INSERT INTO topics (user_id, id, level, title, title_key)
    SELECT id, 'topic', 1, 'Topic', 'topic' FROM users;
    INSERT INTO core_document_card_amendments
      (user_id, card_id, amendment_id, date, sentence, quote, source_client, source_session_id, source_message_id)
    SELECT user_id, id, 'amendment', '2025-02-01', 'Sentence', 'Quote', 'client', 'session', 'message'
      FROM document_cards WHERE scope_id = user_id;
    INSERT INTO card_topics (user_id, card_id, topic_id, content_hash)
    SELECT user_id, id, 'topic', content_hash FROM document_cards WHERE scope_id = user_id;
    INSERT INTO card_placements (user_id, card_id, content_hash, status)
    SELECT user_id, id, content_hash, 'filed' FROM document_cards WHERE scope_id = user_id;
  `);
  const relatedRows = table => pool.query(`SELECT user_id, card_id FROM ${table} ORDER BY user_id COLLATE "C"`);
  const otherPersonal = { user_id: "other", card_id: "personal" };
  const tables = ["core_document_card_amendments", "card_topics", "card_placements"];
  for (const table of tables) {
    assert.deepEqual((await relatedRows(table)).rows, [otherPersonal, { user_id: "owner", card_id: "personal" }], table);
  }
  assert.equal((await pool.query("DELETE FROM users WHERE id = 'owner'")).rowCount, 1);
  assert.deepEqual((await pool.query(`SELECT user_id, scope_id, id, body FROM document_cards
    ORDER BY scope_id COLLATE "C", id COLLATE "C"`)).rows, [
    { user_id: "other", scope_id: "other", id: "personal", body: "Other" },
    { user_id: "other", scope_id: "team:x", id: "other-team", body: "Other shared" },
    { user_id: null, scope_id: "team:x", id: "team", body: "Shared" },
  ]);
  for (const table of tables) {
    assert.deepEqual((await relatedRows(table)).rows, [otherPersonal], table);
  }
});

test("Postgres rejects personal cards without an author", migrationDbTest, async t => {
  const { pool } = await migrationDatabase(t);
  await assert.rejects(pool.query(`
    INSERT INTO document_cards (user_id, scope_id, id, content_hash, title, body, origin, source_memories, sentences, stale)
    VALUES (NULL, 'owner', 'personal', 'hash', 'Title', 'Personal', 'manual', '[]', '[]', '[]')
  `), { code: "23514", constraint: "document_cards_team_author_check" });
});

test("Postgres applies all migrations after hosted document card team keys", migrationDbTest, async t => {
  const { pool, source, migrations } = await migrationDatabase(t, { migrate: false });
  const teamKeys = migrations.find(({ id }) => id === "0027_core_document_card_team_keys.sql");
  assert.ok(teamKeys);
  // Hosted creates the pre-upgrade card table before running its copy of the migration.
  await pool.query(`
    CREATE TABLE document_cards (
      user_id text NOT NULL, id text NOT NULL, content_hash text NOT NULL, title text NOT NULL, body text NOT NULL,
      date_ms bigint, origin text NOT NULL DEFAULT 'router', source_client text, source_session_id text, source_message_id text,
      source_memories jsonb NOT NULL, sentences jsonb NOT NULL, stale jsonb NOT NULL, hidden_reason text,
      tombstoned boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT document_cards_user_id_id_pk PRIMARY KEY (user_id, id),
      CONSTRAINT document_cards_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT document_cards_origin_check CHECK (origin IN ('router', 'import', 'manual')),
      CONSTRAINT document_cards_router_source_check CHECK (origin <> 'router'
        OR (source_client IS NOT NULL AND source_session_id IS NOT NULL AND source_message_id IS NOT NULL))
    );
    CREATE INDEX document_cards_user_created_idx ON document_cards (user_id, created_at DESC NULLS LAST, id);
    CREATE INDEX document_cards_source_memories_idx ON document_cards USING gin (source_memories jsonb_path_ops)
      WHERE hidden_reason IS NULL AND NOT tombstoned;
  `);
  await shapeProduction(pool);
  await pool.query(teamKeys.sql);
  const readFunction = async () => (await pool.query(`SELECT oid, xmin::text, pg_get_functiondef(oid) AS definition
    FROM pg_proc WHERE oid = 'public.delete_personal_document_cards()'::regprocedure`)).rows;
  const hostedFunction = await readFunction();
  await applyMigrations(source, migrations);
  const readLedger = async () => (await pool.query(`SELECT id, applied_at::text
    FROM core_schema_migrations ORDER BY id COLLATE "C"`)).rows;
  const ledger = await readLedger();
  assert.deepEqual(ledger.map(({ id }) => id), migrations.map(({ id }) => id));

  const writer = await pool.connect();
  try {
    await writer.query("BEGIN");
    await writer.query(`
      INSERT INTO users (id) VALUES ('owner');
      INSERT INTO document_cards (user_id, id, content_hash, title, body, origin, source_memories, sentences, stale)
      VALUES ('owner', 'card', 'hash', 'Title', 'Body', 'manual', '[]', '[]', '[]');
    `);
    const replay = await pool.connect();
    try {
      await replay.query("BEGIN");
      // Replay the SQL itself since the runner skips migrations already in the ledger.
      await replay.query(teamKeys.sql);
      const { rows } = await replay.query(`SELECT relation::regclass::text, mode FROM pg_locks
        WHERE pid = pg_backend_pid() AND relation IN ('public.document_cards'::regclass, 'public.users'::regclass)`);
      assert.deepEqual(rows, []);
      await replay.query("COMMIT");
    } finally {
      replay.release(true);
    }
    await applyMigrations(source, migrations);
    assert.deepEqual(await readLedger(), ledger);
    assert.deepEqual(await readFunction(), hostedFunction);
  } finally {
    try { await writer.query("ROLLBACK"); } finally { writer.release(); }
  }
});

async function setup(t, profile) {
  const { source, pool } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
  const key = profile === "keyed" ? await userFingerprintKey(randomUUID(), owner, coreFingerprintLabels) : null;
  const hashSessionKey = (client, sessionId) => digest(JSON.stringify([client, sessionId]));
  const options = { lineageSecret: randomUUID(), hashSessionKey, sessionKey: hashSessionKey, fingerprintKey: () => key };
  const store = createPostgresDocumentCardStore(options);
  const candidates = createPostgresDocumentCardCandidates(options);
  const uow = createPostgresUnitOfWork(source);
  const { run } = uow;
  const read = work => run(owner, { readOnly: true }, work);
  const write = work => run(owner, { pauseLock: true }, work);
  const put = (value, vector) => write(tx => store.put(tx, scope, value, vector));
  const factStore = createPostgresSuppressionStore({ hashSessionKey });
  const fact = (tx, value) => factStore.writeFact(tx, { ...scope, origin: "forget", actionId: "forget", ...value },
    digest(factIncarnationBody({ ...scope, origin: "forget", actionId: "forget", ...value })));
  const revision = async () => Number((await pool.query(
    "SELECT index_revision FROM core_owner_state WHERE user_id = $1", [owner])).rows[0]?.index_revision ?? 0);
  return { pool, key, options, store, candidates, read, write, put, fact, revision, hashSessionKey, uow };
}

async function storeTeamCard(pool, value, user = owner) {
  await pool.query(`INSERT INTO document_cards (user_id, scope_id, id, content_hash, title, body, origin,
    source_client, source_session_id, source_message_id, source_memories, sentences, stale,
    embedding, embedding_model, embedding_text_version, embedding_content_hash)
    VALUES ($1, 'team:x', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, '[]',
      $12::vector, $13, 1, $3)`, [user, value.id, value.contentHash, value.title, value.body, value.origin,
    value.sourceMessage?.client ?? null, value.sourceMessage?.sessionId ?? null, value.sourceMessage?.messageId ?? null,
    JSON.stringify(value.sourceMemories), JSON.stringify(value.sentences),
    JSON.stringify(Array.from(embedding.vector)), embedding.model]);
}

async function archive(pool, message, source = sourceMessage) {
  await pool.query(`INSERT INTO raw_messages (id, user_id, client, session_id, message_id, role, content, occurred_at)
    VALUES ($1, $2, $3, $4, $5, 'user', $6, to_timestamp(1))`, [randomUUID(), owner,
    source.client, source.sessionId, source.messageId, message]);
}

const selectors = [{ sourceMemoryId: "memory" }, { sourceMessage }, { session: sourceMessage }];

const memoryContent = text => ({
  text, textHash: "sha256:" + digest(text), confidence: 1, kind: "fact", origin: "explicit",
  source: { kind: "mcp", client: null, sessionId: null }, embedding,
});

async function fileCard(pool, { id, contentHash }) {
  await pool.query(`INSERT INTO card_topics (user_id, card_id, topic_id, content_hash)
    VALUES ($1, $2, 'topic', $3)`, [owner, id, contentHash]);
  await pool.query(`INSERT INTO card_placements (user_id, card_id, content_hash, status)
    VALUES ($1, $2, $3, 'filed')`, [owner, id, contentHash]);
}

test("Postgres forget refuses pending legacy facts before erasing memory", migrationDbTest, async t => {
  const { pool, store, read, write, put, uow } = await setup(t, "keyless");
  const memories = createPostgresMemoryStore({ purgeCards: store.purgeCards });
  const duplicates = t.mock.method(memories, "findDuplicates");
  const erase = t.mock.method(memories, "erase");
  const suppressions = createPostgresSuppressionStore();
  const writeFact = t.mock.method(suppressions, "writeFact");
  const forget = forgetMethod({ storage: { uow, memories, suppressions, capabilities: capabilities({}) },
    clock: { sha256Hex: digest } });
  const content = memoryContent("Fasteners are stored in the cabinet.");
  const memory = await write(tx => memories.insert(tx, scope, content, [], 1000));
  const linked = { ...card("linked"), sourceMemories: [{ id: memory.id, revision: memory.revision }] };
  await put(linked, embedding);
  await pool.query(`INSERT INTO suppressions (id, user_id, kind, client, session_id, origin)
    VALUES ('pending', $1, 'session', 'client', 'unrelated', 'forget')`, [owner]);

  await assert.rejects(forget(scope, memory.id, content.source), { code: "ineligible" });
  assert.equal(duplicates.mock.callCount(), 1);
  assert.equal(writeFact.mock.callCount(), 0);
  assert.equal(erase.mock.callCount(), 0);
  assert.equal((await read(tx => memories.get(tx, scope, memory.id))).id, memory.id);
  assert.deepEqual((await pool.query("SELECT tombstoned, body FROM document_cards WHERE id = $1", [linked.id])).rows,
    [{ tombstoned: false, body: linked.body }]);

  await pool.query("UPDATE core_owner_state SET legacy_facts_ready = true WHERE user_id = $1", [owner]);
  assert.equal((await forget(scope, memory.id, content.source)).status, "forgotten");
  assert.equal(erase.mock.callCount(), 1);
  assert.deepEqual((await pool.query("SELECT tombstoned, body FROM document_cards WHERE id = $1", [linked.id])).rows,
    [{ tombstoned: true, body: "" }]);
});

for (const profile of ["keyless", "keyed"]) {
  test(`Postgres ${profile} isolates team cards from all personal operations`, migrationDbTest, async t => {
    const db = await setup(t, profile);
    const { store, candidates, read, write, pool, put, revision } = db;
    const message = "Cabinet inventory.";
    const { card: routed } = await buildDocumentCard({ id: sourceMessage.messageId, role: "user", content: message },
      { scope, client: sourceMessage.client, canonicalSessionKey: db.hashSessionKey(sourceMessage.client, sourceMessage.sessionId) });
    const team = { ...card(routed.id), origin: "router", title: routed.title, body: routed.body, sourceMessage,
      sourceMemories: [{ id: "memory", revision: 1 }] };
    await archive(pool, message);
    await storeTeamCard(pool, team);
    const stored = () => pool.query("SELECT * FROM document_cards WHERE user_id = $1 AND id = $2", [owner, team.id]);
    const before = (await stored()).rows;
    await read(async tx => {
      assert.equal(await store.get(tx, scope, team.id), null);
      assert.deepEqual(await store.list(tx, scope), []);
      assert.deepEqual(await store.visibilityInputs(tx, scope, [ref(team.id)]), [null]);
      assert.deepEqual(await candidates.lexical(tx, selection, "cabinet", 5, {}), { rows: [], matched: false });
      assert.deepEqual(await candidates.vector(tx, selection, embedding.vector, embedding.model, 5),
        { rows: [], coverage: { eligible: 0, embedded: 0, complete: true } });
      assert.deepEqual(await store.listForPurge(tx, scope), []);
    });
    await write(async tx => {
      await store.hide(tx, scope, team.id, "hidden");
      for (const selector of selectors) {
        assert.deepEqual(await store.hideWhere(tx, scope, selector, "hidden"), { hidden: 0 });
        assert.deepEqual(await store.hideWhere(tx, scope, selector, "purged", { purge: true }), { hidden: 0 });
      }
      await store.purgeById(tx, scope, team.id, "purged");
    });
    await assert.rejects(put(team, embedding), { code: "revision_conflict" });
    assert.deepEqual((await stored()).rows, before);
    assert.equal(await revision(), 0);
  });

  test(`Postgres ${profile} erases payloads and reserves a purged ID`, migrationDbTest, async t => {
    const { store, pool, put, write, read, revision } = await setup(t, profile);
    const value = { ...card("purged"), sourceMemories: [{ id: "memory", revision: 1 }],
      sentences: [{ start: 0, end: 7, source: sourceMessage }] };
    await put(value, embedding);
    const change = amendment();
    assert.deepEqual(await write(tx => store.amend(tx, scope, value.id, change)), { status: "inserted" });
    assert.deepEqual(await write(tx => store.hideWhere(tx, scope, selectors[0], "hidden", { retainText: true })), { hidden: 2 });
    const retained = (await pool.query("SELECT body, embedding_model, tombstoned FROM document_cards WHERE id = $1", [value.id])).rows[0];
    assert.deepEqual(retained, { body: value.body, embedding_model: embedding.model, tombstoned: false });
    assert.deepEqual(await write(tx => store.hideWhere(tx, scope, selectors[0], "purged", { purge: true })), { hidden: 0 });
    const { rows: [row] } = await pool.query(`SELECT id, title, body, sentences, hidden_reason, tombstoned, embedding,
      embedding_model, embedding_text_version, embedding_content_hash FROM document_cards WHERE id = $1`, [value.id]);
    assert.deepEqual(row, { id: value.id, title: "", body: "", sentences: [], hidden_reason: "purged", tombstoned: true,
      embedding: null, embedding_model: null, embedding_text_version: null, embedding_content_hash: null });
    const { rows: [changed] } = await pool.query(`SELECT amendment_id, sentence, quote, hidden_reason, purged
      FROM core_document_card_amendments WHERE card_id = $1`, [value.id]);
    assert.deepEqual(changed, { amendment_id: change.amendmentId, sentence: "", quote: "", hidden_reason: "purged", purged: true });
    assert.equal(await read(tx => store.get(tx, scope, value.id)), null);
    const after = await revision();
    assert.deepEqual(await put({ ...value, contentHash: digest("Different hash") }, embedding), { status: "tombstoned" });
    assert.equal(await revision(), after);
  });

  test(`Postgres ${profile} hide and purge roll back card memberships with the payload`, migrationDbTest, async t => {
    const { store, pool, put, write, read } = await setup(t, profile);
    const value = card("filed");
    await put(value, embedding);
    await pool.query("INSERT INTO topics (user_id, id, level, title, title_key) VALUES ($1, 'topic', 1, 'Filed', 'filed')", [owner]);
    await pool.query(`INSERT INTO card_topics (user_id, card_id, topic_id, content_hash) VALUES ($1, $2, 'topic', $3)`,
      [owner, value.id, value.contentHash]);
    await pool.query(`INSERT INTO card_placements (user_id, card_id, content_hash, status) VALUES ($1, $2, $3, 'filed')`,
      [owner, value.id, value.contentHash]);
    const counts = async tx => (await query(tx, `SELECT
      (SELECT count(*)::int FROM card_topics WHERE user_id = $1 AND card_id = $2) AS topics,
      (SELECT count(*)::int FROM card_placements WHERE user_id = $1 AND card_id = $2) AS placements`, [owner, value.id])).rows[0];
    for (const op of [store.hide, store.purgeById]) {
      await assert.rejects(write(async tx => {
        await op(tx, scope, value.id, "forget");
        assert.deepEqual(await counts(tx), { topics: 0, placements: 0 });
        assert.equal(await store.get(tx, scope, value.id), null);
        throw new CoreError("storage_error");
      }), { code: "storage_error" });
      assert.deepEqual(await read(counts), { topics: 1, placements: 1 });
      assert.equal((await read(tx => store.get(tx, scope, value.id))).body, value.body);
    }
    await write(tx => store.purgeById(tx, scope, value.id, "forget"));
    assert.deepEqual(await read(counts), { topics: 0, placements: 0 });
  });

  test(`Postgres ${profile} excludes a card when its whole Raw message is withheld`, migrationDbTest, async t => {
    const { store, pool, candidates, read, write, put, fact, hashSessionKey } = await setup(t, profile);
    const message = "Cabinet inventory.";
    const canonicalSessionKey = hashSessionKey(sourceMessage.client, sourceMessage.sessionId);
    const { card: routed } = await buildDocumentCard({ id: sourceMessage.messageId, role: "user", content: message },
      { scope, client: sourceMessage.client, canonicalSessionKey });
    const value = { ...card(routed.id), origin: "router", title: routed.title, body: routed.body, sourceMessage };
    await archive(pool, message);
    await put(value, embedding);
    assert.equal((await pool.query("SELECT source_session_id FROM document_cards WHERE id = $1", [value.id])).rows[0].source_session_id,
      sourceMessage.sessionId);
    const input = async () => (await read(tx => store.visibilityInputs(tx, scope, [ref(value.id)])))[0];
    const lexical = () => read(tx => candidates.lexical(tx, selection, "cabinet", 5, {}));
    const vector = () => read(tx => candidates.vector(tx, selection, embedding.vector, embedding.model, 5));
    assert.equal((await input()).card.canonicalSessionKey, canonicalSessionKey);
    assert.equal((await documentCardVisible(await input())).visible, true);
    assert.equal((await lexical()).rows[0].ref.id, value.id);
    assert.equal((await vector()).rows[0].ref.id, value.id);
    if (profile === "keyed") {
      await write(tx => fact(tx, { kind: "session", session: { client: sourceMessage.client, sessionKeyHash: canonicalSessionKey } }));
    } else {
      await pool.query(`INSERT INTO core_memory_receipts
        (user_id, memory_id, client, session_id, message_id, role, forgotten_at)
        VALUES ($1, 'erased-memory', $2, $3, $4, 'user', now())`, [owner, ...Object.values(sourceMessage)]);
    }
    assert.deepEqual(await documentCardVisible(await input()), { visible: false, reason: "source_withheld" });
    assert.deepEqual(await lexical(), { rows: [], matched: false });
    assert.deepEqual((await vector()).rows, []);
  });

  test(`Postgres ${profile} advances the owner revision once per effective card call`, migrationDbTest, async t => {
    const { store, pool, revision, write } = await setup(t, profile);
    const value = card("revision");
    const changed = { ...value, contentHash: digest("Revised"), body: "Revised" };
    const stale = { memoryId: "earlier", replacementMemoryId: "later" };
    const first = amendment("first"), second = amendment("second");
    const before = await revision();
    await write(async tx => {
      const count = async delta => assert.equal(Number((await query(tx,
        "SELECT index_revision FROM core_owner_state WHERE user_id = $1", [owner])).rows[0].index_revision), before + delta);
      await store.put(tx, scope, value);
      await store.put(tx, scope, value);
      await count(1);
      await store.put(tx, scope, changed, embedding);
      await count(2);
      await store.markStale(tx, scope, value.id, stale);
      await store.markStale(tx, scope, value.id, stale);
      await count(3);
      await store.linkMemories(tx, scope, value.id, [{ id: "memory", revision: 1 }]);
      await store.linkMemories(tx, scope, value.id, [{ id: "memory", revision: 1 }]);
      await count(4);
      for (const item of [first, second, first]) await store.amend(tx, scope, value.id, item);
      await count(6);
      await store.hideAmendment(tx, scope, value.id, first.amendmentId, "forget");
      await store.hideAmendment(tx, scope, value.id, first.amendmentId, "forget");
      await count(7);
      assert.deepEqual(await store.hideWhere(tx, scope, selectors[0], "forget"), { hidden: 2 });
      await count(8);
      await store.hide(tx, scope, value.id, "forget");
      await count(8);
      await store.purgeById(tx, scope, value.id, "forget");
      await store.purgeById(tx, scope, value.id, "forget");
      await count(9);
    });
    assert.equal(await revision(), before + 9);
    assert.equal((await pool.query("SELECT hidden_reason FROM document_cards WHERE id = $1", [value.id])).rows[0].hidden_reason, "forget");
  });

  test(`Postgres ${profile} excludes ordinary hides from store reads and both candidate channels`, migrationDbTest, async t => {
    const { store, candidates, read, write, put } = await setup(t, profile);
    const hidden = card("hidden");
    const live = card("live");
    await put(hidden, embedding);
    await put(live, embedding);
    await write(tx => store.hide(tx, scope, hidden.id, "forget"));
    await read(async tx => {
      assert.equal(await store.get(tx, scope, hidden.id), null);
      assert.deepEqual((await store.list(tx, scope)).map(({ id }) => id), [live.id]);
      assert.deepEqual(await store.visibilityInputs(tx, scope, [ref(hidden.id)]), [null]);
      assert.deepEqual((await candidates.lexical(tx, selection, "cabinet", 5, {})).rows.map(({ ref }) => ref.id), [live.id]);
      assert.deepEqual((await candidates.vector(tx, selection, embedding.vector, embedding.model, 5)).rows.map(({ ref }) => ref.id), [live.id]);
    });
  });

  test(`Postgres ${profile} requires matching embeddings across all live personal cards`, migrationDbTest, async t => {
    const { store, pool, candidates, read, put } = await setup(t, profile);
    const embedded = card("embedded");
    const missing = card("missing");
    const coverage = () => read(tx => candidates.vector(tx, selection, embedding.vector, embedding.model, 5));
    await put(embedded, embedding);
    await put(missing);
    assert.deepEqual((await coverage()).coverage, { eligible: 2, embedded: 1, complete: false });
    await put({ ...missing, body: "Replacement", contentHash: digest("Replacement") }, embedding);
    assert.deepEqual((await coverage()).coverage, { eligible: 2, embedded: 2, complete: true });
    assert.deepEqual((await read(tx => candidates.vector(tx, selection, embedding.vector, "different-model", 5))).coverage,
      { eligible: 2, embedded: 0, complete: false });
    await pool.query("UPDATE document_cards SET embedding_text_version = 0 WHERE id = $1", [missing.id]);
    assert.deepEqual((await coverage()).coverage, { eligible: 2, embedded: 1, complete: false });
    await assert.rejects(put(card("bad-vector"), { ...embedding, vector: [1] }), { code: "invalid_input" });
    await assert.rejects(put(card("bad-coordinate"), { ...embedding, vector: Float64Array.from(embedding.vector, () => Infinity) }),
      { code: "invalid_input" });
    await assert.rejects(read(tx => store.list(tx, { ...scope, namespace: "project" })), { code: "capability_unavailable" });
  });

  test(`Postgres ${profile} uses only action-scoped facts for retained card erasure evidence`, migrationDbTest, async t => {
    const { store, key, read, write, put, fact } = await setup(t, profile);
    const kept = card("candidate", "Every tool has a designated drawer.");
    await put(kept);
    const text = { digests: [await coreDigest(kept.body, key ?? undefined)], keyId: key?.id ?? null };
    const hidden = await write(tx => fact(tx, { kind: "text", mode: "exact", text }));
    await read(async tx => {
      const [live] = await store.visibilityInputs(tx, scope, [ref(kept.id)]);
      assert.equal((await documentCardVisible(live)).reason, "text_withheld");
      const [unrelated] = await store.listForPurge(tx, scope, undefined, { actionId: "unrelated", factIds: [] });
      assert.equal((await documentCardVisible(unrelated.input, { definiteOnly: true })).visible, true);
      const [selected] = await store.listForPurge(tx, scope, undefined, { actionId: "forget", factIds: [hidden.factId] });
      assert.equal((await documentCardVisible(selected.input, { definiteOnly: true })).reason, "text_withheld");
    });
  });

  test(`Postgres ${profile} isolates team cards under the promoted scope key`, migrationDbTest, async t => {
    const { store, pool, candidates, read, write, put } = await setup(t, profile);
    await pool.query("INSERT INTO users (id) VALUES ('departing')");
    const memories = createPostgresMemoryStore();
    const { id: memoryId, revision } = await write(tx => memories.insert(tx, scope, memoryContent("Inventory memory"), [], 1));
    const links = [{ id: memoryId, revision }];
    const departedTeam = {
      ...card("unowned"), sourceMemories: links, sentences: [{ start: 0, end: 7, source: sourceMessage }],
    };
    const authoredTeam = { ...departedTeam, id: "authored-team" };
    await archive(pool, "Cabinet inventory.");
    await storeTeamCard(pool, departedTeam, "departing");
    await storeTeamCard(pool, authoredTeam);
    await pool.query(`INSERT INTO document_cards (user_id, id, content_hash, title, body, origin, source_memories, sentences, stale)
      VALUES ('departing', 'departing-personal', 'hash', '', 'personal', 'manual', '[]', '[]', '[]')`);
    await pool.query("DELETE FROM users WHERE id = 'departing'");
    const teamRows = async () => (await pool.query("SELECT * FROM document_cards WHERE scope_id = 'team:x' ORDER BY id")).rows;
    const before = await teamRows();
    assert.deepEqual(before.map(({ id, user_id }) => [id, user_id]), [[authoredTeam.id, owner], [departedTeam.id, null]]);
    assert.equal((await pool.query("SELECT 1 FROM document_cards WHERE id = 'departing-personal'")).rowCount, 0);

    const personal = { ...card("personal"), sentences: departedTeam.sentences };
    assert.deepEqual(await put(personal, embedding), { status: "inserted" });
    await assert.rejects(put(authoredTeam, embedding), { code: "revision_conflict" });
    await write(async tx => {
      assert.deepEqual(await store.linkMemories(tx, scope, personal.id, links), { status: "linked" });
      for (const { id } of before) {
        assert.deepEqual(await store.linkMemories(tx, scope, id, links), { status: "not_found" });
        await store.hide(tx, scope, id, "hidden");
        await store.purgeById(tx, scope, id, "purged");
      }
    });
    await read(async tx => {
      for (const { id } of before) assert.equal(await store.get(tx, scope, id), null);
      assert.equal((await store.get(tx, scope, personal.id)).body, personal.body);
      assert.deepEqual((await store.list(tx, scope)).map(({ id }) => id), [personal.id]);
      assert.deepEqual((await store.listForPurge(tx, scope)).map(({ cardId }) => cardId), [personal.id]);
      const inputs = await store.visibilityInputs(tx, scope, [ref(authoredTeam.id), ref(personal.id), ref(departedTeam.id)]);
      assert.deepEqual(inputs.map(input => input?.card.id ?? null), [null, personal.id, null]);
      assert.deepEqual((await candidates.lexical(tx, selection, "cabinet", 5)).rows.map(({ ref }) => ref.id), [personal.id]);
      const vector = await candidates.vector(tx, selection, embedding.vector, embedding.model, 5);
      assert.deepEqual(vector.rows.map(({ ref }) => ref.id), [personal.id]);
      assert.deepEqual(vector.coverage, { eligible: 1, embedded: 1, complete: true });
    });
    for (const selector of [{ sourceMemoryId: memoryId }, { sourceMessage }, { session: sourceMessage }]) {
      await assert.rejects(write(async tx => {
        assert.deepEqual((await store.listForPurge(tx, scope, [selector])).map(({ cardId }) => cardId), [personal.id]);
        assert.deepEqual(await store.hideWhere(tx, scope, selector, "hidden"), { hidden: 1 });
        assert.equal(await store.get(tx, scope, personal.id), null);
        throw new CoreError("storage_error");
      }), { code: "storage_error" });
    }
    await write(async tx => {
      await store.hide(tx, scope, personal.id, "hidden");
      assert.equal(await store.get(tx, scope, personal.id), null);
      await store.purgeById(tx, scope, personal.id, "purged");
      assert.deepEqual(await store.listForPurge(tx, scope), []);
    });
    assert.deepEqual(await put(card(departedTeam.id), embedding), { status: "inserted" });
    assert.equal((await read(tx => store.get(tx, scope, departedTeam.id))).scope.owner, owner);
    assert.deepEqual(await teamRows(), before);
  });

  test(`Postgres ${profile} purges card bindings atomically on every Raw deletion path`, migrationDbTest, async t => {
    const { store, pool, key, options, read, write, put } = await setup(t, profile);
    const { purgeCards } = store;
    const { raw, sessionLineage } = createPostgresRawPorts({ ...options, purgeCards,
      fingerprintKeys: () => key ? [{ key, pipeline: "core" }] : [] });
    const memories = createPostgresMemoryStore({ purgeCards });
    await pool.query("INSERT INTO topics (user_id, id, level, title, title_key) VALUES ($1, 'topic', 1, 'Filed', 'filed')", [owner]);
    await pool.query("INSERT INTO core_owner_state (user_id, legacy_facts_ready) VALUES ($1, true)", [owner]);

    for (const path of ["deleteConversation", "eraseSessions", "purgeWithheld", "eraseReceiptRaw"]) {
      const source = { ...sourceMessage, sessionId: path };
      const controlSource = { ...source, sessionId: path + "-control" };
      const text = `Private source for ${path}.`;
      await archive(pool, text, source);
      await archive(pool, "Independent source.", controlSource);
      const primary = { ...card(path + "-primary"), origin: "router", sourceMessage: source };
      const sentence = { ...card(path + "-sentence"), sentences: [{ start: 0, end: 7, source }] };
      const control = { ...card(path + "-control"), origin: "router", sourceMessage: controlSource };
      const erasedAmendment = { ...amendment("erased"), sourceMessage: source };
      const keptAmendment = { ...amendment("kept"), sourceMessage: controlSource };
      const erased = [primary, sentence];
      const ledgerSessions = [];
      if (path === "purgeWithheld") {
        const ledgerSource = { ...source, sessionId: path + "-ledger" };
        erased.push({ ...card(path + "-ledger"), origin: "router", sourceMessage: ledgerSource });
        // Only the ledger matches at the control address. Its archived Raw keeps the card live.
        for (const { client, sessionId, messageId } of [ledgerSource, controlSource]) {
          const request = { client, session_id: sessionId, event_id: sessionId,
            messages: [{ id: messageId, role: "user", content: text }] };
          await pool.query(`INSERT INTO capture_events (user_id, client, session_id, event_id, raw_request, received_at)
            VALUES ($1, $2, $3, $3, $4, now())`, [owner, client, sessionId, JSON.stringify(request)]);
          ledgerSessions.push(sessionId);
        }
      }
      const records = [...erased, control];
      for (const value of records) {
        await put(value, embedding);
        await fileCard(pool, value);
      }
      await write(async tx => {
        for (const change of [erasedAmendment, keptAmendment]) {
          assert.deepEqual(await store.amend(tx, scope, control.id, change), { status: "inserted" });
        }
        assert.deepEqual(await store.amend(tx, scope, primary.id, keptAmendment), { status: "inserted" });
        await store.hide(tx, scope, sentence.id, "earlier_hide");
      });
      // A retained hidden row may still have stale memberships from an earlier writer.
      await fileCard(pool, sentence);
      const memory = path === "eraseReceiptRaw" ? await write(tx => memories.insert(tx, scope,
        memoryContent("Memory about the deleted source."), [{ ...source, role: "user", occurredAtMs: 1000 }], 1000)) : null;
      const textFact = { ...scope, kind: "text", mode: "exact", origin: "forget", actionId: path,
        text: { digests: [await coreDigest(text, key ?? undefined)], keyId: key?.id ?? null } };

      const snapshot = async tx => (await query(tx, `SELECT
        ARRAY(SELECT to_jsonb(c) FROM document_cards c WHERE c.user_id = $1 AND c.id = ANY($2) ORDER BY c.id) AS cards,
        ARRAY(SELECT to_jsonb(a) FROM core_document_card_amendments a
          WHERE a.user_id = $1 AND a.card_id = ANY($2) ORDER BY a.card_id, a.amendment_id) AS amendments,
        ARRAY(SELECT card_id FROM card_topics WHERE user_id = $1 AND card_id = ANY($2) ORDER BY card_id) AS topics,
        ARRAY(SELECT card_id FROM card_placements WHERE user_id = $1 AND card_id = ANY($2) ORDER BY card_id) AS placements,
        ARRAY(SELECT to_jsonb(r) FROM raw_messages r WHERE r.user_id = $1 AND r.session_id = ANY($3) ORDER BY r.session_id) AS raw,
        ARRAY(SELECT raw_request #>> '{messages,0,content}' FROM capture_events
          WHERE user_id = $1 AND session_id = ANY($4) ORDER BY session_id) AS ledger
        `, [owner, records.map(({ id }) => id), [source.sessionId, controlSource.sessionId], ledgerSessions])).rows[0];
      const before = await read(snapshot);
      const remove = async tx => {
        switch (path) {
          case "deleteConversation":
            assert.deepEqual(await raw.deleteConversation(tx, scope, source), { rawDeleted: 1 });
            break;
          case "eraseSessions": {
            const closure = await sessionLineage.provenClosure(tx, scope, [source]);
            assert.deepEqual(await raw.eraseSessions(tx, scope, closure), { rawDeleted: 1, ledgerBlanked: 0 });
            break;
          }
          case "purgeWithheld":
            assert.deepEqual(await raw.purgeWithheld(tx, scope, [{ fact: textFact }]), { rawDeleted: 1, ledgerBlanked: 2 });
            break;
          case "eraseReceiptRaw":
            assert.equal(await memories.erase(tx, scope, memory.id), true);
            break;
        }
      };
      const assertErased = state => {
        assert.deepEqual(state.raw, before.raw.filter(row => row.session_id === controlSource.sessionId), path);
        assert.deepEqual(state.ledger, ledgerSessions.map(() => ""), path);
        for (const value of erased) {
          const { tombstoned, hidden_reason, title, body, sentences, embedding, embedding_model, embedding_text_version,
            embedding_content_hash } = state.cards.find(row => row.id === value.id);
          assert.equal(tombstoned, true, path);
          assert.equal(hidden_reason, memory ? "source_memory_forgotten" : "raw_deleted", path);
          assert.deepEqual([title, body, sentences, embedding, embedding_model, embedding_text_version, embedding_content_hash],
            ["", "", [], null, null, null, null], path);
        }
        assert.deepEqual(state.cards.find(({ id }) => id === control.id), before.cards.find(({ id }) => id === control.id), path);
        for (const item of state.amendments) {
          if (item.card_id === control.id && item.amendment_id === keptAmendment.amendmentId) {
            assert.deepEqual(item, before.amendments.find(value =>
              value.card_id === item.card_id && value.amendment_id === item.amendment_id), path);
          } else {
            assert.deepEqual([item.purged, item.sentence, item.quote], [true, "", ""], path);
          }
        }
        assert.equal(state.amendments.length, before.amendments.length, path);
        assert.deepEqual(state.topics, [control.id], path);
        assert.deepEqual(state.placements, [control.id], path);
      };
      await assert.rejects(write(async tx => {
        await remove(tx);
        assertErased(await snapshot(tx));
        throw new CoreError("storage_error");
      }), { code: "storage_error" });
      assert.deepEqual(await read(snapshot), before, path);
      await write(remove);
      assertErased(await read(snapshot));
    }
  });

  for (const path of ["deleteConversation", "eraseSessions", "purgeWithheld", "eraseReceiptRaw", "lateLineage"]) {
    test(`Postgres ${profile} erases logical-client cards through ${path}`, migrationDbTest, async t => {
      const { store, pool, key, options, read, write, put } = await setup(t, profile);
      const { purgeCards } = store;
      const { raw, sessionLineage } = createPostgresRawPorts({ ...options, purgeCards,
        fingerprintKeys: () => key ? [{ key, pipeline: "core" }] : [] });
      const memories = createPostgresMemoryStore({ purgeCards });
      const source = { ...sourceMessage, client: "mcp", sessionId: `mcp-save:${randomUUID()}` };
      const logical = { ...source, client: "reported-client" };
      const control = { ...card("control"), origin: "router", sourceMessage: { ...logical, sessionId: randomUUID() } };
      const text = "Private source text.";
      const { card: routed } = await buildDocumentCard({ id: logical.messageId, role: "user", content: text },
        { scope, client: logical.client, canonicalSessionKey: options.sessionKey(logical.client, logical.sessionId) });
      const target = { ...card(routed.id, routed.body), origin: "router", title: routed.title, sourceMessage: logical };
      await pool.query("INSERT INTO core_owner_state (user_id, legacy_facts_ready) VALUES ($1, true)", [owner]);
      const rawSource = path === "purgeWithheld" ? { ...source, client: "mixed-client" } : source;
      await archive(pool, text, rawSource);
      await archive(pool, "Independent source.", control.sourceMessage);
      const request = { client: rawSource.client, session_id: rawSource.sessionId, event_id: rawSource.sessionId,
        messages: [{ id: rawSource.messageId, role: "user", content: text }] };
      await pool.query(`INSERT INTO capture_events (user_id, client, session_id, event_id, raw_request, received_at)
        VALUES ($1, $2, $3, $3, $4, now())`, [owner, rawSource.client, rawSource.sessionId, JSON.stringify(request)]);
      assert.deepEqual(await put(target, embedding), { status: "inserted" });
      await put(control, embedding);

      const messageOnly = path === "purgeWithheld" || path === "eraseReceiptRaw";
      if (messageOnly) {
        const neighbor = { ...logical, messageId: "neighbor" };
        await archive(pool, "Separate message in the same session.", { ...rawSource, messageId: neighbor.messageId });
        await put({ ...card("neighbor"), origin: "router", sourceMessage: neighbor }, embedding);
      }
      if (path === "purgeWithheld") {
        // Mixed provenance makes the reverse lookup ambiguous for this client's Raw address.
        for (const kind of ["mcp", "plugin"]) {
          await write(tx => memories.insert(tx, scope, { ...memoryContent(`Provenance for ${kind}.`),
            source: { kind, client: rawSource.client, sessionId: rawSource.sessionId } }, [], 1000));
        }
        await put({ ...card("sentence"), sentences: [{ start: 0, end: 7, source: logical }] }, embedding);
        assert.deepEqual(await write(tx => store.amend(tx, scope, control.id,
          { ...amendment(), sourceMessage: logical })), { status: "inserted" });
      }
      const memory = path === "eraseReceiptRaw" ? await write(tx => memories.insert(tx, scope,
        memoryContent("Independent memory text."), [{ ...rawSource, role: "user", occurredAtMs: 1000 }], 1000)) : null;
      const textFact = { ...scope, kind: "text", mode: "exact", origin: "forget", actionId: path,
        text: { digests: [await coreDigest(text, key ?? undefined)], keyId: key?.id ?? null } };

      const root = { ...source, sessionId: randomUUID() };
      const anchor = { messageMac: digest("message"), contentMac: digest(text) };
      const eraseSession = async (tx, session, ledgerBlanked) => {
        const closure = await sessionLineage.provenClosure(tx, scope, [session]);
        assert.deepEqual(await raw.eraseSessions(tx, scope, closure), { rawDeleted: 1, ledgerBlanked });
      };
      if (path === "lateLineage") {
        await archive(pool, text, root);
        await write(async tx => {
          await sessionLineage.recordAnchors(tx, scope, source, [anchor]);
          await eraseSession(tx, root, 0);
        });
        await storeTeamCard(pool, { ...target, id: "team" });
        await storeTeamCard(pool, { ...target, id: "unowned" }, null);
      }

      const snapshot = async tx => (await query(tx, `SELECT
        ARRAY(SELECT to_jsonb(c) FROM document_cards c ORDER BY c.scope_id, c.id) AS cards,
        ARRAY(SELECT to_jsonb(a) FROM core_document_card_amendments a ORDER BY a.card_id, a.amendment_id) AS amendments,
        ARRAY(SELECT to_jsonb(r) FROM raw_messages r ORDER BY r.id) AS raw,
        ARRAY(SELECT raw_request #>> '{messages,0,content}' FROM capture_events ORDER BY event_id) AS ledger,
        ARRAY(SELECT to_jsonb(m) FROM memories m ORDER BY m.id) AS memories,
        ARRAY(SELECT to_jsonb(r) FROM core_memory_receipts r ORDER BY r.memory_id, r.message_id) AS receipts,
        ARRAY(SELECT to_jsonb(f) FROM capture_raw_fences f ORDER BY f.client, f.session_id) AS fences,
        ARRAY(SELECT to_jsonb(l) FROM capture_raw_lineage l ORDER BY l.client, l.session_id, l.message_mac, l.content_mac) AS lineage,
        ARRAY(SELECT to_jsonb(s) FROM suppressions s ORDER BY s.id) AS suppressions,
        (SELECT index_revision::text FROM core_owner_state WHERE user_id = $1) AS revision`, [owner])).rows[0];
      const before = await read(snapshot);
      assert.ok(before.raw.some(row => row.session_id === rawSource.sessionId && row.message_id === rawSource.messageId));
      assert.equal(before.cards.find(row => row.id === target.id).tombstoned, false);
      const remove = async tx => {
        switch (path) {
          case "deleteConversation":
            assert.deepEqual(await raw.deleteConversation(tx, scope, rawSource), { rawDeleted: 1 });
            break;
          case "eraseSessions":
            await eraseSession(tx, rawSource, 1);
            break;
          case "purgeWithheld":
            assert.deepEqual(await raw.purgeWithheld(tx, scope, [{ fact: textFact }]), { rawDeleted: 1, ledgerBlanked: 1 });
            break;
          case "eraseReceiptRaw":
            assert.equal(await memories.erase(tx, scope, memory.id), true);
            break;
          case "lateLineage":
            await sessionLineage.recordAnchors(tx, scope, root, [anchor]);
            break;
        }
      };
      const assertErased = state => {
        assert.deepEqual(state.raw, before.raw.filter(row =>
          row.session_id !== rawSource.sessionId || row.message_id !== rawSource.messageId));
        assert.deepEqual(state.ledger, [""]);
        assert.equal(state.cards.length, before.cards.length);
        for (const [i, previous] of before.cards.entries()) {
          const current = state.cards[i];
          if (previous.id !== target.id && previous.id !== "sentence") {
            assert.deepEqual(current, previous);
            continue;
          }
          const { tombstoned, hidden_reason, title, body, sentences, embedding, embedding_model, embedding_text_version,
            embedding_content_hash } = current;
          assert.equal(tombstoned, true, `Expected ${previous.id} to be tombstoned`);
          assert.equal(hidden_reason, memory ? "source_memory_forgotten" : "raw_deleted");
          assert.deepEqual([title, body, sentences, embedding, embedding_model, embedding_text_version, embedding_content_hash],
            ["", "", [], null, null, null, null]);
        }
        if (path === "purgeWithheld") {
          const [{ purged, sentence, quote }] = state.amendments;
          assert.deepEqual([purged, sentence, quote], [true, "", ""]);
        }
        if (memory) {
          assert.deepEqual(state.memories, []);
          assert.ok(state.receipts[0].forgotten_at);
        }
      };
      await assert.rejects(write(async tx => {
        await remove(tx);
        assertErased(await snapshot(tx));
        throw new CoreError("storage_error");
      }), { code: "storage_error" });
      assert.deepEqual(await read(snapshot), before);
      await write(remove);
      assertErased(await read(snapshot));
    });
  }

  test(`Postgres ${profile} withholds older citations after a late sourced correction`, migrationDbTest, async t => {
    const { store, pool, key, candidates, read, write, put, fact, hashSessionKey } = await setup(t, profile);
    const memories = createPostgresMemoryStore();
    const content = async text => ({ ...memoryContent(text), digests: [await coreDigest(text, key ?? undefined)] });
    const original = await content("The machine takes steel rivets.");
    const middleContent = await content("The machine takes brass rivets.");
    const latestContent = await content("The machine takes stainless steel rivets.");
    const memory = await write(tx => memories.insert(tx, scope, original, [], 1000));
    const citations = [];
    const addCitation = async revision => {
      const source = { ...sourceMessage, messageId: String(revision) };
      const message = { id: source.messageId, role: "user", content: "Cabinet inventory." };
      const canonicalSessionKey = hashSessionKey(source.client, source.sessionId);
      const { card: routed } = await buildDocumentCard(message, { scope, client: source.client, canonicalSessionKey });
      const value = { ...card(routed.id), origin: "router", sourceMessage: source,
        sourceMemories: [{ id: memory.id, revision }] };
      await archive(pool, message.content, source);
      assert.deepEqual(await put(value, embedding), { status: "inserted" });
      citations.push(value);
    };
    const readCitations = () => read(async tx => ({
      inputs: await store.visibilityInputs(tx, scope, citations.map(({ id }) => ref(id))),
      stored: await Promise.all(citations.map(({ id }) => store.get(tx, scope, id))),
      lexical: await candidates.lexical(tx, selection, "cabinet", 5, {}),
      vector: await candidates.vector(tx, selection, embedding.vector, embedding.model, 5),
    }));
    await addCitation(memory.revision);
    // Mirror the kit's first replacement without a fact, then the replacement with a late fact.
    const middle = await write(tx => memories.replaceContent(tx, scope, memory.id, memory.revision,
      middleContent, null, 2000));
    assert.equal(middle.revision, memory.revision + 1);
    await addCitation(middle.revision);
    const before = await readCitations();
    const ids = citations.map(({ id }) => id).sort();
    assert.deepEqual(before.stored.map(({ id }) => id).sort(), ids);
    assert.equal(before.inputs.length, citations.length);
    for (const input of before.inputs) assert.deepEqual(await documentCardVisible(input), { visible: true, reason: null });
    for (const channel of [before.lexical, before.vector]) {
      assert.deepEqual(channel.rows.map(({ ref }) => ref.id).sort(), ids);
    }

    const latest = await write(async tx => {
      await fact(tx, { origin: "correct", kind: "text", mode: "exact", actionId: "late-correction",
        sourceMemory: { id: memory.id, createdAtMs: memory.createdAtMs },
        text: { digests: original.digests, keyId: key?.id ?? null } });
      return memories.replaceContent(tx, scope, memory.id, middle.revision, latestContent, null, 3000);
    });
    assert.equal(latest.revision, middle.revision + 1);

    // Mirror the kit's older-citation privacy assertion across storage and candidate reads.
    const after = await readCitations();
    assert.equal(after.inputs.length, citations.length);
    for (const [i, input] of after.inputs.entries()) {
      const [{ revision }] = citations[i].sourceMemories;
      const state = input.memoryStates.get(memory.id);
      assert.equal(state.revision, latest.revision);
      assert.deepEqual(state.correctedRevisions, [revision]);
      assert.deepEqual(await documentCardVisible(input), { visible: false, reason: "source_memory_corrected" });
    }
    assert.deepEqual(after.stored, [null, null]);
    assert.deepEqual(after.lexical.rows, []);
    assert.deepEqual(after.vector.rows, []);
  });

  test(`Postgres ${profile} returns the stored hash and allows visibility inputs without Raw`, migrationDbTest, async t => {
    const { store, pool, read, put, write, fact, hashSessionKey } = await setup(t, profile);
    const value = { ...card("pending"), origin: "router", sourceMessage, contentHash: "stored-hash" };
    await put(value);
    const { rows: [row] } = await pool.query("SELECT content_hash FROM document_cards WHERE id = $1", [value.id]);
    await read(async tx => {
      assert.equal((await store.get(tx, scope, value.id)).contentHash, row.content_hash);
      assert.deepEqual(await store.visibilityInputs(tx, scope, [ref(value.id)]), [null]);
      const [input] = await store.visibilityInputs(tx, scope, [ref(value.id)], { requireRaw: false });
      assert.equal(input.card.id, value.id);
      assert.deepEqual(input.card.sourceMessage, sourceMessage);
      assert.equal(input.sourceWithheld, false);
    });
    const inputs = () => read(tx => store.visibilityInputs(tx, scope, [ref(value.id)], { requireRaw: false }));
    await write(tx => fact(tx, { kind: "rawSpan", sessionKeyHash: hashSessionKey(sourceMessage.client, sourceMessage.sessionId),
      messageKey: sourceMessage.messageId, startUtf16: 0, endUtf16: 1, contentDigest: digest(value.body) }));
    assert.equal((await inputs())[0].sourceWithheld, true);
    const receiptSource = { ...sourceMessage, messageId: "receipt" };
    const receiptCard = { ...value, id: "receipt-card", sourceMessage: receiptSource };
    await put(receiptCard);
    await pool.query(`INSERT INTO core_memory_receipts (user_id, memory_id, client, session_id, message_id, role, forgotten_at)
      VALUES ($1, 'forgotten', $2, $3, $4, 'user', now())`, [owner, ...Object.values(receiptSource)]);
    const [blocked] = await read(tx => store.visibilityInputs(tx, scope, [ref(receiptCard.id)], { requireRaw: false }));
    assert.equal(blocked.sourceWithheld, true);
  });
}
