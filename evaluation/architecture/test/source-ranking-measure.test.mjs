import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { CELLS, POLICY, PREFIX_SHA256, WATCHDOG_MS, ChildSupervisor, assertChild, cellSpec,
  childEnvironment, contentionGate, parseOptions, prepareStore, queryMeasurement,
  resourceGate, runCampaign, validateRanking, worstWorkload, measureContention } from '../source-ranking-measure.mjs';

const [major, minor] = process.versions.node.split('.').map(Number);
const native = { skip: major < 22 || major === 22 && minor < 16
  ? 'Actual owned SQLite subprocesses require Node >=22.16; pure measurement tests still run.' : false };
const numericRanking = (spec, patch = {}) => ({ version: POLICY, physicalRows: spec.authorized,
  eligibleMemories: spec.authorized, receiptReads: spec.authorized * spec.receiptsPerRow,
  retainedRows: Math.min(spec.authorized, 1024), maskBytes: spec.authorized * 5 * Math.ceil(spec.queryTokenCount / 32) * 4,
  queryTokenCount: spec.queryTokenCount, retainedReceiptReads: 0, ...patch });
const raw = (value, patch = {}) => ({ status: 0, signal: null, timedOut: false, error: null,
  messages: [{ type: 'result', value }], stdout: '', stderr: '', ...patch });

test('H5 import is inert, CLI is exact, frozen cells and prospective hash remain fixed', () => {
  assert.deepEqual(CELLS, ['1000', '20000', 'worst1000', 'foreign1000', 'worst20000']);
  assert.equal(WATCHDOG_MS, 60_000);
  assert.equal(PREFIX_SHA256, '8ed97e23f6449d68e67fe8901cc5ec59410bc3a95d9e6e6411a53e9c7309926f');
  assert.deepEqual(parseOptions([]), { cells: CELLS, contentionOnly: false });
  assert.deepEqual(parseOptions(['--cell', 'worst20000', '--contention-only']), { cells: ['worst20000'], contentionOnly: true });
  for (const args of [['--unknown'], ['--cell'], ['--cell', '0'], ['--cell', '1000', '--cell', '20000'],
    ['--contention-only', '--contention-only'], ['--cell', '1000', '--contention-only']]) assert.throws(() => parseOptions(args));
  const source = readFileSync(new URL('../source-ranking-measure.mjs', import.meta.url), 'utf8');
  assert.ok(!source.includes("from 'node:sqlite'"), 'Node20 pure import must not resolve sqlite');
});

test('H5 exact worst20000 query and all dense/sparse passage sizes are independent of IDs', () => {
  const workload = worstWorkload();
  const queryTokens = workload.query.match(/[\p{L}\p{N}]+/gu);
  assert.equal(workload.query.length, 4000);
  assert.equal(workload.query.normalize('NFKC'), workload.query);
  assert.equal(new Set(queryTokens).size, 2000);
  assert.equal(queryTokens[0], String.fromCodePoint(0x4e00));
  assert.equal(queryTokens.at(-1), String.fromCodePoint(0x4e00 + 1999));
  let dense = 0; let sparse = 0;
  for (let i = 0; i < 20_000; i += 1) {
    const { body, receipts } = workload.passages(i);
    assert.equal(body.length, 4000); assert.equal(receipts.length, 4);
    assert.equal(new Set(receipts).size, 4);
    for (const passage of receipts) assert.equal(passage.length, 800);
    if (i % 2 === 0) {
      dense += 1; assert.equal(body, workload.query);
      for (let j = 0; j < 4; j += 1) assert.equal(receipts[j], `${queryTokens.slice(j * 400, (j + 1) * 400).join(' ')}?`);
    } else {
      sparse += 1;
      assert.equal(body, `${queryTokens[i % 2000]} ${'x'.repeat(3998)}`);
      for (let j = 0; j < 4; j += 1) assert.equal(receipts[j], `${queryTokens[(i + j + 1) % 2000]} ${'x'.repeat(798)}`);
    }
  }
  assert.deepEqual([dense, sparse], [10_000, 10_000]);
});

