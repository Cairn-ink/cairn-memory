import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { STORAGE_BUSY_TIMEOUT_MS } from '../database.mjs';
import { openMemoryCore, openContextReader } from '../index.mjs';
import { assemblyFixture, assemblyQuery, counter, ns, ok } from '../testing/context-read-assembly-fixture.mjs';
import { denied, mutateProcess, query, receipt } from '../testing/context-read-core-fixture.mjs';
import { observeDatabaseFiles } from '../testing/context-read-fixture.mjs';

const sidecar = path => path + '.context-read-v1.sqlite';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function diskSnapshot(path) {
  return Object.fromEntries([path, sidecar(path)].flatMap(file => ['', '-journal', '-wal', '-shm'].map(suffix => file + suffix))
    .filter(existsSync).map(file => [basename(file), hash(readFileSync(file))]));
}
function ddl(path) {
  const db = new DatabaseSync(path, { readOnly: true, timeout: STORAGE_BUSY_TIMEOUT_MS });
  try { return db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(); }
  finally { db.close(); }
}
function copied(f, name) {
  const path = join(f.workspace.path, name + '.sqlite');
  copyFileSync(f.path, path); copyFileSync(sidecar(f.path), sidecar(path));
  return { ...f, path };
}
async function assemblyAttempt(f, mode, storeId, config = f.config) {
  let core;
  try {
    core = mode === 'read-only' ? openContextReader({ path: f.path, contextRead: config }) :
      openMemoryCore({ path: f.path, contextRead: config, existingStore: { version: 'schema30-existing-v1', storeId } });
    return await f.trusted.call(core, 'contextRead', assemblyQuery());
  } catch (error) { return { ok: false, error: { code: error.code } }; }
  finally { core?.close(); }
}
function matrixFixture(t) {
  const authority = { authorize() { return null; }, isCurrent() { return null; } };
  const f = assemblyFixture(t, { coreOptions: { methodPackages: { version: 'method-packages-local-v1', storage: 'local-plain-v1', authority } } });
  const memory = f.admit('assembly canonical matrix');
  return { f, memory };
}

test('A10 both read-only assembly openers refuse canonical and sidecar hazards without files or DDL changes', async t => {
  const { f, memory } = matrixFixture(t);
  ok(await f.call('contextRead', assemblyQuery()));
  const expectedDDL = ddl(f.path), storeId = f.db.prepare('SELECT store_id FROM store_metadata').get().store_id;
  const cases = [
    ...['canonical', 'sidecar'].flatMap(location => ['-journal', '-wal', '-shm'].map(suffix => ({ name: location + suffix, location, suffix }))),
    ...['canonical', 'sidecar'].map(location => ({ name: location + '-wal-header', location, header: true })),
    { name: 'missing-sidecar' }, { name: 'mismatched-sidecar' }, { name: 'stale-sidecar' },
  ];
  for (const mode of ['read-only', 'managed']) for (const scenario of cases) await t.test(mode + ': ' + scenario.name, async () => {
    const selected = copied(f, mode + '-' + scenario.name);
    const location = scenario.location === 'canonical' ? selected.path : sidecar(selected.path);
    let restore = () => {};
    if (scenario.suffix) {
      writeFileSync(location + scenario.suffix, Buffer.alloc(1024, 1), { mode: 0o600 });
      restore = () => unlinkSync(location + scenario.suffix);
    } else if (scenario.header) {
      const original = readFileSync(location), writer = new DatabaseSync(location, { timeout: STORAGE_BUSY_TIMEOUT_MS });
      try { assert.equal(writer.prepare('PRAGMA journal_mode=WAL').get().journal_mode, 'wal'); }
      finally { writer.close(); }
      assert.equal(readFileSync(location)[18], 2);
      assert.equal(existsSync(location + '-wal'), false); assert.equal(existsSync(location + '-shm'), false);
      restore = () => writeFileSync(location, original);
    } else if (scenario.name === 'missing-sidecar') unlinkSync(sidecar(selected.path));
    else if (scenario.name === 'mismatched-sidecar') {
      const writer = new DatabaseSync(sidecar(selected.path), { timeout: STORAGE_BUSY_TIMEOUT_MS });
      try { writer.prepare('UPDATE generations SET store_id=?').run('synthetic-other-store'); }
      finally { writer.close(); }
    } else {
      // Reuse U5a's independent canonical writer and checked subprocess runner.
      await mutateProcess(selected, { method: 'correct', input: { namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
        content: 'assembly stale sidecar', kind: 'fact', receipt: receipt('matrix-stale') } });
    }
    const before = diskSnapshot(selected.path);
    try {
      // U5a's process helper probes the inherited opener/search refusal. The
      // assembly attempt uses the same state with its trusted counter supplied.
      const observed = await observeDatabaseFiles(selected, async () => {
        const code = scenario.suffix === '-journal' ? 'storage_busy' : 'index_unavailable';
        const candidates = await mutateProcess(selected, { mode, storeId, method: 'findCandidates', input: query({ query: 'assembly' }), envelope: true });
        denied(candidates, code);
        const assembly = await assemblyAttempt(selected, mode, storeId);
        denied(assembly, code);
        if (scenario.suffix === '-journal') {
          assert.deepEqual(candidates.error, { code }, 'the opener error envelope carries only code');
          assert.deepEqual(assembly.error, { code }, 'the opener error envelope carries only code');
        }
      });
      assert.deepEqual(observed.events, [], 'read-only paths create, change or delete no database files');
      assert.deepEqual(diskSnapshot(selected.path), before, 'canonical, sidecar and auxiliary bytes are untouched');
    } finally { restore(); }
    assert.deepEqual(ddl(selected.path), expectedDDL);
  });
});

