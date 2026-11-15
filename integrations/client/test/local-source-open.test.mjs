import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, symlink, link, rename, unlink, open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { openLocalSource, withLocalSourceOpenCheckpoint } from '../raw/local-source-open.mjs';
import { readBytes, withSourceReadObserver } from '../../codex/source.mjs';

const darwinOnly = { skip: process.platform !== 'darwin' && 'Darwin ancestor race checkpoints require the macOS walk; Linux delegates to fd-relative openSource.' };
async function tree(t) {
  const ws = createTestWorkspace(t, { prefix: 'local-source-open-' });
  // macOS temporary roots can be reached through a system symlink.
  const root = await realpath(ws.path), parent = join(root, 'one/two/three');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const path = join(parent, 'transcript.jsonl');
  await writeFile(path, 'synthetic transcript\n', { mode: 0o600 });
  return { root, path, parent };
}
async function refusedWithoutReads(work) {
  const reads = [];
  await withSourceReadObserver(value => reads.push(value), () => assert.rejects(work));
  assert.deepEqual(reads, [], 'no transcript bytes, including link-target bytes, may be read');
}
for (const position of ['one', 'one/two', 'one/two/three', 'one/two/three/transcript.jsonl']) {
  test(`local opener refuses persistent symlink at ${position} without reading its target`, async t => {
    const f = await tree(t), path = join(f.root, position);
    const probe = await open(f.path), identity = await probe.stat(), prototype = Object.getPrototypeOf(probe), read = prototype.read;
    await probe.close();
    let targetReads = 0;
    t.mock.method(prototype, 'read', async function (...args) {
      const current = await this.stat();
      if (current.dev === identity.dev && current.ino === identity.ino) targetReads++;
      return read.apply(this, args);
    });
    await rename(path, path + '.original'); await symlink(path + '.original', path);
    await refusedWithoutReads(async () => { const file = await openLocalSource(f.path); try { await readBytes(file, 0, 1); } finally { await file.close(); } });
    assert.equal(targetReads, 0, 'observer on the link-target inode records zero reads');
  });
}
test('local opener refuses directories and FIFOs without blocking', { timeout: 5000 }, async t => {
  const f = await tree(t);
  await refusedWithoutReads(() => openLocalSource(f.parent));
  const fifo = join(f.root, 'fifo');
  const result = spawnSync('mkfifo', [fifo], { timeout: 2000 });
  assert.equal(result.status, 0); assert.equal(result.error, undefined);
  await refusedWithoutReads(() => openLocalSource(fifo));
});
test('local opener refuses a different uid and unsafe file size', async t => {
  const f = await tree(t), uid = process.getuid();
  const owner = t.mock.method(process, 'getuid', () => uid + 1);
  await refusedWithoutReads(() => openLocalSource(f.path)); owner.mock.restore();
  const probe = await open(f.path), prototype = Object.getPrototypeOf(probe), stat = prototype.stat;
  await probe.close();
  t.mock.method(prototype, 'stat', async function (...args) {
    const value = await stat.apply(this, args);
    if (value.isFile()) value.size = Number.MAX_SAFE_INTEGER + 1;
    return value;
  });
  await refusedWithoutReads(() => openLocalSource(f.path));
});
test('local opener permits user-owned hardlinks, matching Linux', async t => {
  const f = await tree(t), alias = join(f.root, 'hardlink'); await link(f.path, alias);
  const file = await openLocalSource(alias);
  try { assert.equal((await readBytes(file, 0, 20)).toString(), 'synthetic transcript'); }
  finally { await file.close(); }
});
test('local opener validates absolute normalized bounded paths without NUL', async () => {
  for (const path of [null, 'relative', '/one/../two', '/one//two', '/bad\0path', '/' + 'x'.repeat(8192)])
    await assert.rejects(() => openLocalSource(path), /invalid_source_path/);
});
for (const depth of [1, 2, 3]) for (const restore of [false, true]) {
  test(`Darwin refuses ancestor ${depth} swap${restore ? ' and restore' : ''}`, darwinOnly, async t => {
    const f = await tree(t), ancestor = join(f.root, ...['one', 'two', 'three'].slice(0, depth));
    const attack = join(f.root, 'attack'), tail = ['one', 'two', 'three'].slice(depth);
    await mkdir(join(attack, ...tail), { recursive: true, mode: 0o700 });
    await writeFile(join(attack, ...tail, 'transcript.jsonl'), 'synthetic attack\n');
    let swapped = false;
    const reads = [];
    await withSourceReadObserver(value => reads.push(value), () => withLocalSourceOpenCheckpoint(async (phase, context) => {
      if (phase === 'ancestor' && context.path === f.parent) {
        await rename(ancestor, ancestor + '.original'); await symlink(attack, ancestor); swapped = true;
      }
      if (phase === 'opened' && restore && swapped) {
        await unlink(ancestor); await rename(ancestor + '.original', ancestor); swapped = false;
      }
    }, () => assert.rejects(() => openLocalSource(f.path), /source_changed/)));
    assert.deepEqual(reads, []);
    if (swapped) { await unlink(ancestor); await rename(ancestor + '.original', ancestor); }
  });
}
