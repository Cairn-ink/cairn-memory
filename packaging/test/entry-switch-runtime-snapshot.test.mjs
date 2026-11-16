import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rename, lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runtimeSnapshot, classifyRuntimeHygiene } from './fixtures/entry-switch-installed.mjs';
import { localProcessIdentity } from '../../adapters/mcp/local-daemon-liveness.mjs';

const prefix = 'd-' + 'a'.repeat(32);
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'hygiene-snapshot-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
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
    assert.deepEqual(classifyRuntimeHygiene(result, await runtimeSnapshot(path)).errors, []);
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
  test(`ownerless ${suffix} ${JSON.stringify(value)} is exact through real parsing`, async t => {
    const path = await directory(t), file = join(path, prefix + suffix);
    await writeFile(file, value === '{malformed' ? value : JSON.stringify(value), { mode: 0o600 });
    const before = await runtimeSnapshot(path), after = await runtimeSnapshot(path);
    assert.equal(before.identities[0].owner, undefined);
    assert.equal(before.identities[0].alive, false);
    assert.deepEqual(classifyRuntimeHygiene(before, after).errors, []);
    await writeFile(file, 'changed-ownerless-record');
    const changed = classifyRuntimeHygiene(before, await runtimeSnapshot(path));
    assert.deepEqual(changed.errors, ['dead or ownerless foreign entry changed: ' + prefix + suffix]);
  });
}
