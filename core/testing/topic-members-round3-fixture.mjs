import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
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
export async function baselineReader(workspace, diagnostic = () => {}) {
  const fixture = new URL('../test/fixtures/topic-overview-b2513501/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', fixture)));
  assert.equal(manifest.revision, 'b2513501');
  const directory = join(workspace.path, 'b2513501'); mkdirSync(directory);
  const output = join(workspace.path, 'git-stdout'), error = join(workspace.path, 'git-stderr');
  function git(args) {
    const out = openSync(output, 'w'), err = openSync(error, 'w');
    let result;
    try { result = spawnSync('git', args, { cwd: fileURLToPath(new URL('../../', import.meta.url)),
      stdio: ['ignore', out, err] }); }
    finally { closeSync(out); closeSync(err); }
    return { ...result, stdout: readFileSync(output), stderr: readFileSync(error, 'utf8') };
  }
  // History only strengthens provenance. Missing git or a shallow checkout must
  // still execute the entire differential against the frozen, hashed baseline.
  const history = git(['cat-file', '-e', manifest.revision + '^{commit}']);
  if (history.error) assert.equal(history.error.code, 'ENOENT', history.error.message);
  else assert.ok(history.status === 0 || history.status === 128, history.stderr);
  const historyAvailable = !history.error && history.status === 0;
  for (const [path, sha256] of Object.entries(manifest.files)) {
    const bytes = readFileSync(new URL(path, fixture));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256, 'frozen baseline hash: ' + path);
    if (historyAvailable) {
      const original = git(['show', manifest.revision + ':' + path]);
      assert.equal(original.error, undefined); assert.equal(original.status, 0, original.stderr);
      assert.deepEqual(bytes, original.stdout, 'frozen baseline equals git show: ' + path);
    }
    const target = join(directory, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes);
  }
  diagnostic(JSON.stringify({ baseline: manifest.revision, vendoredFiles: Object.keys(manifest.files).length,
    historyAvailable, differentialSource: 'vendored fixture' }));
  return (await import(pathToFileURL(join(directory, manifest.entry)).href)).openMemoryReader;
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
