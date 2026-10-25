import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import threads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { openMemoryReader } from '../index.mjs';
import { STORAGE_BUSY_TIMEOUT_MS } from '../database.mjs';
import { namespace, ok } from './topic-members-fixture.mjs';

export function observedReader(t, f) {
  const NativeWorker = threads.Worker;
  const records = [], waiting = [], ports = [];
  threads.Worker = class extends NativeWorker {
    constructor(url, options) {
      const { port1, port2 } = new MessageChannel(); ports.push(port1);
      port1.on('message', record => { const resolve = waiting.shift(); if (resolve) resolve(record); else records.push(record); });
      super(url, { ...options, workerData: { ...options.workerData, reviewPort: port2 }, transferList: [port2],
        execArgv: ['--import', new URL('./topic-members-clock.mjs', import.meta.url).href,
          '--import', new URL('./topic-members-review-observer.mjs', import.meta.url).href] });
    }
  };
  syncBuiltinESMExports();
  const reader = openMemoryReader({ path: f.path, ownerId: namespace.ownerId });
  t.after(async () => { await reader.close(); ports.forEach(port => port.close()); threads.Worker = NativeWorker; syncBuiltinESMExports(); });
  return { reader, restore: () => { threads.Worker = NativeWorker; syncBuiltinESMExports(); }, report: () => records.length ? Promise.resolve(records.shift()) : new Promise(resolve => waiting.push(resolve)) };
}
const quote = value => '"' + value.replaceAll('"','""') + '"';
export function alternateLayout(f, { encoding = 'UTF-8', nocaseOwner = false } = {}) {
  const path = join(f.workspace.path, 'alternate-'+encoding+'-'+nocaseOwner+'.sqlite'), db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA encoding='${encoding}'; PRAGMA foreign_keys=OFF; PRAGMA busy_timeout=${STORAGE_BUSY_TIMEOUT_MS}`);
    const objects = f.db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END,rowid").all();
    for (const row of objects) {
      let sql = row.sql;
      if (nocaseOwner && row.name === 'memories') sql = sql.replace('owner_id TEXT NOT NULL', 'owner_id TEXT COLLATE NOCASE NOT NULL');
      if (nocaseOwner && row.name === 'index_memory_keyset') sql = sql.replace('owner_id,', 'owner_id COLLATE BINARY,');
      db.exec(sql);
    }
    for (const row of objects.filter(row => row.type === 'table')) {
      for (const value of f.db.prepare('SELECT * FROM ' + quote(row.name)).all()) {
        const keys = Object.keys(value);
        db.prepare(`INSERT INTO ${quote(row.name)}(${keys.map(quote)}) VALUES(${keys.map(()=>'?')})`).run(...Object.values(value));
      }
    }
    const app = f.db.prepare('PRAGMA application_id').get().application_id, version = f.db.prepare('PRAGMA user_version').get().user_version;
    db.exec(`PRAGMA application_id=${app}; PRAGMA user_version=${version}`);
    if (nocaseOwner) db.prepare('UPDATE memories SET owner_id=?').run(namespace.ownerId.toUpperCase());
    assert.equal(db.prepare('PRAGMA encoding').get().encoding.toUpperCase(), encoding.toUpperCase());
  } finally { db.close(); }
  // Native DatabaseSync creates with its default mode, so restrict the fixture.
  return path;
}
export async function complete(reader, input) {
  let cursor; const items = [];
  for (let attempt = 0; attempt < 3000; attempt++) {
    const page = ok(await reader.readTopicMembers({ ...input, ...(cursor ? { cursor } : {}) }));
    items.push(...page.items); cursor = page.nextCursor;
    if (!cursor) { assert.equal(page.coverage.complete,true); return items; }
  }
  assert.fail('initialization/enumeration did not make finite progress');
}
