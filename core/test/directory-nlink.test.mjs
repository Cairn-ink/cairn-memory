import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, dirname } from 'node:path';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { openRawSearchStorage } from '../raw-search-storage.mjs';
import { contextReadDeleteJournal } from '../context-read-sidecar.mjs';
import { protectedDeleteJournal } from '../sqlite-journal-probe.mjs';
import { sourceFixture, savedSource } from '../testing/raw-source-fixtures.mjs';
import { searchFixture } from '../testing/raw-search-fixtures.mjs';
import { installRawSearchTestClock } from '../testing/raw-search-clock.mjs';
import { fixture, drain, request } from '../testing/context-read-fixture.mjs';

test.beforeEach(installRawSearchTestClock);

// Patch the builtin binding, including the imports at the actual comparison
// points. Regular-file stats are returned untouched. No production test hook.
function apfs(t) {
  const original = fs.lstatSync;
  const samples = [];
  fs.lstatSync = (path, options) => {
    const stat = original(path, options);
    if (stat.isDirectory()) {
      const count = 2 + fs.readdirSync(path).length;
      stat.nlink = typeof stat.nlink === 'bigint' ? BigInt(count) : count;
      samples.push({ path: String(path), nlink: Number(stat.nlink) });
    }
    return stat;
  };
  syncBuiltinESMExports();
  t.after(() => { fs.lstatSync = original; syncBuiltinESMExports(); });
  return samples;
}
async function raw(t) {
  const ws = createTestWorkspace(t), directory = join(ws.path, 'index');
  fs.mkdirSync(directory, { mode: 0o700 });
  const storage = await openRawSearchStorage({ directory,
    identity: { storeId: 'synthetic', fileIdentity: '1:2', ownerId: 'synthetic', readSet: [] },
    bind: (purpose, value) => createHmac('sha256', 'synthetic').update(JSON.stringify([purpose, value])).digest('base64url'),
    quotaBytes: 1024 * 1024 });
  ws.defer(() => storage.close());
  return { storage, directory, path: join(directory, fs.readdirSync(directory).find(name => name.endsWith('.sqlite'))) };
}
function sqlite(t) {
  const ws = createTestWorkspace(t), directory = join(ws.path, 'sidecar');
  fs.mkdirSync(directory, { mode: 0o700 });
  const path = join(directory, 'sidecar.sqlite'), db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=DELETE; CREATE TABLE synthetic(value); INSERT INTO synthetic VALUES(1)');
  fs.chmodSync(path, 0o600);
  ws.defer(() => db.close());
  return { ws, directory, path, db };
}
const proof = path => ({ main: fs.lstatSync(path, { bigint: true }),
  directory: fs.lstatSync(dirname(path), { bigint: true }), journal: fs.lstatSync(path + '-journal', { bigint: true }) });

test('APFS directory stats: Raw opens, indexes, searches, reopens and closes', async t => {
  const samples = apfs(t), f = sourceFixture(t);
  await savedSource(f, 'Synthetic copper telescope.');
  const s = await searchFixture(f);
  await s.maintain();
  assert.equal((await s.search({ query: 'copper' })).candidates.length, 1);
  await s.reopen();
  assert.equal((await s.search({ query: 'copper' })).candidates.length, 1);
  await s.service.close();
  const links = samples.filter(v => v.path === s.directory).map(v => v.nlink);
  assert.ok(new Set(links).size >= 2, 'real index creation changed simulated directory nlink');
});

test('APFS directory stats: real context-read sidecar and DELETE journal cycle pass', t => {
  apfs(t);
  const f = fixture(t); f.admit('Synthetic copper telescope.');
  const sidecar = f.index(); drain(sidecar);
  assert.equal(sidecar.lexical(request(), 'copper').length, 1);
  const path = f.path + '.context-read-v1.sqlite', db = new DatabaseSync(path);
  try {
    const before = { main: fs.lstatSync(path), directory: fs.lstatSync(dirname(path)) };
    db.exec('BEGIN IMMEDIATE; UPDATE generations SET sequence=sequence+1');
    assert.ok(fs.existsSync(path + '-journal'));
    assert.equal(contextReadDeleteJournal(path, undefined, before), true);
    const during = { main: fs.lstatSync(path), directory: fs.lstatSync(dirname(path)) };
    assert.equal(contextReadDeleteJournal(path, { journalRemainingMs() { db.exec('ROLLBACK'); return 5000; } }, during), true);
    assert.equal(fs.existsSync(path + '-journal'), false);
  } finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
});

