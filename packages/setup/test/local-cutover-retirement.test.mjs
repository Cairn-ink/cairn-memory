import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { abortRetirement, beginActivation, readActivation, retireLegacy } from '../lib/local-cutover-retirement.mjs';

const marker = 'Synthetic cache contains the oriole checklist.';
const targetIdentity = '1:2';
const linux = { skip: process.platform !== 'linux' };

async function fixture(t) {
  const directory = createTestWorkspace(t).path;
  const maintenance = join(directory, 'maintenance');
  await mkdir(maintenance, { mode: 0o700 });
  const sourcePath = join(directory, 'memory.sqlite');
  const cutover = { sourcePath, attemptId: randomUUID() };
  const raw = sourcePath + '.raw-search';
  const shard = join(raw, 'namespace');
  const stage = join(directory, '.memory.sqlite.context-read-v1.sqlite.cairn-create-1-' + randomUUID());
  await mkdir(raw, { mode: 0o700 });
  await mkdir(shard, { mode: 0o700 });
  const sqlitePaths = [sourcePath, join(shard, 'index.raw-search.sqlite'), sourcePath + '.context-read-v1.sqlite',
    sourcePath + '.context-read-product-v1.1.sqlite', stage];
  for (const path of sqlitePaths) {
    const db = new DatabaseSync(path);
    try {
      db.exec('CREATE TABLE obsolete_projection (body TEXT NOT NULL)');
      db.prepare('INSERT INTO obsolete_projection VALUES (?)').run(marker);
    } finally { db.close(); }
    await chmod(path, 0o600);
  }
  const companion = sourcePath + '.context-read-product-v1.1.sqlite-journal';
  await writeFile(companion, marker, { mode: 0o600 });
  const prove = (_path, assertLease) => assertLease();
  return { directory, maintenance, cutover, sqlitePaths, companion, raw,
    retire: async onCheckpoint => retireLegacy({ maintenance, cutover, targetIdentity,
      receipt: await readActivation(maintenance, cutover) ?? await beginActivation(maintenance, cutover),
      drain() {}, reattest: assertLease => assertLease(), proveRetired: prove, onCheckpoint }) };
}

async function closedFiles(directory) {
  const files = [];
  for (const name of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, name.name);
    if (name.isDirectory()) files.push(...await closedFiles(path));
    else files.push(await readFile(path));
  }
  return files;
}

test('abort after pathname exchange keeps the original closed store and search caches', linux, async t => {
  const f = await fixture(t);
  const stop = new Error('interrupt before seal');
  await assert.rejects(f.retire(state => {
    if (state === 'activation-source-exchanged') throw stop;
  }), stop);
  await abortRetirement(f.cutover, await readActivation(f.maintenance, f.cutover), async () => {});
  for (const path of [...f.sqlitePaths, f.companion]) assert.ok((await readFile(path)).includes(marker));
});

test('confirmation removes closed legacy search families before allowing publication', linux, async t => {
  const f = await fixture(t);
  for (const path of [...f.sqlitePaths, f.companion]) assert.ok((await readFile(path)).includes(marker));
  const checkpoints = [];
  const advance = await f.retire(async state => {
    checkpoints.push(state);
    if (state === 'activation-source-exchanged') {
      for (const suffix of ['-wal', '-shm', '-journal']) {
        await writeFile(f.cutover.sourcePath + suffix, marker, { mode: 0o600 });
      }
    }
    if (state === 'activation-caches-removed') {
      assert.ok((await closedFiles(f.directory)).every(bytes => !bytes.includes(marker)));
      await assert.rejects(readdir(f.raw), { code: 'ENOENT' });
    }
  });
  await advance('reclaimed', 'activation-reclaimed');
  assert.deepEqual(checkpoints, ['activation-retirement-planned', 'activation-source-exchanged',
    'activation-legacy-sealed', 'activation-source-removed', 'activation-caches-removed', 'activation-reclaimed']);
  assert.ok((await closedFiles(f.directory)).every(bytes => !bytes.includes(marker)));
});
