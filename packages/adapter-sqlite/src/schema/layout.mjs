// ASCII "CNXT" identifies core-next stores. Their user_version starts a
// separate schema version sequence from the legacy engine.
export const SQLITE_APPLICATION_ID = 0x434e5854;
export const SQLITE_PHYSICAL_VERSION = 1;

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
`;

export const INITIALIZE_STORE = `
  INSERT INTO cairn_store VALUES (1, lower(hex(randomblob(16))), lower(hex(randomblob(32))));
  PRAGMA application_id = ${SQLITE_APPLICATION_ID};
  PRAGMA user_version = ${SQLITE_PHYSICAL_VERSION};
`;
