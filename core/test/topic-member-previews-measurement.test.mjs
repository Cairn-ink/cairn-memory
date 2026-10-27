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
    assert.ok(result.counters.sqlite.calls > 0);
    assert.ok(result.counters.sqlite.totalMs >= result.counters.sqlite.longest.elapsedMs);
    assert.equal(result.hostMessages.length, 1);
    assert.ok(result.hostMessages[0].finishedAt >= result.hostMessages[0].startedAt);
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

test('P1 failed cold children always release heartbeats and allow natural process exit', async () => {
  const { spawnSync } = await import('node:child_process');
  const tool = new URL('../../tools/testing/measure-topic-member-previews.mjs', import.meta.url).href;
  const probe = String.raw`
    import assert from 'node:assert/strict';
    const { coldAttempt } = await import(process.argv[1]);
    const fault = process.argv[2], intervals = new Set();
    const nativeSet = globalThis.setInterval, nativeClear = globalThis.clearInterval;
    globalThis.setInterval = (...args) => {
      const timer = nativeSet(...args); intervals.add(timer); return timer;
    };
    globalThis.clearInterval = timer => { intervals.delete(timer); nativeClear(timer); };
    let killed = 0, exited = false;
    const spawn = () => {
      if (fault === 'spawn') throw Error('forced_spawn_failure');
      const monitor = setInterval(() => {}, 60000);
      let resolveExit;
      const child = { exitCode: null, signalCode: null,
        exited: new Promise(resolve => { resolveExit = resolve; }),
        async wait() {
          if (fault === 'wait') throw Error('forced_wait_failure');
          return { record: {} };
        },
        kill() {
          killed++; child.signalCode = 'SIGKILL';
          clearInterval(monitor); exited = true; resolveExit({ code: null, signal: 'SIGKILL' });
          return true;
        },
      };
      if (fault === 'exit-status') {
        child.exitCode = 7; clearInterval(monitor); exited = true;
        resolveExit({ code: 7, signal: null });
      } else if (fault === 'exit-wait') {
        child.exited = Promise.reject(Error('forced_exit_wait_failure'));
        child.exited.catch(() => {});
      }
      return child;
    };
    let failed = false;
    try { await coldAttempt({}, { spawn }); }
    catch { failed = true; process.exitCode = 1; } // Same exitCode-only CLI failure policy.
    assert.equal(failed, true);
    assert.equal(intervals.size, 0, 'cold failure left a live interval');
    assert.equal(process.getActiveResourcesInfo().filter(type => type === 'Timeout').length, 0);
    assert.equal(killed, fault === 'wait' || fault === 'exit-wait' ? 1 : 0);
    assert.equal(exited, fault !== 'spawn');
    console.log(JSON.stringify({ failed, liveIntervals: intervals.size, killed, exited }));
  `;
  for (const fault of ['spawn','wait','exit-status','exit-wait']) {
    const child = spawnSync(process.execPath, ['--input-type=module','--eval',probe,tool,fault], {
      env: {}, encoding: 'utf8', timeout: 10000,
    }); // Containment watchdog only; no elapsed-time performance assertion.
    assert.equal(child.error, undefined, 'cold failure probe did not exit naturally');
    assert.equal(child.signal, null); assert.equal(child.status, 1, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.failed, true); assert.equal(result.liveIntervals, 0);
  }
});

test('P1 seed ledger tracks removed parent/title-source revisions on both physical schemas', async t => {
  const { memberFixture, namespace, ok } = await import('../testing/topic-members-fixture.mjs');
  const { openDatabase } = await import('../database.mjs');
  const f = memberFixture(t), a = f.admit('title-source'), b = f.admit('survivor');
  const created = f.place(namespace, [{ memoryId: a.id, parentIds: [], newL1: {
    title: 'Topic', parentL2Ids: [], newL2Title: 'Root' } }]).createdMocs;
  const l1 = created.find(n => n.level === 'L1');
  f.place(namespace, [{ memoryId: b.id, parentIds: [l1.id] }]);
  const removed = f.place(namespace, [{ memoryId: a.id, parentIds: [] }]);
  assert.deepEqual(removed.refs, []);
  for (const schema of [18,33]) {
    if (schema === 33) { f.core.close(); const db = openDatabase(f.path, { currentDependencies: true }); db.close(); }
    assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, schema);
    // Unfiling the title source bumps both MOCs; neither is in resulting refs.
    for (const node of created) {
      const current = f.db.prepare('SELECT revision FROM mocs WHERE id=?').get(node.id).revision;
      assert.equal(f.mocs.get(node.id).revision, current);
      const reader = f.reader(), input = { namespace,
        selection: { type: 'moc', mocId: node.id, level: node.level, revision: f.mocs.get(node.id).revision },
        accessRevision: 'removed-parent', limit: 24, previews: { version: 'topic-member-previews-v1' } };
      try {
        assert.equal((await reader.readTopicMembers({ ...input,
          selection: { ...input.selection, revision: current - 1 } })).error.code, 'revision_conflict');
        const page = ok(await reader.readTopicMembers(input));
        assert.deepEqual(page.items.map(row => row.id), [b.id]);
      } finally { await reader.close(); }
    }
  }
});

