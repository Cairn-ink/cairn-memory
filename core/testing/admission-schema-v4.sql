-- Synthetic empty schema generated from the frozen public v4 runtime.
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
      updated_at TEXT NOT NULL, filing_status TEXT NOT NULL DEFAULT 'unfiled'
      CHECK (filing_status IN ('filed','unfiled')),
      CHECK ((scope = 'personal' AND project_id = '') OR
             (scope = 'project' AND length(project_id) > 0)),
      CHECK ((deleted = 0 AND content IS NOT NULL) OR (deleted = 1 AND content IS NULL))
    ) STRICT;
CREATE TABLE moc_edges (
      parent_id TEXT NOT NULL REFERENCES mocs(id) ON DELETE CASCADE,
      parent_revision INTEGER NOT NULL CHECK (parent_revision > 0),
      child_id TEXT NOT NULL REFERENCES mocs(id) ON DELETE CASCADE,
      child_revision INTEGER NOT NULL CHECK (child_revision > 0),
      PRIMARY KEY (parent_id, child_id),
      CHECK (parent_id != child_id)
    ) STRICT;
CREATE TABLE moc_memory_refs (
      moc_id TEXT NOT NULL REFERENCES mocs(id) ON DELETE CASCADE,
      moc_revision INTEGER NOT NULL CHECK (moc_revision > 0),
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      memory_revision INTEGER NOT NULL CHECK (memory_revision > 0),
      PRIMARY KEY (moc_id, memory_id)
    ) STRICT;
CREATE TABLE moc_title_sources (
      moc_id TEXT NOT NULL REFERENCES mocs(id) ON DELETE CASCADE,
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      memory_revision INTEGER NOT NULL CHECK (memory_revision > 0),
      PRIMARY KEY (moc_id, memory_id)
    ) STRICT;
CREATE TABLE mocs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      level INTEGER NOT NULL CHECK (level IN (1,2)),
      title TEXT NOT NULL,
      canonical_title TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK ((scope = 'personal' AND project_id = '') OR
             (scope = 'project' AND length(project_id) > 0))
    ) STRICT;
CREATE TABLE namespace_epochs (
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      epoch INTEGER NOT NULL CHECK (epoch >= 1),
      PRIMARY KEY (owner_id, scope, project_id)
    ) STRICT;
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
CREATE TABLE store_metadata (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      store_id TEXT NOT NULL UNIQUE,
      cursor_secret TEXT NOT NULL
    ) STRICT;
CREATE TABLE suppressed (
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      project_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      PRIMARY KEY (owner_id, scope, project_id, fingerprint)
    ) STRICT;
CREATE UNIQUE INDEX active_identity ON memories(owner_id, scope, project_id, fingerprint)
      WHERE deleted = 0;
CREATE INDEX child_moc_edges ON moc_edges(child_id, parent_id);
CREATE INDEX memory_moc_refs ON moc_memory_refs(memory_id, moc_id);
CREATE INDEX memory_receipts ON receipts(memory_id, created_at, id);
CREATE INDEX memory_title_sources ON moc_title_sources(memory_id, moc_id);
CREATE INDEX namespace_memories ON memories(
      owner_id, scope, project_id, deleted, updated_at DESC, id);
CREATE UNIQUE INDEX namespace_moc_titles ON mocs(
      owner_id, scope, project_id, level, canonical_title);
CREATE INDEX namespace_mocs ON mocs(
      owner_id, scope, project_id, level, canonical_title, id);
PRAGMA application_id = 1128352082;
PRAGMA user_version = 4;
