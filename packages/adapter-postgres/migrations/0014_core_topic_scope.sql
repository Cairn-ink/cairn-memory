SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Match the core memory store's namespace encoding. Hosted rows use NULL.
ALTER TABLE topics ADD COLUMN IF NOT EXISTS core_namespace text COLLATE "C";

-- Keep the name checked by migration 0007 when its SQL is replayed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'topics'::regclass AND conname = 'topics_user_level_title_key_unique'
      AND cardinality(conkey) = 3
  ) THEN
    ALTER TABLE topics
      DROP CONSTRAINT topics_user_level_title_key_unique,
      ADD CONSTRAINT topics_user_level_title_key_unique
        UNIQUE NULLS NOT DISTINCT (user_id, core_namespace, level, title_key);
  END IF;
END;
$$;

-- Older edges have no stored order and continue to sort by parent id.
ALTER TABLE topic_edges ADD COLUMN IF NOT EXISTS core_parent_position integer;
