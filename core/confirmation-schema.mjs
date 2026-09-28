import { installIndexReaders } from './index-schema.mjs';

export const CONFIRMATION_SCHEMA_VERSION = 18;

// Called inside the opener's schema transaction, including feature-off opens.
export function migrateVersion17(db) {
  db.exec(`
    ALTER TABLE memories ADD COLUMN review_state TEXT NOT NULL DEFAULT 'none'
      CHECK(review_state IN ('none','awaiting','confirmed'));
    CREATE TABLE confirmation_actions (
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      action_id TEXT NOT NULL, payload_digest TEXT NOT NULL, result TEXT NOT NULL,
      PRIMARY KEY(owner_id,scope,project_id,action_id)
    ) STRICT;
    CREATE VIEW review_hidden_episodes AS
      WITH RECURSIVE hidden(id) AS (
        SELECT l.episode_id FROM episode_memory_links l JOIN memories m ON m.id=l.memory_id
          WHERE m.deleted=0 AND m.review_state='awaiting'
        UNION
        SELECT s.episode_id FROM episode_sources s JOIN hidden h ON h.id=s.origin_episode_id
      ) SELECT id FROM hidden;
  `);
  installIndexReaders(db, true, true);
}
