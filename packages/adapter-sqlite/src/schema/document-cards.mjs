export const DOCUMENT_CARD_TABLES = Object.freeze([
  "cairn_document_cards", "cairn_document_card_sources", "cairn_document_card_memories",
  "cairn_document_card_amendments", "cairn_document_card_generations",
  "cairn_document_card_outcomes", "cairn_document_card_memberships", "cairn_document_card_failures",
]);

export const DOCUMENT_CARD_SCHEMA = `
  CREATE TABLE cairn_document_cards (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    id TEXT NOT NULL,
    origin TEXT CHECK (origin IN ('router', 'import', 'manual')),
    title TEXT,
    body TEXT,
    content_hash TEXT,
    source_at_ms INTEGER,
    created_at_ms INTEGER NOT NULL,
    updated_at_us INTEGER NOT NULL CHECK (updated_at_us >= 0),
    revision INTEGER NOT NULL CHECK (revision > 0),
    body_revision INTEGER NOT NULL CHECK (body_revision > 0),
    stale TEXT,
    state TEXT NOT NULL CHECK (state IN ('active', 'hidden', 'purged')),
    hidden_reason TEXT,
    PRIMARY KEY (owner_id, namespace_key, id),
    CHECK ((state = 'active') = (hidden_reason IS NULL)),
    CHECK ((state = 'purged' AND title IS NULL AND body IS NULL AND content_hash IS NULL AND stale IS NULL) OR
      (state != 'purged' AND title IS NOT NULL AND body IS NOT NULL AND content_hash IS NOT NULL AND stale IS NOT NULL))
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE cairn_document_card_sources (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    card_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    client_key TEXT NOT NULL,
    session_key TEXT NOT NULL,
    message_key TEXT NOT NULL,
    start_utf16 INTEGER,
    end_utf16 INTEGER,
    PRIMARY KEY (owner_id, namespace_key, card_id, ordinal),
    FOREIGN KEY (owner_id, namespace_key, card_id) REFERENCES cairn_document_cards,
    CHECK ((ordinal = 0 AND start_utf16 IS NULL AND end_utf16 IS NULL) OR
      (ordinal > 0 AND start_utf16 IS NOT NULL AND end_utf16 IS NOT NULL AND start_utf16 >= 0 AND end_utf16 > start_utf16))
  ) STRICT, WITHOUT ROWID;

  CREATE INDEX cairn_document_card_source_address ON cairn_document_card_sources
    (owner_id, namespace_key, client_key, session_key, message_key, card_id);

  CREATE TABLE cairn_document_card_memories (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    card_id TEXT NOT NULL,
    memory_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY (owner_id, namespace_key, card_id, memory_id),
    UNIQUE (owner_id, namespace_key, card_id, ordinal),
    FOREIGN KEY (owner_id, namespace_key, card_id) REFERENCES cairn_document_cards
  ) STRICT, WITHOUT ROWID;

  CREATE INDEX cairn_document_card_memory_binding ON cairn_document_card_memories
    (owner_id, namespace_key, memory_id, card_id);

  CREATE TABLE cairn_document_card_amendments (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    card_id TEXT NOT NULL,
    amendment_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    date TEXT NOT NULL,
    client_key TEXT NOT NULL,
    session_key TEXT NOT NULL,
    message_key TEXT NOT NULL,
    sentence TEXT,
    quote TEXT,
    state TEXT NOT NULL CHECK (state IN ('active', 'hidden', 'purged')),
    hidden_reason TEXT,
    PRIMARY KEY (owner_id, namespace_key, card_id, amendment_id),
    UNIQUE (owner_id, namespace_key, card_id, ordinal),
    FOREIGN KEY (owner_id, namespace_key, card_id) REFERENCES cairn_document_cards,
    CHECK ((state = 'active') = (hidden_reason IS NULL)),
    CHECK ((state = 'purged' AND sentence IS NULL AND quote IS NULL) OR
      (state != 'purged' AND sentence IS NOT NULL AND quote IS NOT NULL))
  ) STRICT, WITHOUT ROWID;

  CREATE INDEX cairn_document_card_amendment_address ON cairn_document_card_amendments
    (owner_id, namespace_key, client_key, session_key, message_key, card_id);

  CREATE TABLE cairn_document_card_generations (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
    PRIMARY KEY (owner_id, namespace_key)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE cairn_document_card_outcomes (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    card_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    PRIMARY KEY (owner_id, namespace_key, card_id),
    FOREIGN KEY (owner_id, namespace_key, card_id) REFERENCES cairn_document_cards
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE cairn_document_card_memberships (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    card_id TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    placed_at_us INTEGER NOT NULL CHECK (placed_at_us >= 0),
    PRIMARY KEY (owner_id, namespace_key, card_id, topic_id),
    FOREIGN KEY (owner_id, namespace_key, card_id) REFERENCES cairn_document_card_outcomes ON DELETE CASCADE,
    FOREIGN KEY (owner_id, namespace_key, topic_id) REFERENCES cairn_topics ON DELETE CASCADE
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE cairn_document_card_failures (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    card_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    code TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    failed_at_ms INTEGER NOT NULL,
    PRIMARY KEY (owner_id, namespace_key, card_id),
    FOREIGN KEY (owner_id, namespace_key, card_id) REFERENCES cairn_document_cards
  ) STRICT, WITHOUT ROWID;
`;
