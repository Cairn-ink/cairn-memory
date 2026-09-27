import { randomBytes } from 'node:crypto';
import { transaction } from './database.mjs';
import { fail } from './validation.mjs';

export const EPISODE_SCHEMA_VERSION = 15;
export const hasEpisodes = db => db.prepare('PRAGMA user_version').get().user_version === 15;

/** Caller holds transaction(). Snapshot/drop children first: CASCADE must not erase the journal. */
export function migrateVersion14(db) {
  if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) fail('storage_error');
  const children = ['staged_capture_evidence', 'capture_initial_classification'];
  const definitions = children.map(name => db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(name).sql);
  for (const name of children) {
    db.exec(`CREATE TEMP TABLE se1_${name} AS SELECT * FROM ${name}; DROP TABLE ${name};`);
  }
  const parent = db.prepare("SELECT sql FROM sqlite_master WHERE name='admission_claims'").get().sql;
  db.exec('CREATE TEMP TABLE se1_admission_claims AS SELECT * FROM admission_claims; DROP TABLE admission_claims;');
  db.exec(parent.replace("('pending','completed')", "('reserved','pending','completed')")
    .replace("CHECK ((state = 'pending'", "CHECK ((state = 'reserved' AND token IS NULL AND lease_expires_at IS NULL AND memory_ids IS NULL AND suppressed_count IS NULL) OR (state = 'pending'"));
  db.exec('INSERT INTO admission_claims SELECT * FROM se1_admission_claims; DROP TABLE se1_admission_claims;');
  const staging = definitions[0].replace("'forgotten')", "'forgotten','released')")
    .replace('PRIMARY KEY (owner_id', `event_mode TEXT NOT NULL DEFAULT 'staged-v1' CHECK(event_mode IN ('staged-v1','episode-v1')),
      release_reason TEXT CHECK(release_reason IN ('interpreted','capacity')),
      disposition INTEGER NOT NULL DEFAULT 0 CHECK(disposition IN (0,1)),
      PRIMARY KEY (owner_id`)
    .replace(/\)\s*STRICT\s*$/, `, CHECK ((state='released' AND event_mode='episode-v1' AND payload IS NULL
      AND payload_bytes=0 AND release_reason IS NOT NULL) OR (state!='released' AND release_reason IS NULL))) STRICT`);
  db.exec(staging);
  db.exec(`
    INSERT INTO staged_capture_evidence(owner_id,scope,project_id,client,event_id,state,created_at,expires_at,payload,payload_bytes)
      SELECT * FROM se1_staged_capture_evidence;
    DROP TABLE se1_staged_capture_evidence;`);
  db.exec(definitions[1]);
  db.exec('INSERT INTO capture_initial_classification SELECT * FROM se1_capture_initial_classification; DROP TABLE se1_capture_initial_classification;');
  db.exec(`
    CREATE TABLE episode_identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1), secret TEXT NOT NULL) STRICT;
    CREATE TABLE episode_controls(owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      generation TEXT NOT NULL, paused INTEGER NOT NULL CHECK(paused IN (0,1)),
      enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), ordinal INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(owner_id,scope,project_id)) STRICT;
    CREATE TABLE session_episodes(
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      client TEXT NOT NULL, session_key TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
      source_fence INTEGER NOT NULL DEFAULT 1, generation TEXT NOT NULL, draft_every INTEGER NOT NULL CHECK(draft_every BETWEEN 2 AND 16),
      deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
      observed INTEGER NOT NULL DEFAULT 0, attempted INTEGER NOT NULL DEFAULT 0, covered INTEGER NOT NULL DEFAULT 0,
      first_received_at TEXT NOT NULL, last_received_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      record TEXT NOT NULL, writer_token TEXT, writer_expires_at INTEGER,
      UNIQUE(owner_id,scope,project_id,client,session_key)) STRICT;
    CREATE INDEX episode_pending ON session_episodes(owner_id,scope,project_id,client,deleted,last_received_at,id);
    CREATE TABLE episode_events(
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL, client TEXT NOT NULL,event_id TEXT NOT NULL,
      episode_id TEXT NOT NULL REFERENCES session_episodes(id), payload_digest TEXT NOT NULL,
      position INTEGER NOT NULL, ordinal INTEGER NOT NULL, generation TEXT NOT NULL,
      staging TEXT NOT NULL CHECK(staging IN ('staged','not-staged')), gap TEXT,
      admission_writer TEXT, admission TEXT NOT NULL DEFAULT 'reserved' CHECK(admission IN ('reserved','pending','completed')),
      disposition INTEGER NOT NULL DEFAULT 0 CHECK(disposition IN (0,1)), policy TEXT NOT NULL DEFAULT 'normal',
      policy_revision INTEGER, policy_type TEXT, policy_at TEXT, created_at TEXT NOT NULL,
      PRIMARY KEY(owner_id,scope,project_id,client,event_id), UNIQUE(episode_id,position),
      FOREIGN KEY(owner_id,scope,project_id,client,event_id) REFERENCES admission_claims(owner_id,scope,project_id,client,event_id)) STRICT;
    CREATE INDEX episode_policy_page ON episode_events(episode_id,position);
    CREATE TABLE episode_sources(id TEXT PRIMARY KEY, episode_id TEXT NOT NULL REFERENCES session_episodes(id),
      origin_episode_id TEXT NOT NULL REFERENCES session_episodes(id), event_id TEXT NOT NULL, message_id TEXT NOT NULL,
      digest TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','assistant')), text TEXT NOT NULL CHECK(length(text)<=800),
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
  db.exec('PRAGMA user_version=15');
}

export function ensureEpisodes(db) {
  if (!hasEpisodes(db)) transaction(db, () => {
    if (!hasEpisodes(db)) migrateVersion14(db);
  });
}
