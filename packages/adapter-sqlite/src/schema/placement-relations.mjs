export const PLACEMENT_RELATION_TABLES = [
  "cairn_topics", "cairn_topic_sources", "cairn_topic_outcomes", "cairn_topic_memberships", "cairn_topic_failures",
  "cairn_supersessions", "cairn_conflicts",
];

export const PLACEMENT_RELATION_SCHEMA = `
  CREATE TABLE cairn_topics (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    id TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('L1', 'L2')),
    title TEXT,
    title_hash TEXT NOT NULL,
    parent_ids TEXT NOT NULL,
    PRIMARY KEY (owner_id, namespace_key, id),
    UNIQUE (owner_id, id),
    UNIQUE (owner_id, namespace_key, level, title_hash)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE cairn_topic_sources (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    memory_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY (owner_id, namespace_key, topic_id, memory_id),
    FOREIGN KEY (owner_id, namespace_key, topic_id) REFERENCES cairn_topics ON DELETE CASCADE
  ) STRICT, WITHOUT ROWID;

  CREATE INDEX cairn_topic_source_memory ON cairn_topic_sources (owner_id, namespace_key, memory_id);

  CREATE TABLE cairn_topic_outcomes (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    memory_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    PRIMARY KEY (owner_id, namespace_key, memory_id)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE cairn_topic_memberships (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    memory_id TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    placed_at_us INTEGER NOT NULL CHECK (placed_at_us >= 0),
    PRIMARY KEY (owner_id, namespace_key, memory_id, topic_id),
    FOREIGN KEY (owner_id, namespace_key, memory_id) REFERENCES cairn_topic_outcomes ON DELETE CASCADE,
    FOREIGN KEY (owner_id, namespace_key, topic_id) REFERENCES cairn_topics ON DELETE CASCADE
  ) STRICT, WITHOUT ROWID;

  CREATE INDEX cairn_topic_membership_topic ON cairn_topic_memberships (owner_id, namespace_key, topic_id);

  CREATE TABLE cairn_topic_failures (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    memory_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    code TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    failed_at_ms INTEGER NOT NULL,
    PRIMARY KEY (owner_id, namespace_key, memory_id)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE cairn_supersessions (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    previous_id TEXT NOT NULL,
    previous_revision INTEGER NOT NULL,
    replacement_id TEXT NOT NULL CHECK (replacement_id != previous_id),
    replacement_revision INTEGER NOT NULL,
    receipt_ids TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (owner_id, namespace_key, previous_id)
  ) STRICT, WITHOUT ROWID;

  CREATE INDEX cairn_supersession_replacement ON cairn_supersessions (owner_id, namespace_key, replacement_id);

  CREATE TABLE cairn_conflicts (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    left_id TEXT NOT NULL,
    left_revision INTEGER NOT NULL,
    right_id TEXT NOT NULL CHECK (left_id < right_id),
    right_revision INTEGER NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('explicit-hint', 'inferred-hint')),
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (owner_id, namespace_key, left_id, left_revision, right_id, right_revision, source)
  ) STRICT, WITHOUT ROWID;

  CREATE INDEX cairn_conflict_right ON cairn_conflicts (owner_id, namespace_key, right_id);

  CREATE TRIGGER cairn_topic_source_revision AFTER UPDATE OF revision, historical, deleted ON cairn_memories
    WHEN OLD.revision != NEW.revision OR OLD.historical != NEW.historical OR OLD.deleted != NEW.deleted
    BEGIN
      UPDATE cairn_topics SET title = NULL WHERE owner_id = OLD.owner_id AND namespace_key = OLD.namespace_key
        AND title IS NOT NULL AND id IN (
          SELECT topic_id FROM cairn_topic_sources WHERE owner_id = OLD.owner_id AND namespace_key = OLD.namespace_key
            AND memory_id = OLD.id
        );
    END;

  CREATE TRIGGER cairn_memory_erase_dependents AFTER UPDATE OF deleted ON cairn_memories
    WHEN NEW.deleted = 1 AND OLD.deleted = 0
    BEGIN
      DELETE FROM cairn_topic_outcomes WHERE owner_id = OLD.owner_id AND namespace_key = OLD.namespace_key AND memory_id = OLD.id;
      DELETE FROM cairn_topic_failures WHERE owner_id = OLD.owner_id AND namespace_key = OLD.namespace_key AND memory_id = OLD.id;
      UPDATE cairn_topic_sources SET revision = 0
        WHERE owner_id = OLD.owner_id AND namespace_key = OLD.namespace_key AND memory_id = OLD.id AND revision != 0;
      DELETE FROM cairn_conflicts WHERE owner_id = OLD.owner_id AND namespace_key = OLD.namespace_key
        AND (left_id = OLD.id OR right_id = OLD.id);
      DELETE FROM cairn_supersessions WHERE owner_id = OLD.owner_id AND namespace_key = OLD.namespace_key
        AND (previous_id = OLD.id OR replacement_id = OLD.id);
    END;
`;