test('H5 sanitized child environment forwards no credentials, profile or Node injection', t => {
  const workspace = createTestWorkspace(t);
  assert.deepEqual(childEnvironment({ PATH: '/bin', TMPDIR: workspace.path, TMP: 'relative', TEMP: '/does-not-exist',
    OPENAI_API_KEY: 'synthetic-secret', NODE_OPTIONS: '--import=evil.mjs', CAIRN_DB: '/user/store', HOME: '/user' }),
  { PATH: '/bin', NODE_NO_WARNINGS: '1', TMPDIR: workspace.path });
});

test('H5 numeric metadata enforces active policy, exact counts and proportional hard mask limit', () => {
  for (const cell of CELLS) {
    const spec = cellSpec(cell);
    const ranking = numericRanking(spec);
    assert.equal(validateRanking(ranking, spec), ranking.maskBytes);
    for (const patch of [{ version: undefined }, { physicalRows: spec.authorized + 1 }, { receiptReads: 0 },
      { maskBytes: ranking.maskBytes + 4 }, { queryTokenCount: 2001 }, { retainedReceiptReads: ranking.retainedRows + 1 },
      { rareTokens: ['must never serialize'] }, { maskBytes: -1 }, { retainedRows: NaN }]) {
      assert.throws(() => validateRanking({ ...ranking, ...patch }, spec));
    }
  }
  assert.equal(numericRanking(cellSpec('worst20000')).maskBytes, 25_200_000);
});

test('H5 private query options preserve disabled shape and reject silently ignored new policy', () => {
  const spec = { ...cellSpec('1000'), authorized: 1 };
  let options;
  const runtime = { queryCandidateRows(namespace, input) {
    assert.equal(namespace.ownerId, 'keyset-measure'); options = input;
    input.score('synthetic row'); input.score('receipt');
    return { rows: [{}], scanExhausted: true };
  } };
  const old = queryMeasurement(runtime, spec, 'old');
  assert.equal(old.scored, 2);
  assert.equal(Object.hasOwn(options, 'sourceRankingPolicy'), false);
  assert.equal(Object.hasOwn(options, 'query'), false);
  assert.throws(() => queryMeasurement(runtime, spec, 'new'), /ranking_policy_not_active/);
  assert.equal(options.sourceRankingPolicy, POLICY); assert.equal(options.query, 'tailmarker');
  const enabled = { queryCandidateRows() { return { rows: [{}], scanExhausted: true, ranking: numericRanking(spec) }; } };
  assert.equal(queryMeasurement(enabled, spec, 'new').ranking.version, POLICY);
  assert.throws(() => queryMeasurement({ queryCandidateRows(namespace, input) {
    input.score('synthetic'); return enabled.queryCandidateRows();
  } }, spec, 'new'), /new_ranking_called_legacy_scorer/);
});

test('H5 both measured arms run the actual query-aware excerpt callback beyond the prefix', () => {
  const spec = { ...cellSpec('1000'), authorized: 1 };
  const content = `${'.'.repeat(250)} tailmarker ${'z'.repeat(150)}`;
  assert.equal(content.slice(0, 120).includes('tailmarker'), false);
  for (const arm of ['old', 'new']) {
    let label;
    const runtime = { queryCandidateRows(namespace, input) {
      label = input.memoryLabel(content);
      if (arm === 'old') { input.score(content); input.score('receipt'); }
      return { rows: [{}], scanExhausted: true,
        ...(arm === 'new' ? { ranking: numericRanking(spec) } : {}) };
    } };
    queryMeasurement(runtime, spec, arm);
    assert.equal(label, `${'.'.repeat(109)} tailmarker`);
    assert.equal([...label].length, 120);
  }
});

test('H5 paired gates retain all observations and freeze elapsed/CPU/RSS tolerances', () => {
  const observations = Array.from({ length: 3 }, (_, pair) => ['old', 'new'].map(arm => ({ pair, arm,
    elapsedMs: arm === 'old' ? 10 : 30, cpuTotalMs: arm === 'old' ? 5 : 20,
    peakRssBytes: arm === 'old' ? 100_000_000 : 100_000_000 + 64 * 1024 * 1024 }))).flat();
  assert.equal(resourceGate(observations).status, 'pass');
  const worse = observations.map(row => ({ ...row, elapsedMs: row.arm === 'new' ? 30.001 : row.elapsedMs }));
  assert.equal(resourceGate(worse).status, 'fail');
  assert.throws(() => resourceGate(observations.slice(1)), /three_pairs_required/);
  assert.throws(() => resourceGate(observations.map(row => ({ ...row, pair: 0 }))), /invalid_paired_observations/);
  assert.throws(() => resourceGate(observations.map(row => ({ ...row, cpuTotalMs: NaN }))), /invalid_resource_metric/);
});

