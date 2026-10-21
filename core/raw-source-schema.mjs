import { installCardMemoryInvalidation } from './private-card-schema.mjs';

export const RAW_SOURCE_SCHEMA_VERSION = 28;

export function installRawSources(db) {
  db.exec(`
    CREATE INDEX raw_source_part_start ON raw_parts(conversation_id,message_id,start);
    CREATE TABLE card_raw_bindings (
      card_id TEXT NOT NULL REFERENCES private_cards(id), binding_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL, message_id TEXT NOT NULL,
      start INTEGER NOT NULL CHECK(start>=0), end INTEGER NOT NULL CHECK(end>start),
      source_ref TEXT NOT NULL CHECK(json_valid(source_ref)),
      position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 15),
      PRIMARY KEY(card_id,binding_id)
    ) STRICT;
    CREATE INDEX card_raw_dependents ON card_raw_bindings(conversation_id,card_id,message_id,start,end);
    CREATE TABLE card_raw_mutation_context (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner_id TEXT NOT NULL,
      scope TEXT NOT NULL, project_id TEXT NOT NULL, action_id TEXT NOT NULL
    ) STRICT;
    CREATE TABLE card_raw_pending_invalidations (
      card_id TEXT PRIMARY KEY REFERENCES private_cards(id), revision INTEGER NOT NULL CHECK(revision>0)
    ) STRICT;
    CREATE TRIGGER card_raw_purge AFTER UPDATE OF state ON private_cards
      WHEN NEW.state IN ('cancelled','deleted') BEGIN
      DELETE FROM card_raw_bindings WHERE card_id=NEW.id;
    END;
  `);
  db.exec('DROP TRIGGER card_memory_revision_invalidation');
  installCardMemoryInvalidation(db,true);
}
