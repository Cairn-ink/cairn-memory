import assert from "node:assert/strict";
import test from "node:test";
import { applyMigrations } from "../src/index.mjs";
import { readCatalog } from "./catalog.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const tables = [
  "document_cards", "memory_placements", "memory_topics", "topic_edges",
  "topic_index_state", "topic_title_sources", "topics",
];
const readLedger = 'SELECT id, applied_at::text FROM core_schema_migrations ORDER BY id COLLATE "C"';
const readStoreCatalog = (connection) => readCatalog(connection, tables, { includeDefaults: true });

// Schema created by the hosted service before the adapter migrations are applied.
const hostedDDL = `
  SET LOCAL lock_timeout = '5s';

  CREATE TABLE "memory_placements" (
    "user_id" text NOT NULL,
    "memory_id" text NOT NULL,
    "memory_revision" integer NOT NULL,
    "status" text NOT NULL,
    "code" text,
    "attempts" smallint DEFAULT 0 NOT NULL,
    "placed_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "memory_placements_user_id_memory_id_pk" PRIMARY KEY ("user_id", "memory_id"),
    CONSTRAINT "memory_placements_memory_revision_check" CHECK ("memory_placements"."memory_revision" >= 1),
    CONSTRAINT "memory_placements_status_check" CHECK ("memory_placements"."status" IN ('filed', 'unfiled', 'failed')),
    CONSTRAINT "memory_placements_attempts_check" CHECK ("memory_placements"."attempts" BETWEEN 0 AND 3)
  );
  CREATE TABLE "memory_topics" (
    "user_id" text NOT NULL,
    "memory_id" text NOT NULL,
    "topic_id" text NOT NULL,
    "memory_revision" integer NOT NULL,
    "placed_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "memory_topics_user_id_memory_id_topic_id_pk" PRIMARY KEY ("user_id", "memory_id", "topic_id"),
    CONSTRAINT "memory_topics_memory_revision_check" CHECK ("memory_topics"."memory_revision" >= 1)
  );
  CREATE TABLE "topic_edges" (
    "user_id" text NOT NULL,
    "parent_id" text NOT NULL,
    "child_id" text NOT NULL,
    CONSTRAINT "topic_edges_user_id_parent_id_child_id_pk" PRIMARY KEY ("user_id", "parent_id", "child_id"),
    CONSTRAINT "topic_edges_distinct_check" CHECK ("topic_edges"."parent_id" <> "topic_edges"."child_id")
  );
  CREATE TABLE "topic_index_state" (
    "user_id" text PRIMARY KEY NOT NULL,
    "revision" bigint NOT NULL
  );
  CREATE TABLE "topic_title_sources" (
    "user_id" text NOT NULL,
    "topic_id" text NOT NULL,
    "memory_id" text NOT NULL,
    "memory_revision" integer NOT NULL,
    CONSTRAINT "topic_title_sources_user_id_topic_id_memory_id_pk" PRIMARY KEY ("user_id", "topic_id", "memory_id"),
    CONSTRAINT "topic_title_sources_memory_revision_check" CHECK ("topic_title_sources"."memory_revision" >= 0)
  );
  CREATE TABLE "topics" (
    "user_id" text NOT NULL,
    "id" text NOT NULL,
    "level" smallint NOT NULL,
    "title" text NOT NULL,
    "title_key" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "topics_user_id_id_pk" PRIMARY KEY ("user_id", "id"),
    CONSTRAINT "topics_user_level_title_key_unique" UNIQUE ("user_id", "level", "title_key"),
    CONSTRAINT "topics_level_check" CHECK ("topics"."level" IN (1, 2))
  );

  ALTER TABLE "memories" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
  ALTER TABLE "memory_placements" ADD CONSTRAINT "memory_placements_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  ALTER TABLE "memory_topics" ADD CONSTRAINT "memory_topics_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  ALTER TABLE "memory_topics" ADD CONSTRAINT "memory_topics_user_id_topic_id_topics_user_id_id_fk"
    FOREIGN KEY ("user_id", "topic_id") REFERENCES "public"."topics" ("user_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
  ALTER TABLE "topic_edges" ADD CONSTRAINT "topic_edges_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  ALTER TABLE "topic_edges" ADD CONSTRAINT "topic_edges_user_id_parent_id_topics_user_id_id_fk"
    FOREIGN KEY ("user_id", "parent_id") REFERENCES "public"."topics" ("user_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
  ALTER TABLE "topic_edges" ADD CONSTRAINT "topic_edges_user_id_child_id_topics_user_id_id_fk"
    FOREIGN KEY ("user_id", "child_id") REFERENCES "public"."topics" ("user_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
  ALTER TABLE "topic_index_state" ADD CONSTRAINT "topic_index_state_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  ALTER TABLE "topic_title_sources" ADD CONSTRAINT "topic_title_sources_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  ALTER TABLE "topic_title_sources" ADD CONSTRAINT "topic_title_sources_user_id_topic_id_topics_user_id_id_fk"
    FOREIGN KEY ("user_id", "topic_id") REFERENCES "public"."topics" ("user_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
  ALTER TABLE "topics" ADD CONSTRAINT "topics_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  CREATE INDEX "memory_placements_memory_idx" ON "memory_placements" USING btree ("memory_id");
  CREATE INDEX "memory_placements_retry_idx" ON "memory_placements" USING btree ("user_id", "placed_at")
    WHERE "memory_placements"."status" = 'failed';
  CREATE INDEX "memory_topics_memory_idx" ON "memory_topics" USING btree ("memory_id");
  CREATE INDEX "memory_topics_newest_idx" ON "memory_topics" USING btree
    ("user_id", "topic_id", "placed_at" DESC NULLS LAST, "memory_id" DESC NULLS LAST);
  CREATE INDEX "topic_edges_child_idx" ON "topic_edges" USING btree ("user_id", "child_id", "parent_id");
  CREATE INDEX "memories_user_oldest_idx" ON "memories" USING btree ("user_id", "created_at", "id");
  ALTER TABLE "memories" ADD CONSTRAINT "memories_revision_check" CHECK ("memories"."revision" >= 1);

  CREATE TABLE "document_cards" (
    "user_id" text,
    "id" text NOT NULL,
    "content_hash" text NOT NULL,
    "title" text NOT NULL,
    "body" text NOT NULL,
    "date_ms" bigint,
    "origin" text DEFAULT 'router' NOT NULL,
    "source_client" text,
    "source_session_id" text,
    "source_message_id" text,
    "source_memories" jsonb NOT NULL,
    "sentences" jsonb NOT NULL,
    "stale" jsonb NOT NULL,
    "hidden_reason" text,
    "tombstoned" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "scope_id" text NOT NULL,
    "embedding" vector(1536),
    "embedding_model" text,
    "embedding_text_version" smallint,
    "embedding_content_hash" text,
    CONSTRAINT "document_cards_scope_id_id_pk" PRIMARY KEY ("scope_id", "id"),
    CONSTRAINT "document_cards_user_id_id_pk" UNIQUE ("user_id", "id"),
    CONSTRAINT "document_cards_team_author_check" CHECK (user_id IS NOT NULL OR scope_id LIKE 'team:%'),
    CONSTRAINT "document_cards_embedding_check"
      CHECK (num_nonnulls(embedding, embedding_model, embedding_text_version, embedding_content_hash) IN (0, 4)),
    CONSTRAINT "document_cards_origin_check" CHECK ("document_cards"."origin" IN ('router', 'import', 'manual')),
    CONSTRAINT "document_cards_router_source_check" CHECK ("document_cards"."origin" <> 'router' OR
      ("document_cards"."source_client" IS NOT NULL AND "document_cards"."source_session_id" IS NOT NULL AND
       "document_cards"."source_message_id" IS NOT NULL))
  );
  ALTER TABLE "document_cards" ADD CONSTRAINT "document_cards_scope_id_id_unique" UNIQUE ("scope_id", "id");
  ALTER TABLE "document_cards" ADD CONSTRAINT "document_cards_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  CREATE FUNCTION public.delete_personal_document_cards() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public AS $personal$
  BEGIN
    DELETE FROM public.document_cards WHERE user_id = OLD.id AND scope_id NOT LIKE 'team:%';
    RETURN OLD;
  END;
  $personal$;
  CREATE TRIGGER document_cards_delete_personal BEFORE DELETE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.delete_personal_document_cards();
  -- The engine schema has no scopes table, so this fixture omits its foreign key.
  CREATE FUNCTION public.default_document_card_scope() RETURNS trigger LANGUAGE plpgsql AS $scope$
  BEGIN
    IF NEW.scope_id IS NULL THEN
      NEW.scope_id := NEW.user_id;
    END IF;
    RETURN NEW;
  END;
  $scope$;
  CREATE TRIGGER document_cards_default_scope BEFORE INSERT ON public.document_cards
    FOR EACH ROW EXECUTE FUNCTION public.default_document_card_scope();
  CREATE INDEX document_cards_scope_created_idx ON public.document_cards (scope_id, created_at DESC NULLS LAST, id);
  CREATE FUNCTION public.document_card_search_text(title text, body text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $search$
    SELECT CASE WHEN title IS NULL OR title = '' THEN body ELSE title || E'\\n\\n' || body END;
  $search$;
  CREATE INDEX document_cards_search_text_idx ON public.document_cards
    USING pgroonga (public.document_card_search_text(title, body)) WHERE hidden_reason IS NULL AND NOT tombstoned;
  CREATE INDEX document_cards_live_source_idx ON public.document_cards
    USING btree (user_id, source_client, source_session_id, source_message_id)
    WHERE hidden_reason IS NULL AND NOT tombstoned;
  CREATE INDEX "document_cards_user_created_idx" ON "document_cards" USING btree ("user_id", "created_at" DESC NULLS LAST, "id");
  CREATE INDEX "document_cards_source_memories_idx" ON "document_cards" USING gin ("source_memories" jsonb_path_ops)
    WHERE "document_cards"."hidden_reason" IS NULL AND NOT "document_cards"."tombstoned";
`;

