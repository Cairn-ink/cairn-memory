import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../../../core/index.mjs';
import { createContextReadAccess } from '../context-read-access.mjs';
import { startLocalContextMaintenance } from '../../../core/local-defaults.mjs';
import { controlledClock } from '../../../core/testing/context-read-assembly-fixture.mjs';
import { assertContextReadCanonicalDelete, openContextReadSidecar } from '../../../core/context-read-sidecar.mjs';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, lstatSync, renameSync, chmodSync, linkSync } from 'node:fs';

const ns = { ownerId: 'synthetic-owner', scope: 'personal', projectId: null };
const counter = { id: 'synthetic', countTokens: () => 1 };
const ok = value => { assert.equal(value.ok, true, JSON.stringify(value)); return value.value; };
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const query = { readSet: [ns], types: ['memory'], intent: 'current', query: 'telescope', semantic: false, deadlineMs: 1000 };

for (const repeated of [false, true]) test(`foreground reads survive ${repeated ? 'repeated lexical commits' : 'a lexical commit'} during the sidecar probe and after the turn settles`, async t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'memory.sqlite');
  const access = createContextReadAccess(ns, false, { maintenance: true });
  const maintainer = openMemoryCore({ path, contextRead: { ...access.configuration, counter } });
  workspace.defer(() => maintainer.close());
  const admit = i => ok(maintainer.admit({ namespace: ns, memory: { content: 'Synthetic telescope ' + i, kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'synthetic', eventId: 'synthetic-' + i, role: 'user', excerpt: 'telescope' }] }));
  admit('seed');
  ok(await access.call(maintainer, 'refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } }));
  for (let i = 0; i < 40; i++) admit(i);
  const reader = openMemoryCore({ path, contextRead: { ...access.configuration, counter } });
  workspace.defer(() => reader.close());
  const clock = controlledClock(t), prepare = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, 'prepare', function(sql) {
    const statement = Reflect.apply(prepare, this, [sql]);
    if (sql.startsWith('SELECT content AS text')) {
      const get = statement.get.bind(statement);
      statement.get = (...args) => { const row = get(...args); clock.advance(2); return row; };
    }
    return statement;
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finishTurn, turnResult, settled = false;
  const driver = startLocalContextMaintenance(maintainer, { readSet: [ns], call(core, method, input) {
    return Promise.resolve(access.call(core, method, input)).then(result => {
      turnResult = result;
      return new Promise(resolve => { finishTurn = () => { settled = true; resolve(result); }; });
    });
  } });
  const spawn = childProcess.spawnSync;
  let injected = false, probes = 0, secondTurn;
  childProcess.spawnSync = (command, args, options) => {
    const result = spawn(command, args, options);
    if (args[2]?.includes('PRAGMA journal_mode') && args[3]?.includes('.context-read-v1.sqlite')) {
      probes++;
      if (!injected) {
        injected = true;
        // Commit an actual bounded lexical checkpoint between the probe's two
        // metadata samples. Its refresh promise remains in flight for the read.
        t.mock.timers.tick(0);
      } else if (repeated && probes === 2) {
        // A second writer turn can commit during the repeated header probe too.
        secondTurn = access.call(maintainer, 'refreshContextIndex', {
          readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 1024, maxMs: 25 },
        });
      }
    }
    return result;
  };
  syncBuiltinESMExports();
  try {
    const during = await access.call(reader, 'findCandidates', query);
    await flush();
    assert.equal(injected, true);
    assert.equal(settled, false);
    assert.equal(ok(turnResult).status, 'rebuilding');
    assert.ok(ok(turnResult).progress.transformed > 0);
    assert.ok(ok(turnResult).progress.transformed < 40);
    assert.ok(ok(during).items.length > 0);
    assert.equal(during.value.channels.lexical.state, 'ready');
    if (repeated) {
      assert.ok(probes >= 2);
      assert.equal(ok(await secondTurn).status, 'rebuilding');
    }
    finishTurn(); await flush();
    const after = ok(await access.call(reader, 'findCandidates', query));
    assert.deepEqual(after.items.map(item => item.ref), during.value.items.map(item => item.ref));
    assert.equal(after.channels.lexical.state, 'ready');
  } finally {
    childProcess.spawnSync = spawn; syncBuiltinESMExports();
    if (finishTurn) finishTurn(); await driver.close(); t.mock.timers.reset();
  }
});

test('unfinished lexical work yields one slice between turns and completion backs off', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0;
  const turns = [];
  const core = { getContextReadCapabilities: () => ({ ok: true, value: { types: ['memory'] } }) };
  const driver = startLocalContextMaintenance(core, { readSet: [ns], call(_core, _method, input) {
    turns.push({ at: now, budget: input.budget });
    return { ok: true, value: { status: turns.length < 3 ? 'rebuilding' : 'complete', progress: { transformed: turns.length < 3 ? 1 : 0, lexical: { checkpoint: Math.min(turns.length, 3) } } } };
  } });
  const tick = async ms => { now += ms; t.mock.timers.tick(ms); await flush(); };
  try {
    await tick(0); await tick(24); assert.equal(turns.length, 1);
    await tick(1); await tick(25);
    assert.deepEqual(turns.map(turn => turn.at), [0, 25, 50]);
    assert.ok(turns.every(turn => turn.budget.maxMs === 25 && turn.budget.maxItems === 1024));
    await tick(1000); assert.equal(turns.length, 4);
    await tick(29_999); assert.equal(turns.length, 4);
    await tick(1); assert.equal(turns.length, 5);
  } finally { await driver.close(); t.mock.timers.reset(); }
});

