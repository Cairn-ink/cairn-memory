/** Internal, opt-in journal only. No capture or public capability is installed. */
export const RAW_SCHEMA_VERSION = 24;

export function installRawJournal(db) {
  db.exec(`
    CREATE TABLE raw_conversations (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, scope TEXT NOT NULL,
      project_id TEXT NOT NULL, client TEXT NOT NULL CHECK(client IN ('claude-code','codex')),
      session_key TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
      first_received_at TEXT NOT NULL, last_received_at TEXT NOT NULL,
      CHECK((scope='personal' AND project_id='') OR (scope='project' AND length(project_id)>0)),
      UNIQUE(owner_id,scope,project_id,client,session_key)
    ) STRICT;
    CREATE TABLE raw_messages (
      conversation_id TEXT NOT NULL REFERENCES raw_conversations(id), message_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK(ordinal>0), role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      occurred_at TEXT, total_units INTEGER NOT NULL CHECK(total_units>0), total_bytes INTEGER NOT NULL CHECK(total_bytes>0),
      next_index INTEGER NOT NULL DEFAULT 0 CHECK(next_index>=0), next_start INTEGER NOT NULL DEFAULT 0 CHECK(next_start>=0),
      received_bytes INTEGER NOT NULL DEFAULT 0 CHECK(received_bytes>=0),
      assembly_state TEXT NOT NULL CHECK(assembly_state IN ('pending','complete','closed')),
      reason TEXT CHECK(reason IN ('tool_off','notice_required','quota_reached','raw_disabled','capture_barrier')),
      reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK(reserved_bytes>=0), first_event_id TEXT NOT NULL,
      PRIMARY KEY(conversation_id,message_id), UNIQUE(conversation_id,ordinal)
    ) STRICT;
    CREATE TABLE raw_parts (
      conversation_id TEXT NOT NULL, message_id TEXT NOT NULL, part_index INTEGER NOT NULL CHECK(part_index>=0),
      start INTEGER NOT NULL CHECK(start>=0), end INTEGER NOT NULL CHECK(end>start),
      byte_count INTEGER NOT NULL CHECK(byte_count>0), digest TEXT NOT NULL,
      event_id TEXT NOT NULL, saved INTEGER NOT NULL CHECK(saved IN (0,1)),
      reason TEXT CHECK(reason IN ('tool_off','notice_required','quota_reached','raw_disabled','capture_barrier')),
      format TEXT CHECK(format IN ('local-plain-v1','envelope-aes-256-gcm-v1')), key_version TEXT, sealed BLOB,
      PRIMARY KEY(conversation_id,message_id,part_index),
      FOREIGN KEY(conversation_id,message_id) REFERENCES raw_messages(conversation_id,message_id),
      CHECK((saved=1 AND reason IS NULL AND format IS NOT NULL AND sealed IS NOT NULL)
        OR (saved=0 AND reason IS NOT NULL AND format IS NULL AND key_version IS NULL AND sealed IS NULL))
    ) STRICT;
    CREATE TABLE raw_events (
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      client TEXT NOT NULL, event_id TEXT NOT NULL, digest TEXT NOT NULL,
      conversation_id TEXT NOT NULL REFERENCES raw_conversations(id), policy TEXT NOT NULL, result TEXT NOT NULL,
      PRIMARY KEY(owner_id,scope,project_id,client,event_id)
    ) STRICT;
    CREATE TABLE raw_owner_usage (
      owner_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
      cap_bytes INTEGER NOT NULL CHECK(cap_bytes>0), saved_bytes INTEGER NOT NULL DEFAULT 0 CHECK(saved_bytes>=0),
      reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK(reserved_bytes>=0)
    ) STRICT;
    CREATE TABLE raw_capture_controls (
      owner_id TEXT NOT NULL, client TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
      revision INTEGER NOT NULL CHECK(revision>0), PRIMARY KEY(owner_id,client)
    ) STRICT;
  `);
}
