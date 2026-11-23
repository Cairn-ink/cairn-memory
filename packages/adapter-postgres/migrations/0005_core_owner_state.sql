SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS core_owner_state (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  fact_epoch bigint NOT NULL DEFAULT 0 CHECK (fact_epoch >= 0),
  index_revision bigint NOT NULL DEFAULT 0 CHECK (index_revision >= 0),
  legacy_facts_ready boolean NOT NULL DEFAULT false
);
