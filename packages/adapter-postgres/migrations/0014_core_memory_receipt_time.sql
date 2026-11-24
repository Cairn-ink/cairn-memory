SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE core_memory_receipts
  ADD COLUMN IF NOT EXISTS core_occurred_at_ms double precision;