test('A10 auxiliary arrival during counting refuses in both opener modes without reader filesystem effects', async t => {
  const { f } = matrixFixture(t);
  ok(await f.call('contextRead', assemblyQuery()));
  const expectedDDL = ddl(f.path), storeId = f.db.prepare('SELECT store_id FROM store_metadata').get().store_id;
  for (const mode of ['read-only', 'managed']) for (const location of ['canonical', 'sidecar']) await t.test(mode + ': ' + location, async () => {
    const selected = copied(f, mode + '-during-count-' + location);
    const auxiliary = (location === 'canonical' ? selected.path : sidecar(selected.path)) + '-journal';
    const content = Buffer.alloc(1024, 1);
    // Positive control measures only the test writer's intentional arrival.
    // The identical events must be the entire observation during assembly.
    const control = await observeDatabaseFiles(selected, () => writeFileSync(auxiliary, content, { mode: 0o600 }));
    assert.ok(control.events.length > 0);
    assert.ok(control.events.every(([, name]) => name === basename(auxiliary)));
    unlinkSync(auxiliary);
    const before = diskSnapshot(selected.path);
    let injected = false, calls = 0;
    const config = { ...f.config, counter: { id: 'auxiliary-during-count', countTokens(text) {
      calls++;
      if (!injected) { injected = true; writeFileSync(auxiliary, content, { mode: 0o600 }); }
      return counter.countTokens(text);
    } } };
    try {
      const observed = await observeDatabaseFiles(selected, async () => {
        const result = await assemblyAttempt(selected, mode, storeId, config);
        denied(result, 'storage_busy');
        assert.equal(result.error.retryable, true);
      });
      assert.equal(injected, true); assert.ok(calls > 0);
      assert.deepEqual(observed.events, control.events, 'no reader events beyond the controlled test-writer arrival');
      assert.deepEqual(diskSnapshot(selected.path), { ...before, [basename(auxiliary)]: hash(content) });
    } finally { if (existsSync(auxiliary)) unlinkSync(auxiliary); }
    assert.deepEqual(ddl(selected.path), expectedDDL);
  });
});
