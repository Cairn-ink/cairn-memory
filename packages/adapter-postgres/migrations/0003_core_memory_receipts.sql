SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS core_memory_receipts (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  memory_id text COLLATE "C" NOT NULL,
  client text NOT NULL,
  session_id text NOT NULL,
  message_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  occurred_at timestamptz,
  PRIMARY KEY (user_id, memory_id, client, session_id, message_id)
);

CREATE INDEX IF NOT EXISTS core_memory_receipts_user_memory_idx
  ON core_memory_receipts (user_id, memory_id);
