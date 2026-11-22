SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS confidence double precision NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS origin text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'memories'::regclass AND conname = 'memories_core_metadata_check'
  ) THEN
    ALTER TABLE memories ADD CONSTRAINT memories_core_metadata_check CHECK (
      revision > 0 AND confidence BETWEEN 0 AND 1
      AND (origin IS NULL OR origin IN ('explicit', 'inferred'))
    ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'memories'::regclass AND conname = 'memories_source_kind_check'
      AND strpos(pg_catalog.pg_get_constraintdef(oid), '''capture''') > 0
  ) THEN
    ALTER TABLE memories
      DROP CONSTRAINT IF EXISTS memories_source_kind_check,
      ADD CONSTRAINT memories_source_kind_check
        CHECK (source_kind IN ('mcp', 'plugin', 'import', 'web', 'capture')) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE memories VALIDATE CONSTRAINT memories_core_metadata_check;
ALTER TABLE memories VALIDATE CONSTRAINT memories_source_kind_check;