test('P1 loop diagnostics retain absolute gaps and phase boundaries, including cold launcher blocks', async () => {
  const { observeLoop } = await import('../../tools/testing/measure-topic-member-previews.mjs');
  let time = 0;
  const loop = observeLoop({ now: () => time, epoch: 1000 });
  loop.phase('read'); time = 120; loop.sample();
  loop.phase('close'); time = 250; loop.sample();
  const result = await loop.finish();
  assert.equal(result.maxMs, 130); assert.equal(result.blocksOver100, 2);
  assert.deepEqual(result.blocks.map(b => [b.startedAt,b.finishedAt,b.gapMs,b.phaseEnd]),
    [[1000,1120,120,'read'],[1120,1250,130,'close']]);
  const cold = decide(cell, 'cold', [record(1, { launcherLoop: result })], 1, true, true);
  assert.equal(cold.checks.loop, false); assert.equal(cold.decision, 'fail');
  assert.equal(cold.summary.blocksOver100, 2); assert.equal(cold.summary.hostLoopMaximumMs, 130);
});

test('P1 report sink appends raw attempts once and assembles the existing JSON schema', async t => {
  const { createReportSink } = await import('../../tools/testing/measure-topic-member-previews.mjs');
  const { createTestWorkspace } = await import('../../tools/testing/workspace.mjs');
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'report.json');
  const sink = await createReportSink(path);
  const entries = [0,1].map(i => ({ cell: { ...cell, limit: i ? 100 : 24 },
    warmups: [record(2)], main: [record(3)], cold: [], retained: { records: [record(4)], complete: true } }));
  for (const [i, entry] of entries.entries()) {
    for (const series of ['warmups','main','cold']) for (const attempt of entry[series]) await sink.record(i, series, attempt);
    await sink.cell(entry);
  }
  const journal = (await readFile(path + '.records.jsonl','utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(journal.map(r => [r.cell,r.series,r.record.elapsedMs]), [[0,'warmups',2],[0,'main',3],[1,'warmups',2],[1,'main',3]]);
  await sink.finish({ cells: [], protocol: PROTOCOL, status: 'failed', failure: { code: 'measurement_failed' } });
  const report = JSON.parse(await readFile(path,'utf8'));
  assert.deepEqual(report.cells, entries); assert.deepEqual(report.protocol, PROTOCOL);
  assert.equal(report.status, 'failed'); assert.equal(report.failure.code, 'measurement_failed');
});

test('P1 measurement rejects unknown preview statuses and malformed unavailable shapes before deciding', async () => {
  const { EventEmitter } = await import('node:events');
  const { default: threads } = await import('node:worker_threads');
  const { syncBuiltinESMExports } = await import('node:module');
  const { attempt } = await import('../../tools/testing/measure-topic-member-previews.mjs');
  const native = threads.Worker;
  let preview;
  threads.Worker = class extends EventEmitter {
    stdout = { resume() {} }; stderr = { resume() {} };
    constructor(url, options) { super(); this.metricsPort = options.workerData.previewMetricsPort; }
    ref() {} unref() {} async terminate() { return 0; }
    postMessage() {
      const result = { ok: true, value: { status: 'page', items: [{ preview }], nextCursor: null } };
      const bytes = new TextEncoder().encode(JSON.stringify(result));
      this.metricsPort.postMessage({ extractions: 1, sourceBytes: 1, decodedUnits: 1, normalizationUnits: 1 });
      setImmediate(() => this.emit('message', bytes.buffer));
    }
  };
  syncBuiltinESMExports();
  try {
    const invalid = [
      { status: 'unexpected', text: 'x'.repeat(2048) },
      { status: 'unexpected' }, {}, null,
      { status: 'unavailable' }, { status: 'unavailable', reason: 'unexpected' },
      { status: 'unavailable', reason: 'empty', text: 'x'.repeat(2048) },
      { status: 'unavailable', reason: 'empty', truncated: false },
      { status: 'available', text: 'x'.repeat(73), truncated: true },
      { status: 'available', text: 'a' + '\u0301'.repeat(600), truncated: true },
      { status: 'available', text: 'ok' },
    ];
    const valid = ['empty','trimmed_prefix_empty','content_limit','invalid_text','grapheme_too_large','segmenter_unavailable']
      .map(reason => ({ status: 'unavailable', reason }));
    valid.push({ status: 'available', text: '界'.repeat(72), truncated: false });
    for (const [value, expected] of [...invalid.map(p => [p, false]), ...valid.map(p => [p, true])]) {
      preview = value;
      const observed = await attempt({ path: 'unused.sqlite', namespace: { ownerId: 'bounds-owner', scope: 'personal', projectId: null },
        cell, input: { namespace: { ownerId: 'bounds-owner', scope: 'personal', projectId: null },
          selection: { type: 'unfiled' }, accessRevision: 'bounds', previews: { version: PROTOCOL.version }, limit: 24 } });
      assert.equal(observed.failure, null);
      assert.equal(observed.bounds, expected, JSON.stringify(value));
      const decision = decide(cell, 'main', Array.from({ length: 50 }, () => ({ ...observed,
        hostLoop: { maxMs: 1, blocksOver100: 0 }, elapsedMs: 1 })), 50, true);
      assert.equal(decision.checks.bytes, expected);
      assert.equal(decision.decision, expected ? 'pass' : 'fail');
      assert.deepEqual(Object.keys(observed.reasons).sort(), valid.slice(0,6).map(p => p.reason).sort());
    }
  } finally { threads.Worker = native; syncBuiltinESMExports(); }
});

test('P1 isolated database cloning preserves bytes/schema/journal and host POSIX locks', async t => {
  const { cloneDatabase, seed } = await import('../../tools/testing/measure-topic-member-previews.mjs');
  const { fileBytes } = await import('../testing/topic-overview-raw29-fixture.mjs');
  const { createTestWorkspace } = await import('../../tools/testing/workspace.mjs');
  const { DatabaseSync } = await import('node:sqlite');
  const { spawnSync } = await import('node:child_process');
  const { join } = await import('node:path');
  const workspace = createTestWorkspace(t);
  for (const schema of [18,33]) {
    const fixture = await seed(112, schema, workspace);
    for (const mode of ['DELETE','WAL']) {
      const setup = new DatabaseSync(fixture.path);
      setup.exec(`PRAGMA journal_mode=${mode}`); setup.close(); // Checkpoints WAL.
      const source = new DatabaseSync(fixture.path, { readOnly: true });
      source.exec('BEGIN'); source.prepare('SELECT * FROM store_metadata').all();
      const probe = () => {
        const result = spawnSync(process.execPath, ['--input-type=module','--eval', `
          import { DatabaseSync } from 'node:sqlite';
          const db = new DatabaseSync(process.argv[1]); db.exec('PRAGMA busy_timeout=0');
          try { db.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE'); db.prepare('SELECT * FROM store_metadata').all(); console.log(0); }
          catch (e) { console.log(e.errcode & 255); }
          finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
        `, fixture.path], { env: {}, encoding: 'utf8', timeout: 10000 });
        assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
        assert.equal(result.signal, null); assert.equal(result.stdout.trim(), '5');
      };
      try {
        probe(); fileBytes(fixture.path); probe();
        const copies = [0,1].map(i => join(workspace.path, `clone-${schema}-${mode}-${i}.sqlite`));
        for (const path of copies) { cloneDatabase(fixture.path, path); probe(); }
        // Only the SQLite-free child opens raw database descriptors for hashing.
        const hashes = spawnSync(process.execPath, ['--input-type=module','--eval', `
          import { readFileSync } from 'node:fs'; import { createHash } from 'node:crypto';
          console.log(JSON.stringify(process.argv.slice(1).map(path => createHash('sha256').update(readFileSync(path)).digest('hex'))));
        `, fixture.path, ...copies], { env: {}, encoding: 'utf8', timeout: 10000 });
        assert.equal(hashes.error, undefined); assert.equal(hashes.status, 0, hashes.stderr); assert.equal(hashes.signal, null);
        assert.equal(new Set(JSON.parse(hashes.stdout)).size, 1);
        for (const path of copies) {
          const db = new DatabaseSync(path, { readOnly: true });
          try {
            assert.equal(db.prepare('PRAGMA user_version').get().user_version, schema);
            assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode.toUpperCase(), mode);
            assert.deepEqual(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), source.prepare('SELECT * FROM sqlite_master ORDER BY name').all());
            assert.equal(db.prepare('SELECT count(*) n FROM memories').get().n, 112);
          } finally { db.close(); }
        }
      } finally { source.exec('ROLLBACK'); source.close(); }
    }
  }
  assert.throws(() => cloneDatabase(join(workspace.path, 'missing.sqlite'), join(workspace.path, 'failed.sqlite')),
    { code: 'child_failed' });
});

