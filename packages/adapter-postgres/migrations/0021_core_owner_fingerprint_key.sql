SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE core_owner_state ADD COLUMN IF NOT EXISTS fingerprint_key_id text
  CHECK (fingerprint_key_id ~ '^[0-9a-f]{16}$');
