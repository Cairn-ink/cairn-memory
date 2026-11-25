SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS core_quantity_ledger (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  core_namespace text,
  memory_id text NOT NULL,
  receipt_id text NOT NULL,
  ledger_key text COLLATE "C" NOT NULL,
  text_hash text NOT NULL,
  date_ms bigint NOT NULL,
  ordinal bigint NOT NULL,
  kind text NOT NULL,
  measure text NOT NULL,
  category text NOT NULL,
  value double precision NOT NULL,
  unit text NOT NULL,
  quantity_group text NOT NULL,
  period text NOT NULL,
  comparator text NOT NULL
);

-- The owner write lock protects exact-key deduplication without indexing unbounded quantity text.
CREATE INDEX IF NOT EXISTS core_quantity_ledger_memory_idx
  ON core_quantity_ledger (user_id, memory_id);
CREATE INDEX IF NOT EXISTS core_quantity_ledger_receipt_idx
  ON core_quantity_ledger (user_id, receipt_id);
CREATE INDEX IF NOT EXISTS core_quantity_ledger_date_idx
  ON core_quantity_ledger (user_id, date_ms);
