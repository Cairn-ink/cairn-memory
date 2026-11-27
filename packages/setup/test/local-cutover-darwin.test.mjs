import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { lstatSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { chmod, cp, mkdir, readFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { privateList, privateRead, privateWrite, syncDirectory } from '../../../integrations/client/private-state.mjs';
import { buildCoreLocalCandidate } from '../../../packaging/build-core-local.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { byteDigest, createLegacyBackup, verifyLegacyBackupAgainstSource } from '../../adapter-sqlite/src/legacy/backup.mjs';
import { editFixture, fixture, quiescence } from '../../adapter-sqlite/test/legacy/fixtures.mjs';
import { darwinExclusion } from '../lib/local-cutover-darwin.mjs';
import { cutoverRefusal as refuse, localCutoverExclusion } from '../lib/local-cutover-lease.mjs';
import { runLocalCutover } from '../lib/local-cutover.mjs';
import { readDescriptor } from '../lib/local-descriptor.mjs';
import { assertRecordedEngine, installerFixture, realDaemonEngine } from './daemon-installer-fixture.mjs';
import { assertFixtureClients } from './fixture-clients.mjs';

const mac = { skip: process.platform !== 'darwin', timeout: 90_000 };
const tombstone = 'Synthetic retired-store marker.\n';
const inode = path => {
  const { dev, ino } = lstatSync(path, { bigint: true });
  return [dev, ino].join(':');
};

async function retirementFixture(t) {
  const dir = createTestWorkspace(t).path;
  const { path: source, storeId } = await fixture(dir, 18);
  await chmod(source, 0o600);
  const retired = join(dir, '.retired'), backupDirectory = join(dir, 'backup');
  const expectedStoreId = storeId;
  const backup = { backupDirectory, expectedStoreId, quiescence };
  const proof = await createLegacyBackup({ ...backup, path: source });
  const sourceDigest = byteDigest(source);
  const receipt = { source: inode(source), phase: 'exchanging' };
  // Use the same backup verifier and source-byte check as confirmation.
  const proveRetired = (path, assertLease) => {
    if (byteDigest(path) !== sourceDigest) throw refuse('legacy_backup_stale');
    const actual = verifyLegacyBackupAgainstSource({ ...backup, path });
    assert.deepEqual(actual, proof);
    assertLease();
  };
  const options = { source, retired, tombstone, receipt, drain() {}, proveRetired, syncDirectory,
    state: { privateList, privateRead, privateWrite },
    assertTombstone: path => assert.equal(readFileSync(path, 'utf8'), tombstone),
    assertSiblings() {}, async advance(phase) { receipt.phase = phase; },
    async notify() {}, async reclaim() {} };
  return { options, source, retired, sourceDigest };
}

test('the macOS provider requires both daemon stop and exit verification', () => {
  const provider = darwinExclusion(refuse);
  const result = value => ({ code: 0, stdout: JSON.stringify(value) });
  const stopped = () => result({ still_running: 0 }), calls = [];
  provider.drainDaemon(() => { calls.push('stop'); return stopped(); },
    () => { calls.push('status'); return result({ daemons: [{ running: false }] }); });
  assert.deepEqual(calls, ['stop', 'status']);
  assert.throws(() => provider.drainDaemon(stopped, () => result({ daemons: [{ running: true }] })),
    { code: 'cutover_daemon_busy' });
  assert.throws(() => provider.drainDaemon(() => result({ still_running: 1 }), assert.fail),
    { code: 'cutover_daemon_busy' });
  const unsupported = () => ({ code: 0, stdout: 'daemon_platform\n' });
  provider.drainDaemon(unsupported, unsupported);
  assert.throws(() => provider.drainDaemon(unsupported, () => ({ code: 1 })), { code: 'cutover_daemon_unavailable' });
});

test('an open store or companion refuses before retirement and an uncertain scan fails closed', async t => {
  const { options, source, retired, sourceDigest } = await retirementFixture(t);
  const suffixes = ['', '-wal', '-shm', '-journal'];
  for (const suffix of suffixes.slice(1)) writeFileSync(source + suffix, '', { mode: 0o600 });
  let openPath;
  const provider = darwinExclusion(refuse, { closed(paths) {
    assert.deepEqual(paths, suffixes.map(suffix => source + suffix));
    return !paths.includes(openPath);
  } });
  for (const suffix of suffixes) {
    openPath = source + suffix;
    await assert.rejects(provider.retireLegacy(options), { code: 'cutover_busy' });
  }
  const uncertain = darwinExclusion(refuse, { closed() {} });
  await assert.rejects(uncertain.retireLegacy(options), { code: 'cutover_exclusion_unavailable' });
  assert.equal(byteDigest(source), sourceDigest);
  assert.throws(() => lstatSync(retired), { code: 'ENOENT' });
});

test('a writer opening after the final closed check and before rename is detected and its write survives rollback', async t => {
  const { options, source, retired, sourceDigest } = await retirementFixture(t);
  const events = [];
  const provider = darwinExclusion(refuse, {
    closed(paths) { events.push(paths.includes(retired) ? 'retired-check' : 'source-check'); return true; },
    rename(from, to) {
      if (from === retired + '.fence') {
        assert.equal(events.at(-1), 'source-check');
        editFixture(source, db => db.exec('CREATE TABLE late_write (value TEXT); INSERT INTO late_write VALUES (\'preserve\');'));
        events.push('late-write');
      }
      renameSync(from, to);
    },
  });
  const prove = options.proveRetired;
  options.proveRetired = (path, check) => {
    if (path === retired) events.push('retired-proof');
    return prove(path, check);
  };
  await assert.rejects(provider.retireLegacy(options), { code: 'legacy_backup_stale' });
  assert.ok(events.indexOf('late-write') < events.indexOf('retired-proof'));
  assert.equal(options.receipt.phase, 'exchanging');
  assert.equal(readFileSync(source, 'utf8'), tombstone);
  assert.notEqual(byteDigest(retired), sourceDigest);
  await provider.abortRetirement({ ...options, async reclaim() {
    assert.equal(readFileSync(source, 'utf8'), tombstone);
  } });
  assert.equal(inode(source), options.receipt.source);
  assert.equal(editFixture(source, db => db.prepare('SELECT value FROM late_write').get().value), 'preserve');
  assert.throws(() => lstatSync(retired), { code: 'ENOENT' });
});

function crashProvider(options, action, point, addCompanions) {
  const input = { source: options.source, retired: options.retired, receipt: options.receipt, point, action, addCompanions };
  const script = `
    import { renameSync, writeFileSync } from 'node:fs';
    import { privateList, privateRead, privateWrite, syncDirectory } from ${JSON.stringify(new URL('../../../integrations/client/private-state.mjs', import.meta.url).href)};
    import { darwinExclusion } from ${JSON.stringify(new URL('../lib/local-cutover-darwin.mjs', import.meta.url).href)};
    const { source, retired, receipt, point, action, addCompanions } = JSON.parse(process.argv[1]);
    const provider = darwinExclusion(code => Object.assign(new Error(code), { code }), {
      closed: () => true,
      rename(from, to) {
        if (addCompanions && from === retired + '.fence') {
          for (const suffix of ['-wal', '-shm']) writeFileSync(source + suffix, suffix, { mode: 0o600 });
        }
        renameSync(from, to);
      },
    });
    await provider[action]({ source, retired, receipt, syncDirectory, tombstone: ${JSON.stringify(tombstone)},
      state: { privateList, privateRead, privateWrite },
      drain() {}, proveRetired() {}, assertTombstone() {}, assertSiblings() {}, async reclaim() {},
      advance() { throw new Error('unexpected_seal'); },
      async notify(state) { if (state === point) process.kill(process.pid, 'SIGKILL'); },
    });
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(input)],
    { env: {}, encoding: 'utf8', timeout: 15_000 });
  assert.ifError(child.error);
  assert.equal(child.signal, 'SIGKILL', child.stderr);
}

test('SIGKILL with both legacy links resumes confirmation without changing the retired bytes', async t => {
  const { options, source, retired } = await retirementFixture(t);
  crashProvider(options, 'retireLegacy', 'activation-darwin-source-linked', false);
  assert.equal(inode(source), inode(retired));
  const provider = darwinExclusion(refuse, { closed: () => true });
  await provider.retireLegacy(options);
  assert.equal(options.receipt.phase, 'sealed');
  assert.equal(readFileSync(source, 'utf8'), tombstone);
  assert.throws(() => lstatSync(retired), { code: 'ENOENT' });
});

for (const point of ['activation-darwin-companion-restored', 'activation-darwin-source-restored']) {
  test(`SIGKILL during ${point} restores the original inode and both companions on retry`, async t => {
    const { options, source, retired, sourceDigest } = await retirementFixture(t);
    crashProvider(options, 'retireLegacy', 'activation-darwin-companion-retired', true);
    assert.equal(readFileSync(retired + '-wal', 'utf8'), '-wal');
    assert.equal(readFileSync(source + '-shm', 'utf8'), '-shm');
    const provider = darwinExclusion(refuse, { closed: () => true });
    await assert.rejects(provider.retireLegacy(options), { code: 'legacy_backup_stale' });
    crashProvider(options, 'abortRetirement', point, false);
    await provider.abortRetirement(options);
    assert.equal(inode(source), options.receipt.source);
    assert.equal(byteDigest(source), sourceDigest);
    for (const suffix of ['-wal', '-shm']) {
      assert.equal(readFileSync(source + suffix, 'utf8'), suffix);
      assert.throws(() => lstatSync(retired + suffix), { code: 'ENOENT' });
    }
  });
}

test('native macOS lsof refuses an external handle on each exact store pathname', mac, async t => {
  const { source } = await retirementFixture(t);
  const provider = localCutoverExclusion();
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const path = source + suffix;
    if (suffix) writeFileSync(path, '', { mode: 0o600 });
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { openSync } from 'node:fs';
      openSync(process.argv[1], 'r');
      process.stdout.write('ready\\n');
      process.stdin.resume();
    `, path], { env: {}, stdio: ['pipe', 'pipe', 'inherit'] });
    const exit = once(child, 'close');
    try {
      await Promise.race([once(child.stdout, 'data'), exit.then(() => assert.fail('fixture holder exited'))]);
      await assert.rejects(provider.withColdStoreLease(source, assert.fail), { code: 'cutover_busy' });
    } finally {
      child.stdin.end();
      assert.deepEqual(await exit, [0, null]);
    }
    if (suffix) await unlink(path);
  }
  await provider.withColdStoreLease(source, check => check());
});

