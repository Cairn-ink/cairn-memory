// v19 was never implemented. v20 is only the explicit local note/Card slice.
export const PRIVATE_CARD_SCHEMA_VERSION = 20;
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
