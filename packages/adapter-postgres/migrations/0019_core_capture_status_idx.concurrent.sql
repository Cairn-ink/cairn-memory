CREATE INDEX CONCURRENTLY IF NOT EXISTS capture_events_core_status_idx
  ON capture_events (user_id, event_id, core_namespace, client) WHERE core_admitted OR core_payload_digest IS NULL;
