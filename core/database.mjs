import { randomBytes, randomUUID } from "node:crypto";
import { closeSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fail } from "./validation.mjs";

const APPLICATION_ID = 0x43414952;
const VERSION = 4;

function createVersion3(db) {
  db.exec(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      content TEXT,
      kind TEXT NOT NULL,
      origin TEXT NOT NULL CHECK (origin IN ('explicit','agent-inferred')),
      confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
      revision INTEGER NOT NULL CHECK (revision > 0),
      deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK ((scope = 'personal' AND project_id = '') OR
             (scope = 'project' AND length(project_id) > 0)),
      CHECK ((deleted = 0 AND content IS NOT NULL) OR (deleted = 1 AND content IS NULL))
    ) STRICT;
    CREATE UNIQUE INDEX active_identity ON memories(owner_id, scope, project_id, fingerprint)
      WHERE deleted = 0;
    CREATE INDEX namespace_memories ON memories(
      owner_id, scope, project_id, deleted, updated_at DESC, id);
    CREATE TABLE receipts (
      id TEXT NOT NULL UNIQUE,
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      receipt_key TEXT NOT NULL,
      client TEXT NOT NULL,
      session_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      excerpt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (memory_id, receipt_key)
    ) STRICT;
    CREATE INDEX memory_receipts ON receipts(memory_id, created_at, id);
    CREATE TABLE suppressed (
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      project_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      PRIMARY KEY (owner_id, scope, project_id, fingerprint)
    ) STRICT;
    CREATE TABLE namespace_epochs (
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      epoch INTEGER NOT NULL CHECK (epoch >= 1),
      PRIMARY KEY (owner_id, scope, project_id)
    ) STRICT;
    CREATE TABLE store_metadata (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      store_id TEXT NOT NULL UNIQUE,
      cursor_secret TEXT NOT NULL
    ) STRICT;
  `);
  db.prepare(`INSERT INTO store_metadata(singleton, store_id, cursor_secret)
    VALUES (1, ?, ?)`).run(randomUUID(), randomBytes(32).toString("hex"));
}

function migrateVersion1(db) {
  db.exec(`
    ALTER TABLE receipts RENAME TO receipts_v1;
    CREATE TABLE receipts (
      id TEXT NOT NULL UNIQUE,
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      receipt_key TEXT NOT NULL,
      client TEXT NOT NULL,
      session_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      excerpt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (memory_id, receipt_key)
    ) STRICT;
  `);
  const insert = db.prepare(`INSERT INTO receipts
    (id, memory_id, receipt_key, client, session_id, event_id, role, excerpt, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const receipt of db.prepare("SELECT * FROM receipts_v1").all()) {
    insert.run(randomUUID(), receipt.memory_id, receipt.receipt_key, receipt.client,
      receipt.session_id, receipt.event_id, receipt.role, receipt.excerpt, receipt.created_at);
  }
  db.exec(`
    DROP TABLE receipts_v1;
    DROP INDEX namespace_memories;
    CREATE INDEX namespace_memories ON memories(
      owner_id, scope, project_id, deleted, updated_at DESC, id);
    CREATE INDEX memory_receipts ON receipts(memory_id, created_at, id);
    CREATE TABLE namespace_epochs (
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      epoch INTEGER NOT NULL CHECK (epoch >= 1),
      PRIMARY KEY (owner_id, scope, project_id)
    ) STRICT;
    INSERT INTO namespace_epochs(owner_id, scope, project_id, epoch)
      SELECT DISTINCT owner_id, scope, project_id, 1 FROM memories;
    CREATE TABLE store_metadata (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      store_id TEXT NOT NULL UNIQUE,
      cursor_secret TEXT NOT NULL
    ) STRICT;
  `);
  db.prepare(`INSERT INTO store_metadata(singleton, store_id, cursor_secret)
    VALUES (1, ?, ?)`).run(randomUUID(), randomBytes(32).toString("hex"));
}

