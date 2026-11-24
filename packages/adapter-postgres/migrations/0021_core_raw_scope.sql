ALTER TABLE raw_messages
  ADD COLUMN IF NOT EXISTS core_namespace text,
  ADD COLUMN IF NOT EXISTS core_occurred_at_ms bigint;

ALTER TABLE capture_raw_fences ADD COLUMN IF NOT EXISTS core_namespaces text[];
ALTER TABLE capture_raw_lineage ADD COLUMN IF NOT EXISTS core_namespaces text[];
