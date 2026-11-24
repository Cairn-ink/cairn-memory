SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE core_owner_state
  ADD COLUMN IF NOT EXISTS legacy_writes_reconciled boolean NOT NULL DEFAULT false;
