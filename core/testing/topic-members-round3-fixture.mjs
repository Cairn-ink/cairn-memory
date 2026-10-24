import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync, openSync, closeSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import threads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { STORAGE_BUSY_TIMEOUT_MS } from '../database.mjs';
export const quote = value => '"' + value.replaceAll('"', '""') + '"';
export function cloneSchema(f, transform = sql => sql, nullId = false) {
  const path = join(f.workspace.path, 'round3.sqlite'), db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA foreign_keys=OFF; PRAGMA busy_timeout=${STORAGE_BUSY_TIMEOUT_MS}`);
    const objects = f.db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND type IN ('table','index') ORDER BY type DESC,rowid").all();
    for (const row of objects) db.exec(transform(row.sql, row));
    for (const row of objects.filter(row => row.type === 'table')) {
      for (const original of f.db.prepare('SELECT * FROM ' + quote(row.name)).all()) {
        const value = { ...original }; if (nullId && row.name === 'memories') value.id = null;
        const names = Object.keys(value);
        db.prepare(`INSERT INTO ${quote(row.name)}(${names.map(quote)}) VALUES(${names.map(() => '?')})`).run(...Object.values(value));
      }
    }
    db.exec(`PRAGMA application_id=${f.db.prepare('PRAGMA application_id').get().application_id}; PRAGMA user_version=${f.db.prepare('PRAGMA user_version').get().user_version}`);
  } finally { db.close(); }
  chmodSync(path, 0o600); return path;
}
export function withoutPrimary(sql) {
  return sql.replace(/\bid TEXT PRIMARY KEY\b/, 'id TEXT UNIQUE').replace(/PRIMARY KEY\s*\(([^)]+)\)/, 'UNIQUE ($1)')
    .replace(/(CREATE TABLE[^ (]+|CREATE TABLE\s+[^ (]+)\s*\(/, '$1 (surrogate INTEGER PRIMARY KEY,');
}
export async function baselineReader(workspace) {
  const directory = join(workspace.path, 'b2513501'); mkdirSync(directory);
  const archive = join(workspace.path, 'baseline.tar'), error = join(workspace.path, 'git-stderr');
  const out = openSync(archive, 'w'), err = openSync(error, 'w');
  let result;
  try { result = spawnSync('git', ['archive', '--format=tar', 'b2513501'], { stdio: ['ignore', out, err] }); }
  finally { closeSync(out); closeSync(err); }
  assert.equal(result.error, undefined); assert.equal(result.status, 0, readFileSync(error, 'utf8'));
  const extract = spawnSync('tar', ['-xf', archive, '-C', directory], { stdio: 'ignore' });
  assert.equal(extract.error, undefined); assert.equal(extract.status, 0);
  return (await import(pathToFileURL(join(directory, 'core/memory-reader.mjs')).href)).openMemoryReader;
}
export function faultWorkers(t) {
  const NativeWorker = threads.Worker;
  let fault;
  threads.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(url, { ...options, workerData: { ...options.workerData, round3Fault: fault },
        execArgv: ['--import', new URL('./topic-members-round3-fault.mjs', import.meta.url).href] });
    }
  };
  syncBuiltinESMExports();
  t.after(() => { threads.Worker = NativeWorker; syncBuiltinESMExports(); });
  return value => { fault = value; };
}
