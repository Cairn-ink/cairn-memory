import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// A separate event loop releases the lock while the parent's synchronous SQLite
// operation waits. IPC acknowledges both acquisition and the release timer.
export async function holdReader(t, filename) {
  const child = fork(fileURLToPath(import.meta.url), [filename], {
    execArgv: [], env: { NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  let releaseScheduled = false;
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve()
      : reject(new Error(`synthetic reader exit ${code}/${signal}: ${stderr}`)));
  });
  // Attach immediately, including if setup fails before a caller awaits exit.
  exited.catch(() => {});
  const waitFor = expected => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('synthetic reader watchdog')); }, 15_000);
    const onMessage = message => { if (message === expected) { cleanup(); resolve(); } };
    const onExit = () => { cleanup(); reject(new Error('synthetic reader exited before handshake')); };
    const cleanup = () => { clearTimeout(timer); child.off('message', onMessage); child.off('exit', onExit); };
    child.on('message', onMessage); child.once('exit', onExit);
  });
  const release = async () => {
    if (!releaseScheduled && child.connected) {
      releaseScheduled = true;
      child.send({ holdMs: 0 });
    }
    await exited;
  };
  t.after(release);
  await waitFor('locked');
  return {
    async releaseAfter(holdMs) {
      assert.ok(Number.isSafeInteger(holdMs) && holdMs > 0 && holdMs < 15_000);
      const scheduled = waitFor('scheduled');
      releaseScheduled = true;
      child.send({ holdMs });
      await scheduled;
    },
    release,
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const db = new DatabaseSync(process.argv[2], { readOnly: true });
  db.exec('PRAGMA query_only = ON; BEGIN');
  db.prepare('SELECT count(*) FROM attempts').get();
  let timer;
  const release = () => { clearTimeout(timer); db.exec('ROLLBACK'); db.close(); process.disconnect(); };
  process.on('message', message => {
    if (message?.holdMs === 0) { release(); return; }
    assert.ok(Number.isSafeInteger(message?.holdMs) && message.holdMs > 0 && message.holdMs < 15_000);
    clearTimeout(timer);
    timer = setTimeout(release, message.holdMs);
    process.send('scheduled');
  });
  timer = setTimeout(release, 15_000);
  process.send('locked');
}
