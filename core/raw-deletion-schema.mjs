import { rawBoundary } from './raw-input.mjs';
import { fail } from './validation.mjs';

export const RAW_DELETION_SCHEMA_VERSION = 27;

// This optional outbox can be added to an existing Raw store in the same
// transaction as its first queued denial. It contains selectors only.
export const RAW_SEARCH_DENIAL_QUEUE_DDL = `CREATE TABLE IF NOT EXISTS raw_search_denial_queue (
  owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal>0), conversation_id TEXT NOT NULL,
  message_id TEXT, start INTEGER, end INTEGER,
  CHECK((message_id IS NULL AND start IS NULL AND end IS NULL) OR
    (message_id IS NOT NULL AND start IS NOT NULL AND end IS NOT NULL AND start>=0 AND end>start)),
  PRIMARY KEY(owner_id,scope,project_id,ordinal)
) STRICT, WITHOUT ROWID;`;

export function queueRawSearchDenialInside(db, ns, conversationId, messageId = null, start = null, end = null) {
  if (!db.isTransaction) fail('raw_transaction_required');
  db.exec(RAW_SEARCH_DENIAL_QUEUE_DDL);
  const boundary = [ns.ownerId, ns.scope, ns.projectId ?? ''];
  db.prepare(`INSERT INTO raw_search_denial_queue
    VALUES(?,?,?,coalesce((SELECT ordinal FROM raw_search_denial_queue
      WHERE owner_id=? AND scope=? AND project_id=? ORDER BY ordinal DESC LIMIT 1),0)+1,?,?,?,?)`)
    .run(...boundary, ...boundary, conversationId, messageId, start, end);
}

export function recordRawSessionFenceInside(db, ns, client, session) {
  if (!db.isTransaction) fail('raw_transaction_required');
  const args = [...rawBoundary(ns), client, session];
  if (!db.prepare('INSERT OR IGNORE INTO raw_session_fences VALUES(?,?,?,?,?)').run(...args).changes) return false;
  // The canonical session tuple is unique. If it never had a conversation,
  // there is no published segment key to seek.
  const conversation = db.prepare(`SELECT id FROM raw_conversations
    WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?`).get(...args);
  if (conversation) queueRawSearchDenialInside(db, ns, conversation.id);
  return Boolean(conversation);
}

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
