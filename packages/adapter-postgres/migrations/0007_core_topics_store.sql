SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS topics (
  user_id text NOT NULL,
  id text NOT NULL,
  level smallint NOT NULL,
  title text NOT NULL,
  title_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS topic_edges (
  user_id text NOT NULL,
  parent_id text NOT NULL,
  child_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS topic_title_sources (
  user_id text NOT NULL,
  topic_id text NOT NULL,
  memory_id text NOT NULL,
  memory_revision integer NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_topics (
  user_id text NOT NULL,
  memory_id text NOT NULL,
  topic_id text NOT NULL,
  memory_revision integer NOT NULL,
  placed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_placements (
  user_id text NOT NULL,
  memory_id text NOT NULL,
  memory_revision integer NOT NULL,
  status text NOT NULL,
  code text,
  attempts smallint NOT NULL DEFAULT 0,
  placed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS topic_index_state (
  user_id text NOT NULL,
  revision bigint NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'topics'::regclass AND conname = 'topics_user_id_id_pk'
  ) THEN
    ALTER TABLE topics ADD CONSTRAINT topics_user_id_id_pk PRIMARY KEY (user_id, id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'topics'::regclass AND conname = 'topics_user_level_title_key_unique'
  ) THEN
    ALTER TABLE topics ADD CONSTRAINT topics_user_level_title_key_unique UNIQUE (user_id, level, title_key);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'topics'::regclass AND conname = 'topics_level_check'
  ) THEN
    ALTER TABLE topics ADD CONSTRAINT topics_level_check CHECK (level IN (1, 2));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'topics'::regclass AND conname = 'topics_user_id_users_id_fk'
  ) THEN
    ALTER TABLE topics ADD CONSTRAINT topics_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'topic_edges'::regclass AND conname = 'topic_edges_user_id_parent_id_child_id_pk'
  ) THEN
    ALTER TABLE topic_edges ADD CONSTRAINT topic_edges_user_id_parent_id_child_id_pk PRIMARY KEY (user_id, parent_id, child_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'topic_edges'::regclass AND conname = 'topic_edges_distinct_check'
  ) THEN
    ALTER TABLE topic_edges ADD CONSTRAINT topic_edges_distinct_check CHECK (parent_id <> child_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'topic_edges'::regclass AND conname = 'topic_edges_user_id_users_id_fk'
  ) THEN
    ALTER TABLE topic_edges ADD CONSTRAINT topic_edges_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'topic_edges'::regclass AND conname = 'topic_edges_user_id_parent_id_topics_user_id_id_fk'
  ) THEN
    ALTER TABLE topic_edges ADD CONSTRAINT topic_edges_user_id_parent_id_topics_user_id_id_fk
      FOREIGN KEY (user_id, parent_id) REFERENCES public.topics (user_id, id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'topic_edges'::regclass AND conname = 'topic_edges_user_id_child_id_topics_user_id_id_fk'
  ) THEN
    ALTER TABLE topic_edges ADD CONSTRAINT topic_edges_user_id_child_id_topics_user_id_id_fk
      FOREIGN KEY (user_id, child_id) REFERENCES public.topics (user_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'topic_title_sources'::regclass AND conname = 'topic_title_sources_user_id_topic_id_memory_id_pk'
  ) THEN
    ALTER TABLE topic_title_sources ADD CONSTRAINT topic_title_sources_user_id_topic_id_memory_id_pk
      PRIMARY KEY (user_id, topic_id, memory_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'topic_title_sources'::regclass AND conname = 'topic_title_sources_memory_revision_check'
  ) THEN
    ALTER TABLE topic_title_sources ADD CONSTRAINT topic_title_sources_memory_revision_check CHECK (memory_revision >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'topic_title_sources'::regclass AND conname = 'topic_title_sources_user_id_users_id_fk'
  ) THEN
    ALTER TABLE topic_title_sources ADD CONSTRAINT topic_title_sources_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'topic_title_sources'::regclass AND conname = 'topic_title_sources_user_id_topic_id_topics_user_id_id_fk'
  ) THEN
    ALTER TABLE topic_title_sources ADD CONSTRAINT topic_title_sources_user_id_topic_id_topics_user_id_id_fk
      FOREIGN KEY (user_id, topic_id) REFERENCES public.topics (user_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'memory_topics'::regclass AND conname = 'memory_topics_user_id_memory_id_topic_id_pk'
  ) THEN
    ALTER TABLE memory_topics ADD CONSTRAINT memory_topics_user_id_memory_id_topic_id_pk PRIMARY KEY (user_id, memory_id, topic_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'memory_topics'::regclass AND conname = 'memory_topics_memory_revision_check'
  ) THEN
    ALTER TABLE memory_topics ADD CONSTRAINT memory_topics_memory_revision_check CHECK (memory_revision >= 1);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'memory_topics'::regclass AND conname = 'memory_topics_user_id_users_id_fk'
  ) THEN
    ALTER TABLE memory_topics ADD CONSTRAINT memory_topics_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'memory_topics'::regclass AND conname = 'memory_topics_user_id_topic_id_topics_user_id_id_fk'
  ) THEN
    ALTER TABLE memory_topics ADD CONSTRAINT memory_topics_user_id_topic_id_topics_user_id_id_fk
      FOREIGN KEY (user_id, topic_id) REFERENCES public.topics (user_id, id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'memory_placements'::regclass AND conname = 'memory_placements_user_id_memory_id_pk'
  ) THEN
    ALTER TABLE memory_placements ADD CONSTRAINT memory_placements_user_id_memory_id_pk PRIMARY KEY (user_id, memory_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'memory_placements'::regclass AND conname = 'memory_placements_memory_revision_check'
  ) THEN
    ALTER TABLE memory_placements ADD CONSTRAINT memory_placements_memory_revision_check CHECK (memory_revision >= 1);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'memory_placements'::regclass AND conname = 'memory_placements_status_check'
  ) THEN
    ALTER TABLE memory_placements ADD CONSTRAINT memory_placements_status_check CHECK (status IN ('filed', 'unfiled', 'failed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'memory_placements'::regclass AND conname = 'memory_placements_attempts_check'
  ) THEN
    ALTER TABLE memory_placements ADD CONSTRAINT memory_placements_attempts_check CHECK (attempts BETWEEN 0 AND 3);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'memory_placements'::regclass AND conname = 'memory_placements_user_id_users_id_fk'
  ) THEN
    ALTER TABLE memory_placements ADD CONSTRAINT memory_placements_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'topic_index_state'::regclass AND conname = 'topic_index_state_pkey'
  ) THEN
    ALTER TABLE topic_index_state ADD CONSTRAINT topic_index_state_pkey PRIMARY KEY (user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'topic_index_state'::regclass AND conname = 'topic_index_state_user_id_users_id_fk'
  ) THEN
    ALTER TABLE topic_index_state ADD CONSTRAINT topic_index_state_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS memory_placements_memory_idx ON memory_placements (memory_id);
CREATE INDEX IF NOT EXISTS memory_placements_retry_idx
  ON memory_placements (user_id, placed_at) WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS memory_topics_memory_idx ON memory_topics (memory_id);
CREATE INDEX IF NOT EXISTS memory_topics_newest_idx
  ON memory_topics (user_id, topic_id, placed_at DESC NULLS LAST, memory_id DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS topic_edges_child_idx ON topic_edges (user_id, child_id, parent_id);