for (const change of ['wal', 'replacement']) test(`a changing sidecar probe still refuses ${change}`, async t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'memory.sqlite');
  const sidecar = path + '.context-read-v1.sqlite';
  const access = createContextReadAccess(ns, false, { maintenance: true });
  const core = openMemoryCore({ path, contextRead: { ...access.configuration, counter } });
  ok(core.admit({ namespace: ns, memory: { content: 'Synthetic telescope', kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'synthetic', eventId: 'synthetic', role: 'user', excerpt: 'telescope' }] }));
  ok(await access.call(core, 'refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } }));
  await core.close();
  const reader = openMemoryCore({ path, contextRead: { ...access.configuration, counter } });
  workspace.defer(() => reader.close());
  const originalInode = lstatSync(sidecar).ino, spawn = childProcess.spawnSync;
  let injected = false, changedInode;
  childProcess.spawnSync = (command, args, options) => {
    const result = spawn(command, args, options);
    if (!injected && args[2]?.includes('PRAGMA journal_mode') && args[3]?.includes('.context-read-v1.sqlite')) {
      injected = true;
      if (change === 'replacement') renameSync(sidecar, sidecar + '.previous');
      const writer = new DatabaseSync(sidecar);
      try {
        if (change === 'wal') writer.exec('PRAGMA journal_mode=WAL');
        else writer.exec('CREATE TABLE synthetic(value TEXT)');
      } finally { writer.close(); }
      changedInode = lstatSync(sidecar).ino;
    }
    return result;
  };
  syncBuiltinESMExports();
  try {
    const result = await access.call(reader, 'findCandidates', query);
    assert.equal(injected, true);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'index_unavailable');
    assert.equal(lstatSync(sidecar).ino, changedInode, 'refusal never repairs the changing file');
    assert.equal(changedInode === originalInode, change === 'wal');
    assert.equal(existsSync(sidecar + '-wal'), false);
    assert.equal(existsSync(sidecar + '-shm'), false);
  } finally { childProcess.spawnSync = spawn; syncBuiltinESMExports(); }
});

for (const change of ['replacement', 'file-protection', 'directory-protection', 'link-identity', 'wal']) test(`second concurrent header probe refuses ${change}`, async t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'memory.sqlite');
  const access = createContextReadAccess(ns, false, { maintenance: true });
  const core = openMemoryCore({ path, contextRead: { ...access.configuration, counter } });
  ok(core.admit({ namespace: ns, memory: { content: 'Synthetic telescope', kind: 'fact' }, receipts: [{ client: 'synthetic', sessionId: 'synthetic', eventId: 'synthetic', role: 'user', excerpt: 'telescope' }] }));
  ok(await access.call(core, 'refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } }));
  await core.close();
  const reader = openMemoryCore({ path, contextRead: { ...access.configuration, counter } }); workspace.defer(() => reader.close());
  const sidecar = path + '.context-read-v1.sqlite', spawn = childProcess.spawnSync;
  // Invalidate the header cache without altering its identity or protection.
  const initial = new DatabaseSync(sidecar); initial.exec('PRAGMA user_version=1'); initial.close();
  let probes = 0;
  childProcess.spawnSync = (command, args, options) => {
    const header = args[2]?.includes('PRAGMA journal_mode') && args[3]?.includes('.context-read-v1.sqlite');
    // Change the second child's input after the retry captured its baseline,
    // so its actual header result (including WAL refusal) sees the change.
    if (header && probes === 1) {
      if (change === 'replacement') renameSync(sidecar, sidecar + '.previous');
      if (change === 'file-protection') chmodSync(sidecar, 0o640);
      else if (change === 'directory-protection') chmodSync(workspace.path, 0o750);
      else if (change === 'link-identity') linkSync(sidecar, sidecar + '.linked');
      else { const writer = new DatabaseSync(sidecar); writer.exec(change === 'wal' ? 'PRAGMA journal_mode=WAL' : 'CREATE TABLE synthetic(value TEXT)'); writer.close(); }
    }
    const result = spawn(command, args, options);
    if (header && ++probes === 1) { const writer = new DatabaseSync(sidecar); writer.exec('PRAGMA user_version=2'); writer.close(); }
    return result;
  };
  syncBuiltinESMExports();
  try {
    const result = await access.call(reader, 'findCandidates', query);
    assert.equal(probes, 2); assert.equal(result.ok, false); assert.equal(result.error.code, 'index_unavailable');
  } finally { childProcess.spawnSync = spawn; syncBuiltinESMExports(); chmodSync(workspace.path, 0o700); }
});

for (const caller of ['managed', 'read-only']) test(`${caller} caller retains strict changing-header refusal`, t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'memory.sqlite');
  const db = new DatabaseSync(path); db.exec('CREATE TABLE synthetic(value TEXT)'); chmodSync(path, 0o600); workspace.defer(() => db.close());
  const spawn = childProcess.spawnSync; let probes = 0;
  childProcess.spawnSync = (command, args, options) => {
    const result = spawn(command, args, options);
    if (args[2]?.includes('PRAGMA journal_mode')) { probes++; db.exec('PRAGMA user_version=1'); }
    return result;
  };
  syncBuiltinESMExports();
  try {
    if (caller === 'managed') assert.throws(() => assertContextReadCanonicalDelete(path), /index_unavailable/);
    else assert.throws(() => openContextReadSidecar({ path, db, readOnly: true }), /index_unavailable/);
    assert.equal(probes, 1, 'strict caller never retries with concurrent writes allowed');
  } finally { childProcess.spawnSync = spawn; syncBuiltinESMExports(); }
});
