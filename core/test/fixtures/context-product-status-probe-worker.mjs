import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { workerData } from 'node:worker_threads';

// Commit another owner's maintenance after the real child query, before the
// probe's final fingerprint. No SQLite call or transcript is synthesized.
const state = new Int32Array(workerData.host.configuration.statusProbeState);
const spawn = childProcess.spawnSync;
childProcess.spawnSync = function(command, args, options) {
  const result = spawn(command, args, options);
  if (args?.[2]?.includes('closeFailed') && args[3]?.includes('.context-read-product-v1.1.sqlite')) {
    const sequence = Atomics.add(state, 0, 1) + 1;
    Atomics.notify(state, 0);
    while (Atomics.load(state, 1) < sequence) {
      if (Atomics.wait(state, 1, sequence - 1, 5000) === 'timed-out') throw Error('maintenance barrier timed out');
    }
  }
  return result;
};
syncBuiltinESMExports();
await import('../../context-product-worker.mjs');
