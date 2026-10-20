// v19 was never implemented. v20 is only the explicit local note/Card slice.
export const PRIVATE_CARD_SCHEMA_VERSION = 21;
export function installPrivateCards(db) {
  db.exec(`
    CREATE TABLE card_notes (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, scope TEXT NOT NULL,
      project_id TEXT NOT NULL, revision INTEGER NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('available','deleted')),
      text TEXT, byte_count INTEGER NOT NULL, occurred_at TEXT,
      received_at TEXT NOT NULL,
      CHECK((state='available' AND text IS NOT NULL) OR
        (state='deleted' AND text IS NULL AND byte_count=0))
    ) STRICT;
    CREATE INDEX card_note_scope ON card_notes(owner_id,scope,project_id,id);
    CREATE TABLE private_cards (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, scope TEXT NOT NULL,
      project_id TEXT NOT NULL, revision INTEGER NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('draft','confirmed','cancelled','deleted')),
      title TEXT, body TEXT, body_revision INTEGER,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, confirmed_at TEXT,
      CHECK((state IN ('draft','confirmed') AND title IS NOT NULL AND body IS NOT NULL)
        OR (state IN ('cancelled','deleted') AND title IS NULL AND body IS NULL))
    ) STRICT;
    CREATE INDEX private_card_scope ON private_cards(owner_id,scope,project_id,state,id);
    CREATE TABLE card_bindings (
      card_id TEXT NOT NULL REFERENCES private_cards(id),
      source_id TEXT NOT NULL REFERENCES card_notes(id),
      source_ref TEXT NOT NULL, position INTEGER NOT NULL,
      PRIMARY KEY(card_id,source_id)
    ) STRICT;
    CREATE INDEX card_source_dependents ON card_bindings(source_id,card_id);
    CREATE TABLE card_operations (
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      action_id TEXT NOT NULL, method TEXT NOT NULL, payload_binding TEXT NOT NULL,
      target_id TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(owner_id,scope,project_id,action_id)
    ) STRICT;
    CREATE TABLE card_effects (
      effect_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, scope TEXT NOT NULL,
      project_id TEXT NOT NULL, kind TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, revision INTEGER NOT NULL, action_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL UNIQUE
    ) STRICT;
    CREATE INDEX card_effect_scope ON card_effects(owner_id,scope,project_id,ordinal);
    CREATE TABLE card_epochs (
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      generation INTEGER NOT NULL, PRIMARY KEY(owner_id,scope,project_id)
    ) STRICT;
    CREATE TABLE card_note_usage (
      owner_id TEXT PRIMARY KEY, byte_count INTEGER NOT NULL CHECK(byte_count>=0)
    ) STRICT;
  `);
}

// Metadata only: canonical receipt text remains exclusively in receipts.
export function installCardMemorySources(db) {
  db.exec(`
    CREATE TABLE card_memory_bindings (
      card_id TEXT NOT NULL REFERENCES private_cards(id),
      memory_id TEXT NOT NULL REFERENCES memories(id),
      memory_revision INTEGER NOT NULL CHECK(memory_revision>0),
      receipt_id TEXT NOT NULL, source_ref TEXT NOT NULL,
      position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 15),
      PRIMARY KEY(card_id,receipt_id)
    ) STRICT;
    CREATE INDEX card_memory_dependents ON card_memory_bindings(memory_id,card_id);
    CREATE INDEX card_receipt_dependents ON card_memory_bindings(receipt_id,card_id);
    CREATE TRIGGER card_memory_purge AFTER UPDATE OF state ON private_cards
      WHEN NEW.state IN ('cancelled','deleted')
    BEGIN
      DELETE FROM card_bindings WHERE card_id=NEW.id;
      DELETE FROM card_memory_bindings WHERE card_id=NEW.id;
    END;
    CREATE TRIGGER card_memory_revision_invalidation AFTER UPDATE OF revision ON memories
      WHEN OLD.revision!=NEW.revision AND EXISTS(
        SELECT 1 FROM card_memory_bindings WHERE memory_id=OLD.id)
    BEGIN
      SELECT CASE WHEN (SELECT count(*) FROM (
        SELECT DISTINCT c.id FROM private_cards c JOIN card_memory_bindings b ON b.card_id=c.id
        WHERE b.memory_id=OLD.id AND c.owner_id=OLD.owner_id AND c.scope=OLD.scope
          AND c.project_id=OLD.project_id AND c.state IN ('draft','confirmed') LIMIT 129
      ))>128 THEN RAISE(ABORT,'card_dependency_limit_reached') END;
      INSERT INTO card_effects
        (effect_id,owner_id,scope,project_id,kind,entity_type,entity_id,revision,action_id,ordinal)
      SELECT lower(hex(randomblob(16))),c.owner_id,c.scope,c.project_id,
        'evidence_invalidated','card',c.id,c.revision+1,
        'memory-revision-'||OLD.id||'-'||NEW.revision,
        (SELECT coalesce(max(ordinal),0) FROM card_effects)+row_number() OVER(ORDER BY c.id)
      FROM private_cards c WHERE c.owner_id=OLD.owner_id AND c.scope=OLD.scope
        AND c.project_id=OLD.project_id AND c.state IN ('draft','confirmed') AND EXISTS(
          SELECT 1 FROM card_memory_bindings b WHERE b.card_id=c.id AND b.memory_id=OLD.id);
      UPDATE private_cards SET revision=revision+1,updated_at=NEW.updated_at,
        title=CASE WHEN state='draft' THEN NULL ELSE title END,
        body=CASE WHEN state='draft' THEN NULL ELSE body END,
        state=CASE WHEN state='draft' THEN 'cancelled' ELSE state END
      WHERE owner_id=OLD.owner_id AND scope=OLD.scope AND project_id=OLD.project_id
        AND state IN ('draft','confirmed') AND EXISTS(
          SELECT 1 FROM card_memory_bindings b WHERE b.card_id=private_cards.id AND b.memory_id=OLD.id);
      INSERT INTO card_epochs(owner_id,scope,project_id,generation)
        VALUES(OLD.owner_id,OLD.scope,OLD.project_id,2)
        ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET generation=generation+1;
    END;
  `);
}
