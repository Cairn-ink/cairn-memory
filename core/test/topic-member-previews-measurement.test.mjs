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

const writers = (reviewMs = 25000) => ['capture','review'].map(operation => ({ operation,
  startedAt: 1, finishedAt: 5, writeStartedAt: 2, writeFinishedAt: 4,
  writeElapsedMs: 2, elapsedMs: 4, commits: 1, failure: null,
  deadlineMs: operation === 'capture' ? 25000 : reviewMs, deadlineOverrun: false }));
const concurrent = (elapsedMs, extra = {}) => record(elapsedMs, {
  readStartedAt: 0, readFinishedAt: 10, writes: writers(), ...extra,
});

test('P1 concurrent main/cold gates exclude fast missed overlaps, retaining every attempt', () => {
  for (const cold of [false,true]) {
    const loadCell = { ...cell, load: 'other-owner' };
    const slow = cold ? 800 : 200;
    const exposed = Array.from({ length: 50 }, (_, i) => concurrent(i < 46 ? 50 : slow));
    const missed = Array.from({ length: 400 }, () => concurrent(1, { overlap: false }));
    const result = decide(loadCell, cold ? 'cold' : 'main', [...exposed,...missed], cold ? 10 : 50, true, cold);
    assert.equal(result.summary.attempts, 450); assert.equal(result.summary.successfulPages, 450);
    assert.equal(result.summary.gatedPages, 50); assert.equal(result.summary.missedOverlaps, 400);
    assert.equal(result.summary.gatedPopulation.p95Ms, slow);
    assert.equal(result.summary.successfulPopulation.p95Ms, 50);
    assert.equal(result.decision, 'fail');
  }
});
test('P1 missing page evidence is inconclusive, while observed hard violations still fail', () => {
  const busy = Array.from({ length: 500 }, () => record(1, { successfulPage: false, status: null, failure: { code: 'storage_busy' } }));
  const result = decide(cell, 'main', busy, 50, true);
  assert.equal(result.summary.successfulPages, 0); assert.equal(result.checks.p95, null);
  assert.equal(result.checks.maximum, null); assert.equal(result.decision, 'inconclusive');
  for (const extra of [{ hostLoop: { maxMs: 101, blocksOver100: 1 } }, { bounds: false },
    { writes: [{ ...writers()[0], deadlineOverrun: true }] }]) {
    assert.equal(decide(cell, 'main', [...busy,record(1, { successfulPage: false, ...extra })], 50, true).decision, 'fail');
  }
  assert.equal(decide({ ...cell, journal: 'WAL' }, 'cold', busy.slice(0,100), 10, true, true).decision, 'fail');
  assert.equal(decide(cell, 'cold', [], 10, true, true).decision, 'inconclusive');
});
test('P1 staleness is expected only with actual same-owner committed write overlap', () => {
  const successes = Array.from({ length: 50 }, () => concurrent(50));
  const stale = concurrent(1, { successfulPage: false, status: null, failure: { code: 'cursor_stale' } });
  for (const load of ['idle','other-owner']) {
    const result = decide({ ...cell, load }, 'main', [...successes,stale], 50, true);
    assert.equal(result.checks.expectedFailures, false); assert.equal(result.decision, 'fail');
  }
  assert.equal(decide({ ...cell, load: 'same-owner' }, 'main', [...successes,stale], 50, true).decision, 'pass');
  for (const changed of [{ overlap: false }, { writes: writers().map(w => ({ ...w, commits: 0 })) },
    { writes: writers().map(w => ({ ...w, writeStartedAt: 11, writeFinishedAt: 12 })) }]) {
    assert.equal(decide({ ...cell, load: 'same-owner' }, 'main', [...successes,{ ...stale,...changed }], 50, true).decision, 'fail');
  }
});
test('P1 replay/report/rethrow failures contain fixed codes and numeric mismatches only', async () => {
  const { assertReplay, safeFailure, recordFailure } = await import('../../tools/testing/measure-topic-member-previews.mjs');
  const left = 'PRIVATE_PREVIEW_LEFT', right = 'PRIVATE_PREVIEW_RIGHT';
  let mismatch;
  try { assertReplay({ items: [{ preview: { text: left } }] }, { items: [{ preview: { text: right } }] }); }
  catch (error) { mismatch = error; }
  assert.equal(mismatch.code, 'replay_mismatch'); assert.equal(mismatch.mismatchCount, 1);
  const report = {}; let rethrown;
  try { recordFailure(report, mismatch); } catch (error) { rethrown = error; }
  assert.equal(report.status, 'failed'); assert.equal(report.failure.code, 'replay_mismatch');
  assert.equal(typeof report.failure.actualBytes, 'number'); assert.equal(typeof report.failure.expectedBytes, 'number');
  const raw = Object.assign(Error(left), { code: right, cause: { text: left }, stack: right, actualBytes: 7 });
  assert.deepEqual(safeFailure(raw), { code: 'measurement_failed', actualBytes: 7 });
  const retained = JSON.stringify(report) + rethrown.message + rethrown.stack + JSON.stringify(rethrown) + JSON.stringify(safeFailure(raw));
  assert.equal(retained.includes(left), false); assert.equal(retained.includes(right), false);
});
test('P1 null-review production profile is accepted unchanged and review comparison is not a deadline', async t => {
  const { main, writerProfileInput, PROTOCOL } = await import('../../tools/testing/measure-topic-member-previews.mjs');
  const { createTestWorkspace } = await import('../../tools/testing/workspace.mjs');
  const { writeFileSync, readFileSync } = await import('node:fs'); const { join } = await import('node:path');
  const workspace = createTestWorkspace(t, { prefix: 'preview-profile-' });
  const profile = { captureMs: 25000, reviewMs: null, provenance: 'Production capture 25000ms; review has no deadline.' };
  assert.deepEqual(writerProfileInput(profile), profile);
  const profilePath = join(workspace.path, 'profile.json'), reportPath = join(workspace.path, 'plan.json');
  writeFileSync(profilePath, JSON.stringify(profile));
  await main(['--plan','--writer-profile',profilePath,'--report',reportPath]);
  assert.deepEqual(JSON.parse(readFileSync(reportPath)).writerProfile, profile);
  const attempts = Array.from({ length: 50 }, () => concurrent(50, { writes: writers(null).map(w =>
    w.operation === 'review' ? { ...w, writeElapsedMs: 6000, deadlineOverrun: null } : w) }));
  const result = decide({ ...cell, load: 'other-owner' }, 'main', attempts, 50, true);
  assert.equal(result.checks.captureDeadline, true); assert.equal(result.checks.reviewDeadline, null);
  assert.equal(result.decision, 'inconclusive');
  assert.equal(result.summary.writers.review.deadlineGate, 'inconclusive');
  assert.deepEqual(result.summary.writers.review.informationalComparison, { ...PROTOCOL.reviewInformation, observedAboveComparison: 50 });
  assert.equal(PROTOCOL.reviewInformation.label, 'not a deadline'); assert.equal(PROTOCOL.reviewInformation.acceptanceGate, false);
  attempts[0].writes[0].deadlineOverrun = true;
  assert.equal(decide({ ...cell, load: 'other-owner' }, 'main', attempts, 50, true).decision, 'fail');
});
test('P1 missing content extraction evidence is inconclusive; mismatched source counters fail', () => {
  const required = { ...cell, edgeCasesRequired: true }, attempts = Array.from({ length: 50 }, () => record(50));
  assert.equal(decide(required, 'main', attempts, 50, true).decision, 'inconclusive');
  attempts[0].counters = { edgeCaseExtractions: [1,1,1,1], edgeCaseSourceBytes: [36,24,3014,12000], edgeCaseMismatches: 0 };
  assert.equal(decide(required, 'main', attempts, 50, true).decision, 'pass');
  attempts[0].counters.edgeCaseMismatches = 1;
  assert.equal(decide(required, 'main', attempts, 50, true).decision, 'fail');
});
test('P1 every measured selection extracts all four content cases in its first page, using numeric coverage', async t => {
  const { seed, attempt } = await import('../../tools/testing/measure-topic-member-previews.mjs');
  const { createTestWorkspace } = await import('../../tools/testing/workspace.mjs');
  const workspace = createTestWorkspace(t, { prefix: 'preview-edge-cases-' }), fixture = await seed(112,18,workspace);
  assert.equal(fixture.physical.memories,112); assert.equal(fixture.physical.namespaces,4);
  assert.equal(fixture.physical.l1,60); assert.equal(fixture.physical.l2,11);
  for (const selection of ['L1','L2','unfiled']) for (const limit of [24,100]) {
    const result = await attempt({ path: fixture.path, namespace: fixture.namespace, sourceCases: fixture.sourceCases,
      cell: { limit }, input: { namespace: fixture.namespace,
        selection: selection === 'unfiled' ? { type: 'unfiled' } : fixture.selection[selection],
        accessRevision: 'edge-coverage', limit, previews: { version: 'topic-member-previews-v1', maxChars: 72 } } });
    assert.equal(result.failure, null); assert.equal(result.bounds, true);
    assert.deepEqual(result.counters.edgeCaseExtractions, [1,1,1,1]);
    assert.equal(result.counters.edgeCaseSourceBytes[3],12000); assert.equal(result.counters.edgeCaseMismatches,0);
    assert.ok(result.counters.normalizationUnits >= 7000);
    assert.ok(Object.values(result.counters).every(value => typeof value !== 'string'));
  }
});

test('P1 CLI sanitizes parse failures before writing reports or stderr', async t => {
  const { createTestWorkspace } = await import('../../tools/testing/workspace.mjs');
  const { writeFileSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path'); const { fileURLToPath } = await import('node:url');
  const { spawnSync } = await import('node:child_process');
  const workspace = createTestWorkspace(t, { prefix: 'preview-safe-cli-' });
  const input = join(workspace.path,'invalid.json'), output = join(workspace.path,'report.json');
  const sentinel = 'PRIVATE_PREVIEW_PARSE_FAILURE'; writeFileSync(input, sentinel);
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('../../tools/testing/measure-topic-member-previews.mjs',import.meta.url)),
    '--plan','--writer-profile',input,'--report',output], { env: {}, encoding: 'utf8' });
  assert.equal(child.status,1); assert.equal(child.signal,null);
  assert.equal((child.stdout + child.stderr).includes(sentinel),false);
  assert.deepEqual(JSON.parse(child.stderr), { failure: { code: 'measurement_failed' } });
  assert.equal(existsSync(output),false);
});