async function readOldestIndex(pool) {
  const { rows: [index] } = await pool.query(`
    SELECT indexrelid::text AS oid, pg_get_indexdef(indexrelid) AS definition, indisvalid AS valid
    FROM pg_index WHERE indexrelid = 'public.memories_user_oldest_idx'::regclass
      AND indrelid = 'public.memories'::regclass
  `);
  assert.equal(index?.valid, true);
  return index;
}

test("Postgres topics and cards match the hosted schema and record migrations on both paths", migrationDbTest, async (t) => {
  const fresh = await migrationDatabase(t);
  const hosted = await migrationDatabase(t, { migrate: false });
  // Migration 0001 uses ADD COLUMN IF NOT EXISTS, so the hosted revision column can stay in the fixture.
  await hosted.pool.query(hostedDDL);
  const hostedCatalog = await readStoreCatalog(hosted.pool);
  const hostedIndex = await readOldestIndex(hosted.pool);
  assert.deepEqual([...new Set(hostedCatalog.map((entry) => entry.split("\t", 1)[0]))], tables);

  await applyMigrations(hosted.source, hosted.migrations);
  assert.deepEqual(await readOldestIndex(hosted.pool), hostedIndex);
  assert.equal((await readOldestIndex(fresh.pool)).definition, hostedIndex.definition);

  for (const { pool, source, migrations } of [fresh, hosted]) {
    assert.deepEqual(await readStoreCatalog(pool), hostedCatalog);
    const { rows: applied } = await pool.query(readLedger);
    assert.deepEqual(applied.map(({ id }) => id), migrations.map(({ id }) => id));
    assert.ok(applied.every(({ applied_at }) => applied_at));

    const index = await readOldestIndex(pool);
    await applyMigrations(source, migrations);
    assert.deepEqual((await pool.query(readLedger)).rows, applied);
    assert.deepEqual(await readStoreCatalog(pool), hostedCatalog);
    assert.deepEqual(await readOldestIndex(pool), index);
  }
});

