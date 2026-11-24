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
    kind TEXT NOT NULL CHECK (kind IN ('uuid', 'window', 'range', 'span', 'event')),
    selector TEXT NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (owner_id, namespace_key, client_key, kind, selector, body)
  ) STRICT, WITHOUT ROWID;
`;
