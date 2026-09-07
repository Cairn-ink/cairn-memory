-- Frozen public v3 schema from 3b65135 core/database.mjs, Apache-2.0.
-- Test fixture only; production migrations remain in core/database.mjs.
CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      content TEXT,
      kind TEXT NOT NULL,
      origin TEXT NOT NULL CHECK (origin IN ('explicit','agent-inferred')),
      confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
      revision INTEGER NOT NULL CHECK (revision > 0),
      deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK ((scope = 'personal' AND project_id = '') OR
             (scope = 'project' AND length(project_id) > 0)),
      CHECK ((deleted = 0 AND content IS NOT NULL) OR (deleted = 1 AND content IS NULL))
    ) STRICT;
    CREATE UNIQUE INDEX active_identity ON memories(owner_id, scope, project_id, fingerprint)
      WHERE deleted = 0;
    CREATE INDEX namespace_memories ON memories(
      owner_id, scope, project_id, deleted, updated_at DESC, id);
    CREATE TABLE receipts (
      id TEXT NOT NULL UNIQUE,
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      receipt_key TEXT NOT NULL,
      client TEXT NOT NULL,
      session_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      excerpt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (memory_id, receipt_key)
    ) STRICT;
    CREATE INDEX memory_receipts ON receipts(memory_id, created_at, id);
    CREATE TABLE suppressed (
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      project_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      PRIMARY KEY (owner_id, scope, project_id, fingerprint)
    ) STRICT;
    CREATE TABLE namespace_epochs (
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      epoch INTEGER NOT NULL CHECK (epoch >= 1),
      PRIMARY KEY (owner_id, scope, project_id)
    ) STRICT;
    CREATE TABLE store_metadata (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      store_id TEXT NOT NULL UNIQUE,
      cursor_secret TEXT NOT NULL
    ) STRICT;
INSERT INTO store_metadata VALUES (1, 'synthetic-v3-store', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
PRAGMA application_id = 1128352082;
PRAGMA user_version = 3;