const goodProbe = { probeIntervalMs: 5, lastSuccessRelease: '100000000', firstBusy: '110000000',
  firstAcquire: '140000000', firstRelease: '141000000', writerWaitMs: 30,
  writerSucceeded: true, writerTimeoutMs: 5000 };
const queryInterval = { queryStart: '105000000', queryEnd: '145000000' };
test('H5 contention uses conservative last-success to first-release bracket and proven query overlap', () => {
  const pass = contentionGate(queryInterval, goodProbe);
  assert.equal(pass.status, 'pass'); assert.equal(pass.bracketMs, 41); assert.equal(pass.overlap, true);
  for (const patch of [{ firstBusy: undefined }, { firstAcquire: undefined },
    { lastSuccessRelease: '150000000' }, { firstRelease: '2700000000' }, { writerWaitMs: 2500 }]) {
    assert.equal(contentionGate(queryInterval, { ...goodProbe, ...patch }).status, 'inconclusive');
  }
  assert.equal(contentionGate({ queryStart: '120000000', queryEnd: '130000000' }, goodProbe).status, 'inconclusive');
  for (const patch of [{ writerSucceeded: false }, { writerError: 'ERR_SQLITE_ERROR' }, { writerWaitMs: 5000 },
    { probeIntervalMs: 6 }, { writerTimeoutMs: 10_000 }]) assert.equal(contentionGate(queryInterval, { ...goodProbe, ...patch }).status, 'fail');
  assert.equal(contentionGate(queryInterval, { ...goodProbe, writerSucceeded: false, status: 'pass' }).status, 'fail');
});

function fakeLaunch(behavior, launches = []) {
  return (executable, args, options) => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.connected = true; child.kills = []; child.sent = [];
    child.send = (message, callback) => { child.sent.push(message); callback?.(); };
    child.kill = signal => { child.kills.push(signal); setImmediate(() => child.finish(null, signal)); return true; };
    child.finish = (status = 0, signal = null) => {
      if (child.finished) return; child.finished = true; child.connected = false;
      child.emit('close', status, signal);
    };
    launches.push({ executable, args, options, child });
    setImmediate(() => behavior(child, JSON.parse(args[2])));
    return child;
  };
}

test('H5 supervisor records actual close status/raw diagnostics and waits for ready before GO', async () => {
  const launches = []; const records = [];
  const supervisor = new ChildSupervisor({ observe: row => records.push(row), launch: fakeLaunch(child => {
    child.emit('message', { type: 'ready' }); child.stdout.emit('data', 'raw stdout'); child.stderr.emit('data', 'raw stderr');
  }, launches) });
  const handle = supervisor.start({ role: 'query', cell: '1000' });
  await handle.wait('ready'); assert.equal(launches[0].child.sent.length, 0);
  handle.send({ type: 'go' });
  launches[0].child.emit('message', { type: 'result', value: { retained: 1 } });
  launches[0].child.finish(7);
  const result = await handle.done;
  assert.equal(result.status, 7); assert.equal(result.stdout, 'raw stdout'); assert.equal(result.stderr, 'raw stderr');
  assert.equal(records.length, 1); assert.throws(() => assertChild(result), /child_nonzero_exit/);
  assert.equal(supervisor.children.size, 0); assert.equal(launches[0].options.env.OPENAI_API_KEY, undefined);
  assert.ok(launches[0].options.stdio.includes('ipc'));
});

