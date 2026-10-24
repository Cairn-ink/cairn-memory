import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { openContextReadSidecar } from '../context-read-sidecar.mjs';

const [serialized] = process.argv.slice(2), job = JSON.parse(serialized);
const atomic = (path, value) => { writeFileSync(path + '.tmp', JSON.stringify(value), { mode: 0o600 }); renameSync(path + '.tmp', path); };
if (job.mode === 'writer') {
  const core = openMemoryCore({ path: job.path });
  try {
    const result = core.correct(job.input);
    if (!result.ok) throw Error('independent_writer_refused: ' + JSON.stringify(result));
    atomic(job.report, { pid: process.pid, result });
  } finally { core.close(); }
} else {
  const canonical = new DatabaseSync(job.path, { readOnly: true }), originalPrepare = canonical.prepare, originalExec = canonical.exec;
  let rowsRead = 0, batches = 0, pendingBoundary = false, announced = false, index;
  canonical.prepare = function(sql) {
    const statement = originalPrepare.call(this, sql);
    if (!/FROM memories INDEXED/.test(sql)) return statement;
    return { all(...args) {
      const rows = statement.all(...args); rowsRead += rows.length; batches++; pendingBoundary = true; return rows;
    } };
  };
  canonical.exec = function(sql) {
    const value = originalExec.call(this, sql);
    if (sql === 'COMMIT' && pendingBoundary && !announced) {
      announced = true; pendingBoundary = false;
      atomic(job.marker, { pid: process.pid, rowsRead, batches, inTransaction: this.isTransaction });
      // Pause outside the first metadata transaction while the independent
      // writer commits. A whole-scan snapshot cannot satisfy this boundary.
      const until = Date.now() + 10000, sleeper = new Int32Array(new SharedArrayBuffer(4));
      while (!existsSync(job.writerReport)) {
        if (Date.now() >= until) throw Error('independent_writer_deadline');
        Atomics.wait(sleeper, 0, 0, 5);
      }
      if (!JSON.parse(readFileSync(job.writerReport, 'utf8')).result.ok) throw Error('writer_did_not_commit');
    }
    return value;
  };
  try {
    index = openContextReadSidecar({ path: job.path, db: canonical });
    const first = index.reconcile(job.input), until = Date.now() + 10000;
    let current = first;
    for (let step = 0; current.status !== 'complete' && step < 20 && Date.now() < until; step++) current = index.reconcile(job.input);
    if (current.status !== 'complete') throw Error('reconciliation_deadline');
    atomic(job.report, { pid: process.pid, firstStatus: first.status, status: current.status, rowsRead, batches,
      results: index.lexical(job.input, 'writerproof') });
  } finally { index?.close(); canonical.close(); }
}
