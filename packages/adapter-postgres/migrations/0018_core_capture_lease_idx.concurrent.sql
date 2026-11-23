CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS capture_events_core_lease_idx
  ON capture_events (user_id, core_lease_token) WHERE core_lease_token IS NOT NULL;