test('H5 watchdog and failed handshake clean every owned child and preserve failure evidence', async () => {
  const records = []; const launches = [];
  const supervisor = new ChildSupervisor({ watchdogMs: 15, observe: row => records.push(row), launch: fakeLaunch(() => {}, launches) });
  const first = supervisor.start({ role: 'query' });
  const missingReady = assert.rejects(first.wait('ready'), /child_closed_before_handshake/);
  const result = await first.done; await missingReady;
  assert.equal(result.timedOut, true); assert.equal(result.signal, 'SIGKILL');
  assert.throws(() => assertChild(result));
  const second = supervisor.start({ role: 'probe' }); const third = supervisor.start({ role: 'query' });
  await supervisor.stopAll(); await Promise.all([second.done, third.done]);
  assert.equal(supervisor.children.size, 0); assert.equal(records.length, 3);
  assert.ok(launches.every(row => row.child.kills.includes('SIGKILL')));
});

test('H5 process errors, missing results and excessive child output cannot count as success', async () => {
  for (const mutate of [child => child.emit('error', Object.assign(new Error('synthetic'), { code: 'ENOENT' })),
    child => child.stdout.emit('data', 'x'.repeat(65_537))]) {
    const supervisor = new ChildSupervisor({ launch: fakeLaunch(child => { mutate(child); child.finish(0); }) });
    const result = await supervisor.start({ role: 'query' }).done;
    assert.throws(() => assertChild(result)); await supervisor.stopAll();
  }
  assert.throws(() => assertChild(raw(null, { messages: [] })), /invalid_child_result_count/);
  assert.throws(() => assertChild(raw(null, { messages: [{ type: 'result' }, { type: 'result' }] })), /invalid_child_result_count/);
});

test('H5 contention coordinator readies both connections and closes both on protocol failure', async () => {
  const launches = []; const protocol = [];
  const supervisor = new ChildSupervisor({ launch: fakeLaunch((child, input) => {
    if (input.role === 'query') assert.equal(launches.length, 1, 'probe cannot open before query ready');
    protocol.push(`ready:${input.role}`);
    child.send = (message, callback) => {
      protocol.push(`${message.type}:${input.role}`); callback?.();
      if (input.role === 'query' && message.type === 'go') {
        child.emit('message', { type: 'starting' });
        setImmediate(() => { child.emit('message', { type: 'result', value: queryInterval }); child.finish(); });
      } else if (input.role === 'probe' && message.type === 'go') {
        child.emit('message', { type: 'result', value: goodProbe }); child.finish();
      }
    };
    child.emit('message', { type: 'ready' });
  }, launches) });
  assert.equal((await measureContention(supervisor, '/synthetic', '20000', 'old')).status, 'pass');
  assert.deepEqual(protocol.slice(0, 4), ['ready:query', 'ready:probe', 'go:query', 'go:probe']);
  assert.equal(supervisor.children.size, 0);
  const failed = new ChildSupervisor({ launch: fakeLaunch((child, input) => {
    if (input.role === 'query') child.finish(9);
    else child.emit('message', { type: 'ready' });
  }) });
  await assert.rejects(measureContention(failed, '/synthetic', '20000', 'old'), /child_closed_before_handshake/);
  assert.equal(failed.children.size, 0);
});

function campaignSupervisor(events, { failAt = -1, changeStoreAt = -1 } = {}) {
  let ordinal = 0;
  return { stopped: false, inputs: [], async stopAll() { this.stopped = true; }, start(input) {
    this.inputs.push(input);
    const index = ordinal++;
    if (input.role === 'prepare') writeFileSync(input.path, 'owned immutable synthetic placeholder');
    if (index === changeStoreAt) writeFileSync(input.path, 'changed');
    const value = input.role === 'prepare' ? cellSpec(input.cell) : { arm: input.arm, cell: input.cell,
      elapsedMs: 1, cpuTotalMs: 1, peakRssBytes: 1 };
    const result = raw(value, index === failAt ? { status: 19 } : {});
    events.push({ type: 'child', input, ...result });
    return { done: Promise.resolve(result) };
  } };
}

