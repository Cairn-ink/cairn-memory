CREATE INDEX CONCURRENTLY IF NOT EXISTS raw_messages_core_purge_idx
  ON raw_messages (user_id, core_namespace, id);
