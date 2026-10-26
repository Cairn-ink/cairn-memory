import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openSync, closeSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, drain, request, ns, ok, receipt } from '../testing/context-read-fixture.mjs';
import { waitForContextEntry } from '../testing/context-read-core-fixture.mjs';

function worker(f, job) {
  const outPath = job.report + '.out', errPath = job.report + '.err';
  const out = openSync(outPath, 'wx', 0o600), err = openSync(errPath, 'wx', 0o600);
  let child;
  try { child = spawn(process.execPath, [new URL('../testing/context-read-review-worker.mjs', import.meta.url).pathname, JSON.stringify(job)], { stdio: ['ignore', out, err] }); }
  finally { closeSync(out); closeSync(err); }
  const closed = new Promise(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.once('error', error => { clearTimeout(timer); resolve({ error }); });
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  const result = closed.then(state => {
    const diagnostics = readFileSync(errPath, 'utf8') + readFileSync(outPath, 'utf8');
    assert.equal(state.error, undefined); assert.equal(state.signal, null, diagnostics); assert.equal(state.code, 0, diagnostics);
    return { ...JSON.parse(readFileSync(job.report, 'utf8')), exitCode: state.code };
  });
  result.catch(() => {}); // The barrier may observe an early failure before the main join.
  f.workspace.defer(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await closed; });
  return { child, closed, result };
}
async function marker(path, operation) {
  let interval;
  const entry = new Promise(resolve => { interval = setInterval(() => { if (existsSync(path)) resolve(); }, 5); });
  try { await waitForContextEntry(entry, operation); return JSON.parse(readFileSync(path, 'utf8')); }
  finally { clearInterval(interval); }
}

test('R10 review 4: an independent canonical writer commits while another process is between reconciliation scan batches', { timeout: 45000 }, async t => {
  const f = fixture(t), memories = Array.from({ length: 384 }, (_, i) => f.admit('apple scan ' + i));
  drain(f.index());
  ok(f.core.correct({ namespace: ns, memoryId: memories[0].id, expectedRevision: 1,
    content: 'apple dirty before scan', kind: 'fact', receipt: receipt('before-scan') }));
  const scanMarker = join(f.workspace.path, 'scan-boundary.json'), writerReport = join(f.workspace.path, 'writer.json');
  const scanning = worker(f, { mode: 'scan', path: f.path, marker: scanMarker, writerReport,
    report: join(f.workspace.path, 'scanner.json'), input: request() });
  let writing;
  try {
    const boundary = await marker(scanMarker, scanning.result);
    assert.equal(boundary.rowsRead, 128); assert.equal(boundary.batches, 1); assert.equal(boundary.inTransaction, false);
    assert.ok(boundary.rowsRead < memories.length);
    writing = worker(f, { mode: 'writer', path: f.path, report: writerReport, input: { namespace: ns,
      memoryId: memories[1].id, expectedRevision: 1, content: 'apple writerproof', kind: 'fact', receipt: receipt('during-scan') } });
    const committed = await writing.result;
    assert.equal(committed.exitCode, 0); assert.equal(committed.result.value.memory.revision, 2);
    assert.notEqual(committed.pid, boundary.pid); assert.notEqual(boundary.pid, process.pid); assert.notEqual(committed.pid, process.pid);
    assert.equal(f.db.prepare('SELECT revision FROM memories WHERE id=?').get(memories[1].id).revision, 2);
    const complete = await scanning.result;
    assert.equal(complete.exitCode, 0); assert.equal(complete.firstStatus, 'rebuilding'); assert.equal(complete.status, 'complete');
    assert.deepEqual(complete.results.map(row => row.ref.memoryId), [memories[1].id]);
  } finally {
    for (const operation of [scanning, writing].filter(Boolean)) {
      if (operation.child.exitCode === null && operation.child.signalCode === null) operation.child.kill('SIGKILL');
      await operation.closed;
    }
  }
});
