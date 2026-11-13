// Import this control only after the open-spy bootstrap, just like application
// modules. All cached aliases are captured during this module's initialization.
import { DatabaseSync } from 'node:sqlite';
import * as sqliteNamespace from 'node:sqlite';
import sqlite from 'node:sqlite';
import * as children from 'node:child_process';
import { spawnSync, spawn, execFileSync, execFile, execSync, exec, fork } from 'node:child_process';
import childProcess from 'node:child_process';
import { Worker } from 'node:worker_threads';
import * as workers from 'node:worker_threads';
import workerThreads from 'node:worker_threads';
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
const builtinSQLite = globalThis.process.getBuiltinModule('node:sqlite');
const CachedPrototypeDatabase = sqlite.DatabaseSync.prototype.constructor;
const CachedBuiltinPrototypeDatabase = builtinSQLite.DatabaseSync.prototype.constructor;
const instance = new builtinSQLite.DatabaseSync(':memory:');
const CachedInstanceDatabase = instance.constructor;
instance.close();
const dynamicChildren = await import('node:child_process');
const dynamicWorkers = await import('node:worker_threads');
const CachedDefaultWorker = workerThreads.Worker;

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
  builtin: path => read(builtinSQLite.DatabaseSync, path),
  'cached-prototype': path => read(CachedPrototypeDatabase, path),
  'cached-builtin-prototype': path => read(CachedBuiltinPrototypeDatabase, path),
  'cached-instance': path => read(CachedInstanceDatabase, path),
};
export const databaseBindings = [DatabaseSync, sqliteNamespace.DatabaseSync,
  sqlite.DatabaseSync, CachedDefaultDatabase, dynamic.DatabaseSync,
  dynamic.default.DatabaseSync, CachedDynamicDefaultDatabase,
  requiredSQLite.DatabaseSync, CachedRequiredDatabase, builtinSQLite.DatabaseSync,
  CachedPrototypeDatabase, CachedBuiltinPrototypeDatabase, CachedInstanceDatabase];

// Used by the temporary WAL-refusal mutation; it deliberately caches the
// builtin prototype constructor above and does not depend on the control table.
export function cachedPrototypeOpen(path) {
  const db = new CachedBuiltinPrototypeDatabase(path, { readOnly: true });
  try { db.prepare('PRAGMA journal_mode').get(); }
  finally { db.close(); }
}

export const childLaunches = { named: { spawnSync, spawn, execFileSync, execFile, execSync, exec, fork },
  namespace: children, default: childProcess,
  'cached-default': cachedChildren, require: requiredChildren,
  'dynamic-named': dynamicChildren, 'dynamic-default': dynamicChildren.default,
  builtin: globalThis.process.getBuiltinModule('node:child_process') };

export const workerLaunches = {
  named: Worker, namespace: workers.Worker, default: workerThreads.Worker,
  'cached-default': CachedDefaultWorker,
  'dynamic-named': dynamicWorkers.Worker, 'dynamic-default': dynamicWorkers.default.Worker,
  require: require('node:worker_threads').Worker,
  builtin: globalThis.process.getBuiltinModule('node:worker_threads').Worker,
  'cached-prototype': CachedDefaultWorker.prototype.constructor,
};
