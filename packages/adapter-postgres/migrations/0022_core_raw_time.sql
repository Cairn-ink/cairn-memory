ALTER TABLE raw_messages
  ADD COLUMN IF NOT EXISTS core_occurred_at_ms bigint;
