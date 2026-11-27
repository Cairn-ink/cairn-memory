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
`;
