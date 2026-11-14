import { readFile } from 'node:fs/promises';
import { withFileLock } from '../../file-lock.mjs';

const path = process.argv[2], rendezvousPath = process.argv[3] ?? path;
// Keep the crash rendezvous alive until the parent sends SIGKILL.
process.on('message', () => {});
let reads = 0;
await withFileLock(path, () => { throw Error('crashed_reaper_must_not_acquire'); }, {
  timeoutMs: 2000, pollMs: 5,
  read: async (name, ...args) => {
    if (name === rendezvousPath && ++reads === 2) {
      // The second original-owner read follows successful marker election and
      // precedes its token check/unlink. Hold here until the parent kills us.
      process.send({ elected: true });
      await new Promise(() => {});
    }
    return readFile(name, ...args);
  },
});
