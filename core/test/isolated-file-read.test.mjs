import assert from 'node:assert/strict';
import test from 'node:test';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { writeFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { isolatedFileRead } from '../isolated-file-read.mjs';

test('fixed child bounds reads, closes on overflow, returns exact bytes and nanosecond identity', t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'input'), trace = join(workspace.path, 'trace');
  const original = cp.spawnSync;
  t.mock.method(cp, 'spawnSync', (executable, args, options) => {
    assert.equal(executable, process.execPath); assert.equal(args.length, 1);
    assert.ok(args[0].endsWith('/isolated-file-read-child.mjs'));
    assert.deepEqual(options.env, {}); assert.equal(options.timeout, 5000);
    assert.ok(options.maxBuffer < 65536); assert.equal(options.shell, undefined);
    // Instrument the actual child syscalls; no production injection hook.
    const preload = 'data:text/javascript,' + encodeURIComponent(`
      import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
      const read=fs.readSync,open=fs.openSync,close=fs.closeSync;let data,total=0,closed=0;
      fs.openSync=(path,...args)=>{const fd=open(path,...args);if(path===${JSON.stringify(path)})data=fd;return fd;};
      fs.readSync=(fd,...args)=>{const n=read(fd,...args);if(fd===data)total+=n;return n;};
      fs.closeSync=fd=>{if(fd===data)closed++;return close(fd);};syncBuiltinESMExports();
      process.on('exit',()=>fs.writeFileSync(${JSON.stringify(trace)},JSON.stringify({total,closed})));
    `);
    return original(executable, ['--import', preload, ...args], options);
  });
  syncBuiltinESMExports();
  try {
    writeFileSync(path, Buffer.from([0, 255, 1, 2]));
    const result = isolatedFileRead(path, 4, { expected: statSync(path, { bigint: true }) });
    assert.deepEqual(result.bytes, Buffer.from([0, 255, 1, 2]));
    const actual = statSync(path, { bigint: true });
    for (const key of ['dev', 'ino', 'mode', 'size', 'nlink', 'mtimeNs', 'ctimeNs']) assert.equal(result.stat[key], actual[key]);
    assert.deepEqual(JSON.parse(readFileSync(trace)), { total: 4, closed: 1 });
    writeFileSync(path, Buffer.alloc(65536));
    assert.throws(() => isolatedFileRead(path, 32768), { code: 'invalid_input' });
    assert.deepEqual(JSON.parse(readFileSync(trace)), { total: 32769, closed: 1 });
    assert.throws(() => isolatedFileRead(path, 1, { invalid: 'invalid_review_configuration' }),
      { name: 'Error', message: 'invalid_review_configuration' });
    assert.deepEqual(JSON.parse(readFileSync(trace)), { total: 2, closed: 1 });
  } finally { cp.spawnSync = original; syncBuiltinESMExports(); }
});

test('timeout, output overflow and child failure refuse input', t => {
  const original = cp.spawnSync;
  try {
    for (const result of [{ error: Object.assign(Error('timeout'), { code: 'ETIMEDOUT' }) },
      { error: Object.assign(Error('overflow'), { code: 'ENOBUFS' }) }, { status: 1 },
      { status: 0, signal: 'SIGTERM' }, { status: 0, stdout: 'invalid protocol' }]) {
      t.mock.method(cp, 'spawnSync', () => result); syncBuiltinESMExports();
      assert.throws(() => isolatedFileRead('unused', 10), { code: 'invalid_input' });
      cp.spawnSync = original;
    }
  } finally { cp.spawnSync = original; syncBuiltinESMExports(); }
});

test('un-pinned regular inputs retain bounded read semantics independently of stat size', () => {
  // proc regular files report size zero despite having bytes, as the original
  // review dependency reader allowed. Pinned asset/method files remain exact.
  assert.equal(statSync('/proc/version').size, 0);
  assert.deepEqual(isolatedFileRead('/proc/version', 32768).bytes, readFileSync('/proc/version'));
});

test('child data-close I/O errors retain their Error class and code', t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'input'); writeFileSync(path, 'bytes');
  const original = cp.spawnSync;
  t.mock.method(cp, 'spawnSync', (executable, args, options) => {
    const preload = 'data:text/javascript,' + encodeURIComponent(`
      import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
      const open=fs.openSync,close=fs.closeSync;let data;
      fs.openSync=(path,...args)=>{const fd=open(path,...args);if(path===${JSON.stringify(path)})data=fd;return fd;};
      fs.closeSync=fd=>{close(fd);if(fd===data)throw Object.assign(Error('close failed'),{code:'EIO'});};
      syncBuiltinESMExports();
    `);
    return original(executable, ['--import', preload, ...args], options);
  });
  syncBuiltinESMExports();
  try { assert.throws(() => isolatedFileRead(path, 10), { name: 'Error', code: 'EIO', message: 'close failed' }); }
  finally { cp.spawnSync = original; syncBuiltinESMExports(); }
});
