import { randomBytes } from 'node:crypto';
import { fail } from './validation.mjs';

export const EPISODE_SCHEMA_VERSION = 17;
export const ADMISSION_LEASE_MS = 125_000;
export const STAGED_PAYLOAD_MAX_BYTES = 128 * 1024;
export const HEX_DIGEST = /^[0-9a-f]{64}$/;
const digestCheck = column => `length(${column})=64 AND ${column} NOT GLOB '*[^0-9a-f]*'`;
const namespaceCheck = `CHECK(scope IN ('personal','project')), CHECK((scope='personal' AND project_id='') OR
  (scope='project' AND length(project_id)>0))`;

/** Read-only access paths; no table/column or stored-record changes. */
export function migrateVersion16(db) {
  if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) fail('storage_error');
  db.exec(`
    CREATE INDEX episode_event_read ON session_episodes(owner_id,scope,project_id,
      json_extract(record,'$.eventEnd') DESC,id) WHERE deleted=0;
    CREATE INDEX episode_receipt_read ON session_episodes(owner_id,scope,project_id,
      first_received_at DESC,id) WHERE deleted=0;
    CREATE INDEX episode_open_step_read ON session_episodes(owner_id,scope,project_id,
      json_extract(record,'$.nextStep.receiptOrdinal') DESC,id)
      WHERE deleted=0 AND json_extract(record,'$.processing.state')='ready'
        AND json_extract(record,'$.nextStep.status')='open';
    CREATE INDEX receipt_time_read ON receipts(created_at DESC,id,memory_id);
  `);
  if (db.prepare('PRAGMA foreign_key_check').all().length) fail('storage_error');
}

