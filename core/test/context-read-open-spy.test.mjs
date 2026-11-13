import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sqliteOpenSpy, SpiedDatabaseSync } from '../testing/context-read-open-spy.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const { databaseOpens, databaseBindings, childLaunches } =
  await import('../testing/context-read-open-patterns.mjs');

test('every SQLite import and require route records a real read-only open', t => {
  const workspace = createTestWorkspace(t, { prefix: 'open-spy-control-' });
  const path = join(workspace.path, 'synthetic.sqlite');
  const db = new SpiedDatabaseSync(path);
  db.exec("CREATE TABLE synthetic_control(value TEXT); INSERT INTO synthetic_control VALUES('synthetic');");
  db.close();
  for (const binding of databaseBindings) assert.equal(binding, SpiedDatabaseSync);
  for (const [pattern, open] of Object.entries(databaseOpens)) {
    const { result, calls } = sqliteOpenSpy(() => open(path));
    assert.equal(result, 'synthetic', pattern);
    assert.deepEqual(calls, [{ kind: 'in-process', args: [path, { readOnly: true }] }], pattern);
  }
  assert.throws(() => sqliteOpenSpy(() => { throw new Error('synthetic failure'); }), /synthetic failure/);
  assert.equal(databaseOpens['cached-default'](path), 'synthetic', 'outside-spy delegation after failure');
  assert.equal(sqliteOpenSpy(() => databaseOpens['cached-default'](path)).calls.length, 1);
});

test('spawnSync records named, default, cached-default and require launches', () => {
  const args = ['--input-type=module', '-e', "process.stdout.write('synthetic')"];
  const options = { encoding: 'utf8', env: {}, timeout: 5000, maxBuffer: 4096 };
  for (const [pattern, launches] of Object.entries(childLaunches)) {
    const { result, calls } = sqliteOpenSpy(() => launches.spawnSync(process.execPath, args, options));
    assert.equal(result.status, 0, pattern);
    assert.equal(result.stdout, 'synthetic', pattern);
    assert.deepEqual(calls, [{ kind: 'child', command: process.execPath, args, options }], pattern);
  }
});

test('all other child launches refuse through every alias, even if caught', () => {
  for (const [pattern, launches] of Object.entries(childLaunches)) {
    for (const api of ['spawn', 'execFileSync', 'execFile', 'execSync', 'exec', 'fork']) {
      let calls;
      assert.throws(() => sqliteOpenSpy(transcript => {
        calls = transcript;
        launches[api](process.execPath, ['--eval', "throw new Error('must not launch')"]);
      }), { code: 'open_spy_child_launch_refused' }, `${pattern}.${api}`);
      assert.deepEqual(calls, [{ kind: 'refused-child', api }], `${pattern}.${api}`);
      assert.throws(() => sqliteOpenSpy(() => {
        try { launches[api](process.execPath); } catch {}
      }), { code: 'open_spy_child_launch_refused' }, `caught ${pattern}.${api}`);
    }
  }
  assert.deepEqual(sqliteOpenSpy(() => 'restored').calls, []);
  assert.equal(childLaunches['cached-default'].spawnSync(process.execPath,
    ['--eval', ''], { env: {}, timeout: 5000 }).status, 0, 'outside-spy delegation after refusal');
});
