SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- This migration locks document_cards, then users, in the order card writers use.
-- Keep public.delete_personal_document_cards() and the document_cards_delete_personal trigger stable.
-- Rows in card_topics and card_placements are removed by their existing users foreign keys (ON DELETE CASCADE).

DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.delete_personal_document_cards()') IS NULL THEN
    CREATE FUNCTION public.delete_personal_document_cards() RETURNS trigger LANGUAGE plpgsql AS $personal$
    BEGIN
      DELETE FROM public.document_cards WHERE user_id = OLD.id AND scope_id = OLD.id;
      RETURN OLD;
    END;
    $personal$;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.document_cards'::regclass AND conname = 'document_cards_user_id_id_pk' AND contype = 'p'
  ) THEN
    ALTER TABLE public.document_cards DROP CONSTRAINT document_cards_user_id_id_pk;
    -- Keep the name: 0009 adds it only when missing, and existing upserts infer ON CONFLICT (user_id, id).
    ALTER TABLE public.document_cards ADD CONSTRAINT document_cards_user_id_id_pk UNIQUE (user_id, id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.document_cards'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public.document_cards ADD CONSTRAINT document_cards_scope_id_id_pk PRIMARY KEY (scope_id, id);
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.document_cards'::regclass AND attname = 'user_id' AND attnotnull AND NOT attisdropped
  ) THEN
    ALTER TABLE public.document_cards ALTER COLUMN user_id DROP NOT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.document_cards'::regclass AND conname = 'document_cards_team_author_check'
  ) THEN
    ALTER TABLE public.document_cards ADD CONSTRAINT document_cards_team_author_check
      CHECK (user_id IS NOT NULL OR scope_id LIKE 'team:%');
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.document_cards'::regclass AND conname = 'document_cards_user_id_users_id_fk' AND confdeltype <> 'n'
  ) THEN
    ALTER TABLE public.document_cards DROP CONSTRAINT document_cards_user_id_users_id_fk;
    ALTER TABLE public.document_cards ADD CONSTRAINT document_cards_user_id_users_id_fk
      FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.users'::regclass AND tgname = 'document_cards_delete_personal' AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER document_cards_delete_personal BEFORE DELETE ON public.users
      FOR EACH ROW EXECUTE FUNCTION public.delete_personal_document_cards();
  END IF;
END;
$$;
