CREATE INDEX CONCURRENTLY IF NOT EXISTS capture_events_core_raw_ledger_idx
  ON capture_events (user_id, client, event_id) WHERE core_namespace IS NULL;
