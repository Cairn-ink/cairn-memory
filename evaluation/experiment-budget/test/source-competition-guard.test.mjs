import assert from 'node:assert/strict';
import test from 'node:test';
import * as guards from '../request-guard.mjs';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { inspectEmbeddingExperimentBudgetSnapshot } from '../index.mjs';
import { compileSourceCompetitionBatch } from '../../source-competition/index.mjs';
import { sourceRoleFixture, checkpointOptions, settleFixture, urls, httpOptions, denied, noHttp,
  fakeResponse } from './source-role-ablation-fixture.mjs';

async function granted(t, settings) {
  const f = sourceRoleFixture(t, settings);
  f.capability = await guards.authorizeSourceCompetitionCapability(checkpointOptions(f, {
    authorizationId: 'competition-fresh-auth', executionId: 'competition-fresh-execution' }));
  return f;
}
const configured = (f, fetchImpl = noHttp) => ({ ledger: f.ledger, policy: f.policy,
  benchmarkExtension: f.benchmarkExtension, sourceCompetitionCapability: f.capability, fetchImpl });
const identity = slot => ({ slot: slot.slot, ordinal: slot.ordinal, arm: slot.arm, subBatch: slot.subBatch });
const wire = async slot => (await compileSourceCompetitionBatch({ ordinal: slot.ordinal, arm: slot.arm,
  subBatch: slot.subBatch, scriptedOutput: { items: [] } })).httpBodies;
const state = f => inspectEmbeddingExperimentBudgetSnapshot(f.ledger);

test('C3 distinct source-competition authority is required', () => {
  for (const name of ['prepareSourceCompetitionExecution', 'authorizeSourceCompetitionCapability',
    'createSourceCompetitionRequestGuard']) assert.equal(typeof guards[name], 'function', name);
});

