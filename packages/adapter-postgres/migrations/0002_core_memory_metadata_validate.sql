SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE memories VALIDATE CONSTRAINT memories_core_metadata_check;