test('APFS directory stats: protected DELETE proofs tolerate entry creation and deletion', t => {
  apfs(t); const f = sqlite(t);
  f.db.exec('BEGIN IMMEDIATE; UPDATE synthetic SET value=2');
  const before = proof(f.path), extra = join(f.directory, 'synthetic-entry');
  assert.equal(protectedDeleteJournal(before), true);
  fs.writeFileSync(extra, '', { mode: 0o600 });
  assert.notEqual(proof(f.path).directory.nlink, before.directory.nlink);
  assert.equal(protectedDeleteJournal(proof(f.path), before), true);
  fs.unlinkSync(extra);
  assert.equal(protectedDeleteJournal(proof(f.path), before), true);
  f.db.exec('ROLLBACK');
});

test('APFS directory stats: Raw refuses a replacement directory with a different inode', async t => {
  apfs(t); const f = await raw(t), old = f.directory + '-old';
  const inode = fs.lstatSync(f.directory).ino, fileInode = fs.lstatSync(f.path).ino;
  fs.renameSync(f.directory, old); fs.mkdirSync(f.directory, { mode: 0o700 });
  for (const name of fs.readdirSync(old)) fs.renameSync(join(old, name), join(f.directory, name));
  assert.notEqual(fs.lstatSync(f.directory).ino, inode);
  assert.equal(fs.lstatSync(f.path).ino, fileInode, 'file identity is preserved across the directory swap');
  await assert.rejects(f.storage.snapshot(), { code: 'unsafe_index_file' });
});

test('APFS directory stats: header and protected journal proofs refuse a directory inode swap', t => {
  apfs(t); const f = sqlite(t), old = f.directory + '-old';
  f.db.exec('BEGIN IMMEDIATE; UPDATE synthetic SET value=2');
  const before = proof(f.path);
  assert.equal(protectedDeleteJournal(before), true);
  assert.equal(contextReadDeleteJournal(f.path, undefined, before), true);
  f.db.exec('ROLLBACK');
  fs.renameSync(f.directory, old); fs.mkdirSync(f.directory, { mode: 0o700 });
  fs.renameSync(join(old, 'sidecar.sqlite'), f.path);
  assert.equal(fs.lstatSync(f.path, { bigint: true }).ino, before.main.ino);
  assert.notEqual(fs.lstatSync(f.directory, { bigint: true }).ino, before.directory.ino);
  assert.equal(contextReadDeleteJournal(f.path, undefined, before), false);
  fs.writeFileSync(f.path + '-journal', '', { mode: 0o600 });
  assert.equal(protectedDeleteJournal(proof(f.path), before), false);
});

test('APFS directory stats: Raw refuses a hard link added to the live index file', async t => {
  apfs(t); const f = await raw(t);
  fs.linkSync(f.path, f.path + '-hardlink');
  assert.equal(fs.lstatSync(f.path).nlink, 2);
  await assert.rejects(f.storage.snapshot(), { code: 'unsafe_index_file' });
});

for (const target of ['main', 'journal']) test(`APFS directory stats: ${target} file hard links retain journal refusal`, t => {
  apfs(t); const f = sqlite(t);
  f.db.exec('BEGIN IMMEDIATE; UPDATE synthetic SET value=2');
  const before = proof(f.path), path = f.path + (target === 'journal' ? '-journal' : '');
  assert.equal(protectedDeleteJournal(before), true);
  fs.linkSync(path, path + '-hardlink');
  assert.equal(fs.lstatSync(path).nlink, 2);
  assert.equal(protectedDeleteJournal(proof(f.path), before), false);
  if (target === 'main') assert.equal(contextReadDeleteJournal(f.path, undefined, before), false);
  fs.unlinkSync(path + '-hardlink'); f.db.exec('ROLLBACK');
});
