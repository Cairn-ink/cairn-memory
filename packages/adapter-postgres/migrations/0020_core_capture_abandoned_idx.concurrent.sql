CREATE INDEX CONCURRENTLY IF NOT EXISTS capture_events_core_abandoned_idx
  ON capture_events USING gin (core_abandoned_tokens) WHERE core_abandoned_tokens IS NOT NULL;
