SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- A receipt records forgotten_at when a forget deletes its source message.
-- Hosts withhold re-sent messages with the same owner, client, session, and message IDs.
ALTER TABLE core_memory_receipts ADD COLUMN IF NOT EXISTS forgotten_at timestamptz;

CREATE INDEX IF NOT EXISTS core_memory_receipts_forgotten_idx
  ON core_memory_receipts (user_id, client, session_id, message_id) WHERE forgotten_at IS NOT NULL;
