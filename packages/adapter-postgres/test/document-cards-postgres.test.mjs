import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { CoreError, coreDigest, coreFingerprintLabels, factIncarnationBody, userFingerprintKey } from "@cairn-ink/core";
import { buildDocumentCard, documentCardVisible } from "@cairn-ink/core/routing";
import {
  applyMigrations, createPostgresDocumentCardStore, createPostgresDocumentCardCandidates,
  createPostgresSuppressionStore, createPostgresUnitOfWork, query,
} from "../src/index.mjs";
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
    CREATE FUNCTION default_card_scope() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      NEW.scope_id := COALESCE(NEW.scope_id, NEW.user_id);
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER default_card_scope BEFORE INSERT ON document_cards FOR EACH ROW EXECUTE FUNCTION default_card_scope();
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
      FROM pg_proc WHERE oid IN ('document_card_search_text(text,text)'::regprocedure, 'default_card_scope()'::regprocedure)) AS functions,
    (SELECT jsonb_agg(jsonb_build_array(oid, xmin::text, pg_get_triggerdef(oid)) ORDER BY oid)
      FROM pg_trigger WHERE tgrelid = 'document_cards'::regclass AND NOT tgisinternal) AS triggers`)).rows[0];
  const before = await definitions();
  const writer = await pool.connect();
  try {
    await writer.query("BEGIN");
    await writer.query("UPDATE document_cards SET title = 'Concurrent update' WHERE user_id = $1", [owner]);
    await applyMigrations(source, migrations);
  } finally {
    try { await writer.query("ROLLBACK"); } finally { writer.release(); }
  }
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

async function setup(t, profile) {
  const { source, pool } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
  const key = profile === "keyed" ? await userFingerprintKey(randomUUID(), owner, coreFingerprintLabels) : null;
  const hashSessionKey = (client, sessionId) => digest(JSON.stringify([client, sessionId]));
  const options = { lineageSecret: randomUUID(), hashSessionKey, sessionKey: hashSessionKey, fingerprintKey: () => key };
  const store = createPostgresDocumentCardStore(options);
  const candidates = createPostgresDocumentCardCandidates(options);
  const { run } = createPostgresUnitOfWork(source);
  const read = work => run(owner, { readOnly: true }, work);
  const write = work => run(owner, { pauseLock: true }, work);
  const put = (value, vector) => write(tx => store.put(tx, scope, value, vector));
  const factStore = createPostgresSuppressionStore({ hashSessionKey });
  const fact = (tx, value) => factStore.writeFact(tx, { ...scope, origin: "forget", actionId: "forget", ...value },
    digest(factIncarnationBody({ ...scope, origin: "forget", actionId: "forget", ...value })));
  const revision = async () => Number((await pool.query(
    "SELECT index_revision FROM core_owner_state WHERE user_id = $1", [owner])).rows[0]?.index_revision ?? 0);
  return { pool, key, options, store, candidates, read, write, put, fact, revision, hashSessionKey };
}

async function storeTeamCard(pool, value) {
  await pool.query(`INSERT INTO document_cards (user_id, scope_id, id, content_hash, title, body, origin,
    source_client, source_session_id, source_message_id, source_memories, sentences, stale,
    embedding, embedding_model, embedding_text_version, embedding_content_hash)
    VALUES ($1, 'team:x', $2, $3, $4, $5, 'router', $6, $7, $8, '[{"id":"memory","revision":1}]', '[]', '[]',
      $9::vector, $10, 1, $3)`, [owner, value.id, value.contentHash, value.title, value.body,
    sourceMessage.client, sourceMessage.sessionId, sourceMessage.messageId, JSON.stringify(Array.from(embedding.vector)), embedding.model]);
}

async function archive(pool, message) {
  await pool.query(`INSERT INTO raw_messages (id, user_id, client, session_id, message_id, role, content, occurred_at)
    VALUES ($1, $2, $3, $4, $5, 'user', $6, to_timestamp(1))`, [randomUUID(), owner,
    sourceMessage.client, sourceMessage.sessionId, sourceMessage.messageId, message]);
}

const selectors = [{ sourceMemoryId: "memory" }, { sourceMessage }, { session: sourceMessage }];

for (const profile of ["keyless", "keyed"]) {
  test(`Postgres ${profile} isolates team cards from all personal operations`, migrationDbTest, async t => {
    const db = await setup(t, profile);
    const { store, candidates, read, write, pool, put, revision } = db;
    const message = "Cabinet inventory.";
    const { card: routed } = await buildDocumentCard({ id: sourceMessage.messageId, role: "user", content: message },
      { scope, client: sourceMessage.client, canonicalSessionKey: db.hashSessionKey(sourceMessage.client, sourceMessage.sessionId) });
    const team = { ...card(routed.id), title: routed.title, body: routed.body };
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
}
