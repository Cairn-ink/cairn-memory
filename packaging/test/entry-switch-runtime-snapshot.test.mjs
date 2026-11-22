import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rename, lstat, rm, link, symlink, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runtimeSnapshot, classifyRuntimeHygiene } from './fixtures/entry-switch-installed.mjs';
import { localProcessIdentity } from '../../adapters/mcp/local-daemon-liveness.mjs';
import { runtimeDirectory } from '../../adapters/mcp/local-daemon-state.mjs';

const prefix = 'd-' + 'a'.repeat(32);
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'hygiene-snapshot-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('snapshot records log bytes through the bounded private log reader', async t => {
  const root = await directory(t), dir = await runtimeDirectory({ root }), content = 'daemon_ready\ndaemon_exit\n';
  await writeFile(join(dir.path, prefix + '.log'), content, { mode: 0o600 });
  const result = await runtimeSnapshot(dir.path);
  assert.ok(result.entries.find(e => e.name === prefix + '.log').content === content, 'log content recorded privately');
});

test('snapshot retries a log rename and records its matching metadata and bytes', async t => {
  const root = await directory(t), dir = await runtimeDirectory({ root }), file = join(dir.path, prefix + '.log'), attempts = [];
  await writeFile(file, 'daemon_ready\n', { mode: 0o600 });
  const result = await runtimeSnapshot(dir.path, [], { afterMetadata: async ({ attempt }) => {
    attempts.push(attempt);
    if (attempt !== 1) return;
    await writeFile(file + '.replacement', 'daemon_ready\ndaemon_exit\n', { mode: 0o600 });
    await rename(file + '.replacement', file);
  } });
  assert.deepEqual(attempts, [1, 2]);
  const log = result.entries.find(e => e.name === prefix + '.log');
  assert.equal(log.inode, String((await lstat(file, { bigint: true })).ino));
  assert.ok(log.content === 'daemon_ready\ndaemon_exit\n', 'matching log bytes');
  assert.equal(BigInt(log.size), BigInt(Buffer.byteLength(log.content)));
});

for (const [kind, code] of [['mode', 'daemon_entry_mode'], ['links', 'daemon_entry_links'],
  ['symlink', 'daemon_entry_type'], ['directory', 'daemon_entry_type'], ['oversized', 'daemon_entry_changed']]) {
  test(`snapshot private log reader refuses ${kind} by code only`, async t => {
    const root = await directory(t), dir = await runtimeDirectory({ root }), file = join(dir.path, prefix + '.log');
    if (kind === 'directory') {
      // Rename an existing empty directory into the typed log name.
      const empty = await mkdtemp(join(root, 'empty-')); await rename(empty, file);
    } else if (kind === 'symlink') await symlink(join(root, 'absent'), file);
    else {
      await writeFile(file, kind === 'oversized' ? 'x'.repeat(262145) : 'daemon_ready\n', { mode: 0o600 });
      if (kind === 'mode') await chmod(file, 0o644);
      if (kind === 'links') await link(file, join(dir.path, prefix + '.extra-link'));
    }
    await assert.rejects(runtimeSnapshot(dir.path), error => {
      assert.equal(error.code, code); assert.equal(error.message, code); return true;
    });
  });
}
const publish = (path, suffix, owner) => writeFile(join(path, prefix + suffix),
  JSON.stringify(suffix === '.json' ? { owner } : owner), { mode: 0o600 });