test('C2/C3 immutable exact roster, 1M ceiling, fresh durable binding and exclusive concurrent claim', async t => {
  const f = await granted(t);
  const p = f.capability.protocol;
  assert.equal(p.slots.length, 24);
  assert.deepEqual(p.slots.slice(0, 6).map(s => [s.ordinal, s.arm, s.subBatch]),
    [[1, 'control', 1], [1, 'candidate', 1], [1, 'candidate', 2],
      [2, 'candidate', 1], [2, 'candidate', 2], [2, 'control', 1]]);
  assert.deepEqual(f.capability.limits, { requestCap: 48, reservedMicroUsd: 1_000_000, protectedMicroUsd: 30_000_000 });
  const bodies = await wire(p.slots[0]);
  assert.equal(p.slots[0].countBodySha256, createHash('sha256').update(bodies[0].bodyText).digest('hex'));
  assert.equal(p.slots[0].generationBodySha256, createHash('sha256').update(bodies[1].bodyText).digest('hex'));
  assert.equal(Object.isFrozen(p.slots[0].messageIndices), true);
  const filename = path.join(f.ledger.directory, 'experiment-source-competition-competition-fresh-execution.json');
  const before = readFileSync(filename);
  await assert.rejects(guards.authorizeSourceCompetitionCapability(checkpointOptions(f, {
    authorizationId: 'competition-fresh-auth', executionId: 'competition-fresh-execution' })), denied('unsafe_policy_binding'));
  assert.deepEqual(readFileSync(filename), before);
  const race = await Promise.allSettled([guards.createSourceCompetitionRequestGuard(configured(f)),
    guards.createSourceCompetitionRequestGuard(configured(f))]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(race.filter(result => result.status === 'rejected' && result.reason.code === 'capability_consumed').length, 1);
  for (const result of race) if (result.status === 'fulfilled') f.workspace.defer(() => result.value.close());
  assert.equal(state(f).requestCount, 5);
});

test('C3/C6 actual guard enforces scopes, exact bodies, one request at a time, sealed callbacks and 48 sends', async t => {
  const f = await granted(t, { requestCap: 53 });
  let sends = 0;
  const guard = await guards.createSourceCompetitionRequestGuard(configured(f, async url => {
    const snapshot = state(f);
    assert.equal(snapshot.requestCount, 5 + sends + 1, 'reservation is durable before HTTP');
    assert.equal(snapshot.attempts.at(-1).outcome, null);
    sends++; return fakeResponse(url);
  }));
  f.workspace.defer(() => guard.close());
  const first = f.capability.protocol.slots[0], bodies = await wire(first);
  await assert.rejects(guard.cairnFetch(urls.count, httpOptions(bodies[0].bodyText)), denied('case_scope_required'));
  await assert.rejects(guard.withSlotScope(identity(f.capability.protocol.slots[1]), async () => {}), denied('case_schedule_mismatch'));
  let late, releaseLate;
  for (const slot of f.capability.protocol.slots) {
    const request = await wire(slot);
    await guard.withSlotScope(identity(slot), async () => {
      if (slot.slot === 1) {
        await assert.rejects(guard.withSlotScope(identity(slot), async () => {}), denied('case_scope_busy'));
        await assert.rejects(guard.cairnFetch(urls.generation, httpOptions(request[1].bodyText)), denied('case_scope_violation'));
        const gate = new Promise(resolve => { releaseLate = resolve; });
        late = gate.then(() => guard.cairnFetch(urls.count, httpOptions(request[0].bodyText)));
        late.catch(() => {});
        await assert.rejects(guard.answerFetch('https://api.openai.com/v1/chat/completions', {}), denied('case_scope_violation'));
      }
      if (slot.slot === 2) {
        releaseLate();
        await assert.rejects(late, denied('case_scope_required'));
      }
      const count = guard.cairnFetch(urls.count, httpOptions(request[0].bodyText));
      await assert.rejects(guard.cairnFetch(urls.generation, httpOptions(request[1].bodyText)), denied('guard_busy'));
      await count;
      await assert.rejects(guard.cairnFetch(urls.count, httpOptions(request[0].bodyText)), denied('case_scope_violation'));
      await guard.cairnFetch(urls.generation, httpOptions(request[1].bodyText));
    });
  }
  assert.equal(sends, 48);
  assert.equal(guard.attempts().length, 48);
  assert.equal(guard.getState().requestCount, 53);
  assert.equal(guard.getState().attempts.filter(row => row.outcome === null).length, 0);
  const beforeReplay = state(f);
  await assert.rejects(guards.createSourceCompetitionRequestGuard(configured(f)), denied('policy_mismatch'));
  assert.deepEqual(state(f), beforeReplay);
  assert.equal(sends, 48, 'denied replay sends nothing new');
});

// Builtin faults are isolated from all test/core activity in dedicated owned child processes.
const root = fileURLToPath(new URL('../../../', import.meta.url));
function faultChild(f, mode) {
  const filename = path.join(f.workspace.path, 'fault-' + mode + '.json');
  writeFileSync(filename, JSON.stringify(configured(f)), { mode: 0o600 });
  const code = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import crypto from 'node:crypto';
    import { syncBuiltinESMExports } from 'node:module';
    import { DatabaseSync } from 'node:sqlite';
    import * as guards from ${JSON.stringify(new URL('../request-guard.mjs', import.meta.url).href)};
    import { openBoundEmbeddingExperimentBudget, inspectEmbeddingExperimentBudgetSnapshot } from ${JSON.stringify(new URL('../index.mjs', import.meta.url).href)};
    import { compileSourceCompetitionBatch } from ${JSON.stringify(new URL('../../source-competition/index.mjs', import.meta.url).href)};
    import { runSourceCompetition } from ${JSON.stringify(new URL('../../source-competition/operator.mjs', import.meta.url).href)};
    import { fakeResponse, urls, httpOptions } from ${JSON.stringify(new URL('./source-role-ablation-fixture.mjs', import.meta.url).href)};
    const config = JSON.parse(fs.readFileSync(${JSON.stringify(filename)}, 'utf8'));
    const mode = ${JSON.stringify(mode)};
    const noHttp = () => assert.fail('unexpected_http');
    const originalRead = fs.readFileSync, originalUuid = crypto.randomUUID, originalPrepare = DatabaseSync.prototype.prepare;
    let guard, activated = false;
    try {
      if (mode === 'constructor') {
        const claim = config.ledger.directory + '/experiment-source-competition-claim-' + config.sourceCompetitionCapability.executionId + '.json';
        fs.readFileSync = (...args) => {
          if (String(args[0]).endsWith('/source-competition/operator.mjs') && fs.existsSync(claim)) {
            activated = true; throw new Error('private_fault_not_exported');
          }
          return originalRead(...args);
        };
        syncBuiltinESMExports();
        await assert.rejects(guards.createSourceCompetitionRequestGuard({ ...config, fetchImpl: noHttp }),
          error => error.code === 'invalid_capability');
        fs.readFileSync = originalRead; syncBuiltinESMExports();
        assert.equal(activated, true); assert.equal(fs.existsSync(claim), true);
        await assert.rejects(guards.createSourceCompetitionRequestGuard({ ...config, fetchImpl: noHttp }),
          error => error.code === 'capability_consumed');
        console.log(JSON.stringify({ activated, replay: 'capability_consumed', owned: 0 }));
      } else if (mode === 'foreign') {
        guard = await guards.createSourceCompetitionRequestGuard({ ...config, fetchImpl: noHttp });
        const first = config.sourceCompetitionCapability.protocol.slots[0];
        const compiled = await compileSourceCompetitionBatch({ ordinal: first.ordinal, arm: first.arm,
          subBatch: first.subBatch, scriptedOutput: { items: [] } });
        crypto.randomUUID = () => {
          if (!activated) {
            activated = true;
            const foreign = openBoundEmbeddingExperimentBudget({ configuration: config.ledger, authorize() {} });
            try { const attemptId = originalUuid();
              foreign.reserve({ attemptId, channel: 'host-embedding', reservedMicroUsd: 1 });
              foreign.recordOutcome({ attemptId, outcome: 'succeeded', actualMicroUsd: 1 });
            } finally { foreign.close(); }
          }
          return originalUuid();
        };
        syncBuiltinESMExports();
        await assert.rejects(guard.withSlotScope({ slot: 1, ordinal: 1, arm: 'control', subBatch: 1 }, async () =>
          guard.cairnFetch(urls.count, httpOptions(compiled.httpBodies[0].bodyText))), error => error.code === 'invalid_ledger');
        assert.equal(activated, true); assert.equal(guard.attempts().length, 0);
        assert.equal(guard.isHalted(), true);
        console.log(JSON.stringify({ activated, halted: true, owned: 0 }));
      } else {
        DatabaseSync.prototype.prepare = function(sql, ...args) {
          if (sql.includes('UPDATE attempts SET outcome')) { activated = true; throw new Error('private_fault_not_exported'); }
          return originalPrepare.call(this, sql, ...args);
        };
        let sends = 0;
        const report = await runSourceCompetition({ ...config, apiKey: 'synthetic-private-key-never-report',
          fetchImpl: async url => { sends++; return fakeResponse(url); }, persistSlot: async () => {} });
        assert.equal(activated, true); assert.equal(sends, 1);
        assert.equal(report.status, 'halted'); assert.equal(report.results.length, 24);
        assert.equal(report.results.slice(1).every(row => row.status === 'not_run'), true);
        assert.equal(report.results[0].parsedObservation.state, 'not_observed');
        assert.equal(JSON.stringify(report).includes('private_fault_not_exported'), false);
        assert.equal(inspectEmbeddingExperimentBudgetSnapshot(config.ledger).attempts.filter(row => row.outcome === null).length, 1);
        console.log(JSON.stringify({ activated, halted: true, sends, pending: 1 }));
      }
    } finally { fs.readFileSync = originalRead; crypto.randomUUID = originalUuid;
      DatabaseSync.prototype.prepare = originalPrepare; syncBuiltinESMExports(); guard?.close(); }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    cwd: root, env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
      TMPDIR: f.workspace.path, NODE_DISABLE_COMPILE_CACHE: '1' },
    encoding: 'utf8', timeout: 15_000, maxBuffer: 64_000 });
  assert.equal(result.error, undefined, mode);
  assert.equal(result.signal, null, mode);
  assert.equal(result.status, 0, mode + ': ' + result.stderr);
  return JSON.parse(result.stdout);
}

