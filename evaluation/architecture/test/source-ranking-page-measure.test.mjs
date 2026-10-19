import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import * as frozen from '../source-ranking-measure.mjs';
import { CAPTURE_TRIALS, PREFIX_SHA256, ChildSupervisor, assertChild, assertClosedSeed, auditCaptureCopy,
  captureGate, cellSpec, measureContention, observePhysicalPage, runCampaign } from '../source-ranking-page-measure.mjs';

const query = { queryStart: '100000000', firstPhysicalRead: '110000000', queryEnd: '200000000' };
const writer = { ok: true, complete: true, captureTimeoutMs: 5000,
  captureStart: '120000000', captureEnd: '150000000', memoryId: 'synthetic', admittedCount: 1,
  classification: 'applied', disposition: 'completed', initialClassification: 'applied' };
const raw = (value, patch = {}) => ({ status: 0, signal: null, timedOut: false, error: null,
  messages: [{ type: 'result', value }], stdout: '', stderr: '', ...patch });
const [major, minor] = process.versions.node.split('.').map(Number);
const native = { skip: major < 22 || major === 22 && minor < 16 ? 'Native preflight requires Node >=22.16.' : false };

test('H5b imports reuse frozen cell construction, query mechanics and pure gates unchanged', async () => {
  const current = await import('../source-ranking-page-measure.mjs');
  for (const key of ['CELLS', 'POLICY', 'WATCHDOG_MS', 'cellSpec', 'prepareStore', 'queryMeasurement',
    'resourceGate', 'validateRanking', 'worstWorkload', 'parseOptions', 'childEnvironment', 'assertChild'])
    assert.equal(current[key], frozen[key], key);
  assert.equal(PREFIX_SHA256, '7253269b0b0ee53ee8b24ef8ce01cd25a92887ae6f88e711cfaf19dc1866201c');
  assert.equal(CAPTURE_TRIALS, 3);
  assert.equal(current.WATCHDOG_MS, 60_000);
  const source = readFileSync(new URL('../source-ranking-page-measure.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes("from 'node:sqlite'"), false, 'pure import stays usable without native sqlite');
});

test('actual complete capture gate requires ordered monotonic overlap and strict completion threshold', () => {
  assert.equal(captureGate(query, writer).status, 'pass');
  assert.equal(captureGate(query, writer).waitMs, 30);
  for (const patch of [{ ok: false }, { complete: false }, { complete: undefined },
    { writerError: 'storage_busy' }, { captureTimeoutMs: 10_000 }, { status: 'pass', ok: false },
    { admittedCount: 0 }, { classification: 'failed' }, { disposition: 'pending' }, { initialClassification: 'not_started' }])
    assert.equal(captureGate(query, { ...writer, ...patch }).status, 'fail');
  for (const patch of [{ captureStart: undefined }, { captureStart: 'bad' },
    { captureStart: '105000000' }, { captureStart: '210000000' }, { captureEnd: '200000000' },
    { captureEnd: '115000000' }]) assert.equal(captureGate(query, { ...writer, ...patch }).status, 'inconclusive');
  const long = { ...query, queryEnd: '4000000000' };
  assert.equal(captureGate(long, { ...writer, captureEnd: '2620000000' }).status, 'inconclusive');
  assert.equal(captureGate(long, { ...writer, captureEnd: '2619999999' }).status, 'pass');
});

function fakeLaunch(behavior, launches = []) {
  return (executable, args, options) => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.connected = true; child.kills = []; child.sent = [];
    child.send = (message, callback) => { child.sent.push(message); callback?.(); };
    child.finish = (status = 0, signal = null) => {
      if (child.finished) return; child.finished = true; child.connected = false; child.emit('close', status, signal);
    };
    child.kill = signal => { child.kills.push(signal); setImmediate(() => child.finish(null, signal)); return true; };
    launches.push({ executable, args, options, child });
    setImmediate(() => behavior(child, JSON.parse(args[2])));
    return child;
  };
}

test('supervisor launches separate H5b child module and retains raw exits, timeout and output failures', async () => {
  const launches = []; const records = [];
  const supervisor = new ChildSupervisor({ launch: fakeLaunch(child => {
    child.stdout.emit('data', 'stdout'); child.stderr.emit('data', 'stderr');
    child.emit('message', { type: 'result', value: 'value' }); child.finish(7);
  }, launches), observe: row => records.push(row) });
  const result = await supervisor.start({ role: 'query' }).done;
  assert.match(launches[0].args[0], /source-ranking-page-measure\.mjs$/);
  assert.equal(result.status, 7); assert.equal(result.stdout, 'stdout'); assert.equal(result.stderr, 'stderr');
  assert.throws(() => assertChild(result), /child_nonzero_exit/);
  assert.equal(records.length, 1); assert.equal(supervisor.children.size, 0);
  for (const behavior of [child => child.stdout.emit('data', 'x'.repeat(65_537)),
    child => child.emit('error', Object.assign(new Error('synthetic'), { code: 'ENOENT' })), () => {}]) {
    const failed = new ChildSupervisor({ watchdogMs: 15, launch: fakeLaunch(behavior) });
    const handle = failed.start({ role: 'capture' });
    const missing = assert.rejects(handle.wait('ready'), /child_closed_before_handshake/);
    const observed = await handle.done; await missing;
    assert.throws(() => assertChild(observed)); await failed.stopAll();
    assert.equal(failed.children.size, 0);
  }
});

test('first page observer runs only after actual nonempty physical read and never waits', () => {
  const calls = []; const rows = [{ id: 'one', revision: 1 }];
  class Database { prepare(sql) { return { all() { calls.push(sql); return rows; } }; } }
  const original = Database.prototype.prepare;
  const restore = observePhysicalPage(Database, time => { assert.match(time, /^\d+$/); calls.push('observed'); });
  try {
    const db = new Database();
    db.prepare('EXPLAIN QUERY PLAN SELECT id,revision FROM memories INDEXED BY capture_current_memories').all();
    assert.equal(calls.includes('observed'), false);
    const statement = db.prepare('SELECT id, revision FROM memories INDEXED BY capture_current_memories WHERE id>?');
    assert.equal(statement.all(''), rows); statement.all('');
    assert.equal(calls.filter(value => value === 'observed').length, 1);
    assert.equal(calls[2], 'observed');
  } finally { restore(); }
  assert.equal(Database.prototype.prepare, original);
});

test('contention readies query and capture before GO and triggers capture only from physical page observation', async () => {
  const protocol = []; const launches = [];
  const supervisor = new ChildSupervisor({ launch: fakeLaunch((child, input) => {
    protocol.push(`ready:${input.role}`);
    child.send = (message, callback) => {
      protocol.push(`${message.type}:${input.role}`); callback?.();
      if (input.role === 'query') {
        child.emit('message', { type: 'physical-page', at: query.firstPhysicalRead });
        setImmediate(() => { child.emit('message', { type: 'result', value: query }); child.finish(); });
      } else { child.emit('message', { type: 'result', value: writer }); child.finish(); }
    };
    child.emit('message', { type: 'ready' });
  }, launches) });
  assert.equal((await measureContention(supervisor, '/synthetic', '20000', 'new')).status, 'pass');
  assert.deepEqual(protocol, ['ready:query', 'ready:capture', 'go:query', 'go:capture']);
  assert.equal(supervisor.children.size, 0);
  const failing = new ChildSupervisor({ launch: fakeLaunch(child => child.finish(9)) });
  await assert.rejects(measureContention(failing, '/synthetic', '20000', 'new'), /child_closed_before_handshake/);
  assert.equal(failing.children.size, 0);
});

function campaignSupervisor({ failAt = -1, changeAt = -1, signal = false } = {}) {
  let ordinal = 0;
  return { inputs: [], stopped: false, async stopAll() { this.stopped = true; }, start(input) {
    this.inputs.push(input); const index = ordinal++;
    if (input.role === 'prepare') writeFileSync(input.path, 'owned immutable synthetic seed');
    if (index === changeAt) writeFileSync(input.path, 'changed');
    if (signal && index === 0) process.emit('SIGTERM');
    return { done: Promise.resolve(raw(input.role === 'prepare' ? cellSpec(input.cell) : {
      arm: input.arm, elapsedMs: 1, cpuTotalMs: 1, peakRssBytes: 1 }, index === failAt ? { status: 19 } : {})) };
  } };
}

test('campaign preserves alternating fresh pairs, separate copies, three candidate trials and labelled failed legacy', async () => {
  const supervisor = campaignSupervisor(); const events = []; const copies = [];
  const result = await runCampaign({ cells: ['20000'], supervisor, observe: row => events.push(row),
    contention: async (owner, path, cell, arm) => {
      assert.equal(owner, supervisor); assert.equal(cell, '20000');
      copies.push(path); assert.notEqual(path, supervisor.inputs[0].path);
      assert.equal(readFileSync(path, 'utf8'), 'owned immutable synthetic seed');
      return { query, writer: { ...writer, complete: arm === 'new' },
        ...captureGate(query, { ...writer, complete: arm === 'new', writerError: arm === 'old' ? 'storage_busy' : null }) };
    }, audit: async () => ({ durableMemories: 1, durableReceipts: 1 }) });
  assert.equal(result.status, 'pass'); assert.equal(supervisor.stopped, true);
  assert.deepEqual(supervisor.inputs.slice(1).map(row => [row.arm, row.pair]),
    [['old', 0], ['new', 0], ['new', 1], ['old', 1], ['old', 2], ['new', 2]]);
  assert.equal(new Set(copies).size, 4);
  assert.equal(events.filter(row => row.type === 'capture-contention' && row.role === 'candidate-gate').length, 3);
  const legacy = events.find(row => row.role === 'legacy-observation');
  assert.equal(legacy.status, 'fail'); assert.equal(legacy.writerError, 'storage_busy');
  assert.ok(copies.every(path => !existsSync(path)));
  assert.equal(existsSync(supervisor.inputs[0].path), false);
});

test('failed candidates or missing overlap stop promotion, while child, store and cleanup failures throw', async t => {
  for (const status of ['fail', 'inconclusive']) {
    const supervisor = campaignSupervisor();
    const result = await runCampaign({ cells: ['20000'], supervisor, observe: () => {},
      contention: async () => ({ status, query, writer: { ...writer, complete: false } }),
      audit: async () => ({ captureComplete: false, baselineRowsUnchanged: true }) });
    assert.equal(result.status, 'stop'); assert.equal(result.summaries[0].status, status);
    assert.equal(existsSync(supervisor.inputs[0].path), false);
  }
  for (const [options, expected] of [[{ failAt: 2 }, /child_nonzero_exit/],
    [{ changeAt: 1 }, /store_changed_between_arms/], [{ signal: true }, /campaign_interrupted/]]) {
    const supervisor = campaignSupervisor(options);
    await assert.rejects(runCampaign({ cells: ['1000'], supervisor, observe: () => {} }), expected);
    assert.equal(supervisor.stopped, true); assert.equal(existsSync(supervisor.inputs[0].path), false);
  }
  const cleanup = campaignSupervisor();
  cleanup.stopAll = async () => { throw new Error('synthetic cleanup failure'); };
  const events = [];
  // The outer fixture owns the deliberately retained child workspace. The
  // campaign must not remove it when child closure cannot be verified.
  const parent = createTestWorkspace(t);
  const previousTemp = process.env.TMPDIR;
  try {
    process.env.TMPDIR = parent.path;
    await assert.rejects(runCampaign({ cells: ['1000'], supervisor: cleanup, observe: row => events.push(row) }), /synthetic cleanup failure/);
  } finally {
    if (previousTemp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTemp;
  }
  assert.equal(existsSync(cleanup.inputs[0].path), true);
  assert.ok(cleanup.inputs[0].path.startsWith(`${parent.path}/`));
  assert.equal(events.at(-1).reason, 'owned_cleanup_failed');
  const auditFailure = campaignSupervisor();
  await assert.rejects(runCampaign({ cells: ['20000'], supervisor: auditFailure, observe: () => {},
    contention: async () => ({ query, writer, status: 'pass' }), audit: async () => { throw new Error('audit_failed'); } }), /audit_failed/);
  assert.equal(existsSync(auditFailure.inputs[0].path), false);
});

test('closed seed sidecars reject copying', t => {
  const workspace = createTestWorkspace(t); const path = join(workspace.path, 'seed.sqlite');
  writeFileSync(path, 'synthetic'); assertClosedSeed(path);
  writeFileSync(`${path}-wal`, 'synthetic'); assert.throws(() => assertClosedSeed(path), /seed_has_sidecar_dependency/);
});

test('bounded native preflight uses fresh children, cold durable audit and owned success/failure cleanup', native, async t => {
  const workspace = createTestWorkspace(t);
  const seed = join(workspace.path, 'seed.sqlite'); const copy = join(workspace.path, 'capture.sqlite');
  const records = []; const supervisor = new ChildSupervisor({ observe: row => records.push(row) });
  workspace.defer(() => supervisor.stopAll());
  const prepared = assertChild(await supervisor.start({ role: 'prepare', path: seed, cell: '1000' }).done);
  assert.equal(prepared.memories, 1002); assertClosedSeed(seed);
  const unchanged = readFileSync(seed); copyFileSync(seed, copy);
  const emptyFailure = await auditCaptureCopy(copy, seed, { complete: false });
  assert.equal(emptyFailure.captureComplete, false); assert.equal(emptyFailure.durableMemories, 0);
  const old = assertChild(await supervisor.start({ role: 'query', path: seed, cell: '1000', arm: 'old' }).done);
  assert.equal(old.scored, 2000); assert.equal(old.retained, 1000);
  assert.ok(old.queryPlan.some(row => row.includes('capture_current_memories')));
  assert.ok(old.databaseMainBytes > 0); assert.equal(old.databaseWalBytes, 0); assert.equal(old.databaseShmBytes, 0);
  const measured = await measureContention(supervisor, copy, '1000', 'new');
  assert.equal(measured.writer.ok, true); assert.equal(measured.writer.complete, true);
  assert.equal(measured.writer.disposition, 'completed'); assert.equal(measured.writer.classification, 'applied');
  // A 1000-row smoke is not a 20k gate; overlap can be missed on either runtime.
  assert.ok(['pass', 'inconclusive'].includes(measured.status));
  t.diagnostic(JSON.stringify({ smokeOnly: true, status: measured.status, queryElapsedMs: measured.query.elapsedMs,
    captureWaitMs: measured.waitMs, overlap: measured.overlap, captureComplete: measured.writer.complete }));
  const durable = await auditCaptureCopy(copy, seed, measured.writer);
  assert.equal(durable.baselineRowsUnchanged, true); assert.equal(durable.durableMemories, 1);
  await assert.rejects(auditCaptureCopy(copy, seed, { ...measured.writer, memoryId: 'missing-memory' }), /foreign_receipt_binding/);
  const { DatabaseSync } = await import('node:sqlite');
  const tamper = new DatabaseSync(copy);
  try { tamper.prepare('UPDATE memories SET content=? WHERE id=?').run('Synthetic unauthorized mutation.', 'keyset-measure-000001'); }
  finally { tamper.close(); }
  await assert.rejects(auditCaptureCopy(copy, seed, measured.writer), /baseline_rows_changed:memories/);
  assert.deepEqual(readFileSync(seed), unchanged);
  const failed = await supervisor.start({ role: 'invalid', path: copy }).done;
  assert.equal(failed.status, 1); assert.throws(() => assertChild(failed), /child_nonzero_exit/);
  assert.equal(supervisor.children.size, 0);
  assert.ok(records.every(row => row.status === 0 || row.input.role === 'invalid' && row.status === 1));
});
