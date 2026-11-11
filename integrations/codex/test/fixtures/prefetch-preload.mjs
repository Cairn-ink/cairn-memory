// Test-only fsync accounting and deterministic disk latency. No runtime seams.
import fs from 'node:fs';
import promises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { relative } from 'node:path';

const milliseconds = Number(process.env.CAIRN_TEST_SYNC_DELAY ?? 0);
const calls = [];
const paths = new WeakMap();
const note = (method, path) => calls.push({ method, path: relative(process.env.HOME, String(path)) });
const open = promises.open;
const probe = await open(new URL(import.meta.url), 'r');
const prototype = Object.getPrototypeOf(probe), sync = prototype.sync;
await probe.close();
prototype.sync = async function () {
  note('FileHandle.sync', paths.get(this) ?? 'unknown');
  if (milliseconds) await delay(milliseconds);
  return sync.call(this);
};
promises.open = async function (path, ...args) {
  const handle = await open.call(this, path, ...args);
  paths.set(handle, path);
  return handle;
};
const fsync = fs.fsync, fsyncSync = fs.fsyncSync;
fs.fsync = function (fd, callback) {
  note('fsync', 'unknown');
  if (milliseconds) setTimeout(() => fsync.call(this, fd, callback), milliseconds);
  else fsync.call(this, fd, callback);
};
fs.fsyncSync = function (fd) {
  note('fsyncSync', 'unknown');
  if (milliseconds) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
  return fsyncSync.call(this, fd);
};
syncBuiltinESMExports();
const fetch = globalThis.fetch;
globalThis.fetch = function (url, options) {
  if (new URL(url).pathname.endsWith('/recall')) process.send?.({ kind: 'prefetch',
    syncCalls: calls.length, calls, atMs: performance.now() });
  return fetch.call(this, url, options);
};
