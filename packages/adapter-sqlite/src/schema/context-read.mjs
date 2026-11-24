/** @import { Connection } from "../storage-values.mjs" */

export const CONTEXT_READ_TABLES = Object.freeze([
  "cairn_context_publications", "cairn_context_documents", "cairn_context_terms", "cairn_context_raw_checkpoints",
]);

/** @param {Connection} db */
export function installContextReadSchema(db) {
  db.exec(`
    CREATE TABLE cairn_context_publications (
      projection TEXT PRIMARY KEY,
      fence TEXT NOT NULL,
      incarnation TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence > 0),
      base_sequence INTEGER NOT NULL CHECK (base_sequence >= 0),
      checkpoint INTEGER NOT NULL CHECK (checkpoint > 0),
      phase INTEGER NOT NULL CHECK (phase >= 0),
      last_id TEXT NOT NULL,
      eligible INTEGER NOT NULL CHECK (eligible >= 0),
      total_length INTEGER NOT NULL CHECK (total_length >= 0),
      published INTEGER NOT NULL CHECK (published IN (0, 1)),
      rebuilt INTEGER NOT NULL CHECK (rebuilt IN (0, 1))
    ) STRICT, WITHOUT ROWID;

    CREATE TABLE cairn_context_documents (
      projection TEXT NOT NULL REFERENCES cairn_context_publications (projection) ON DELETE CASCADE,
      namespace_key TEXT NOT NULL,
      id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      token_length INTEGER NOT NULL CHECK (token_length >= 0),
      PRIMARY KEY (projection, namespace_key, id)
    ) STRICT, WITHOUT ROWID;

    CREATE INDEX cairn_context_old_documents ON cairn_context_documents (projection, sequence);

    -- Terms are store-keyed digests. Canonical text is never copied here.
    CREATE TABLE cairn_context_terms (
      projection TEXT NOT NULL,
      namespace_key TEXT NOT NULL,
      id TEXT NOT NULL,
      term TEXT NOT NULL,
      frequency INTEGER NOT NULL CHECK (frequency > 0),
      PRIMARY KEY (projection, term, namespace_key, id),
      FOREIGN KEY (projection, namespace_key, id)
        REFERENCES cairn_context_documents (projection, namespace_key, id) ON DELETE CASCADE
    ) STRICT, WITHOUT ROWID;

    CREATE INDEX cairn_context_terms_by_document ON cairn_context_terms (projection, namespace_key, id);
    CREATE INDEX cairn_context_receipts_by_source ON cairn_receipts (owner_id, namespace_key, source_key);

    CREATE TABLE cairn_context_raw_checkpoints (
      projection TEXT PRIMARY KEY,
      fence TEXT NOT NULL,
      last_key TEXT NOT NULL,
      examined INTEGER NOT NULL CHECK (examined >= 0),
      published INTEGER NOT NULL CHECK (published IN (0, 1))
    ) STRICT, WITHOUT ROWID;
  `);
}
