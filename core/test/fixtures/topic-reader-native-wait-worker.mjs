// Test-only surrogate for native cancellation at the real public host boundary.
// A read-only connection waits on an owned SQLite DELETE-mode exclusive lock;
// the outer in-memory UDF proves SQLite execution has entered before signaling.
import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';

const { control, blocked } = workerData;
if (!blocked) {
  parentPort.on('message', () => parentPort.postMessage({ ok: true, value: { from: 'replacement' } }));
} else {
  const db = new DatabaseSync(workerData.path, { readOnly: true });
  db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=5000');
  const statement = db.prepare('SELECT value FROM cancellation_probe');
  const outer = new DatabaseSync(':memory:');
  outer.function('blocked_read', () => {
    control.postMessage('entered-native');
    return statement.get().value;
  });
  const query = outer.prepare('SELECT blocked_read() value');
  let request, go = false;
  function run() {
    if (!go || !request) return;
    go = false;
    db.exec('BEGIN');
    const row = query.get();
    // Keep the actual read transaction/SHARED lock until thread termination.
    // The parent verifies EXCLUSIVE fails before termination and succeeds after.
    parentPort.postMessage({ ok: true, value: { from: 'abandoned', value: row.value } });
    control.postMessage('returned-native');
  }
  parentPort.on('message', message => { request = message; run(); });
  control.on('message', message => { if (message === 'go') { go = true; run(); } });
  control.postMessage('prepared');
}
