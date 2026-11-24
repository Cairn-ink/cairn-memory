export const BOOTSTRAP_FILENAME = ".cairn-migration-bootstrap.sqlite";
export const MIGRATION_SCHEMA = `
  CREATE TABLE cairn_migration (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    migration_id TEXT NOT NULL,
    source_version INTEGER NOT NULL,
    source_digest TEXT NOT NULL,
    checkpoint INTEGER NOT NULL CHECK (checkpoint BETWEEN 0 AND 3),
    source_evidence TEXT NOT NULL,
    attestation TEXT,
    CHECK ((checkpoint = 3) = (attestation IS NOT NULL))
  ) STRICT;
  CREATE TABLE cairn_migrated_raw_privacy (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    client_key TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('uuid', 'window', 'range', 'span', 'event', 'admission', 'reservation')),
    selector TEXT NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (owner_id, namespace_key, client_key, kind, selector, body)
  ) STRICT, WITHOUT ROWID;
  CREATE TABLE cairn_migrated_safety (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('fact', 'reservation')),
    identity TEXT NOT NULL,
    epoch TEXT,
    reason TEXT,
    origin TEXT NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (owner_id, namespace_key, kind, identity)
  ) STRICT, WITHOUT ROWID;
  CREATE TRIGGER cairn_migrated_memory_reservation BEFORE INSERT ON cairn_memories
  WHEN EXISTS (SELECT 1 FROM cairn_migrated_safety
    WHERE owner_id=NEW.owner_id AND namespace_key=NEW.namespace_key AND kind='reservation'
      AND identity=json_array('memory',NEW.id))
  BEGIN SELECT RAISE(ABORT, 'reserved_memory_identity'); END;
  CREATE TABLE cairn_migrated_raw_maps (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    client_key TEXT NOT NULL,
    session_key TEXT NOT NULL,
    message_key TEXT NOT NULL,
    source_key TEXT NOT NULL,
    start_utf16 INTEGER NOT NULL,
    end_utf16 INTEGER NOT NULL,
    precision TEXT NOT NULL,
    PRIMARY KEY (owner_id, namespace_key, client_key, session_key, message_key, source_key, start_utf16, end_utf16),
    FOREIGN KEY (owner_id, namespace_key, client_key, session_key, message_key)
      REFERENCES cairn_raw_messages ON DELETE CASCADE
  ) STRICT, WITHOUT ROWID;
`;
