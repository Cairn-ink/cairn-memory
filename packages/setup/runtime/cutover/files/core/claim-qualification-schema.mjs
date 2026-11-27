export function migrateVersion9(db) {
  db.exec(`
    CREATE TABLE memory_qualifications (
      memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
      version INTEGER NOT NULL CHECK (version = 1),
      bound_revision INTEGER NOT NULL CHECK (bound_revision BETWEEN 1 AND 9007199254740991),
      content_digest TEXT NOT NULL CHECK (length(content_digest) = 64 AND content_digest NOT GLOB '*[^0-9a-f]*'),
      subject TEXT CHECK (subject IS NULL OR length(subject) BETWEEN 1 AND 160),
      property TEXT CHECK (property IS NULL OR length(property) BETWEEN 1 AND 160),
      scope TEXT CHECK (scope IS NULL OR length(scope) BETWEEN 1 AND 120),
      applies TEXT CHECK (applies IS NULL OR length(applies) BETWEEN 1 AND 120),
      value TEXT CHECK (value IS NULL OR length(value) BETWEEN 1 AND 160),
      attribution TEXT NOT NULL CHECK (attribution IN ('direct','reported','quoted','proposed','unknown')),
      commitment TEXT NOT NULL CHECK (commitment IN ('adopted','considered','rejected','unknown')),
      anchor_count INTEGER NOT NULL CHECK (anchor_count BETWEEN 1 AND 4)
    ) STRICT;
    CREATE TABLE qualification_anchors (
      memory_id TEXT NOT NULL REFERENCES memory_qualifications(memory_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 3),
      receipt_id TEXT NOT NULL REFERENCES receipts(id),
      receipt_digest TEXT NOT NULL CHECK (length(receipt_digest) = 64 AND receipt_digest NOT GLOB '*[^0-9a-f]*'),
      start INTEGER NOT NULL CHECK (start BETWEEN 0 AND 799),
      end INTEGER NOT NULL CHECK (end > start AND end <= 800 AND end - start <= 200),
      fields TEXT NOT NULL CHECK (length(fields) BETWEEN 2 AND 128),
      PRIMARY KEY (memory_id, ordinal)
    ) STRICT;
    CREATE INDEX qualification_receipts ON qualification_anchors(receipt_id);
  `);
}