test("Postgres records preexisting topics and cards while writes are open", migrationDbTest, async (t) => {
  const { pool, source, migrations } = await migrationDatabase(t, { migrate: false });
  const query = (client, text, values) => client.query({ text, values, query_timeout: 8_000 });
  const boundedSource = {
    async connect() {
      const connection = await source.connect();
      return {
        query: (sql, values) => query(connection, sql, values),
        release: (destroy) => connection.release(destroy),
      };
    },
  };

  await query(pool, hostedDDL);
  await applyMigrations(boundedSource, migrations.slice(0, 6));
  await query(pool, `
    INSERT INTO users (id) VALUES ('owner');
    INSERT INTO memory_placements (user_id, memory_id, memory_revision, status) VALUES ('owner', 'memory', 1, 'filed');
    INSERT INTO document_cards (user_id, id, content_hash, title, body, origin, source_memories, sentences, stale)
    VALUES ('owner', 'card', 'hash', 'Title', 'Body', 'manual', '[]', '[]', '[]');
  `);

  const writer = await pool.connect();
  try {
    await query(writer, "BEGIN");
    assert.equal((await query(writer, `
      UPDATE memory_placements SET attempts = 1 WHERE user_id = 'owner' AND memory_id = 'memory'
    `)).rowCount, 1);
    assert.equal((await query(writer, `
      UPDATE document_cards SET body = 'Updated' WHERE user_id = 'owner' AND id = 'card'
    `)).rowCount, 1);

    // The runner must commit the ledger while both write locks are still held.
    await applyMigrations(boundedSource, migrations);
    const { rows } = await query(writer, readLedger);
    assert.deepEqual(rows.map(({ id }) => id), migrations.map(({ id }) => id));
  } finally {
    try {
      await query(writer, "ROLLBACK");
    } finally {
      writer.release(true);
    }
  }
});

