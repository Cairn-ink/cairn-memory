// Import this control only after the open-spy bootstrap, just like application
// modules. All cached aliases are captured during this module's initialization.
import { DatabaseSync } from 'node:sqlite';
import * as sqliteNamespace from 'node:sqlite';
import sqlite from 'node:sqlite';
import * as children from 'node:child_process';
import { spawnSync, spawn, execFileSync, execFile, execSync, exec, fork } from 'node:child_process';
import childProcess from 'node:child_process';
import { createRequire } from 'node:module';

const CachedDefaultDatabase = sqlite.DatabaseSync;
const dynamic = await import('node:sqlite');
const { DatabaseSync: CachedDynamicDefaultDatabase } = dynamic.default;
const require = createRequire(import.meta.url);
const requiredSQLite = require('node:sqlite');
const CachedRequiredDatabase = requiredSQLite.DatabaseSync;
const cachedChildren = Object.fromEntries(
  ['spawnSync', 'spawn', 'execFileSync', 'execFile', 'execSync', 'exec', 'fork']
    .map(api => [api, childProcess[api]]));
const requiredChildren = require('node:child_process');

function read(Database, path) {
  const db = new Database(path, { readOnly: true });
  try { return db.prepare('SELECT value FROM synthetic_control').get().value; }
  finally { db.close(); }
}

export const databaseOpens = {
  named: path => read(DatabaseSync, path),
  namespace: path => read(sqliteNamespace.DatabaseSync, path),
  'default-property': path => read(sqlite.DatabaseSync, path),
  'cached-default': path => read(CachedDefaultDatabase, path),
  'dynamic-named': path => read(dynamic.DatabaseSync, path),
  'dynamic-default': path => read(dynamic.default.DatabaseSync, path),
  'cached-dynamic-default': path => read(CachedDynamicDefaultDatabase, path),
  require: path => read(requiredSQLite.DatabaseSync, path),
  'cached-require': path => read(CachedRequiredDatabase, path),
};
export const databaseBindings = [DatabaseSync, sqliteNamespace.DatabaseSync,
  sqlite.DatabaseSync, CachedDefaultDatabase, dynamic.DatabaseSync,
  dynamic.default.DatabaseSync, CachedDynamicDefaultDatabase,
  requiredSQLite.DatabaseSync, CachedRequiredDatabase];

// Used by the temporary WAL-refusal mutation; it deliberately caches the
// default constructor above and does not depend on the control table.
export function cachedDefaultOpen(path) {
  const db = new CachedDefaultDatabase(path, { readOnly: true });
  try { db.prepare('PRAGMA journal_mode').get(); }
  finally { db.close(); }
}

export const childLaunches = { named: { spawnSync, spawn, execFileSync, execFile, execSync, exec, fork },
  namespace: children, default: childProcess,
  'cached-default': cachedChildren, require: requiredChildren };
