import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { workspace, until } from './local-daemon-support.mjs';

for (const phase of ['descriptor', 'teardown']) test('descriptor helper polls after list/read ENOENT: ' + phase, async () => {
  const hooks = [], w = await workspace({ after: hook => hooks.push(hook), diagnostic() {} });
  await w.bootstrap();
  const path = join(w.root, 'run', 'cairn-memory', 'd-' + 'a'.repeat(32) + '.json');
  const descriptor = { owner: { pid: 2147483647, start: '0' } };
  await fs.writeFile(path, JSON.stringify(descriptor), { mode: 0o600 });
  const read = fs.readFile; let reads = 0;
  fs.readFile = async function(file, ...args) {
    if (file === path && ++reads === 1) throw Object.assign(Error('synthetic_missing'), { code: 'ENOENT' });
    return read(file, ...args);
  };
  syncBuiltinESMExports();
  try {
    if (phase === 'descriptor') assert.deepEqual(await until(w.descriptor, 'helper retries'), descriptor);
    else await hooks[0]();
    assert.equal(reads, 2, 'the missing listed entry is polled again');
  } finally {
    fs.readFile = read; syncBuiltinESMExports();
    if (phase === 'descriptor') await hooks[0]();
  }
});

test('descriptor helper preserves non-ENOENT errors', async () => {
  const hooks = [], w = await workspace({ after: hook => hooks.push(hook), diagnostic() {} });
  await w.bootstrap();
  const path = join(w.root, 'run', 'cairn-memory', 'd-' + 'b'.repeat(32) + '.json');
  await fs.writeFile(path, JSON.stringify({ owner: { pid: 2147483647, start: '0' } }), { mode: 0o600 });
  const read = fs.readFile;
  fs.readFile = async function(file, ...args) {
    if (file === path) throw Object.assign(Error('synthetic_denied'), { code: 'EACCES' });
    return read(file, ...args);
  };
  syncBuiltinESMExports();
  try { await assert.rejects(w.descriptor(), { code: 'EACCES' }); }
  finally { fs.readFile = read; syncBuiltinESMExports(); await hooks[0](); }
});
