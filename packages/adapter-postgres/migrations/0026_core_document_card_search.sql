SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.document_cards'::regclass AND attname = 'scope_id' AND NOT attisdropped) THEN
    ALTER TABLE public.document_cards ADD COLUMN scope_id text;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.document_cards'::regclass AND attname = 'scope_id' AND NOT attnotnull AND NOT attisdropped) THEN
    UPDATE public.document_cards SET scope_id = user_id WHERE scope_id IS NULL;
    ALTER TABLE public.document_cards ALTER COLUMN scope_id SET NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['embedding', 'embedding_model', 'embedding_text_version',
      'embedding_content_hash']) AS wanted(name)
    WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.document_cards'::regclass AND attname = wanted.name AND NOT attisdropped)
  ) THEN
    ALTER TABLE public.document_cards
      ADD COLUMN IF NOT EXISTS embedding vector(1536),
      ADD COLUMN IF NOT EXISTS embedding_model text,
      ADD COLUMN IF NOT EXISTS embedding_text_version smallint,
      ADD COLUMN IF NOT EXISTS embedding_content_hash text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.document_cards'::regclass AND (
        conname = 'document_cards_scope_id_id_unique' OR (contype = 'p' AND conkey = ARRAY[
          (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = conrelid AND attname = 'scope_id'),
          (SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid = conrelid AND attname = 'id')
        ])
      )) THEN
    ALTER TABLE public.document_cards ADD CONSTRAINT document_cards_scope_id_id_unique UNIQUE (scope_id, id);
  END IF;
  IF pg_catalog.to_regprocedure('public.default_document_card_scope()') IS NULL THEN
    CREATE FUNCTION public.default_document_card_scope() RETURNS trigger LANGUAGE plpgsql AS $scope$
    BEGIN
      IF NEW.scope_id IS NULL THEN
        NEW.scope_id := NEW.user_id;
      END IF;
      RETURN NEW;
    END;
    $scope$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.document_cards'::regclass
      AND tgname = 'document_cards_default_scope') THEN
    CREATE TRIGGER document_cards_default_scope BEFORE INSERT ON public.document_cards
      FOR EACH ROW EXECUTE FUNCTION public.default_document_card_scope();
  END IF;
  IF pg_catalog.to_regclass('public.document_cards_scope_created_idx') IS NULL THEN
    CREATE INDEX document_cards_scope_created_idx ON public.document_cards (scope_id, created_at DESC NULLS LAST, id);
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
