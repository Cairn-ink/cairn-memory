export function migrateVersion11(db) {
  db.exec(`
    CREATE TABLE rationale_edges (
      from_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      from_revision INTEGER NOT NULL CHECK(from_revision > 0),
      to_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      to_revision INTEGER NOT NULL CHECK(to_revision > 0),
      relation TEXT NOT NULL CHECK(relation IN ('supports-decision','challenges-premise')),
      from_receipt TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
      to_receipt TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
      from_digest TEXT NOT NULL,
      to_digest TEXT NOT NULL,
      CHECK(from_id != to_id OR relation = 'supports-decision'),
      PRIMARY KEY(from_id, to_id, relation, from_receipt, to_receipt)
    ) STRICT;
    CREATE INDEX rationale_incoming ON rationale_edges(to_id, relation);
    CREATE TRIGGER rationale_memory_changed AFTER UPDATE ON memories
    WHEN NEW.revision != OLD.revision OR NEW.deleted != OLD.deleted
      OR NEW.content IS NOT OLD.content OR NEW.currentness != OLD.currentness
      OR NEW.owner_id != OLD.owner_id OR NEW.scope != OLD.scope OR NEW.project_id != OLD.project_id
    BEGIN
      DELETE FROM rationale_edges WHERE from_id = OLD.id OR to_id = OLD.id;
    END;
    CREATE TRIGGER rationale_receipt_changed AFTER UPDATE ON receipts
    BEGIN
      DELETE FROM rationale_edges WHERE from_id = OLD.memory_id OR to_id = OLD.memory_id
        OR from_id = NEW.memory_id OR to_id = NEW.memory_id;
    END;
    CREATE TRIGGER rationale_receipt_added AFTER INSERT ON receipts
    BEGIN
      DELETE FROM rationale_edges WHERE from_id = NEW.memory_id OR to_id = NEW.memory_id;
    END;
    CREATE TRIGGER rationale_receipt_removed AFTER DELETE ON receipts
    BEGIN
      DELETE FROM rationale_edges WHERE from_id = OLD.memory_id OR to_id = OLD.memory_id;
    END;
  `);
}
