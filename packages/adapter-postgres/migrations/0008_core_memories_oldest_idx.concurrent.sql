CREATE INDEX CONCURRENTLY IF NOT EXISTS memories_user_oldest_idx ON memories (user_id, created_at, id);
