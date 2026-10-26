// Test-only observer in the actual public reader Worker. It counts returned
// physical rows and EOF independently of the implementation's work counter.
import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';
const nativePrepare = DatabaseSync.prototype.prepare;
let visits = 0, metadata = 0, allCalls = 0, schemaRows = [];
DatabaseSync.prototype.prepare = function(sql) {
  const stmt = nativePrepare.call(this, sql), meta = /PRAGMA|pragma_|sqlite_master|EXPLAIN/i.test(sql);
  const visit = row => {
    visits++; if (meta) metadata++;
    if (/FROM sqlite_master WHERE rowid>/.test(sql) && row) schemaRows.push(row.rowid);
  };
  return new Proxy(stmt, { get(target, name) {
    if (name === 'get') return (...args) => { const row = target.get(...args); visit(row); return row; };
    if (name === 'all') return (...args) => { allCalls++; const rows = target.all(...args); rows.forEach(visit); visit(); return rows; };
    if (name === 'iterate') return function*(...args) { for (const row of target.iterate(...args)) { visit(row); yield row; } visit(); };
    const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value;
  } });
};
const post = parentPort.postMessage.bind(parentPort);
parentPort.postMessage = value => {
  workerData.reviewPort.postMessage({ visits, metadata, allCalls, schemaRows });
  visits = metadata = allCalls = 0; schemaRows = [];
  return post(value);
};