function migrateVersion3(db) {
  db.exec(`
    ALTER TABLE memories ADD COLUMN filing_status TEXT NOT NULL DEFAULT 'unfiled'
      CHECK (filing_status IN ('filed','unfiled'));
    CREATE TABLE mocs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      level INTEGER NOT NULL CHECK (level IN (1,2)),
      title TEXT NOT NULL,
      canonical_title TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK ((scope = 'personal' AND project_id = '') OR
             (scope = 'project' AND length(project_id) > 0))
    ) STRICT;
    CREATE UNIQUE INDEX namespace_moc_titles ON mocs(
      owner_id, scope, project_id, level, canonical_title);
    CREATE INDEX namespace_mocs ON mocs(
      owner_id, scope, project_id, level, canonical_title, id);
    CREATE TABLE moc_title_sources (
      moc_id TEXT NOT NULL REFERENCES mocs(id) ON DELETE CASCADE,
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      memory_revision INTEGER NOT NULL CHECK (memory_revision > 0),
      PRIMARY KEY (moc_id, memory_id)
    ) STRICT;
    CREATE INDEX memory_title_sources ON moc_title_sources(memory_id, moc_id);
    CREATE TABLE moc_memory_refs (
      moc_id TEXT NOT NULL REFERENCES mocs(id) ON DELETE CASCADE,
      moc_revision INTEGER NOT NULL CHECK (moc_revision > 0),
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      memory_revision INTEGER NOT NULL CHECK (memory_revision > 0),
      PRIMARY KEY (moc_id, memory_id)
    ) STRICT;
    CREATE INDEX memory_moc_refs ON moc_memory_refs(memory_id, moc_id);
    CREATE TABLE moc_edges (
      parent_id TEXT NOT NULL REFERENCES mocs(id) ON DELETE CASCADE,
      parent_revision INTEGER NOT NULL CHECK (parent_revision > 0),
      child_id TEXT NOT NULL REFERENCES mocs(id) ON DELETE CASCADE,
      child_revision INTEGER NOT NULL CHECK (child_revision > 0),
      PRIMARY KEY (parent_id, child_id),
      CHECK (parent_id != child_id)
    ) STRICT;
    CREATE INDEX child_moc_edges ON moc_edges(child_id, parent_id);
  `);
}

export function transaction(db, work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function openDatabase(path) {
  if (typeof path !== "string" || !path.trim() || path.includes("\0")) fail("invalid_path");
  if (path !== ":memory:") {
    path = resolve(path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    try {
      closeSync(openSync(path, "ax", 0o600));
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const stat = lstatSync(path);
    if (!stat.isFile() || (process.platform !== "win32" && (stat.mode & 0o077))) {
      fail("unsafe_database_file");
    }
  }
  const db = new DatabaseSync(path, { timeout: 5_000 });
  try {
    db.exec("PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;");
    transaction(db, () => {
      const appId = db.prepare("PRAGMA application_id").get().application_id;
      const version = db.prepare("PRAGMA user_version").get().user_version;
      if (appId === APPLICATION_ID && version === VERSION) return;
      if (appId === APPLICATION_ID && version === 1) {
        migrateVersion1(db);
        migrateVersion3(db);
        db.exec(`PRAGMA user_version = ${VERSION}`);
        return;
      }
      if (appId === APPLICATION_ID && version === 3) {
        migrateVersion3(db);
        db.exec(`PRAGMA user_version = ${VERSION}`);
        return;
      }
      const tables = db.prepare("SELECT count(*) AS n FROM sqlite_master").get().n;
      if (appId !== 0 || version !== 0 || tables !== 0) fail("unsupported_database");
      createVersion3(db);
      migrateVersion3(db);
      db.exec(`PRAGMA application_id = ${APPLICATION_ID}; PRAGMA user_version = ${VERSION};`);
    });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