/** Caller holds transaction(). Snapshot/drop children first: CASCADE must not erase the journal. */
export function migrateVersion14(db) {
  if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) fail('storage_error');
  const children = ['staged_capture_evidence', 'capture_initial_classification'];
  const journalDDL = db.prepare("SELECT sql FROM sqlite_master WHERE name='capture_initial_classification'").get().sql;
  for (const name of children) {
    db.exec(`CREATE TEMP TABLE episode_upgrade_${name} AS SELECT * FROM ${name}; DROP TABLE ${name};`);
  }
  db.exec('CREATE TEMP TABLE episode_upgrade_admission_claims AS SELECT * FROM admission_claims; DROP TABLE admission_claims;');
  // Full DDL: migration does not depend on sqlite_master whitespace or enum spelling.
  db.exec(`CREATE TABLE admission_claims (
    owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
    client TEXT NOT NULL, event_id TEXT NOT NULL,
    payload_digest TEXT NOT NULL CHECK(${digestCheck('payload_digest')}),
    state TEXT NOT NULL CHECK(state IN ('reserved','pending','completed')),
    token TEXT, lease_expires_at INTEGER, memory_ids TEXT, suppressed_count INTEGER,
    PRIMARY KEY(owner_id,scope,project_id,client,event_id), ${namespaceCheck},
    CHECK((state='reserved' AND token IS NULL AND lease_expires_at IS NULL AND memory_ids IS NULL AND suppressed_count IS NULL) OR
      (state='pending' AND token IS NOT NULL AND lease_expires_at IS NOT NULL AND memory_ids IS NULL AND suppressed_count IS NULL) OR
      (state='completed' AND token IS NULL AND lease_expires_at IS NULL AND memory_ids IS NOT NULL AND length(memory_ids)<=2016
        AND suppressed_count IS NOT NULL AND suppressed_count BETWEEN 0 AND 5))) STRICT;
    INSERT INTO admission_claims SELECT * FROM episode_upgrade_admission_claims;
    DROP TABLE episode_upgrade_admission_claims;
    CREATE TABLE staged_capture_evidence (
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL, client TEXT NOT NULL, event_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','failed','admitted','discarded','expired','forgotten','released')),
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, payload TEXT,
      payload_bytes INTEGER NOT NULL CHECK(payload_bytes BETWEEN 0 AND ${STAGED_PAYLOAD_MAX_BYTES}),
      event_mode TEXT NOT NULL DEFAULT 'staged-v1' CHECK(event_mode IN ('staged-v1','episode-v1')),
      release_reason TEXT CHECK(release_reason IN ('interpreted','capacity')),
      disposition INTEGER NOT NULL DEFAULT 0 CHECK(disposition IN (0,1)),
      PRIMARY KEY(owner_id,scope,project_id,client,event_id), ${namespaceCheck},
      FOREIGN KEY(owner_id,scope,project_id,client,event_id) REFERENCES admission_claims(owner_id,scope,project_id,client,event_id),
      CHECK((payload IS NULL AND payload_bytes=0) OR (payload IS NOT NULL AND payload_bytes>0)),
      CHECK((state='released' AND event_mode='episode-v1' AND payload IS NULL AND payload_bytes=0 AND release_reason IS NOT NULL)
        OR (state!='released' AND release_reason IS NULL))) STRICT;`);
  db.exec(`
    INSERT INTO staged_capture_evidence(owner_id,scope,project_id,client,event_id,state,created_at,expires_at,payload,payload_bytes)
      SELECT * FROM episode_upgrade_staged_capture_evidence;
    DROP TABLE episode_upgrade_staged_capture_evidence;`);
  db.exec(journalDDL);
  db.exec('INSERT INTO capture_initial_classification SELECT * FROM episode_upgrade_capture_initial_classification; DROP TABLE episode_upgrade_capture_initial_classification;');
  db.exec(`
    CREATE TABLE episode_identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1), secret TEXT NOT NULL CHECK(${digestCheck('secret')})) STRICT;
    CREATE TABLE episode_controls(owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      generation TEXT NOT NULL, paused INTEGER NOT NULL CHECK(paused IN (0,1)),
      enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), ordinal INTEGER NOT NULL DEFAULT 0,
      ${namespaceCheck}, PRIMARY KEY(owner_id,scope,project_id)) STRICT;
    CREATE TABLE session_episodes(
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      client TEXT NOT NULL, session_key TEXT NOT NULL CHECK(length(session_key)=67 AND substr(session_key,1,3)='s1:' AND ${digestCheck('substr(session_key,4)')}), revision INTEGER NOT NULL CHECK(revision>0),
      source_fence INTEGER NOT NULL DEFAULT 1, generation TEXT NOT NULL, draft_every INTEGER NOT NULL CHECK(draft_every BETWEEN 2 AND 16),
      deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
      observed INTEGER NOT NULL DEFAULT 0, attempted INTEGER NOT NULL DEFAULT 0, covered INTEGER NOT NULL DEFAULT 0,
      first_received_at TEXT NOT NULL, last_received_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      record TEXT NOT NULL CHECK(length(record)<=32768 AND json_valid(record))
        CHECK(coalesce(json_extract(record,'$.processing.state') IN ('pending','ready','incomplete','failed','invalidated'),0)), writer_token TEXT, writer_expires_at INTEGER,
      ${namespaceCheck}, UNIQUE(owner_id,scope,project_id,client,session_key)) STRICT;
    CREATE INDEX episode_pending ON session_episodes(owner_id,scope,project_id,client,deleted,last_received_at,id);
    CREATE TABLE episode_events(
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL, client TEXT NOT NULL,event_id TEXT NOT NULL,
      episode_id TEXT NOT NULL REFERENCES session_episodes(id), payload_digest TEXT NOT NULL CHECK(${digestCheck('payload_digest')}),
      position INTEGER NOT NULL, ordinal INTEGER NOT NULL, generation TEXT NOT NULL,
      staging TEXT NOT NULL CHECK(staging IN ('staged','not-staged')), gap TEXT,
      gap_reasons TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(gap_reasons) AND json_type(gap_reasons)='array' AND length(gap_reasons)<=1024),
      admission TEXT NOT NULL DEFAULT 'reserved' CHECK(admission IN ('reserved','pending','completed')),
      disposition INTEGER NOT NULL DEFAULT 0 CHECK(disposition IN (0,1)), policy TEXT NOT NULL DEFAULT 'normal' CHECK(policy IN ('normal','skip-quick','explicit-keep')),
      policy_revision INTEGER, policy_type TEXT, policy_at TEXT, created_at TEXT NOT NULL,
      ${namespaceCheck}, PRIMARY KEY(owner_id,scope,project_id,client,event_id), UNIQUE(episode_id,position),
      FOREIGN KEY(owner_id,scope,project_id,client,event_id) REFERENCES admission_claims(owner_id,scope,project_id,client,event_id)) STRICT;
    CREATE INDEX episode_policy_page ON episode_events(episode_id,position);
    CREATE TABLE episode_sources(id TEXT PRIMARY KEY, episode_id TEXT NOT NULL REFERENCES session_episodes(id),
      origin_episode_id TEXT NOT NULL REFERENCES session_episodes(id), event_id TEXT NOT NULL, message_id TEXT NOT NULL,
      digest TEXT NOT NULL CHECK(${digestCheck('digest')}), role TEXT NOT NULL CHECK(role IN ('user','assistant')), text TEXT NOT NULL CHECK(length(text)<=800),
      truncated INTEGER NOT NULL CHECK(truncated IN (0,1)), ordinal INTEGER NOT NULL) STRICT;
    CREATE INDEX episode_source_page ON episode_sources(episode_id,id);
    CREATE INDEX episode_source_consumers ON episode_sources(origin_episode_id,episode_id);
    CREATE TABLE episode_memory_links(id TEXT PRIMARY KEY, episode_id TEXT NOT NULL REFERENCES session_episodes(id),
      memory_id TEXT NOT NULL REFERENCES memories(id), event_id TEXT NOT NULL, admission_revision INTEGER NOT NULL, receipt_ids TEXT NOT NULL,
      UNIQUE(episode_id,event_id,memory_id)) STRICT;
    CREATE INDEX episode_lineage_page ON episode_memory_links(episode_id,id);
    CREATE INDEX episode_memory_consumers ON episode_memory_links(memory_id,episode_id);
    CREATE TABLE episode_attempts(episode_id TEXT NOT NULL REFERENCES session_episodes(id),
      marker TEXT NOT NULL, watermark INTEGER NOT NULL, token TEXT NOT NULL, expires_at INTEGER NOT NULL,
      revision INTEGER NOT NULL, source_fence INTEGER NOT NULL, generation TEXT NOT NULL,
      finished INTEGER NOT NULL DEFAULT 0 CHECK(finished IN (0,1)), PRIMARY KEY(episode_id,marker)) STRICT;
    CREATE TABLE procedural_tags(memory_id TEXT PRIMARY KEY REFERENCES memories(id), tag_revision INTEGER NOT NULL CHECK(tag_revision>0),
      positive INTEGER NOT NULL CHECK(positive IN (0,1)), origin TEXT CHECK(origin IN ('model','explicit')), anchors TEXT) STRICT;
  `);
  db.prepare('INSERT INTO episode_identity VALUES(1,?)').run(randomBytes(32).toString('hex'));
  if (db.prepare('PRAGMA foreign_key_check').all().length) fail('storage_error');
}

