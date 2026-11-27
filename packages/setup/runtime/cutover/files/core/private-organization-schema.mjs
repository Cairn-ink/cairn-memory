export const PRIVATE_ORGANIZATION_SCHEMA_VERSION = 23;
export function installPrivateOrganization(db) {
  db.exec(`
    CREATE TABLE card_moc_epochs(owner_id TEXT NOT NULL,scope TEXT NOT NULL,project_id TEXT NOT NULL,
      revision INTEGER NOT NULL,PRIMARY KEY(owner_id,scope,project_id)) STRICT;
    CREATE TABLE card_mocs(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,scope TEXT NOT NULL,project_id TEXT NOT NULL,
      level INTEGER NOT NULL CHECK(level IN (1,2)),title TEXT NOT NULL,canonical_title TEXT NOT NULL,
      revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      UNIQUE(owner_id,scope,project_id,level,canonical_title)) STRICT;
    CREATE TABLE card_moc_title_sources(moc_id TEXT NOT NULL REFERENCES card_mocs(id),
      card_id TEXT NOT NULL REFERENCES private_cards(id),card_revision INTEGER NOT NULL,body_revision INTEGER NOT NULL,
      PRIMARY KEY(moc_id,card_id)) STRICT;
    CREATE TABLE card_moc_refs(moc_id TEXT NOT NULL REFERENCES card_mocs(id),moc_revision INTEGER NOT NULL,
      card_id TEXT NOT NULL REFERENCES private_cards(id),card_revision INTEGER NOT NULL,body_revision INTEGER NOT NULL,
      PRIMARY KEY(moc_id,card_id)) STRICT;
    CREATE INDEX card_moc_card_refs ON card_moc_refs(card_id,moc_id);
    CREATE TABLE card_moc_edges(parent_id TEXT NOT NULL REFERENCES card_mocs(id),parent_revision INTEGER NOT NULL,
      child_id TEXT NOT NULL REFERENCES card_mocs(id),child_revision INTEGER NOT NULL,
      PRIMARY KEY(parent_id,child_id)) STRICT;
    CREATE TABLE evidence_mappings(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,scope TEXT NOT NULL,project_id TEXT NOT NULL,
      revision INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('proposed','active','removed')),
      level INTEGER NOT NULL CHECK(level IN (1,2)),memory_moc_id TEXT NOT NULL,memory_moc_revision INTEGER NOT NULL,
      card_moc_id TEXT NOT NULL,card_moc_revision INTEGER NOT NULL,memory_index_revision INTEGER NOT NULL,
      card_index_revision INTEGER NOT NULL) STRICT;
    CREATE INDEX evidence_mapping_memory ON evidence_mappings(owner_id,scope,project_id,memory_moc_id,id);
    CREATE INDEX evidence_mapping_card ON evidence_mappings(owner_id,scope,project_id,card_moc_id,id);
    CREATE TRIGGER card_moc_card_insert AFTER INSERT ON private_cards BEGIN
      INSERT INTO card_moc_epochs VALUES(NEW.owner_id,NEW.scope,NEW.project_id,2)
        ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET revision=revision+1;
    END;
    CREATE TRIGGER card_moc_card_update AFTER UPDATE OF revision,state ON private_cards
      WHEN NEW.revision!=OLD.revision OR NEW.state!=OLD.state BEGIN
      INSERT INTO card_moc_epochs VALUES(NEW.owner_id,NEW.scope,NEW.project_id,2)
        ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET revision=revision+1;
    END;
  `);
}
