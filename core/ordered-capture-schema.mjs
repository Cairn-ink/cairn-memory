export function migrateVersion8(db) {
  db.exec(`
    CREATE TABLE capture_streams (
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      client TEXT NOT NULL, stream_id TEXT NOT NULL,
      high_water INTEGER NOT NULL CHECK (high_water >= 0),
      PRIMARY KEY(owner_id, scope, project_id, client, stream_id)
    ) STRICT;
    CREATE TABLE capture_events (
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      client TEXT NOT NULL, event_id TEXT NOT NULL, stream_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence > 0),
      reconciliation TEXT CHECK (length(reconciliation) <= 120),
      PRIMARY KEY(owner_id, scope, project_id, client, event_id),
      UNIQUE(owner_id, scope, project_id, client, stream_id, sequence)
    ) STRICT;
    CREATE TABLE receipt_causality (
      receipt_id TEXT PRIMARY KEY REFERENCES receipts(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      client TEXT NOT NULL, stream_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence > 0)
    ) STRICT;
    CREATE INDEX capture_current_memories ON memories(owner_id,scope,project_id,id)
      WHERE deleted = 0 AND currentness = 'current';
    CREATE INDEX capture_memory_receipts ON receipts(memory_id,id);
  `);
}