test("Postgres topics and cards reject invalid rows and cascade when an owner is deleted", migrationDbTest, async (t) => {
  const { pool } = await migrationDatabase(t);
  const client = await pool.connect();
  try {
    await client.query("INSERT INTO users (id) VALUES ('owner'), ('other')");
    await assert.rejects(client.query(`
      INSERT INTO topics (user_id, id, level, title, title_key) VALUES ('owner', 'invalid', 3, 'Invalid', 'invalid')
    `), { code: "23514", constraint: "topics_level_check" });
    await assert.rejects(client.query(`
      INSERT INTO memory_placements (user_id, memory_id, memory_revision, status, attempts)
      VALUES ('owner', 'memory', 1, 'failed', 4)
    `), { code: "23514", constraint: "memory_placements_attempts_check" });

    await client.query(`
      INSERT INTO topics (user_id, id, level, title, title_key)
      VALUES ('owner', 'parent', 1, 'Parent', 'parent'), ('owner', 'child', 2, 'Child', 'child'),
             ('other', 'parent', 1, 'Parent', 'parent')
    `);
    await assert.rejects(client.query(`
      INSERT INTO topic_edges (user_id, parent_id, child_id) VALUES ('owner', 'parent', 'parent')
    `), { code: "23514", constraint: "topic_edges_distinct_check" });
    await assert.rejects(client.query(`
      INSERT INTO document_cards (user_id, id, content_hash, title, body, source_memories, sentences, stale)
      VALUES ('owner', 'invalid', 'hash', 'Title', 'Body', '[]', '[]', '[]')
    `), { code: "23514", constraint: "document_cards_router_source_check" });

    await client.query(`
      INSERT INTO topic_edges (user_id, parent_id, child_id) VALUES ('owner', 'parent', 'child');
      INSERT INTO topic_title_sources (user_id, topic_id, memory_id, memory_revision) VALUES ('owner', 'child', 'memory', 0);
      INSERT INTO memory_topics (user_id, memory_id, topic_id, memory_revision) VALUES ('owner', 'memory', 'child', 1);
      INSERT INTO memory_placements (user_id, memory_id, memory_revision, status) VALUES ('owner', 'memory', 1, 'filed');
      INSERT INTO topic_index_state (user_id, revision) VALUES ('owner', 1);
      INSERT INTO document_cards (
        user_id, id, content_hash, title, body, source_client, source_session_id, source_message_id,
        source_memories, sentences, stale
      ) VALUES ('owner', 'card', 'hash', 'Title', 'Body', 'client', 'session', 'message', '[]', '[]', '[]');
    `);
    assert.equal((await client.query("DELETE FROM users WHERE id = 'owner'")).rowCount, 1);
    for (const table of tables) {
      assert.equal((await client.query(`SELECT 1 FROM ${table} WHERE user_id = 'owner'`)).rowCount, 0, table);
    }
    assert.equal((await client.query("SELECT 1 FROM topics WHERE user_id = 'other'")).rowCount, 1);
  } finally {
    client.release();
  }
});
