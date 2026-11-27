export function migrateVersion10(db) {
  db.exec(`
    CREATE TABLE qualified_slots (
      id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
      owner_id TEXT NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL CHECK (length(project_id) <= 200),
      subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 160),
      property TEXT NOT NULL CHECK (length(property) BETWEEN 1 AND 160),
      claim_scope TEXT NOT NULL CHECK (length(claim_scope) BETWEEN 1 AND 120),
      applies TEXT NOT NULL CHECK (length(applies) BETWEEN 1 AND 120),
      CHECK ((scope = 'personal' AND project_id = '') OR (scope = 'project' AND length(project_id) > 0))
    ) STRICT;
    CREATE TABLE qualified_claim_bindings (
      memory_id TEXT PRIMARY KEY REFERENCES memory_qualifications(memory_id) ON DELETE CASCADE,
      slot_id TEXT NOT NULL REFERENCES qualified_slots(id),
      bound_revision INTEGER NOT NULL CHECK (bound_revision BETWEEN 1 AND 9007199254740991),
      content_digest TEXT NOT NULL CHECK (length(content_digest) = 64 AND content_digest NOT GLOB '*[^0-9a-f]*'),
      single_claim INTEGER NOT NULL CHECK (single_claim = 1)
    ) STRICT;
    CREATE INDEX qualified_slot_members ON qualified_claim_bindings(slot_id);
    CREATE TRIGGER qualified_slot_cleanup AFTER DELETE ON qualified_claim_bindings
    BEGIN
      DELETE FROM qualified_slots WHERE id = OLD.slot_id
        AND NOT EXISTS (SELECT 1 FROM qualified_claim_bindings WHERE slot_id = OLD.slot_id);
    END;
  `);
}
