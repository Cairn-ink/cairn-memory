SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE capture_events VALIDATE CONSTRAINT capture_events_core_payload_digest_check;
