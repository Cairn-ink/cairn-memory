SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE capture_events
  ADD COLUMN IF NOT EXISTS core_namespace text,
  ADD COLUMN IF NOT EXISTS core_payload_digest text CHECK (core_payload_digest ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS core_admitted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS core_lease_token uuid,
  ADD COLUMN IF NOT EXISTS core_lease_expires_at_ms bigint,
  ADD COLUMN IF NOT EXISTS core_lease_sources jsonb,
  ADD COLUMN IF NOT EXISTS core_dispatched boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS core_abandoned_tokens uuid[],
  ADD COLUMN IF NOT EXISTS core_failure_code text,
  ADD COLUMN IF NOT EXISTS core_result jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS capture_events_core_lease_idx
  ON capture_events (user_id, core_lease_token) WHERE core_lease_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS capture_events_core_status_idx
  ON capture_events (user_id, event_id, core_namespace, client) WHERE core_admitted;

-- A retry can replace the lease before the original abandon request is replayed.
CREATE INDEX IF NOT EXISTS capture_events_core_abandoned_idx
  ON capture_events USING gin (core_abandoned_tokens) WHERE core_abandoned_tokens IS NOT NULL;