test('P1 SQLite diagnostics count iterator execution, metadata and native finalization without SQL or row data', async () => {
  const { Worker, MessageChannel } = await import('node:worker_threads');
  const { port1, port2 } = new MessageChannel(), observations = [];
  port1.on('message', value => observations.push(value.sqlite));
  const worker = new Worker(`
    const { workerData } = await import('node:worker_threads');
    const { performance } = await import('node:perf_hooks');
    let tick = 0; Object.defineProperty(performance, 'now', { value: () => ++tick });
    await import(workerData.preload);
    const { DatabaseSync } = await import('node:sqlite');
    const { channel } = await import('node:diagnostics_channel');
    const report = () => channel('cairn.topic-member-previews.metrics').publish({});
    const db = new DatabaseSync(':memory:');
    const statement = db.prepare("SELECT 'PRIVATE_SQL_ROW_SENTINEL' AS value UNION ALL SELECT 'second'"); report();
    const iterator = statement.iterate(); report();
    iterator.next(); report(); iterator.next(); report(); iterator.next(); report();
    iterator.return(); report(); statement.columns(); report();
    const abandoned = statement.iterate(); report(); abandoned.next(); report(); abandoned.return(); report();
    try { statement.get('extra parameter'); } catch {} report();
    if (typeof statement.close === 'function') { statement.close(); report(); }
    if (typeof statement[Symbol.dispose] === 'function') {
      const other = db.prepare('SELECT 1'); report(); other[Symbol.dispose](); report();
    }
    db.close(); report(); workerData.previewMetricsPort.close();
  `, { eval: true, type: 'module', workerData: { previewMetricsPort: port2,
    preload: new URL('../../tools/testing/fixtures/topic-member-previews-metrics.mjs', import.meta.url).href }, transferList: [port2] });
  try {
    await new Promise((resolve, reject) => { worker.once('error', reject); worker.once('exit', code => code === 0 ? resolve() : reject(Error('probe exit ' + code))); });
    await new Promise(resolve => setImmediate(resolve));
    const stages = ['prepare','iterate','iterate_next','iterate_next','iterate_next','iterate_return','columns',
      'iterate','iterate_next','iterate_return','get'];
    if (process.versions.node.startsWith('24.')) stages.push('close','prepare','dispose');
    stages.push('close');
    assert.deepEqual(observations.map(s => s.longest.stage), stages);
    for (const metrics of observations) {
      assert.equal(metrics.calls, 1); assert.equal(metrics.totalMs, 1); assert.equal(metrics.longest.elapsedMs, 1);
      assert.equal(typeof metrics.longest.startedAt, 'number');
      assert.ok(['topic_metadata','connection'].includes(metrics.longest.statement));
      assert.deepEqual(Object.keys(metrics).sort(), ['calls','longest','totalMs']);
      assert.deepEqual(Object.keys(metrics.longest).sort(), ['elapsedMs','stage','startedAt','statement']);
    }
    assert.equal(JSON.stringify(observations).includes('PRIVATE_SQL_ROW_SENTINEL'), false);
  } finally { port1.close(); await worker.terminate(); }
});