test('C3/C6 postclaim failure, transactional foreign-gap and settlement failure are durable finite refusals', async t => {
  for (const mode of ['constructor', 'foreign', 'settlement']) {
    const f = await granted(t);
    const result = faultChild(f, mode);
    assert.equal(result.activated, true);
    const after = state(f);
    assert.equal(after.requestCount, mode === 'constructor' ? 5 : 6);
    assert.deepEqual(after.attempts.slice(0, 5), f.before.attempts);
    await f.workspace.cleanup();
    assert.equal(existsSync(f.workspace.path), false, 'actual failure-path residue zero');
  }
});

test('C6 pending history denies authorization before any claim', async t => {
  const f = sourceRoleFixture(t);
  const { openBoundEmbeddingExperimentBudget } = await import('../index.mjs');
  const handle = openBoundEmbeddingExperimentBudget({ configuration: f.ledger, authorize() {} });
  f.workspace.defer(() => handle.close());
  handle.reserve({ attemptId: '11111111-1111-4111-8111-111111111111', channel: 'host-embedding', reservedMicroUsd: 1 });
  handle.close();
  await assert.rejects(guards.authorizeSourceCompetitionCapability(checkpointOptions(f)), denied('budget_blocked'));
});

test('C6 legacy import and construction remain usable with optional study assets entirely absent', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-competition-legacy-' });
  const target = path.join(workspace.path, 'runtime');
  for (const directory of ['core', 'adapters/openai', 'evaluation/experiment-budget', 'evaluation/live',
    'plugins/cairn-memory/lib']) {
    mkdirSync(path.dirname(path.join(target, directory)), { recursive: true });
    cpSync(path.join(root, directory), path.join(target, directory), { recursive: true, dereference: true });
  }
  const code = `
    import { createExperimentBudget } from './evaluation/experiment-budget/index.mjs';
    import { createExperimentRequestGuard } from './evaluation/experiment-budget/request-guard.mjs';
    import { experimentPolicy } from './evaluation/live/session.mjs';
    const ledger = { directory: ${JSON.stringify(path.join(workspace.path, 'budget'))},
      runId: '11111111-1111-4111-8111-111111111111', limitMicroUsd: 50000000, requestCap: 10 };
    createExperimentBudget(ledger).close();
    const guard = createExperimentRequestGuard({ ledger, policy: experimentPolicy(),
      fetchImpl() { throw new Error('unexpected_http'); } });
    guard.close(); console.log('constructed');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code],
    { cwd: target, env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
      TMPDIR: workspace.path, NODE_DISABLE_COMPILE_CACHE: '1' }, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'constructed');
  assert.equal(existsSync(path.join(target, 'evaluation/source-competition')), false);
  assert.equal(existsSync(path.join(target, 'evaluation/source-role-ablation')), false);
  await workspace.cleanup();
  assert.equal(existsSync(workspace.path), false);
});

test('C6 actual asset and runtime-file drift in an owned copy denies new authority without touching original assets', async t => {
  const f = await granted(t);
  const target = path.join(f.workspace.path, 'runtime');
  for (const directory of ['core', 'adapters/openai', 'evaluation/experiment-budget', 'evaluation/source-competition',
    'plugins/cairn-memory/lib']) {
    mkdirSync(path.dirname(path.join(target, directory)), { recursive: true });
    cpSync(path.join(root, directory), path.join(target, directory), { recursive: true, dereference: true });
  }
  mkdirSync(path.join(target, 'evaluation/longmemeval'), { recursive: true });
  cpSync(path.join(root, 'evaluation/longmemeval/mixed-validation.mjs'), path.join(target, 'evaluation/longmemeval/mixed-validation.mjs'));
  const filename = path.join(f.workspace.path, 'asset-config.json');
  writeFileSync(filename, JSON.stringify(configured(f)), { mode: 0o600 });
  const code = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { createSourceCompetitionRequestGuard } from './evaluation/experiment-budget/request-guard.mjs';
    const config = JSON.parse(fs.readFileSync(${JSON.stringify(filename)}, 'utf8'));
    let sends = 0;
    for (const name of ['sources.json', 'evaluator.json', 'protocol.md', 'operator.mjs']) {
      const filename = './evaluation/source-competition/' + name;
      const original = fs.readFileSync(filename);
      try {
        fs.writeFileSync(filename, Buffer.concat([original, Buffer.from([10, 32])]));
        await assert.rejects(createSourceCompetitionRequestGuard({ ...config, fetchImpl() { sends++; } }),
          error => error.code === 'policy_mismatch');
      } finally { fs.writeFileSync(filename, original); }
    }
    assert.equal(sends, 0); console.log(JSON.stringify({ drifts: 4, sends }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    cwd: target, env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
      TMPDIR: f.workspace.path, NODE_DISABLE_COMPILE_CACHE: '1' }, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { drifts: 4, sends: 0 });
  assert.equal(state(f).requestCount, 5);
  await f.workspace.cleanup();
  assert.equal(existsSync(f.workspace.path), false);
});

test('C3 wrong profile, mutated roster/caps, own accessors, stale checkpoint and grant-file drift send nothing', async t => {
  const f = await granted(t);
  let getterCalls = 0;
  const accessor = configured(f);
  Object.defineProperty(accessor, 'fetchImpl', { enumerable: true, get() { getterCalls++; return noHttp; } });
  await assert.rejects(guards.createSourceCompetitionRequestGuard(accessor), denied('invalid_capability'));
  assert.equal(getterCalls, 0);
  for (const change of [cap => { cap.version = 'source-role-extraction-capability-v1'; },
    cap => { cap.protocol.slots[0].subBatch = 2; }, cap => { cap.protocol.caps.items = 6; },
    cap => { cap.protocol.assets['sources.json'] = '0'.repeat(64); }, cap => { cap.limits.reservedMicroUsd = 2_000_000; }]) {
    const capability = structuredClone(f.capability); change(capability);
    await assert.rejects(guards.createSourceCompetitionRequestGuard({ ...configured(f),
      sourceCompetitionCapability: capability }), denied('policy_mismatch'));
  }
  settleFixture(f, 1, 1);
  await assert.rejects(guards.createSourceCompetitionRequestGuard(configured(f)), denied('policy_mismatch'));
  const file = path.join(f.ledger.directory, 'experiment-source-competition-competition-fresh-execution.json');
  writeFileSync(file, '{', { mode: 0o600 });
  await assert.rejects(guards.createSourceCompetitionRequestGuard(configured(f)), denied('unsafe_policy_binding'));
  assert.equal(state(f).requestCount, 6);
  assert.equal(readFileSync(file, 'utf8'), '{');
});

test('C3 full request/reservation/protected envelopes refuse before any grant or HTTP', async t => {
  const short = sourceRoleFixture(t, { requestCap: 52 });
  await assert.rejects(guards.authorizeSourceCompetitionCapability(checkpointOptions(short)), denied('invalid_capability'));
  const f = sourceRoleFixture(t);
  const reserve = checkpointOptions(f);
  reserve.policy = structuredClone(f.policy);
  reserve.policy.cairnGeneration.reservedMicroUsd = 50_000;
  await assert.rejects(guards.authorizeSourceCompetitionCapability(reserve), denied('invalid_capability'));
  const protectedBudget = checkpointOptions(f);
  protectedBudget.checkpoint.reservedMicroUsd = 369_000_001;
  await assert.rejects(guards.authorizeSourceCompetitionCapability(protectedBudget), denied('invalid_capability'));
  assert.equal(existsSync(path.join(f.ledger.directory, 'experiment-source-competition-source-role-fresh-execution.json')), false);
  const boundary = sourceRoleFixture(t);
  settleFixture(boundary, 368_999_899);
  const capability = await guards.authorizeSourceCompetitionCapability(checkpointOptions(boundary));
  assert.equal(capability.checkpoint.reservedMicroUsd + capability.limits.reservedMicroUsd, 370_000_000);
  const beyond = sourceRoleFixture(t);
  settleFixture(beyond, 368_999_900);
  await assert.rejects(guards.authorizeSourceCompetitionCapability(checkpointOptions(beyond)), denied('invalid_capability'));
});

test('C6 foreign ledger write in caller snapshot getter is refused by transaction witness before reserve', async t => {
  const f = await granted(t);
  let sends = 0;
  const guard = await guards.createSourceCompetitionRequestGuard(configured(f, async url => {
    sends++; return fakeResponse(url);
  }));
  f.workspace.defer(() => guard.close());
  const first = f.capability.protocol.slots[0], bodies = await wire(first);
  await assert.rejects(guard.withSlotScope(identity(first), async () => {
    const init = httpOptions(bodies[0].bodyText);
    let inserted = false;
    Object.defineProperty(init, 'body', { enumerable: true, get() {
      if (!inserted) { inserted = true; settleFixture(f, 1, 1); }
      return bodies[0].bodyText;
    } });
    await guard.cairnFetch(urls.count, init);
  }), denied('invalid_ledger'));
  assert.equal(sends, 0);
  assert.equal(guard.isHalted(), true);
  assert.equal(state(f).requestCount, 6);
});

test('C6 body/prompt/schema/model drift is fatal before reserve, each under its own fresh authority', async t => {
  for (const kind of ['body', 'prompt', 'schema', 'model']) {
    const f = await granted(t);
    const guard = await guards.createSourceCompetitionRequestGuard(configured(f));
    f.workspace.defer(() => guard.close());
    const first = f.capability.protocol.slots[0], bodies = await wire(first);
    const body = JSON.parse(bodies[0].bodyText);
    if (kind === 'prompt') body.instructions += ' drift';
    if (kind === 'schema') body.text.format.schema.extra = true;
    if (kind === 'model') body.model = 'gpt-other';
    await assert.rejects(guard.withSlotScope(identity(first), async () => {
      await guard.cairnFetch(urls.count, httpOptions(kind === 'body' ? ' ' + bodies[0].bodyText : JSON.stringify(body)));
    }), denied('unsupported_request'));
    assert.equal(guard.attempts().length, 0);
    assert.equal(state(f).requestCount, 5);
    assert.equal(guard.isHalted(), true);
  }
});