test('native macOS confirmation recovers a killed setup, fences the legacy path and switches the recorded client', mac, async t => {
  const dir = createTestWorkspace(t).path;
  const { path: database } = await fixture(dir, 18);
  await chmod(database, 0o600);
  const installed = await installerFixture(t, { db: database });
  await installed.setEngine(realDaemonEngine());
  const out = join(dir, 'candidate');
  const manifest = buildCoreLocalCandidate(out);
  const unpack = spawnSync('/usr/bin/tar', ['-xzf', join(out, manifest.archive.filename), '-C', out],
    { env: {}, encoding: 'utf8', timeout: 15_000 });
  assert.ifError(unpack.error);
  assert.equal(unpack.status, 0, unpack.stderr);
  const modules = join(installed.root, 'engine', manifest.engineId, 'app', 'node_modules');
  await mkdir(modules, { mode: 0o700, recursive: true });
  await cp(join(out, 'package'), join(modules, manifest.package.name), { recursive: true });
  const { env, root } = installed;
  const options = { env, root, manifest };
  const { claude } = assertFixtureClients(env, dirname(installed.home));
  const runClaude = args => spawnSync(claude, args, { env, encoding: 'utf8', timeout: 5000 });
  const context = { runClaude, t: key => key, write: Object.assign(() => {}, { literal() {} }) };
  const run = (action, onCheckpoint) => runLocalCutover({ ...options, action, context, onCheckpoint });
  assert.equal((await run('prepare-activation')).state, 'verified');
  const originalInode = inode(database);
  const configPath = join(installed.home, '.claude.json');
  const originalConfig = await readFile(configPath);
  await assert.rejects(run('confirm-activation', state => {
    if (state === 'activation-darwin-source-linked') editFixture(database, db => db.exec('CREATE TABLE late_write (id)'));
  }), { params: { code: 'legacy_backup_stale' } });
  assert.equal((await readDescriptor(root)).version, 'cairn-local-installation-v1');
  assert.equal(inode(database), originalInode);
  assert.deepEqual(await readFile(configPath), originalConfig);
  editFixture(database, db => db.exec('DROP TABLE late_write'));
  assert.equal((await run('prepare-activation')).state, 'verified');
  const { cutover } = (await readDescriptor(root, { allowV2: true })).migration;
  const original = await readFile(database);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { spawnSync } from 'node:child_process';
    import { runLocalCutover } from ${JSON.stringify(new URL('../lib/local-cutover.mjs', import.meta.url).href)};
    const { options, claude } = JSON.parse(process.argv[1]);
    const runClaude = args => spawnSync(claude, args, { env: options.env, encoding: 'utf8', timeout: 5000 });
    await runLocalCutover({ ...options, action: 'confirm-activation',
      context: { runClaude, t: key => key, write: Object.assign(() => {}, { literal() {} }) },
      onCheckpoint(state) { if (state === 'activation-darwin-source-linked') process.kill(process.pid, 'SIGKILL'); },
    });
  `, JSON.stringify({ options, claude })], { env: {}, encoding: 'utf8', timeout: 45_000 });
  assert.ifError(child.error);
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  assert.deepEqual(await readFile(database), original);
  const outcome = await run('confirm-activation', state => {
    if (state !== 'activation-source-exchanged') return;
    const db = new DatabaseSync(database);
    try { assert.throws(() => db.exec('CREATE TABLE must_refuse (id)'), /not a database/u); }
    finally { db.close(); }
  });
  assert.equal(outcome.state, 'active');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(config.mcpServers['cairn-local'].args[2], outcome.targetPath);
  await assert.rejects(readFile(join(dirname(database), '.cairn-retired-' + cutover.attemptId)), { code: 'ENOENT' });
  await assert.rejects(readFile(join(root, '.cutover-' + cutover.id, 'backup-' + cutover.attemptId, 'store.sqlite')), { code: 'ENOENT' });
  const calls = await installed.calls();
  assert.ok(calls.length >= 4);
  for (const [index, call] of calls.entries()) assertRecordedEngine(call, installed, index % 2 === 0 ? 'stop' : 'status');
});
