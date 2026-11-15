// The launcher test owns its real worker through this process. Keep the child
// referenced, reap it before launcher close, and support cleanup on test failure.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const spawn = childProcess.spawn;
const workers = new Set();
let stopping = false;
const finish = () => {
  if (!workers.size && process.connected) process.disconnect();
};
childProcess.spawn = function (executable, args, options) {
  const worker = spawn(executable, args, { ...options, detached: false });
  workers.add(worker);
  worker.unref = () => {}; // Closing the launcher now also proves worker close.
  worker.once('close', () => { workers.delete(worker); finish(); });
  if (stopping) worker.kill('SIGKILL');
  return worker;
};
syncBuiltinESMExports();
process.on('message', message => {
  if (message?.kind !== 'stop-workers') return;
  stopping = true;
  process.stdin.destroy();
  for (const worker of workers) worker.kill('SIGKILL');
  finish();
});
process.on('disconnect', () => {
  for (const worker of workers) worker.kill('SIGKILL');
});
// With no worker, unfinished stdin should be the only reason to stay alive.
process.channel?.unref();
