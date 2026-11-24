SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'core_fact_digests'::regclass
    AND attname = 'lookup_key' AND NOT attisdropped) THEN
    RETURN;
  END IF;

  -- Keep the lookup key bounded even when a signer uses long Unicode identifiers.
  CREATE FUNCTION core_fact_digest_lookup_key(text, text, text, integer, text, text)
  RETURNS bytea LANGUAGE sql IMMUTABLE SET search_path = pg_catalog
  AS $key$
    SELECT sha256(convert_to(jsonb_build_array($1, $2, $3, $4, $5, $6)::text, 'UTF8'))
  $key$;

  ALTER TABLE core_fact_digests ADD COLUMN label text;
  UPDATE core_fact_digests SET label = pipeline;

  ALTER TABLE core_fact_digests
    ALTER COLUMN label SET NOT NULL,
    DROP CONSTRAINT core_fact_digests_pkey,
    DROP CONSTRAINT core_fact_digests_alg_check,
    DROP CONSTRAINT core_fact_digests_key_check,
    ADD CONSTRAINT core_fact_digests_alg_check CHECK (length(alg) BETWEEN 1 AND 512),
    ADD CONSTRAINT core_fact_digests_label_check CHECK (length(label) BETWEEN 1 AND 512),
    ADD CONSTRAINT core_fact_digests_key_check CHECK (
      (key_id IS NULL AND alg = 'sha256' AND label = pipeline) OR (key_id IS NOT NULL AND length(key_id) BETWEEN 1 AND 64)),
    ADD COLUMN lookup_key bytea GENERATED ALWAYS AS (
      core_fact_digest_lookup_key(alg, value, pipeline, redaction_version, key_id, label)) STORED,
    ADD PRIMARY KEY (user_id, fact_id, lookup_key);
END
$migration$;
