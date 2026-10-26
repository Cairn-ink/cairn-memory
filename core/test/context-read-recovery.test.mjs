import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { fixture, request, drain, snapshot, ns, ok, receipt, observeDatabaseFiles } from '../testing/context-read-fixture.mjs';

async function killedAtCheckpoint(t, path, input, kind, point) {
  const markerPath = path + '.checkpoint-' + randomUUID();
  const child = spawn(process.execPath, [new URL('../testing/context-read-crash-worker.mjs', import.meta.url).pathname,
    path, JSON.stringify(input), kind, point, markerPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '', done = false;
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => { done = true; resolve({ code, signal }); });
  });
  t.after(async () => { if (!done) { child.kill('SIGKILL'); await closed; } });
  child.stderr.on('data', bytes => { stderr += bytes; });
  const marker = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { clearInterval(poll); child.kill('SIGKILL'); reject(Error('checkpoint_timeout: ' + stderr)); }, 30000);
    const poll = setInterval(() => {
      if (existsSync(markerPath)) {
        try {
          const value = JSON.parse(readFileSync(markerPath, 'utf8'));
          clearTimeout(timer); clearInterval(poll); resolve(value);
        } catch { /* Observe again after the bounded control file finishes. */ }
      }
    }, 10);
    closed.then(result => { clearTimeout(timer); clearInterval(poll); reject(Error('checkpoint_child_exited: ' + JSON.stringify(result) + ' ' + stderr)); }, reject);
  });
  assert.equal(marker.kind, kind); assert.equal(marker.point, point);
  child.kill('SIGKILL');
  const result = await closed;
  assert.deepEqual(result, { code: null, signal: 'SIGKILL' }, 'actual process termination checked');
  return marker;
}

for (const mode of ['full', 'incremental', 'single']) for (const kind of mode === 'single' ? ['publication'] : ['delta', 'publication']) for (const point of ['before', 'after']) {
  test(`R09 SIGKILL ${mode} ${kind} ${point} checkpoint commit; resume equals clean rebuild`, async t => {
    const f = fixture(t), words = Array.from({ length: 65 }, (_, i) => 'term' + i).join(' ');
    const memories = Array.from({ length: 18 }, (_, i) => f.admit(`synthetic apple ${i} ${words}`));
    if (mode !== 'full') {
      const initial = f.index(); drain(initial); initial.close();
      for (const memory of memories.slice(0, mode === 'single' ? 1 : 4)) ok(f.core.correct({ namespace: ns, memoryId: memory.id,
        expectedRevision: memory.revision, content: `synthetic banana ${memory.id} ${words}`, kind: 'fact', receipt: receipt('correct-' + memory.id) }));
    }
    const marker = await killedAtCheckpoint(t, f.path, request(), kind, point), path = f.path + '.context-read-v1.sqlite';
    if (point === 'before') {
      assert.ok(marker.journalBytes > 0, 'real rollback journal exists before commit');
      assert.ok(lstatSync(path + '-journal').size > 0);
      // A spilled full-build delta produces SQLite's hot-journal header.
      if (mode === 'full' && kind === 'delta') assert.equal(readFileSync(path + '-journal').subarray(0, 8).toString('hex'), 'd9d505f920a163d7');
      const before = readdirSync(f.workspace.path).sort();
      const observed = await observeDatabaseFiles(f, () => {
        assert.throws(() => f.index({ readOnly: true }), { code: 'index_unavailable' });
      });
      assert.deepEqual(readdirSync(f.workspace.path).sort(), before); assert.deepEqual(observed.events, []);
    }
    const resumed = f.index();
    if (kind !== 'publication' || point !== 'after') assert.throws(() => resumed.lexical(request(), 'apple'), { code: 'index_unavailable' });
    else assert.ok(resumed.lexical(request(), 'apple').length > 0);
    const result = drain(resumed); assert.equal(result.buildState, mode === 'full' ? 'rebuilt' : 'ready');
    if (kind === 'delta' && point === 'after') assert.equal(result.totals.textRows, mode === 'full' ? memories.length - 2 : 2, 'the two committed transformations are never replayed');
    if (mode === 'single') assert.equal(result.totals.textRows, point === 'before' ? 1 : 0,
      'the combined fence/delta/checkpoint/publication transaction is wholly replayed or wholly committed');
    const recovered = snapshot(f.path), rankings = resumed.lexical(request(), 'apple banana');
    resumed.close(); unlinkSync(path);
    const clean = f.index(); drain(clean);
    assert.deepEqual(snapshot(f.path), recovered);
    assert.deepEqual(clean.lexical(request(), 'apple banana'), rankings);
  });
}
