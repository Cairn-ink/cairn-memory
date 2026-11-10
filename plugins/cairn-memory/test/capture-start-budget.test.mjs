import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { harness, row } from './capture-window-harness.mjs';

const delay = 'await new Promise(resolve => setTimeout(resolve, 1800));';
function stalled(source, phase) {
  const targets = {
    read: 'if (await readCaptureCursor(statePath)',
    binding: 'binding = await resolveClient(clientOptions);',
    stat: 'try { size = (await stat(event.transcript_path)).size; }',
    temporary: '    checkStartBoundary();\n    await rename(temporary, path);',
  };
  const target = targets[phase];
  assert.equal(source.split(target).length, 2);
  return source.replace(target, phase === 'stat' ? `try { ${delay} size = (await stat(event.transcript_path)).size; }` :
    phase === 'temporary' ? `    ${delay}\n${target}` : `${delay}\n${target}`);
}
async function probe(t, phase, budget = true) {
  const f = await harness(t, { mutateRuntime: source => {
    if (phase) source = stalled(source, phase);
    if (!budget) source = source.replace('const START_BOUNDARY_BUDGET_MS = 300;', 'const START_BOUNDARY_BUDGET_MS = 10000;');
    return source;
  } });
  await f.write(row('first', new Date().toISOString()));
  const result = await f.run('start-boundary');
  assert.ok(result.wallMs < 650, `total start budget: ${result.wallMs.toFixed(1)} ms`);
  if (phase) {
    await assert.rejects(readFile(f.statePath), { code: 'ENOENT' });
    // stat/temporary stalls happen while holding the lock. Capture must reap
    // the dead owner, retain the first record, and classify it as initial.
    await f.run('capture');
    assert.deepEqual(f.captures.flatMap(b => b.messages.map(m => m.id)), ['first']);
    assert.equal(f.captures[0].window.initial, true);
    const files = await readdir(f.dataDir + '/sessions').catch(() => []);
    assert.equal(files.some(name => name.endsWith('.lock')), false);
    assert.equal(files.some(name => name.includes(`.owner-${result.pid}-`) && !name.includes('.reap-')), false);
  }
  return result.wallMs;
}

test('normal and stalled start process wall times, five attempts each', { timeout: 20000 }, async t => {
  for (const phase of [undefined, 'stat']) {
    const times = [];
    for (let i = 0; i < 5; i++) times.push(await probe(t, phase));
    t.diagnostic(JSON.stringify({ node: process.version, phase: phase ?? 'normal', wallMs: times }));
  }
});
for (const phase of ['read', 'binding', 'temporary']) test(`deadline during ${phase} leaves no published boundary`, { timeout: 6000 }, async t => {
  await probe(t, phase);
});
test('the slow I/O probe kills a removed internal budget', { timeout: 6000 }, async t => {
  await assert.rejects(probe(t, 'stat', false), error => error.code === 'ERR_ASSERTION' && error.message.includes('total start budget'));
});
