import assert from 'node:assert/strict';
import test from 'node:test';
import { openMemoryCore } from '../../../core/index.mjs';
import { rationaleModel } from '../../../core/testing/rationale-model.mjs';
import { runSourceLoopControls } from '../source-loop-controls.mjs';

const fixtures = () => [{ id: 'synthetic-reaffirmation', query: 'A offline',
  windows: [[{ id: 'required-original', role: 'user', content: 'I chose A because A supports offline work.' }],
    [{ id: 'required-confirmation', role: 'user', content: 'Testing confirmed A supports offline work.' }]],
  requiredSourceIds: ['required-original', 'required-confirmation'] }];
function model() {
  const m = rationaleModel();
  m.select = ({ input }) => ({ refs: input.maps.flatMap(map => map.items.map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) });
  m.reviewBasis = ({ input }) => {
    const d = input.memories.find(m => m.receipts.some(r => r.excerpt.startsWith('I chose')));
    const c = input.memories.find(m => m.receipts.some(r => r.excerpt.startsWith('Testing')));
    if (!d) return { units: [], links: [] };
    return { units: [{ memory: d.index, receipt: 0, quote: 'I chose A', role: 'decision' },
      { memory: d.index, receipt: 0, quote: 'A supports offline work', role: 'premise' },
      ...(c ? [{ memory: c.index, receipt: 0, quote: 'Testing confirmed A supports offline work.', role: 'update' }] : [])],
    links: [{ from: 1, to: 0, relation: 'supports-decision' },
      ...(c ? [{ from: 2, to: 1, relation: 'challenges-current-basis' }] : [])] };
  };
  return m;
}
const run = async m => (await runSourceLoopControls({ openCore: openMemoryCore, model: m, cases: fixtures() })).cases[0];
test('SLC1 real capture/restart/recall, controls preserve exact-but-false proposal as unassessed, never semantic success', async () => {
  const m = model(), seen = [];
  for (const name of ['extract', 'qualifyCandidates', 'classify', 'select', 'rank', 'reviewBasis']) {
    const original = m[name]; m[name] = request => { seen.push(request.input); return original(request); };
  }
  const result = await run(m);
  assert.equal(result.status, 'observed'); assert.equal(result.captures.length, 2);
  assert.ok(result.coldMatchesWarm && result.readOnlyChecks);
  assert.deepEqual(result.capturedCoverage.missing, []); assert.deepEqual(result.recalledCoverage.missing, []);
  assert.equal(result.controls.length, 3);
  for (const control of result.controls) {
    assert.equal(control.status, 'unassessed'); assert.deepEqual(control.coverage.missing, []);
    assert.ok(control.basis.value.links.some(l => l.relation === 'challenges-current-basis'));
  }
  assert.ok(!JSON.stringify(seen).includes('required-original'));
  assert.ok(!JSON.stringify(seen).includes('requiredSourceIds'));
});
test('SLC2 extractor omission appears before retrieval and remains missing even for oracle', async () => {
  const m = model(), extract = m.extract;
  m.extract = request => request.input.messages.some(m => m.content.startsWith('Testing')) ? { items: [] } : extract(request);
  const result = await run(m);
  assert.deepEqual(result.capturedCoverage.missing, ['required-confirmation']);
  assert.deepEqual(result.controls.find(c => c.name === 'captured-source-oracle').coverage.missing, ['required-confirmation']);
});
test('SLC3 separate select/rank omissions from capture loss; controls do not use rubric to fix MOC', async () => {
  for (const phase of ['select', 'rank']) {
    const m = model(); m[phase] = () => ({ refs: [] });
    const result = await run(m);
    assert.deepEqual(result.capturedCoverage.missing, []);
    assert.equal(result.recalledCoverage.missing.length, 2);
    assert.equal(result.controls[0].status, 'missing-evidence'); assert.equal(result.controls[0].basis, null);
    assert.deepEqual(result.controls[2].coverage.missing, []);
  }
});
test('SLC4 rejected basis and capture errors stay visible without retry or completion claims', async () => {
  const m = model(); let calls = 0;
  m.reviewBasis = () => { calls++; return { invalid: true }; };
  const result = await run(m);
  assert.equal(calls, 3); assert.ok(result.controls.every(c => c.status === 'basis-failed' && !c.basis.ok));
  const broken = model(); let captures = 0;
  broken.extract = () => { captures++; throw new Error('synthetic failure'); };
  const failed = await run(broken);
  assert.equal(captures, 1); assert.equal(failed.status, 'observed-with-failures');
  assert.equal(failed.captures[0].capture.ok, false);
});
test('SLC5 bad fixtures reject before opening any store or invoking model', async () => {
  let calls = 0;
  await assert.rejects(runSourceLoopControls({ openCore: () => { calls++; }, model: model(),
    cases: [{ ...fixtures()[0], requiredSourceIds: ['missing'] }] }), /invalid_source_loop_fixture/);
  assert.equal(calls, 0);
});
test('SLC6 oracle above six refs is unavailable, never silently truncated to favorable sources', async () => {
  const cases = fixtures();
  cases[0].windows.push(Array.from({ length: 4 }, (_, i) => ({ id: `extra-${i}`, role: 'user', content: `A offline extra ${i}` })));
  cases[0].windows[0].push({ id: 'extra-four', role: 'user', content: 'A offline extra four' });
  const result = (await runSourceLoopControls({ openCore: openMemoryCore, model: model(), cases })).cases[0];
  const oracle = result.controls.find(c => c.name === 'captured-source-oracle');
  assert.equal(oracle.refs.length, 7); assert.equal(oracle.status, 'over-ref-cap'); assert.equal(oracle.basis, null);
});
