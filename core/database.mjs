import { closeSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fail } from "./validation.mjs";

const APPLICATION_ID = 0x43414952;
const VERSION = 1;

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
      const tables = db.prepare("SELECT count(*) AS n FROM sqlite_master").get().n;
      if (appId !== 0 || version !== 0 || tables !== 0) fail("unsupported_database");
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
        CREATE INDEX namespace_memories ON memories(owner_id, scope, project_id, deleted);
        CREATE TABLE receipts (
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
        CREATE TABLE suppressed (
          owner_id TEXT NOT NULL,
          scope TEXT NOT NULL,
          project_id TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          PRIMARY KEY (owner_id, scope, project_id, fingerprint)
        ) STRICT;
        PRAGMA application_id = ${APPLICATION_ID};
        PRAGMA user_version = ${VERSION};
      `);
    });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
