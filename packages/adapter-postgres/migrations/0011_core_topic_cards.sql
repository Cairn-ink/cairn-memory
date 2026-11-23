SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

/* Topic tables omit foreign keys to content tables so their migrations avoid locking content tables.
 * A card hide writes a tombstone, and dropCard clears the card's memberships in the same transaction.
 */
CREATE TABLE IF NOT EXISTS card_placements (
  user_id text NOT NULL,
  card_id text NOT NULL,
  content_hash text NOT NULL,
  status text NOT NULL,
  code text,
  attempts smallint NOT NULL DEFAULT 0,
  placed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS card_topics (
  user_id text NOT NULL,
  card_id text NOT NULL,
  topic_id text NOT NULL,
  content_hash text NOT NULL,
  placed_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'card_placements'::regclass AND conname = 'card_placements_user_id_card_id_pk'
  ) THEN
    ALTER TABLE card_placements ADD CONSTRAINT card_placements_user_id_card_id_pk PRIMARY KEY (user_id, card_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'card_placements'::regclass AND conname = 'card_placements_status_check'
  ) THEN
    ALTER TABLE card_placements ADD CONSTRAINT card_placements_status_check CHECK (status IN ('filed', 'unfiled', 'failed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'card_placements'::regclass AND conname = 'card_placements_attempts_check'
  ) THEN
    ALTER TABLE card_placements ADD CONSTRAINT card_placements_attempts_check CHECK (attempts BETWEEN 0 AND 3);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'card_placements'::regclass AND conname = 'card_placements_user_id_users_id_fk'
  ) THEN
    ALTER TABLE card_placements ADD CONSTRAINT card_placements_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'card_topics'::regclass AND conname = 'card_topics_user_id_card_id_topic_id_pk'
  ) THEN
    ALTER TABLE card_topics ADD CONSTRAINT card_topics_user_id_card_id_topic_id_pk PRIMARY KEY (user_id, card_id, topic_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'card_topics'::regclass AND conname = 'card_topics_user_id_users_id_fk'
  ) THEN
    ALTER TABLE card_topics ADD CONSTRAINT card_topics_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'card_topics'::regclass AND conname = 'card_topics_user_id_topic_id_topics_user_id_id_fk'
  ) THEN
    ALTER TABLE card_topics ADD CONSTRAINT card_topics_user_id_topic_id_topics_user_id_id_fk
      FOREIGN KEY (user_id, topic_id) REFERENCES public.topics (user_id, id) ON DELETE CASCADE;
  END IF;
END;
$$;

-- CREATE INDEX locks the table before its IF NOT EXISTS check.
DO $$
BEGIN
  IF pg_catalog.to_regclass('public.card_placements_retry_idx') IS NULL THEN
    EXECUTE $index$CREATE INDEX IF NOT EXISTS card_placements_retry_idx
      ON card_placements (user_id, placed_at) WHERE status = 'failed'$index$;
  END IF;
  IF pg_catalog.to_regclass('public.card_topics_card_idx') IS NULL THEN
    EXECUTE $index$CREATE INDEX IF NOT EXISTS card_topics_card_idx ON card_topics (card_id)$index$;
  END IF;
  IF pg_catalog.to_regclass('public.card_topics_newest_idx') IS NULL THEN
    EXECUTE $index$CREATE INDEX IF NOT EXISTS card_topics_newest_idx
      ON card_topics (user_id, topic_id, placed_at DESC, card_id DESC)$index$;
  END IF;
END;
$$;
