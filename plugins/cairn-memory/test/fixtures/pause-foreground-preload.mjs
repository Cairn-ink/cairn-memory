import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const spawn = childProcess.spawn;
childProcess.spawn = function (_executable, args) {
  process.send?.({ kind: 'worker-launched', action: args.at(-1) });
  // Isolate the launcher: a worker's network belongs to the worker test.
  return spawn(process.execPath, ['--eval', 'process.stdin.resume()'], {
    stdio: ['pipe', 'ignore', 'ignore'], env: { PATH: '/usr/bin:/bin' },
  });
};
syncBuiltinESMExports();
globalThis.fetch = async () => { process.send?.({ kind: 'foreground-network' }); throw new Error('unexpected_network'); };
process.channel?.unref();