test('H5 campaign prepares once, cold arms alternate sequentially, failed child stops later work and scratch is cleaned', async () => {
  const events = []; const supervisor = campaignSupervisor(events);
  const result = await runCampaign({ cells: ['1000'], observe: row => events.push(row), supervisor });
  assert.equal(result.status, 'pass'); assert.equal(supervisor.stopped, true);
  assert.deepEqual(supervisor.inputs.map(row => [row.role, row.arm, row.pair]), [
    ['prepare', undefined, undefined], ['query', 'old', 0], ['query', 'new', 0],
    ['query', 'new', 1], ['query', 'old', 1], ['query', 'old', 2], ['query', 'new', 2]]);
  assert.equal(existsSync(supervisor.inputs[0].path), false);
  assert.equal(events.filter(row => row.type === 'child').length, 7);
  const failures = []; const failing = campaignSupervisor(failures, { failAt: 2 });
  await assert.rejects(runCampaign({ cells: ['1000', 'foreign1000'], observe: row => failures.push(row), supervisor: failing }), /child_nonzero_exit/);
  assert.equal(failing.inputs.length, 3); assert.equal(failing.stopped, true);
  assert.equal(existsSync(failing.inputs[0].path), false);
  assert.equal(failures.at(-1).status, 'stop'); assert.equal(failures.filter(row => row.type === 'child').at(-1).status, 19);
});

test('H5 unchanged-store assertion and signal path stop promotion and clean owned scratch', async () => {
  const events = []; const supervisor = campaignSupervisor(events, { changeStoreAt: 1 });
  await assert.rejects(runCampaign({ cells: ['1000'], supervisor, observe: row => events.push(row) }), /store_changed_between_arms/);
  assert.equal(existsSync(supervisor.inputs[0].path), false);
  const signaled = campaignSupervisor([]);
  const original = signaled.start;
  signaled.start = function (input) {
    const child = original.call(this, input);
    if (input.role === 'prepare') process.emit('SIGTERM');
    return child;
  };
  await assert.rejects(runCampaign({ cells: ['1000'], supervisor: signaled, observe: () => {} }), /campaign_interrupted/);
  assert.equal(signaled.stopped, true); assert.equal(signaled.inputs.length, 1);
  assert.equal(existsSync(signaled.inputs[0].path), false);
});

test('H5 actual fresh preparation/old query children validate counts/index/files and close without provider environment', native, async t => {
  const workspace = createTestWorkspace(t);
  const path = join(workspace.path, 'owned.sqlite');
  const records = []; const supervisor = new ChildSupervisor({ observe: row => records.push(row) });
  workspace.defer(() => supervisor.stopAll());
  const prepared = assertChild(await supervisor.start({ role: 'prepare', path, cell: '1000' }).done);
  assert.equal(prepared.memories, 1002); assert.equal(prepared.receipts, 1002);
  const before = readFileSync(path);
  const result = assertChild(await supervisor.start({ role: 'query', path, cell: '1000', arm: 'old' }).done);
  assert.equal(result.scored, 2000); assert.equal(result.retained, 1000);
  assert.ok(result.queryPlan.some(detail => detail.includes('capture_current_memories')));
  assert.ok(result.databaseMainBytes > 0); assert.ok(result.cpuTotalMs >= 0); assert.ok(result.peakRssBytes >= result.rssBefore);
  assert.deepEqual(readFileSync(path), before);
  assert.equal(records.length, 2); assert.equal(supervisor.children.size, 0);
});

test('H5 actual probe connection has successful baseline before GO and observes a bounded competing reservation', native, async t => {
  const workspace = createTestWorkspace(t);
  const path = join(workspace.path, 'owned.sqlite');
  await prepareStore(path, '1000');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path); workspace.defer(() => db.close());
  const supervisor = new ChildSupervisor(); workspace.defer(() => supervisor.stopAll());
  const probe = supervisor.start({ role: 'probe', path });
  const ready = await probe.wait('ready'); assert.ok(BigInt(ready.baselineSuccessRelease) > 0n);
  const goQuery = process.hrtime.bigint().toString();
  db.exec('BEGIN IMMEDIATE'); probe.send({ type: 'go' });
  await probe.wait('busy');
  await new Promise(resolveTimer => setTimeout(resolveTimer, 20));
  db.exec('ROLLBACK');
  const endQuery = process.hrtime.bigint().toString();
  const observed = assertChild(await probe.done);
  assert.equal(observed.writerSucceeded, true); assert.ok(observed.writerWaitMs > 0);
  assert.equal(contentionGate({ queryStart: goQuery, queryEnd: endQuery }, observed).status, 'pass');
  assert.equal(supervisor.children.size, 0);
});