for (const suffix of ['.json', '.lock']) {
  test(`snapshot retries ${suffix} replacement and pairs successor metadata with its owner`, async t => {
    const path = await directory(t), owner = localProcessIdentity(), predecessor = { ...owner, start: owner.start + '0' };
    await publish(path, suffix, predecessor);
    const sampled = await lstat(join(path, prefix + suffix), { bigint: true }), attempts = [];
    const result = await runtimeSnapshot(path, [], { afterMetadata: async ({ attempt }) => {
      attempts.push(attempt);
      if (attempt !== 1) return;
      await publish(path, suffix + '.replacement', owner);
      // The descriptor's replacement must have descriptor shape too.
      if (suffix === '.json') await writeFile(join(path, prefix + suffix + '.replacement'), JSON.stringify({ owner }));
      await rename(join(path, prefix + suffix + '.replacement'), join(path, prefix + suffix));
    } });
    assert.deepEqual(attempts, [1, 2]);
    const current = await lstat(join(path, prefix + suffix), { bigint: true });
    assert.notEqual(current.ino, sampled.ino);
    assert.equal(result.entries.find(e => e.name === prefix + suffix).inode, String(current.ino));
    assert.deepEqual(result.identities[0].owner, owner);
    assert.equal(result.identities[0].alive, true);
    const classification = classifyRuntimeHygiene(result, await runtimeSnapshot(path));
    assert.deepEqual(classification.errors, []);
    assert.ok(classification.diagnostics.includes('foreign identity live: ' + prefix));
  });
}

test('snapshot fails by code only after three unstable generations', async t => {
  const path = await directory(t), owner = localProcessIdentity(), attempts = [];
  await publish(path, '.lock', owner);
  await assert.rejects(runtimeSnapshot(path, [], { afterMetadata: async ({ attempt }) => {
    attempts.push(attempt);
    await publish(path, '.lock.replacement', owner);
    await rename(join(path, prefix + '.lock.replacement'), join(path, prefix + '.lock'));
  } }), error => {
    assert.equal(error.code, 'runtime_snapshot_changed');
    assert.equal(error.message, 'runtime_snapshot_changed');
    return true;
  });
  assert.deepEqual(attempts, [1, 2, 3]);
});

for (const suffix of ['.lock', '.json']) for (const value of [{}, null, [], 7, 'ownerless', { owner: {} },
  { pid: 1 }, { owner: { pid: 1 } }, '{malformed']) {
  test(`ownerless ${suffix} ${JSON.stringify(value)} is classified through real parsing`, async t => {
    const path = await directory(t), file = join(path, prefix + suffix);
    await writeFile(file, value === '{malformed' ? value : JSON.stringify(value), { mode: 0o600 });
    const before = await runtimeSnapshot(path), after = await runtimeSnapshot(path);
    assert.equal(before.identities[0].owner, undefined);
    assert.equal(before.identities[0].alive, false);
    const unchanged = classifyRuntimeHygiene(before, after);
    assert.deepEqual(unchanged.errors, []);
    assert.ok(unchanged.diagnostics.includes('foreign identity ownerless: ' + prefix));
    await writeFile(file, 'changed-ownerless-record');
    const changed = classifyRuntimeHygiene(before, await runtimeSnapshot(path));
    assert.deepEqual(changed.errors, []);
    assert.ok(changed.diagnostics.includes('dead or ownerless foreign entry changed: ' + prefix + suffix));
  });
}

 test('lossy UTF-8 foreign prefixes are diagnosed through real snapshots without exposing content', async t => {
  const root = await directory(t), dir = await runtimeDirectory({ root }), file = join(dir.path, prefix + '.log');
  await writeFile(file, Buffer.from([0xf0, 0x90, 0x80, 0x0a]), { mode: 0o600 });
  const before = await runtimeSnapshot(dir.path);
  await writeFile(file + '.replacement', Buffer.concat([Buffer.from([0xf0, 0x90, 0x81, 0x0a]), Buffer.from('daemon_ready\n')]), { mode: 0o600 });
  await rename(file + '.replacement', file);
  const result = classifyRuntimeHygiene(before, await runtimeSnapshot(dir.path));
  assert.deepEqual(result.errors, []);
  assert.ok(result.diagnostics.includes('foreign log changed invalidly: ' + prefix + '.log'), 'non-ASCII foreign log diagnosed');
});
