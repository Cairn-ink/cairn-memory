-- Memory-pipeline schema of the hosted service, for disposable databases.
-- Only the identity column is needed from the user table.
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY
);

CREATE EXTENSION IF NOT EXISTS vector;

CREATE EXTENSION IF NOT EXISTS pgroonga;

CREATE TABLE IF NOT EXISTS memories (
  id text PRIMARY KEY,
  user_id text NOT NULL CONSTRAINT memories_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  text text NOT NULL,
  kind text NOT NULL,
  text_hash text NOT NULL,
  embedding vector(1536) NOT NULL,
  embedding_model text NOT NULL,
  source_kind text NOT NULL,
  source_client text,
  source_session_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memories_kind_check CHECK (kind IN ('fact', 'preference', 'decision', 'instruction', 'context')),
  CONSTRAINT memories_source_kind_check CHECK (source_kind IN ('mcp', 'plugin', 'import', 'web')),
  CONSTRAINT memories_user_text_hash_unique UNIQUE (user_id, text_hash)
);

CREATE INDEX IF NOT EXISTS memories_text_idx ON memories USING pgroonga (text);

CREATE INDEX IF NOT EXISTS memories_embedding_idx ON memories USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS memories_user_recent_idx ON memories (user_id, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS raw_messages (
  id text PRIMARY KEY,
  user_id text NOT NULL CONSTRAINT raw_messages_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  client text NOT NULL,
  session_id text NOT NULL,
  message_id text NOT NULL,
  seq integer,
  occurred_at timestamptz,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT raw_messages_role_check CHECK (role IN ('user', 'assistant')),
  CONSTRAINT raw_messages_user_message_unique UNIQUE (user_id, client, session_id, message_id)
);

CREATE INDEX IF NOT EXISTS raw_messages_content_idx ON raw_messages USING pgroonga (content);

CREATE INDEX IF NOT EXISTS raw_messages_user_session_idx
  ON raw_messages (user_id, client, session_id, occurred_at, seq);

CREATE TABLE IF NOT EXISTS suppressions (
  id text PRIMARY KEY,
  user_id text NOT NULL CONSTRAINT suppressions_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  text_hash text,
  embedding vector(1536),
  shingles text[],
  key_id text,
  client text,
  session_id text,
  window_start timestamptz,
  window_end timestamptz,
  origin text,
  created_at timestamptz NOT NULL DEFAULT now(),
  text_hmac text,
  redaction_version integer NOT NULL DEFAULT 1,
  CONSTRAINT suppressions_kind_check CHECK (
    (kind = 'text' AND text_hash IS NOT NULL AND embedding IS NOT NULL)
    OR (kind = 'session' AND client IS NOT NULL AND session_id IS NOT NULL)
    OR (kind = 'window' AND window_start IS NOT NULL AND window_end IS NOT NULL AND window_start < window_end)
  ),
  CONSTRAINT suppressions_key_id_check CHECK (
    shingles IS NULL OR (key_id IS NOT NULL AND key_id ~ '^[0-9a-f]{16}$')
  ),
  CONSTRAINT suppressions_origin_check CHECK (origin IN ('forget', 'correct', 'backfill', 'edit'))
);

CREATE INDEX IF NOT EXISTS suppressions_user_kind_idx ON suppressions (user_id, kind);

CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  user_id text NOT NULL CONSTRAINT jobs_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  capture_id text NOT NULL,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jobs_kind_check CHECK (kind IN ('ingest', 'import')),
  CONSTRAINT jobs_status_check CHECK (status IN ('queued', 'running', 'done', 'failed')),
  CONSTRAINT jobs_user_capture_unique UNIQUE (user_id, capture_id)
);

CREATE TABLE IF NOT EXISTS capture_events (
  user_id text NOT NULL CONSTRAINT capture_events_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  client text NOT NULL,
  event_id text NOT NULL,
  session_id text NOT NULL,
  raw_request jsonb NOT NULL,
  "window" jsonb,
  received_at timestamptz NOT NULL,
  status text DEFAULT 'pending' NOT NULL,
  memory_count integer DEFAULT 0 NOT NULL,
  arrival_order bigint GENERATED ALWAYS AS IDENTITY,
  raw_window_messages jsonb,
  raw_archive_from integer,
  raw_lineage_key_id text,
  CONSTRAINT capture_events_user_id_client_event_id_pk PRIMARY KEY (user_id, client, event_id),
  CONSTRAINT capture_events_status CHECK (status IN ('pending', 'queued', 'completed'))
);

CREATE INDEX IF NOT EXISTS capture_events_session_arrival_idx
  ON capture_events (user_id, client, session_id, arrival_order);

CREATE TABLE IF NOT EXISTS memory_pause (
  user_id text PRIMARY KEY CONSTRAINT memory_pause_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  paused boolean DEFAULT false NOT NULL,
  generation integer DEFAULT 0 NOT NULL,
  CONSTRAINT memory_pause_generation CHECK (generation >= 0)
);

CREATE TABLE IF NOT EXISTS capture_raw_fences (
  user_id text NOT NULL CONSTRAINT capture_raw_fences_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  client text NOT NULL,
  session_id text NOT NULL,
  CONSTRAINT capture_raw_fences_user_id_client_session_id_pk PRIMARY KEY (user_id, client, session_id)
);

CREATE TABLE IF NOT EXISTS capture_raw_lineage (
  user_id text NOT NULL CONSTRAINT capture_raw_lineage_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  client text NOT NULL,
  session_id text NOT NULL,
  message_mac text NOT NULL,
  content_mac text,
  CONSTRAINT capture_raw_lineage_session_message_proof
    UNIQUE NULLS NOT DISTINCT (user_id, client, session_id, message_mac, content_mac)
);

CREATE INDEX IF NOT EXISTS capture_raw_lineage_message_idx
  ON capture_raw_lineage (user_id, client, message_mac, content_mac, session_id);

CREATE TABLE IF NOT EXISTS memory_forget_log (
  user_id text NOT NULL CONSTRAINT memory_forget_log_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  memory_id text NOT NULL,
  forgotten_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT memory_forget_log_user_id_memory_id_pk PRIMARY KEY (user_id, memory_id)
);

CREATE INDEX IF NOT EXISTS memory_forget_log_forgotten_at_idx ON memory_forget_log (forgotten_at);
