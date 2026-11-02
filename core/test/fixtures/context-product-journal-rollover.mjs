// Independent SQLite writer; the parent only observes metadata and rendezvous
// markers. The old journal is pinned by a separate process without SQLite.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, writeFileSync } from 'node:fs';
const [path, kind, signal, completed] = process.argv.slice(2);
const db = new DatabaseSync(path);
const update = kind === 'canonical' ? 'UPDATE namespace_epochs SET epoch=epoch+1' :
  'UPDATE product_metadata SET store_id=store_id || \'-rollover\'';
db.exec('PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=0; BEGIN IMMEDIATE');
db.exec(update);
process.send({ held: true });
const deadline = Date.now() + 10000;
const timer = setInterval(() => {
  if (Date.now() > deadline) throw Error('journal rollover rendezvous timed out');
  if (!existsSync(signal)) return;
  clearInterval(timer);
  db.exec('COMMIT; BEGIN IMMEDIATE');
  db.exec(update);
  writeFileSync(completed, 'held', { mode: 0o600 });
}, 5);
process.on('message', command => {
  if (command !== 'close') throw Error('unexpected writer command');
  clearInterval(timer);db.exec('ROLLBACK');db.close();process.disconnect();
});
