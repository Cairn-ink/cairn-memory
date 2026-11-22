import { DatabaseSync } from 'node:sqlite';
const [role, path] = process.argv.slice(2);
let db, timer, stopped = false;
const samples = [];
function finish() {
  if (stopped) return;
  stopped = true; clearInterval(timer);
  if (db?.isTransaction) db.exec('ROLLBACK');
  db?.close();
  if (process.connected) process.send({ samples }, () => process.disconnect());
}
process.on('disconnect', finish);
process.on('message', message => { if (message === 'release') finish(); });
if (role === 'shared' || role === 'reserved') {
  db = new DatabaseSync(path);
  db.exec(role === 'reserved' ? 'BEGIN IMMEDIATE' : 'BEGIN'); db.prepare('SELECT count(*) FROM memories').get();
  process.send('ready');
} else {
  function sample() {
    const start = performance.now(); let code = 'ok', connection;
    try {
      connection = new DatabaseSync(path, { readOnly: true, timeout: 0 });
      connection.prepare('SELECT count(*) FROM memories').get();
    } catch (error) { code = error.errcode ?? error.code; }
    finally { connection?.close(); }
    samples.push({ time: Date.now(), ms: performance.now() - start, code });
  }
  sample(); timer = setInterval(sample, 10); process.send('ready');
}
