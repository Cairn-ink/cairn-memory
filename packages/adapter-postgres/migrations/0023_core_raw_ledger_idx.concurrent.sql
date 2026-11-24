CREATE INDEX CONCURRENTLY IF NOT EXISTS capture_events_core_raw_ledger_idx
  ON capture_events (user_id, core_namespace, client, event_id);
