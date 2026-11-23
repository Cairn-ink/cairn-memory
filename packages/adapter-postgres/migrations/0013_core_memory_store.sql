SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS core_namespace text COLLATE "C",
  ADD COLUMN IF NOT EXISTS core_digests jsonb,
  ADD COLUMN IF NOT EXISTS core_text_hash text,
  ADD COLUMN IF NOT EXISTS core_created_at_ms bigint;

ALTER TABLE core_memory_receipts
  ADD COLUMN IF NOT EXISTS core_occurred_at_ms double precision;
