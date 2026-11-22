CREATE INDEX CONCURRENTLY IF NOT EXISTS memories_user_recent_c ON memories (user_id, updated_at DESC, id COLLATE "C" DESC);
