SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS core_suppression_facts (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fact_id text COLLATE "C" NOT NULL,
  slot text NOT NULL,
  slot_hash text NOT NULL CHECK (slot_hash ~ '^[0-9a-f]{64}$'),
  incarnation text NOT NULL CHECK (incarnation ~ '^[0-9a-f]{64}$'),
  action_id text NOT NULL CHECK (length(action_id) BETWEEN 1 AND 128),
  epoch bigint NOT NULL CHECK (epoch > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  origin text NOT NULL CHECK (origin IN ('forget', 'correct', 'edit', 'backfill', 'import')),
  kind text NOT NULL CHECK (kind IN ('identity', 'text', 'session', 'window', 'rawSpan')),
  mode text CHECK (mode IN ('exact', 'full')),
  body jsonb NOT NULL,
  embedding vector(1536),
  shingles text[],
  key_id text,
  legacy_ref text,
  PRIMARY KEY (user_id, fact_id),
  UNIQUE (user_id, slot_hash),
  UNIQUE (user_id, epoch),
  CONSTRAINT core_suppression_facts_text_mode_check CHECK (kind <> 'text' OR mode IS NOT NULL),
  CONSTRAINT core_suppression_facts_shingle_key_check CHECK (shingles IS NULL OR key_id IS NOT NULL),
  CONSTRAINT core_suppression_facts_legacy_ref_check CHECK (legacy_ref IS NULL OR octet_length(legacy_ref) <= 256)
);

CREATE UNIQUE INDEX IF NOT EXISTS core_suppression_facts_legacy_ref_uidx
  ON core_suppression_facts (user_id, legacy_ref) WHERE legacy_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS core_suppression_facts_identity_idx
  ON core_suppression_facts (user_id, (body ->> 'memoryId') COLLATE "C") WHERE kind = 'identity';

CREATE INDEX IF NOT EXISTS core_suppression_facts_text_idx
  ON core_suppression_facts (user_id, mode) WHERE kind = 'text';

CREATE INDEX IF NOT EXISTS core_suppression_facts_session_idx
  ON core_suppression_facts (user_id, (body #>> '{session,client}') COLLATE "C") WHERE kind = 'session';

CREATE INDEX IF NOT EXISTS core_suppression_facts_window_idx
  ON core_suppression_facts (user_id, (body ->> 'client') COLLATE "C") WHERE kind = 'window';

CREATE INDEX IF NOT EXISTS core_suppression_facts_raw_span_idx
  ON core_suppression_facts (user_id, (body ->> 'sessionKeyHash') COLLATE "C") WHERE kind = 'rawSpan';

CREATE INDEX IF NOT EXISTS core_suppression_facts_embedding_idx
  ON core_suppression_facts USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;

CREATE TABLE IF NOT EXISTS core_fact_digests (
  user_id text NOT NULL,
  fact_id text COLLATE "C" NOT NULL,
  alg text NOT NULL CHECK (alg IN ('sha256', 'hmac')),
  value text NOT NULL CHECK (value ~ '^[0-9a-f]{64}$'),
  pipeline text NOT NULL CHECK (pipeline IN ('core', 'hosted-v1', 'engine-legacy')),
  redaction_version integer NOT NULL CHECK (redaction_version >= 1),
  key_id text,
  PRIMARY KEY (user_id, fact_id, alg, value),
  FOREIGN KEY (user_id, fact_id) REFERENCES core_suppression_facts ON DELETE CASCADE,
  CONSTRAINT core_fact_digests_key_check CHECK ((alg = 'hmac') = (key_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS core_fact_digests_user_value_idx
  ON core_fact_digests (user_id, value);
