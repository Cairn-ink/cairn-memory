CREATE INDEX CONCURRENTLY IF NOT EXISTS raw_messages_user_time_id_idx
  ON raw_messages (user_id, occurred_at, id COLLATE "C");
