import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { isMainThread, Worker, workerData } from 'node:worker_threads';

if (isMainThread) {
  const [path, control] = process.argv.slice(2);
  const arm = join(control, 'arm'), release = join(control, 'release');
  const gate = new Int32Array(new SharedArrayBuffer(4));
  const relay = new Worker(new URL(import.meta.url), { workerData: { gate, release } });
  try {
    await once(relay, 'online');
    process.send('ready');
    while (!existsSync(arm) && !existsSync(release)) await delay(5);
    if (!existsSync(release)) {
      const db = new DatabaseSync(path);
      try {
        assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
        db.exec('BEGIN EXCLUSIVE');
        mkdirSync(join(control, 'locked'));
        assert.notEqual(Atomics.wait(gate, 0, 0, 10000), 'timed-out');
        db.exec('ROLLBACK');
      } finally { db.close(); }
      mkdirSync(join(control, 'released'));
    }
  } finally {
    await relay.terminate();
    process.disconnect();
  }
} else {
  const { gate, release } = workerData;
  while (!existsSync(release)) await delay(5);
  Atomics.store(gate, 0, 1);
  Atomics.notify(gate, 0);
}
