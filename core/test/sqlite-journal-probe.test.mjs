import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { createExclusiveSqliteFile } from '../sqlite-journal-probe.mjs';
import { initLocalRawStore } from '../../integrations/client/raw/local-setup-init.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

for (const fault of ['fsync', 'timeout']) test(`staged creation ${fault} failure leaves retryable target; dead stages are recovered`, async t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'new.sqlite');
  const original = childProcess.spawnSync;
  childProcess.spawnSync = (command, args, options) => {
    if (args[2]?.includes('fsyncSync(fd)')) {
      args = [...args];
      args[2] = args[2].replace('fsyncSync(fd);', fault === 'fsync'
        ? "(() => { throw Object.assign(new Error('fsync injected'), { code: 'EIO' }); })();"
        : 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);');
      if (fault === 'timeout') options = { ...options, timeout: 500 };
    }
    return original(command, args, options);
  };
  syncBuiltinESMExports();
  try { assert.throws(() => createExclusiveSqliteFile(path), fault === 'fsync' ? { code: 'EIO', published: false } : /sqlite_file_creation_failed/); }
  finally { childProcess.spawnSync = original; syncBuiltinESMExports(); }
  assert.equal(fs.existsSync(path), false);
  const stages = fs.readdirSync(workspace.path);
  assert.equal(stages.length, fault === 'timeout' ? 1 : 0);
  assert.equal((await initLocalRawStore({ databasePath: path })).status, 'initialized');
  assert.deepEqual(fs.readdirSync(workspace.path), ['new.sqlite']);
  assert.equal(fs.statSync(path).mode & 0o777, 0o600);
  const before = fs.readFileSync(path), inode = fs.statSync(path).ino;
  assert.throws(() => createExclusiveSqliteFile(path), { code: 'EEXIST', published: false });
  assert.equal(fs.statSync(path).ino, inode); assert.deepEqual(fs.readFileSync(path), before);
  assert.deepEqual(fs.readdirSync(workspace.path), ['new.sqlite']);
});

test('publication is no-replace even if another creator wins between stage fsync and link', t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'winner.sqlite');
  const original = childProcess.spawnSync;
  childProcess.spawnSync = (command, args, options) => {
    args = [...args]; args[2] = args[2].replace('linkSync(temporary, target);',
      "const winner = openSync(target, 'wx', 0o600); closeSync(winner); linkSync(temporary, target);");
    return original(command, args, options);
  };
  syncBuiltinESMExports();
  try { assert.throws(() => createExclusiveSqliteFile(path), { code: 'EEXIST', published: false }); }
  finally { childProcess.spawnSync = original; syncBuiltinESMExports(); }
  assert.equal(fs.statSync(path).size, 0);
  assert.deepEqual(fs.readdirSync(workspace.path), ['winner.sqlite']);
});

for (const fault of ['directory-fsync', 'post-link-timeout']) test(`${fault}: interrupted publication retains target and never replaces it`, t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'published.sqlite');
  const original = childProcess.spawnSync;
  childProcess.spawnSync = (command, args, options) => {
    args = [...args];
    args[2] = fault === 'directory-fsync'
      ? args[2].replace('fsyncSync(dir);', "(() => { throw Object.assign(new Error('directory fsync'), { code: 'EIO' }); })();")
      : args[2].replace('published = true;', 'published = true; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);');
    return original(command, args, fault === 'post-link-timeout' ? { ...options, timeout: 500 } : options);
  };
  syncBuiltinESMExports();
  try { assert.throws(() => createExclusiveSqliteFile(path), fault === 'directory-fsync' ? { code: 'EIO', published: true } : /sqlite_file_creation_failed/); }
  finally { childProcess.spawnSync = original; syncBuiltinESMExports(); }
  const before = fs.statSync(path);
  assert.equal(before.size, 0);
  assert.throws(() => createExclusiveSqliteFile(path), { code: 'EEXIST', published: false });
  assert.equal(fs.statSync(path).ino, before.ino);
  assert.deepEqual(fs.readdirSync(workspace.path), ['published.sqlite']);
});
