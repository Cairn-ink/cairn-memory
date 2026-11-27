SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['scope_id', 'embedding', 'embedding_model', 'embedding_text_version',
      'embedding_content_hash']) AS wanted(name)
    WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.document_cards'::regclass AND attname = wanted.name AND NOT attisdropped)
  ) THEN
    ALTER TABLE public.document_cards
      ADD COLUMN IF NOT EXISTS scope_id text,
      ADD COLUMN IF NOT EXISTS embedding vector(1536),
      ADD COLUMN IF NOT EXISTS embedding_model text,
      ADD COLUMN IF NOT EXISTS embedding_text_version smallint,
      ADD COLUMN IF NOT EXISTS embedding_content_hash text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.document_cards'::regclass
      AND conname = 'document_cards_scope_id_id_unique') THEN
    ALTER TABLE public.document_cards ADD CONSTRAINT document_cards_scope_id_id_unique UNIQUE (scope_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.document_cards'::regclass
      AND conname = 'document_cards_embedding_check') THEN
    ALTER TABLE public.document_cards ADD CONSTRAINT document_cards_embedding_check
      CHECK (num_nonnulls(embedding, embedding_model, embedding_text_version, embedding_content_hash) IN (0, 4));
  END IF;

  IF pg_catalog.to_regprocedure('public.document_card_search_text(text,text)') IS NULL THEN
    CREATE FUNCTION public.document_card_search_text(title text, body text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $search$
      SELECT CASE WHEN title IS NULL OR title = '' THEN body ELSE title || E'\n\n' || body END;
    $search$;
  END IF;

  IF pg_catalog.to_regclass('public.document_cards_search_text_idx') IS NULL THEN
    CREATE INDEX document_cards_search_text_idx ON public.document_cards
      USING pgroonga (public.document_card_search_text(title, body)) WHERE hidden_reason IS NULL AND NOT tombstoned;
  END IF;
  IF pg_catalog.to_regclass('public.document_cards_live_source_idx') IS NULL THEN
    CREATE INDEX document_cards_live_source_idx ON public.document_cards
      USING btree (user_id, source_client, source_session_id, source_message_id)
      WHERE hidden_reason IS NULL AND NOT tombstoned;
  END IF;

  IF pg_catalog.to_regclass('public.core_document_card_amendments') IS NULL THEN
    CREATE TABLE public.core_document_card_amendments (
      user_id text NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
      card_id text NOT NULL,
      amendment_id text NOT NULL,
      insertion_sequence bigint GENERATED ALWAYS AS IDENTITY,
      date date NOT NULL,
      sentence text NOT NULL,
      quote text NOT NULL,
      source_client text NOT NULL,
      source_session_id text NOT NULL,
      source_message_id text NOT NULL,
      hidden_reason text,
      purged boolean NOT NULL DEFAULT false,
      PRIMARY KEY (user_id, card_id, amendment_id)
    );
  END IF;
END;
$$;
