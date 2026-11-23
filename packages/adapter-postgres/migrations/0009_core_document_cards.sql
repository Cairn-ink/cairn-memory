SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS document_cards (
  user_id text NOT NULL,
  id text NOT NULL,
  content_hash text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  date_ms bigint,
  origin text NOT NULL DEFAULT 'router',
  source_client text,
  source_session_id text,
  source_message_id text,
  source_memories jsonb NOT NULL,
  sentences jsonb NOT NULL,
  stale jsonb NOT NULL,
  hidden_reason text,
  tombstoned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'document_cards'::regclass AND conname = 'document_cards_user_id_id_pk'
  ) THEN
    ALTER TABLE document_cards ADD CONSTRAINT document_cards_user_id_id_pk PRIMARY KEY (user_id, id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'document_cards'::regclass AND conname = 'document_cards_origin_check'
  ) THEN
    ALTER TABLE document_cards ADD CONSTRAINT document_cards_origin_check CHECK (origin IN ('router', 'import', 'manual'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'document_cards'::regclass AND conname = 'document_cards_router_source_check'
  ) THEN
    ALTER TABLE document_cards ADD CONSTRAINT document_cards_router_source_check CHECK (
      origin <> 'router' OR (source_client IS NOT NULL AND source_session_id IS NOT NULL AND source_message_id IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'document_cards'::regclass AND conname = 'document_cards_user_id_users_id_fk'
  ) THEN
    ALTER TABLE document_cards ADD CONSTRAINT document_cards_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS document_cards_user_created_idx
  ON document_cards (user_id, created_at DESC NULLS LAST, id);
CREATE INDEX IF NOT EXISTS document_cards_source_memories_idx
  ON document_cards USING gin (source_memories jsonb_path_ops) WHERE hidden_reason IS NULL AND NOT tombstoned;
