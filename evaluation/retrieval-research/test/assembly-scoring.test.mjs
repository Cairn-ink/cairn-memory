import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCell, summarize } from '../assembly/score.mjs';
import { PROTOCOL, PROTOCOL_COMMIT } from '../assembly/auth.mjs';
import { COUNTER_ID } from '../assembly/counter.mjs';

function example() {
  const memory = id => ({ id, content: 'hello', spans: [{ id: `${id}#first`, text: 'hello' }, { id: `${id}#required`, text: 'hello world' }] });
  const member = (memory, where) => ({ memory, where, spans: [`${memory}#required`], namespace: 'target', scale: 'S300' });
  const queries = [
    { id: 'q1', family: 'f1', category: 'C1', lang: 'en', intent: 'current', groups: [{ members: [member('m1', 'body')] }, { members: [member('m2', 'span')] }] },
    { id: 'q2', family: 'f2', category: 'C1', lang: 'zh', intent: 'current', groups: [{ members: [member('m1', 'body')] }] },
    { id: 'q3', family: 'f3', category: 'C2', lang: 'en', intent: 'current', groups: [{ members: [member('m3', 'span')] }] },
  ];
  const fixture = { hashes: {}, corpus: { memories: ['m1', 'm2', 'm3'].map(memory) }, queries: { queries }, split: { f1: 'dev', f2: 'dev', f3: 'dev' }, labels: { queries: queries.map(query => ({ ...query, split: 'dev' })) } };
  const admission = (id, tokens = 1) => ({ id, tokens, cost: tokens });
  const cell = { format: 'hr2-cell-v1', run: { protocol: PROTOCOL, protocolCommit: PROTOCOL_COMMIT, counter: COUNTER_ID, status: 'complete', fixtureHashes: {}, arm: 'P-top-s1', ranking: 'A1', split: 'dev', scale: 'S1000', budget: 128, overhead: 0 },
    queries: [{ id: 'q1', ranked: ['m1', 'm2'], admitted: [admission('m1#body'), admission('m2#body'), admission('m2#first')], used: 3 },
      { id: 'q2', ranked: ['m1'], admitted: [admission('m1#body')], used: 1 },
      { id: 'q3', ranked: ['m2'], admitted: [admission('m2#body')], used: 1 }] };
  return { fixture, cell };
}

test('hand-computed required body/span coverage, all-required, full-ranking ceiling and packing loss', () => {
  const { fixture, cell } = example(), result = scoreCell(fixture, cell);
  assert.deepEqual(result.queries.map(row => [row.coverage, row.allRequired, row.ceiling, row.assemblyLoss]), [[0.5, false, 1, 0.5], [1, true, 1, 0], [0, false, 0, 0]]);
  assert.equal(result.summary.categories.C1.coverage, 0.75);
  assert.equal(result.summary.categories.C1.allRequired, 0.5);
  assert.equal(result.summary.macroCoverage, null);
  assert.equal(summarize(result.queries).macroCoverage, 0.375);
  assert.deepEqual(result.summary.tokenUse, { p50: 1 / 128, p95: 2.8 / 128 });
  assert.deepEqual(result.queries[0].admitted, cell.queries[0].admitted);
  assert.equal(result.queries[0].used, 3);
});

test('fidelity strata use group denominators and omit queries without that fidelity, with represented categories and counts', () => {
  const { fixture, cell } = example(), result = scoreCell(fixture, cell);
  const body = result.strata['fidelity:body-covered'], span = result.strata['fidelity:span-only'];
  assert.deepEqual([body.queryCount, body.groupCount, body.macroCoverage, body.representedCategories], [2, 2, 1, ['C1']]);
  assert.deepEqual([span.queryCount, span.groupCount, span.macroCoverage, span.representedCategories], [2, 2, 0, ['C1', 'C2']]);
  assert.equal(result.strata['language:en'].macroCoverage, 0.25);
  assert.equal(result.strata['language:zh'].macroCoverage, 1);
  assert.equal(result.strata['category:C1'].macroCoverage, 0.75);
  assert.deepEqual(body.queries.map(row => row.id), ['q1', 'q2']);
  fixture.labels.queries[0].groups[1].members.push({ memory: 'm1', where: 'body', namespace: 'target', scale: 'S300', spans: [] });
  assert.equal(scoreCell(fixture, cell).strata['fidelity:body-covered'].groupCount, 3);
});

test('named required span alone satisfies its group; unrelated span does not; ceiling is common to every arm', () => {
  const { fixture, cell } = example();
  const first = scoreCell(fixture, cell);
  cell.run.arm = 'P-top';
  cell.queries[0].admitted.push({ id: 'm2#required', tokens: 2, cost: 2 }); cell.queries[0].used += 2;
  const full = scoreCell(fixture, cell);
  assert.equal(full.queries[0].coverage, 1); assert.equal(full.queries[0].allRequired, true);
  assert.deepEqual(full.queries.map(row => row.ceiling), first.queries.map(row => row.ceiling));
});

test('empty fidelity stratum reports zero counts and no macro; invalid cell costs and detached spans refuse', () => {
  const { fixture, cell } = example();
  for (const label of fixture.labels.queries) for (const group of label.groups) for (const member of group.members) member.where = 'body';
  const empty = scoreCell(fixture, cell).strata['fidelity:span-only'];
  assert.deepEqual([empty.queryCount, empty.groupCount, empty.macroCoverage, empty.representedCategories], [0, 0, null, []]);
  cell.queries[0].admitted.shift(); cell.queries[0].admitted.push({ id: 'm1#required', tokens: 2, cost: 2 }); cell.queries[0].used++;
  assert.throws(() => scoreCell(fixture, cell), /cell_detached_span/);
});
