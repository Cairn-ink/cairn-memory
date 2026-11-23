SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS currentness text NOT NULL DEFAULT 'current';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'memories'::regclass AND conname = 'memories_currentness_check'
  ) THEN
    ALTER TABLE memories ADD CONSTRAINT memories_currentness_check
      CHECK (currentness IN ('current', 'historical')) NOT VALID;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS memory_supersessions (
  user_id text NOT NULL,
  previous_memory_id text NOT NULL,
  previous_revision integer NOT NULL,
  replacement_memory_id text NOT NULL,
  replacement_revision integer NOT NULL,
  receipt_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memory_supersessions_pkey PRIMARY KEY (previous_memory_id),
  CONSTRAINT memory_supersessions_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT memory_supersessions_previous_memory_id_memories_id_fk
    FOREIGN KEY (previous_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  CONSTRAINT memory_supersessions_replacement_memory_id_memories_id_fk
    FOREIGN KEY (replacement_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  CONSTRAINT memory_supersessions_distinct_check CHECK (previous_memory_id <> replacement_memory_id),
  CONSTRAINT memory_supersessions_revision_check CHECK (previous_revision >= 1 AND replacement_revision >= 1),
  CONSTRAINT memory_supersessions_receipts_check CHECK (cardinality(receipt_ids) <= 4)
);

CREATE INDEX IF NOT EXISTS memory_supersessions_replacement_idx
  ON memory_supersessions (replacement_memory_id);

CREATE TABLE IF NOT EXISTS memory_conflicts (
  user_id text NOT NULL,
  left_memory_id text NOT NULL,
  left_revision integer NOT NULL,
  right_memory_id text NOT NULL,
  right_revision integer NOT NULL,
  relation text NOT NULL DEFAULT 'contradicts',
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memory_conflicts_pk
    PRIMARY KEY (left_memory_id, left_revision, right_memory_id, right_revision, relation, source),
  CONSTRAINT memory_conflicts_user_id_users_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT memory_conflicts_left_memory_id_memories_id_fk
    FOREIGN KEY (left_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  CONSTRAINT memory_conflicts_right_memory_id_memories_id_fk
    FOREIGN KEY (right_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  CONSTRAINT memory_conflicts_relation_check CHECK (relation = 'contradicts'),
  CONSTRAINT memory_conflicts_source_check CHECK (source IN ('explicit-hint', 'inferred-hint')),
  CONSTRAINT memory_conflicts_order_check CHECK ((left_memory_id COLLATE "C") < right_memory_id),
  CONSTRAINT memory_conflicts_revision_check CHECK (left_revision >= 1 AND right_revision >= 1)
);

CREATE INDEX IF NOT EXISTS memory_conflicts_right_idx
  ON memory_conflicts (right_memory_id);
