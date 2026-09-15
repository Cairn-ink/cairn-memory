/** Version 13 adds bounded source payloads and durable content-free event fences. */
export function migrateVersion12(db) {
  db.exec(`
    CREATE TABLE staged_capture_evidence (
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      client TEXT NOT NULL,
      event_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending','failed','admitted','discarded','expired','forgotten')),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      payload TEXT,
      payload_bytes INTEGER NOT NULL CHECK (payload_bytes BETWEEN 0 AND 131072),
      PRIMARY KEY (owner_id, scope, project_id, client, event_id),
      FOREIGN KEY (owner_id, scope, project_id, client, event_id)
        REFERENCES admission_claims(owner_id, scope, project_id, client, event_id),
      CHECK ((payload IS NULL AND payload_bytes = 0) OR
        (payload IS NOT NULL AND payload_bytes > 0)),
      CHECK ((scope = 'personal' AND project_id = '') OR
        (scope = 'project' AND length(project_id) > 0))
    ) STRICT;
    CREATE TABLE staged_capture_clocks (
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      watermark INTEGER NOT NULL,
      PRIMARY KEY (owner_id, scope, project_id)
    ) STRICT;
  `);
}
