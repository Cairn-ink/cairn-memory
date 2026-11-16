// Independent review adversarial matrix, maintained with the local package.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { installLocalRawPrivacy } from '../../core/local-authority-schema.mjs';
import { LOCAL_RAW_PRIVACY_DDL, LOCAL_RAW_PACKAGES, attestContentSafety, attestedLocalRawPackage } from '../../core/content-safety-schema.mjs';

import { openReadDatabase } from '../read-database.mjs';

const cases = [
  { name: 'exact v1 package', ddl: s => s, accept: true, version: 'v1' },
  { name: 'exact v2 package', ddl: () => LOCAL_RAW_PACKAGES.v2.join('\n'), accept: true, version: 'v2' },
  { name: 'inherited schema without local objects', ddl: () => '', accept: true, version: null },
  { name: 'renamed peer index', ddl: s => s, after: 'CREATE INDEX renamed_peers ON raw_messages(message_id, conversation_id)', accept: false },
  { name: 'overflow refuses and still diagnoses an exact peer index beyond the scan bound', ddl: s => s,
    after: Array.from({length:15},(_,i)=>`CREATE INDEX foreign_${i} ON raw_messages(ordinal);`).join('\n')+
      'CREATE INDEX local_raw_message_peers ON raw_messages(message_id, conversation_id);', accept: false, nearest: 'v2' },
  ...['conversation_id, message_id','message_id, ordinal'].map(columns => ({
    name: 'altered peer index '+columns, ddl: s => s,
    after: `CREATE INDEX local_raw_message_peers ON raw_messages(${columns})`, accept: false,
  })),
  ...LOCAL_RAW_PRIVACY_DDL.map(sql => {
    const [,type,name] = /^CREATE (TABLE|INDEX|TRIGGER) IF NOT EXISTS (\w+)/.exec(sql);
    return { name: 'v2 minus '+name, ddl: () => LOCAL_RAW_PACKAGES.v2.join('\n'),
      after: `DROP ${type} ${name}`, accept: false, nearest: 'v2' };
  }),
  { name: 'insignificant whitespace', ddl: s => s.replace(/\s+/g, ' '), accept: true },
  { name: 'no IF NOT EXISTS', ddl: s => s.replaceAll(' IF NOT EXISTS', ''), accept: true },
  { name: 'different keyword case is conservatively refused', ddl: s => s.replaceAll(' NOT NULL', ' not null'), accept: false },
  { name: 'quoted identifier is conservatively refused', ddl: s => s.replaceAll('local_raw_session_modes', '"local_raw_session_modes"'), accept: false },
  { name: 'same name changed constraint', ddl: s => s.replace('CHECK(end_ms>=start_ms)', 'CHECK(end_ms>start_ms)'), accept: false },
  { name: 'same name changed index columns', ddl: s => s.replace('(complete,owner_id,scope,project_id,client,session_key)', '(complete,owner_id,scope,project_id,session_key,client)'), accept: false },
  { name: 'partial package', ddl: s => s.replace(/CREATE TABLE IF NOT EXISTS local_raw_session_modes[\s\S]*?\) STRICT;/, ''), accept: false },
  { name: 'ALTER adds a column', ddl: s => s, after: 'ALTER TABLE local_raw_session_modes ADD COLUMN unexpected TEXT', accept: false },
  { name: 'extra index', ddl: s => s, after: 'CREATE INDEX local_raw_extra ON local_raw_session_modes(interpretation)', accept: false },
  { name: 'extra trigger', ddl: s => s, after: 'CREATE TRIGGER local_raw_extra AFTER INSERT ON local_raw_session_modes BEGIN SELECT 1; END', accept: false },
  { name: 'unshipped five-object package is refused', ddl: () => LOCAL_RAW_PRIVACY_DDL.slice(0,5).join('\n'), accept: false },
];
for (const c of cases) test(c.name, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'independent-attestor-' });
  const path = join(workspace.path, 'synthetic.sqlite');
  const child = spawnSync(process.execPath,
    [new URL('../testing/create-existing-safety-store.mjs',import.meta.url).pathname, path],
    { encoding: 'utf8', timeout: 30000, env: { PATH: '/usr/bin:/bin', TMPDIR: workspace.path, NODE_NO_WARNINGS: '1' } });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, child.stderr);
  const db = new DatabaseSync(path);
  try {
    db.exec(c.ddl(installLocalRawPrivacy()));
    if (c.after) db.exec(c.after);
    if (c.accept) {
      attestContentSafety(db);
      assert.equal(attestedLocalRawPackage(db), c.version === undefined ? 'v1' : c.version);
      const before = db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY name').all();
      const reader = openReadDatabase(path, { contextRead: true }).db;
      try { assert.equal(attestedLocalRawPackage(reader), c.version === undefined ? 'v1' : c.version); }
      finally { reader.close(); }
      assert.deepEqual(db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY name').all(), before);
    } else assert.throws(() => attestContentSafety(db), error => {
      assert.equal(error.code, 'unsupported_database');
      assert.equal(error.nearestLocalRawPackage, c.nearest ?? 'v1');
      assert.equal(Object.getOwnPropertyDescriptor(error, 'nearestLocalRawPackage').enumerable, false);
      assert.doesNotMatch(JSON.stringify(error), /nearestLocalRawPackage/);
      return true;
    });
  } finally { db.close(); }
});
