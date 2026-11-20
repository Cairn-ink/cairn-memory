import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { workspace, until, ok } from './local-daemon-support.mjs';
import { runDaemonCommand, startAwareAlive } from '../local-daemon-liveness.mjs';

async function command(w, args) {
  let stdout = '';
  const rc = await runDaemonCommand(args, { root: join(w.root, 'run'), write: s => { stdout += s; } });
  assert.equal(rc, 0); assert.ok(!stdout.includes(w.root)); assert.ok(!stdout.includes(w.path));
  return JSON.parse(stdout);
}
test('status has no daemon, one daemon, and two physical stores with exact code-only shapes', { timeout: 30000 }, async t => {
  const w = await workspace(t);
  assert.deepEqual(await command(w, ['status']), { daemons: [] });
  const a = w.forward(); a.release(); const first = await w.connect(a);
  let status = await until(async () => { const value = await command(w, ['status']); return value.daemons[0]?.attached_sessions === 1 && value; }, 'status observes the authenticated-session stamp');
  assert.equal(status.daemons.length, 1);
  const row = status.daemons[0];
  assert.deepEqual(Object.keys(row).sort(), ['attached_sessions','build','last_codes','running','stamp_age_seconds','store']);
  assert.equal(row.running, true); assert.match(row.build, /^[a-f0-9]{12}$/); assert.match(row.store, /^[a-f0-9]{12}$/);
  assert.equal(row.attached_sessions, 1); assert.ok(row.stamp_age_seconds >= 0); assert.ok(row.last_codes.includes('daemon_ready'));
  // A second private store, served under the same validated runtime directory.
  const secondPath = join(w.root, 'second.sqlite');
  const b = w.child({ args: ['--db', secondPath, '--owner', 'synthetic-second-store'], options: { root: join(w.root, 'run'), environment: {} } }); b.release(); await w.connect(b);
  status = await command(w, ['status']); assert.equal(status.daemons.length, 2);
  const filtered = await command(w, ['status','--db',w.path]); assert.equal(filtered.daemons.length, 1); assert.equal(filtered.daemons[0].store, row.store);
  a.process.stdin.end(); await until(() => a.messages.some(m => m.kind === 'forwarder-done'), 'old session closes before support stop');
  assert.deepEqual(await command(w, ['stop','--db',w.path]), { stopped: 1, still_running: 0 });
  assert.equal(startAwareAlive(first.owner), false);
  ok(await b.tool('remember_memory', { content: 'synthetic second store remains serving', kind: 'fact' }));
  // Stop client A's idle reconnect before asking for a fresh explicit session.
  a.process.stdin.end(); await until(() => a.messages.some(m => m.kind === 'forwarder-done'), 'old session closes');
  const c = w.forward(); c.release(); const next = await w.connect(c); assert.notEqual(next.incarnation, first.incarnation);
});

test('daemon stop during remember drains to a whole real Memory or none', { timeout: 25000 }, async t => {
  const w = await workspace(t), candidate = w.child({ role: 'candidate', bootstrap: await w.bootstrap(), midWrite: { pauseMs: 400 } }); candidate.release();
  await until(w.descriptor, 'supervised candidate publishes');
  const a = w.forward(); a.release(); const descriptor = await w.connect(a);
  candidate.process.send({ kind: 'arm' }); await until(() => candidate.messages.some(m => m.kind === 'armed'), 'remember write barrier armed');
  const pending = a.tool('remember_memory', { content: 'synthetic support stop during remember', kind: 'fact' });
  await until(() => candidate.messages.some(m => m.kind === 'mid-write'), 'real remember transaction has begun before support stop');
  assert.deepEqual(await command(w, ['stop','--db',w.path]), { stopped: 1, still_running: 0 });
  await until(() => candidate.exit, 'SIGTERM drain exits'); assert.equal(candidate.exit.code, 0);
  assert.equal(startAwareAlive(descriptor.owner), false);
  const response = await pending;
  if (response.error) {
    assert.equal(response.error.message, 'daemon_transport');
    await until(() => a.messages.some(m => m.kind === 'forwarder-done'), 'unknown outcome closes session');
    assert.equal(a.messages.find(m => m.kind === 'forwarder-done').code, 'daemon_outcome_unknown');
  } else assert.equal(response.ok, true);
  // Independent SQLite process; no raw fd or cross-library access in the test.
  const script = `import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);try{console.log(JSON.stringify({memories:db.prepare('SELECT id,content,deleted FROM memories').all(),receipts:db.prepare('SELECT memory_id,excerpt FROM receipts').all(),fk:db.prepare('PRAGMA foreign_key_check').all()}));}finally{db.close();}`;
  const child = spawnSync(process.execPath, ['--input-type=module','-e',script,w.path], { env: {}, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); const rows = JSON.parse(child.stdout); assert.deepEqual(rows.fk, []);
  assert.ok(rows.memories.length === 0 || rows.memories.length === 1);
  assert.equal(rows.receipts.length, rows.memories.length);
  if (rows.memories.length) { assert.equal(rows.memories[0].content, 'synthetic support stop during remember'); assert.equal(rows.memories[0].deleted, 0); assert.equal(rows.receipts[0].memory_id, rows.memories[0].id); }
  if (!response.error) assert.equal(rows.memories.length, 1, 'successful MCP result must mean a complete durable Memory');
});

for (const action of ['status','stop']) test('non-Linux support code: ' + action, async () => {
  let text = ''; assert.equal(await runDaemonCommand([action], { platform: 'darwin', write: line => { text += line; } }), 0);
  assert.equal(text, 'daemon_platform\n');
});
