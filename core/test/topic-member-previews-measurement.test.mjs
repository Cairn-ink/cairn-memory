import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlan, decide, PROTOCOL } from '../../tools/testing/measure-topic-member-previews.mjs';
const record = (elapsedMs, extra = {}) => ({ elapsedMs, hostLoop: { maxMs: 1, blocksOver100: 0 },
  bytes: 1000, cloneRepresentationBytes: 900, successfulPage: true, overlap: true, status: 'page',
  reasons: {}, failure: null, writes: [], bounds: true, counters: { extractions: 1 }, ...extra });
const cell = { count: 1112, schema: 18, journal: 'DELETE', selection: 'L2', limit: 24, load: 'idle' };

test('P1 measurement preregisters exact Cartesian cells and successful-page population, never fast refusals', () => {
  const plan = buildPlan(false); assert.equal(plan.length, 144);
  for (const count of [1112,3336]) for (const schema of [18,33]) for (const journal of ['DELETE','WAL'])
    for (const selection of ['L1','L2','unfiled']) for (const limit of [24,100]) for (const load of ['idle','same-owner','other-owner'])
      assert.equal(plan.filter(c => c.count===count && c.schema===schema && c.journal===journal && c.selection===selection && c.limit===limit && c.load===load).length, 1);
  const attempts = Array.from({ length: 50 }, (_, i) => record(i + 1));
  attempts.push(record(1, { successfulPage: false, failure: { code: 'storage_busy' }, status: null }));
  const result = decide(cell, 'main', attempts, 50, true);
  assert.equal(result.decision, 'pass'); assert.equal(result.summary.attempts, 51); assert.equal(result.summary.successfulPages, 50);
  assert.equal(result.summary.successfulPopulation.p95Ms, 48); assert.equal(result.summary.successfulPopulation.maxMs, 50);
  assert.equal(decide(cell, 'main', attempts.slice(0,49), 50, true).decision, 'inconclusive');
  assert.equal(decide(cell, 'main', attempts, 50, false).decision, 'inconclusive');
  assert.equal(PROTOCOL.mainCeiling, 500); assert.equal(PROTOCOL.coldCeiling, 100); assert.equal(PROTOCOL.warmups, 3);
});
test('P1 measurement absolute loop/busy/byte gates include failures; page100 and cold3336 latency report-only', () => {
  for (const extra of [{ hostLoop: { maxMs: 101, blocksOver100: 1 } }, { bounds: false }]) {
    const attempts = [...Array.from({ length: 50 }, () => record(1)), record(1, { ...extra, successfulPage: false, failure: { code: 'storage_busy' } })];
    assert.equal(decide(cell, 'main', attempts, 50, true).decision, 'fail');
  }
  const busy = [record(1, { successfulPage: false, failure: { code: 'storage_busy' } })];
  assert.equal(decide({ ...cell, journal: 'WAL' }, 'main', busy, 50, true).checks.walBusy, false);
  assert.equal(decide(cell, 'main', busy, 50, true).checks.walBusy, true);
  const slow = Array.from({ length: 50 }, () => record(500));
  assert.equal(decide(cell, 'main', slow, 50, true).decision, 'fail');
  assert.equal(decide({ ...cell, limit: 100 }, 'main', slow, 50, true).decision, 'pass');
  assert.equal(decide(cell, 'cold', slow, 10, true, true).decision, 'pass');
  assert.equal(decide({ ...cell, count: 3336 }, 'cold', slow.map(r => ({ ...r, elapsedMs: 1000 })), 10, true, true).decision, 'pass');
});

test('P1 public measurement observation accounts exact transferred UTF-8 payload and numeric work', async t => {
  const { memberFixture, namespace } = await import('../testing/topic-members-fixture.mjs');
  const { attempt } = await import('../../tools/testing/measure-topic-member-previews.mjs');
  const f = memberFixture(t); f.admit('transport');
  const result = await attempt({ path: f.path, namespace, cell: { limit: 24 }, input: {
    namespace, selection: { type: 'unfiled' }, accessRevision: 'transport', limit: 24,
    previews: { version: 'topic-member-previews-v1', maxChars: 72 },
  } });
  assert.equal(result.failure, null); assert.equal(result.actualTransportPayloadBytes, result.bytes);
  assert.equal(result.bounds, true); assert.ok(result.counters.workUnits > 0);
  assert.equal(result.counters.extractions, 1);
});
