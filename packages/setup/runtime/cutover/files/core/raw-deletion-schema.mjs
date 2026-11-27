export const RAW_DELETION_SCHEMA_VERSION = 27;

/** Only content-free deletion receipts, source ownership and host effects. */
export function installRawDeletion(db) {
  db.exec(`
    CREATE TABLE raw_deletion_actions (
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      action_id TEXT NOT NULL, payload_binding TEXT NOT NULL, result TEXT NOT NULL,
      PRIMARY KEY(owner_id,scope,project_id,action_id)
    ) STRICT;
    CREATE TABLE raw_job_sources (
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      client TEXT NOT NULL, event_id TEXT NOT NULL, source_client TEXT NOT NULL,
      session_key TEXT NOT NULL, message_id TEXT NOT NULL,
      PRIMARY KEY(owner_id,scope,project_id,client,event_id,source_client,session_key,message_id)
    ) STRICT;
    CREATE INDEX raw_job_session ON raw_job_sources(owner_id,scope,project_id,source_client,session_key);
    CREATE TABLE raw_closed_jobs (
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      client TEXT NOT NULL, event_id TEXT NOT NULL,
      PRIMARY KEY(owner_id,scope,project_id,client,event_id)
    ) STRICT;
    CREATE TABLE raw_deletion_effects (
      ordinal INTEGER PRIMARY KEY AUTOINCREMENT, effect_id TEXT NOT NULL UNIQUE,
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK(source_type IN ('conversation','episode')), source_id TEXT NOT NULL,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('conversation','episode','memory')), entity_id TEXT NOT NULL,
      action_id TEXT NOT NULL
    ) STRICT;
    CREATE INDEX raw_effect_scope ON raw_deletion_effects(owner_id,scope,project_id,ordinal);
    CREATE INDEX raw_lineage_conversation ON raw_receipt_lineage(conversation_id,receipt_id);
  `);
}