/** v15 has no historical message ledger: only post-upgrade registrations enter it. */
export function migrateVersion15(db) {
  if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) fail('storage_error');
  db.exec(`ALTER TABLE episode_attempts ADD COLUMN started INTEGER NOT NULL DEFAULT 1 CHECK(started IN (0,1));
    ALTER TABLE episode_attempts ADD COLUMN outcome_code TEXT
      CHECK(outcome_code IN ('episode_failed','episode_timeout','invalid_model_output',
        'context_budget_exceeded','capacity','expired','generation_conflict','missing_evidence'))
      CHECK(outcome_code IS NULL OR finished=1);
    CREATE TABLE episode_messages (
    episode_id TEXT NOT NULL REFERENCES session_episodes(id),
    message_id TEXT NOT NULL CHECK(length(message_id) BETWEEN 1 AND 200),
    digest TEXT NOT NULL CHECK(${digestCheck('digest')}),
    first_event_id TEXT NOT NULL,
    coverage_event_id TEXT NOT NULL,
    PRIMARY KEY(episode_id,message_id)
  ) STRICT;`);
  db.exec(`
    ALTER TABLE episode_events ADD COLUMN message_ids TEXT NOT NULL DEFAULT '[]'
      CHECK(json_valid(message_ids) AND json_type(message_ids)='array' AND json_array_length(message_ids)<=24 AND length(message_ids)<=32768);
    ALTER TABLE episode_events ADD COLUMN omitted_count INTEGER NOT NULL DEFAULT 0 CHECK(omitted_count BETWEEN 0 AND 24);
    ALTER TABLE episode_events ADD COLUMN omitted_indices TEXT NOT NULL DEFAULT '[]'
      CHECK(json_valid(omitted_indices) AND json_type(omitted_indices)='array' AND length(omitted_indices)<=100);
    CREATE TABLE episode_keep_actions (
      admission_key TEXT PRIMARY KEY CHECK(${digestCheck('admission_key')}),
      action_id TEXT NOT NULL CHECK(length(action_id) BETWEEN 1 AND 200),
      episode_id TEXT NOT NULL REFERENCES session_episodes(id),
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      client TEXT NOT NULL, event_id TEXT NOT NULL,
      payload_digest TEXT NOT NULL CHECK(${digestCheck('payload_digest')}),
      state TEXT NOT NULL CHECK(state IN ('reserved','pending','completed')),
      token TEXT, lease_expires_at INTEGER, memory_ids TEXT, suppressed_count INTEGER,
      keep_state TEXT NOT NULL CHECK(keep_state IN ('pending','completed','failed','retryable')),
      keep_error_code TEXT CHECK(keep_error_code IS NULL OR length(keep_error_code) BETWEEN 1 AND 64),
      keep_source_ids TEXT NOT NULL CHECK(json_valid(keep_source_ids) AND json_type(keep_source_ids)='array'
        AND json_array_length(keep_source_ids) BETWEEN 1 AND 16),
      revision INTEGER NOT NULL CHECK(revision>0), source_fence INTEGER NOT NULL CHECK(source_fence>0),
      keep_ordinal INTEGER NOT NULL CHECK(keep_ordinal>0), keep_created_at TEXT NOT NULL CHECK(length(keep_created_at)=24),
      UNIQUE(episode_id,action_id), UNIQUE(episode_id,keep_ordinal), ${namespaceCheck},
      CHECK((state='reserved' AND token IS NULL AND lease_expires_at IS NULL AND memory_ids IS NULL AND suppressed_count IS NULL) OR
        (state='pending' AND token IS NOT NULL AND lease_expires_at IS NOT NULL AND memory_ids IS NULL AND suppressed_count IS NULL) OR
        (state='completed' AND token IS NULL AND lease_expires_at IS NULL AND memory_ids IS NOT NULL
          AND length(memory_ids)<=2016 AND suppressed_count IS NOT NULL AND suppressed_count BETWEEN 0 AND 5)),
      CHECK((keep_state='failed' AND keep_error_code IS NOT NULL) OR (keep_state!='failed' AND keep_error_code IS NULL))
    ) STRICT;
  `);
  if (db.prepare('PRAGMA foreign_key_check').all().length) fail('storage_error');
}
