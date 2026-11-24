// ASCII "CNXT" identifies core-next stores. Their user_version starts a
// separate schema version sequence from the legacy engine. Version 4 adds the
// inspect and Context Read tables, all created with the store.
export const SQLITE_APPLICATION_ID = 0x434e5854;
export const SQLITE_PHYSICAL_VERSION = 4;

export const STORAGE_SCHEMA = `
  PRAGMA encoding = 'UTF-8';

  CREATE TABLE cairn_store (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    store_id TEXT NOT NULL,
    session_hash_key TEXT NOT NULL
  ) STRICT;

  CREATE TABLE cairn_memories (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    created_at_ms INTEGER NOT NULL,
    updated_at_us INTEGER NOT NULL CHECK (updated_at_us >= 0),
    historical INTEGER NOT NULL DEFAULT 0 CHECK (historical IN (0, 1)),
    deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
    text_hash TEXT,
    legacy_hash TEXT,
    body TEXT,
    PRIMARY KEY (owner_id, namespace_key, id),
    CHECK ((deleted = 0 AND body IS NOT NULL AND text_hash IS NOT NULL) OR
      (deleted = 1 AND body IS NULL AND text_hash IS NULL AND legacy_hash IS NULL))
  ) STRICT, WITHOUT ROWID;

  CREATE INDEX cairn_memory_exact ON cairn_memories (owner_id, namespace_key, text_hash)
    WHERE deleted = 0;
  CREATE INDEX cairn_memory_legacy ON cairn_memories (owner_id, namespace_key, legacy_hash)
    WHERE deleted = 0;
  CREATE INDEX cairn_memory_page ON cairn_memories (owner_id, namespace_key, updated_at_us DESC, id DESC)
    WHERE deleted = 0;

  CREATE TABLE cairn_receipts (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    memory_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    source_key TEXT NOT NULL,
    legacy_receipt_key TEXT,
    body TEXT NOT NULL,
    PRIMARY KEY (owner_id, namespace_key, memory_id, ordinal),
    UNIQUE (owner_id, namespace_key, memory_id, source_key),
    FOREIGN KEY (owner_id, namespace_key, memory_id)
      REFERENCES cairn_memories (owner_id, namespace_key, id)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE cairn_suppression_facts (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    slot TEXT NOT NULL,
    fact_id TEXT NOT NULL,
    incarnation TEXT NOT NULL,
    epoch TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    action_id TEXT NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (owner_id, namespace_key, slot),
    UNIQUE (owner_id, fact_id)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE cairn_suppression_epochs (
    owner_id TEXT PRIMARY KEY,
    epoch TEXT NOT NULL
  ) STRICT, WITHOUT ROWID;

  -- Retain legacy fingerprints and receipt-denial tokens as evidence. A bare
  -- legacy fingerprint doesn't carry a typed origin, action or epoch.
  CREATE TABLE cairn_legacy_denials (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    PRIMARY KEY (owner_id, namespace_key, fingerprint)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE cairn_pause (
    owner_id TEXT PRIMARY KEY,
    paused INTEGER NOT NULL CHECK (paused IN (0, 1)),
    generation INTEGER NOT NULL CHECK (generation >= 0)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE cairn_capture_claims (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    client_key TEXT NOT NULL,
    event_key TEXT NOT NULL,
    session_key TEXT NOT NULL,
    payload_digest TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'leased', 'retryable', 'failed', 'done')),
    token TEXT UNIQUE,
    expires_at_ms INTEGER,
    dispatched INTEGER NOT NULL DEFAULT 0 CHECK (dispatched IN (0, 1)),
    source_positions TEXT,
    source_proofs TEXT,
    failure_code TEXT,
    PRIMARY KEY (owner_id, client_key, event_key),
    CHECK ((status = 'leased') = (token IS NOT NULL)),
    CHECK ((status = 'leased') = (expires_at_ms IS NOT NULL)),
    CHECK ((status = 'leased') = (source_positions IS NOT NULL)),
    CHECK ((status = 'leased') = (source_proofs IS NOT NULL)),
    CHECK ((status IN ('retryable', 'failed')) = (failure_code IS NOT NULL))
  ) STRICT, WITHOUT ROWID;

  CREATE INDEX cairn_capture_event ON cairn_capture_claims (owner_id, namespace_key, event_key);
  CREATE INDEX cairn_capture_source ON cairn_capture_claims (owner_id, namespace_key, client_key, session_key);

  -- Keep admission insertion order for clientless failure status.
  CREATE TABLE cairn_capture_outbox (
    owner_id TEXT NOT NULL,
    client_key TEXT NOT NULL,
    event_key TEXT NOT NULL,
    messages TEXT,
    result TEXT,
    PRIMARY KEY (owner_id, client_key, event_key),
    FOREIGN KEY (owner_id, client_key, event_key)
      REFERENCES cairn_capture_claims (owner_id, client_key, event_key),
    CHECK (messages IS NOT NULL OR result IS NOT NULL)
  ) STRICT;

  -- Keep repeat abandon idempotent even after a replacement lease finishes.
  CREATE TABLE cairn_capture_abandoned_tokens (
    owner_id TEXT NOT NULL,
    client_key TEXT NOT NULL,
    event_key TEXT NOT NULL,
    token TEXT NOT NULL,
    PRIMARY KEY (owner_id, token),
    FOREIGN KEY (owner_id, client_key, event_key)
      REFERENCES cairn_capture_claims (owner_id, client_key, event_key)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE cairn_index_revisions (
    owner_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE cairn_raw_messages (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    client_key TEXT NOT NULL,
    session_key TEXT NOT NULL,
    message_key TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    occurred_at_ms INTEGER,
    PRIMARY KEY (owner_id, namespace_key, client_key, session_key, message_key)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE cairn_raw_fences (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    session_hash TEXT NOT NULL,
    PRIMARY KEY (owner_id, namespace_key, session_hash)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE cairn_raw_anchors (
    owner_id TEXT NOT NULL,
    client_key TEXT NOT NULL,
    message_tag TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    session_tag TEXT NOT NULL,
    session_hash TEXT NOT NULL,
    proof TEXT NOT NULL,
    PRIMARY KEY (owner_id, client_key, message_tag, namespace_key, session_tag, proof)
  ) STRICT, WITHOUT ROWID;
`;

export const INITIALIZE_STORE = `
  INSERT INTO cairn_store VALUES (1, lower(hex(randomblob(16))), lower(hex(randomblob(32))));
  PRAGMA application_id = ${SQLITE_APPLICATION_ID};
  PRAGMA user_version = ${SQLITE_PHYSICAL_VERSION};
`;
