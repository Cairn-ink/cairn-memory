SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE capture_events
  ADD COLUMN IF NOT EXISTS core_namespace text,
  ADD COLUMN IF NOT EXISTS core_payload_digest text,
  ADD COLUMN IF NOT EXISTS core_admitted boolean,
  ADD COLUMN IF NOT EXISTS core_outbox_metadata jsonb,
  ADD COLUMN IF NOT EXISTS core_lease_token uuid,
  ADD COLUMN IF NOT EXISTS core_lease_expires_at_ms bigint,
  ADD COLUMN IF NOT EXISTS core_lease_sources jsonb,
  ADD COLUMN IF NOT EXISTS core_dispatched boolean,
  ADD COLUMN IF NOT EXISTS core_abandoned_tokens uuid[],
  ADD COLUMN IF NOT EXISTS core_failure_code text,
  ADD COLUMN IF NOT EXISTS core_result jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'capture_events'::regclass AND conname = 'capture_events_core_payload_digest_check'
  ) THEN
    ALTER TABLE capture_events ADD CONSTRAINT capture_events_core_payload_digest_check
      CHECK (core_payload_digest ~ '^[0-9a-f]{64}$') NOT VALID;
  END IF;
END;
$$;
