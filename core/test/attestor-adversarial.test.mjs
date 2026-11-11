// Independent review adversarial matrix, maintained with the local package.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { installLocalRawPrivacy } from '../../core/local-authority-schema.mjs';
import { LOCAL_RAW_PRIVACY_DDL, attestContentSafety } from '../../core/content-safety-schema.mjs';

const cases = [
  { name: 'complete current package', ddl: s => s, accept: true },
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
    if (c.accept) assert.doesNotThrow(() => attestContentSafety(db));
    else assert.throws(() => attestContentSafety(db), { code: 'unsupported_database' });
  } finally { db.close(); }
});
