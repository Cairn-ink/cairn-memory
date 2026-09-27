import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createExperimentBudget, inspectEmbeddingExperimentBudgetSnapshot,
  inspectExperimentBudgetForEmbeddingUpgrade, openBoundEmbeddingExperimentBudget,
  reopenExperimentBudget, upgradeExperimentBudgetForEmbeddings } from '../index.mjs';
import { assertChainedBenchmarkParentForEmbeddingSnapshot,
  authorizeBenchmarkBudgetExtension, authorizeBenchmarkExtension,
  authorizeBenchmarkRequestAllowance, authorizeChainedBenchmarkBudgetExtension,
  authorizeChainedBenchmarkRequestCapV2, authorizeMixedSourcePairCapability,
  createExperimentRequestGuard, createMixedSourcePairExperimentRequestGuard,
  inspectMixedSourcePairParent, loadChainedBenchmarkRequestCapV2 } from '../request-guard.mjs';
import { mem0WireProfile } from '../mem0-wire.mjs';
import { benchmarkStagePolicy } from '../../live/public-pilot.mjs';
import { experimentPolicy } from '../../live/session.mjs';

const denied = code => error => error?.code === code && error.message === code;
const noHttp = () => assert.fail('synthetic setup must not send HTTP');
const plain = value => JSON.parse(JSON.stringify(value));
const filename = ledger => path.join(ledger.directory, 'experiment-budget.sqlite');
const binding = (ledger, parent) => path.join(ledger.directory,
  `experiment-benchmark-request-cap-v2-${parent.authorizationId}.json`);

function add(ledger, amount) {
  const handle = reopenExperimentBudget(ledger);
  try {
    const attemptId = randomUUID();
    handle.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: amount });
    handle.recordOutcome({ attemptId, outcome: 'unknown' });
  } finally { handle.close(); }
}

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'cairn-cap-v2-chain-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = { directory: path.join(root, 'budget'), runId: randomUUID(),
    limitMicroUsd: 50_000_000, requestCap: 1 };
  createExperimentBudget(first).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger: first, policy, fetchImpl: noHttp }).close();
  const original = authorizeBenchmarkExtension({ ledger: first, policy,
    authorizationId: 'cap-original', stages: benchmarkStagePolicy() });
  const allowance = authorizeBenchmarkRequestAllowance({ oldLedger: first, policy,
    benchmarkExtension: original, authorizationId: 'cap-allowance', newRequestCap: 2,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const second = { ...first, requestCap: 2 };
  add(second, 13); add(second, 17);
  const parent100 = authorizeBenchmarkBudgetExtension({ oldLedger: second, policy,
    requestAllowance: allowance, authorizationId: 'cap-parent100',
    newLimitMicroUsd: 100_000_000, newRequestCap: 3,
    expectedCheckpoint: { requestCount: 2, reservedMicroUsd: 30 } });
  const prior = { ...second, limitMicroUsd: 100_000_000, requestCap: 3 };
  add(prior, 19);
  const oldLedger = { ...prior, limitMicroUsd: 200_000_000, requestCap: 4 };
  const parent200 = authorizeChainedBenchmarkBudgetExtension({ oldLedger: prior, policy,
    parentBudgetExtension: parent100, authorizationId: 'cap-parent200',
    newLimitMicroUsd: 200_000_000, newRequestCap: 4,
    expectedCheckpoint: { requestCount: 3, reservedMicroUsd: 49 } });
  add(oldLedger, 23);
  const before = inspectExperimentBudgetForEmbeddingUpgrade(oldLedger);
  upgradeExperimentBudgetForEmbeddings({ ...oldLedger,
    expectedCheckpoint: { requestCount: 4, reservedMicroUsd: 72 },
    expectedHistorySha256: before.historySha256 });
  const snapshot = inspectEmbeddingExperimentBudgetSnapshot(oldLedger);
  const ledger = { ...oldLedger, requestCap: 10 };
  const authorization = { oldLedger, policy, parentBudgetExtension: parent200,
    authorizationId: 'cap-request-v2', newRequestCap: 10,
    expectedCheckpoint: { requestCount: 4, reservedMicroUsd: 72 },
    expectedOldHistorySha256: snapshot.historySha256 };
  const parentFile = path.join(oldLedger.directory,
    `experiment-benchmark-budget-chain-${parent100.authorizationId}.json`);
  return { oldLedger, ledger, policy, parent200, snapshot, authorization,
    parentFile, parentBytes: readFileSync(parentFile) };
}

function load(f) {
  return loadChainedBenchmarkRequestCapV2({ ledger: f.ledger, policy: f.policy,
    parentBudgetAuthorizationId: f.parent200.authorizationId,
    authorizationId: f.authorization.authorizationId, stages: f.parent200.stages });
}

test('C4-C6 immutable parent, exact replay/recovery, suffix and authentic new parent', t => {
  const f = fixture(t);
  const record = authorizeChainedBenchmarkRequestCapV2(f.authorization);
  assert.equal(record.version, 'benchmark-request-cap-v2');
  assert.equal(record.oldPrefixHistorySha256, f.snapshot.historySha256);
  assert.notEqual(record.newPrefixHistorySha256, record.oldPrefixHistorySha256);
  assert.deepEqual(readFileSync(f.parentFile), f.parentBytes);
  assert.deepEqual(plain(load(f)), plain(record));
  assert.deepEqual(plain(authorizeChainedBenchmarkRequestCapV2(f.authorization)), plain(record));
  const snapshot = inspectEmbeddingExperimentBudgetSnapshot(f.ledger);
  assert.equal(snapshot.historySha256, record.newPrefixHistorySha256);
  assert.equal(assertChainedBenchmarkParentForEmbeddingSnapshot({ ledger: f.ledger,
    policy: f.policy, benchmarkExtension: record, snapshot }), undefined);
  assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot({ ledger: f.ledger,
    policy: f.policy, benchmarkExtension: record, snapshot: structuredClone(snapshot) }),
  denied('policy_mismatch'));
  let getterCalls = 0;
  const getterParent = { ledger: f.ledger, policy: f.policy, snapshot };
  Object.defineProperty(getterParent, 'benchmarkExtension', { enumerable: true,
    get() { getterCalls += 1; return record; } });
  assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot(getterParent),
    denied('invalid_options'));
  const getterVersion = { ...record };
  Object.defineProperty(getterVersion, 'version', { enumerable: true,
    get() { getterCalls += 1; return 'benchmark-request-cap-v2'; } });
  assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot({ ledger: f.ledger,
    policy: f.policy, benchmarkExtension: getterVersion, snapshot }), denied('invalid_options'));
  assert.equal(getterCalls, 0);
  assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot({ ledger: f.ledger,
    policy: f.policy, benchmarkExtension: f.parent200, snapshot }), denied('invalid_extension'));
  const db = new DatabaseSync(filename(f.ledger));
  db.exec('UPDATE run_config SET request_cap = 4 WHERE singleton = 1');
  db.close(); // Synthetic post-binding/pre-CAS crash state, with unchanged attempt rows.
  assert.deepEqual(plain(authorizeChainedBenchmarkRequestCapV2(f.authorization)), plain(record));
  const bound = openBoundEmbeddingExperimentBudget({ configuration: f.ledger, authorize() {} });
  const id = randomUUID();
  bound.reserve({ attemptId: id, channel: 'host-embedding', reservedMicroUsd: 5 });
  bound.recordOutcome({ attemptId: id, outcome: 'failed' });
  bound.close();
  assert.deepEqual(plain(authorizeChainedBenchmarkRequestCapV2(f.authorization)), plain(record));
  assert.deepEqual(plain(load(f)), plain(record));
  assert.equal(readFileSync(f.parentFile).equals(f.parentBytes), true);
});

test('C5 stale parent/hash/target and missing, mismatched or unsafe singleton fail closed', t => {
  const f = fixture(t);
  assert.throws(() => authorizeChainedBenchmarkRequestCapV2({ ...f.authorization,
    expectedOldHistorySha256: '0'.repeat(64) }), denied('configuration_mismatch'));
  assert.throws(() => authorizeChainedBenchmarkRequestCapV2({ ...f.authorization,
    newRequestCap: 11, expectedCheckpoint: { requestCount: 3, reservedMicroUsd: 49 } }));
  assert.throws(() => authorizeChainedBenchmarkRequestCapV2({ ...f.authorization,
    parentBudgetExtension: { ...f.parent200, authorizationId: 'wrong-parent' } }));
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.oldLedger).requestCap, 4);
  const record = authorizeChainedBenchmarkRequestCapV2(f.authorization);
  assert.throws(() => authorizeChainedBenchmarkRequestCapV2({ ...f.authorization,
    authorizationId: 'different' }), denied('policy_mismatch'));
  assert.throws(() => loadChainedBenchmarkRequestCapV2({ ledger: f.ledger, policy: f.policy,
    parentBudgetAuthorizationId: '../bad', authorizationId: record.authorizationId,
    stages: record.stages }), denied('invalid_extension'));
  const file = binding(f.ledger, f.parent200);
  renameSync(file, `${file}.held`);
  assert.throws(() => authorizeChainedBenchmarkRequestCapV2(f.authorization),
    denied('policy_mismatch'));
  assert.throws(() => load(f), denied('unsafe_policy_binding'));
  renameSync(`${file}.held`, file);
  const bytes = readFileSync(file);
  const changed = JSON.parse(bytes);
  changed.authorizationId = 'different';
  writeFileSync(file, `${JSON.stringify(changed)}\n`);
  assert.throws(() => authorizeChainedBenchmarkRequestCapV2(f.authorization),
    denied('policy_mismatch'));
  writeFileSync(file, bytes);
  chmodSync(file, 0o644);
  assert.throws(() => load(f), denied('unsafe_policy_binding'));
  chmodSync(file, 0o600);
  assert.deepEqual(plain(load(f)), plain(record));
});

test('C5 concurrent duplicate operators leave one exact binding and one cap transition', async t => {
  const f = fixture(t);
  const moduleUrl = new URL('../request-guard.mjs', import.meta.url).href;
  const childSource = `const { authorizeChainedBenchmarkRequestCapV2 } = await import(${JSON.stringify(moduleUrl)});
    try { authorizeChainedBenchmarkRequestCapV2(JSON.parse(process.argv[1]));
      process.stdout.write('ok'); }
    catch (error) { process.stdout.write(error?.code ?? 'unfixed'); }`;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', childSource,
      JSON.stringify(f.authorization)], { env: { PATH: process.env.PATH ?? '' },
      stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let error = '';
    child.stdout.setEncoding('utf8').on('data', value => { output += value; });
    child.stderr.setEncoding('utf8').on('data', value => { error += value; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, output, error }));
  });
  const results = await Promise.all([run(), run()]);
  assert.deepEqual(results.map(result => result.code), [0, 0]);
  assert.equal(results.some(result => result.output === 'ok'), true);
  for (const result of results) {
    assert.equal(['ok', 'ledger_busy', 'ledger_failed', 'extension_busy'].includes(result.output), true,
      `${result.output}: ${result.error.slice(0, 200)}`);
  }
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.ledger).requestCap, 10);
  assert.deepEqual(plain(authorizeChainedBenchmarkRequestCapV2(f.authorization)), plain(load(f)));
});

const caps = (requests, reservedMicroUsd) => ({ requests, reservedMicroUsd });
const mixedLimits = () => ({ phaseCaps: { generation: caps(4, 100_000),
  scoring: caps(2, 100_000) }, caseCaps: {
  cairn: { generation: caps(2, 50_000), scoring: caps(1, 50_000) },
  mem0: { generation: caps(2, 50_000), scoring: caps(1, 50_000) },
}, mem0TimeoutMs: 1000 });
const request = body => ({ method: 'POST', redirect: 'error',
  signal: new AbortController().signal,
  headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' },
  body: JSON.stringify(body) });

function mixedOptions(f, newParent, snapshot) {
  const questionId = `lme-case-${'a'.repeat(64)}`;
  const digest = value => createHash('sha256').update(value).digest('hex');
  const scopeId = name => `lme-case-${digest(JSON.stringify([
    'cairn.lme.mixed-source-pair.scope.v1', [questionId, name]]))}`;
  const roster = [{ questionId, protocolDigest: 'b'.repeat(64),
    armOrder: ['cairn', 'mem0'], arms: ['cairn', 'mem0'].map(name => ({ name, scopeId: scopeId(name) })) }];
  const manifest = { sourceProtocolSha256: '1'.repeat(64),
    contextProtocolSha256: '2'.repeat(64), answerProtocolSha256: '3'.repeat(64),
    scorerProtocolSha256: '4'.repeat(64), cairn: { runtimeArtifactSha256: '5'.repeat(64),
      adapterConfigurationSha256: '6'.repeat(64), qualificationInputProfile: 'adaptive-text-catalog-v1',
      captureSourcePolicy: 'indexed-windows-v1' }, mem0: { version: '2.2.0',
      sourceTreeSha256: '7'.repeat(64), dependencyLockSha256: '8'.repeat(64),
      configurationSha256: '9'.repeat(64), wireProfile: structuredClone(mem0WireProfile()) } };
  return { ledger: f.ledger, policy: f.policy, benchmarkExtension: newParent,
    authorizationId: 'newcap-mixed', executionId: 'newcap-execution',
    checkpoint: { requestCount: snapshot.requestCount, reservedMicroUsd: snapshot.reservedMicroUsd,
      historySha256: snapshot.historySha256 }, manifest, roster, limits: mixedLimits() };
}

async function reserveOneMixedEmbedding(f, newParent, snapshot) {
  const started = process.hrtime.bigint();
  const options = mixedOptions(f, newParent, snapshot);
  const capability = authorizeMixedSourcePairCapability(options);
  const afterCapability = process.hrtime.bigint();
  let calls = 0;
  const guard = createMixedSourcePairExperimentRequestGuard({ ledger: f.ledger, policy: f.policy,
    benchmarkExtension: newParent, mixedSourcePairCapability: capability,
    fetchImpl: async () => {
      calls += 1;
      return Response.json({ object: 'list', model: 'text-embedding-3-small',
        usage: { prompt_tokens: 1, total_tokens: 1 }, data: [{ object: 'embedding', index: 0,
          embedding: Array(1536).fill(0) }] });
    } });
  const afterCreate = process.hrtime.bigint();
  let afterFirst;
  let afterRequest;
  try {
    const first = await guard.withCaseScope(capability.schedule[0], async () => 'synthetic-cairn');
    assert.equal(first.status, 'completed');
    afterFirst = process.hrtime.bigint();
    const result = await guard.withCaseScope(capability.schedule[1], async () => {
      const response = await guard.mem0EmbeddingFetch(mem0WireProfile().embedding.endpoint,
        request({ model: 'text-embedding-3-small', input: ['synthetic'],
          dimensions: 1536, encoding_format: 'float' }));
      assert.equal(response.status, 200);
    });
    assert.equal(result.status, 'completed');
    assert.equal(calls, 1);
    afterRequest = process.hrtime.bigint();
    const state = guard.getState();
    assert.equal(state.requestCount, snapshot.requestCount + 1);
    assert.equal(state.limitMicroUsd, 200_000_000);
  } finally { guard.close(); }
  const elapsed = (from, to) => Math.round(Number(to - from) / 1e6);
  return { capabilityMs: elapsed(started, afterCapability),
    guardCreateMs: elapsed(afterCapability, afterCreate),
    firstCaseMs: elapsed(afterCreate, afterFirst),
    embeddingRequestMs: elapsed(afterFirst, afterRequest),
    stateReadCloseMs: elapsed(afterRequest, process.hrtime.bigint()) };
}

test('C6-C7 mixed fake embedding reserves physical request 5 beyond old cap 4', async t => {
  const f = fixture(t);
  const newParent = authorizeChainedBenchmarkRequestCapV2(f.authorization);
  const snapshot = inspectMixedSourcePairParent({ ledger: f.ledger, policy: f.policy,
    benchmarkExtension: newParent, checkpoint: { requestCount: 4, reservedMicroUsd: 72,
      historySha256: newParent.newPrefixHistorySha256 } });
  assert.equal(snapshot.requestCount, 4);
  await reserveOneMixedEmbedding(f, newParent, snapshot);
});

if (process.env.CAIRN_CAP_V2_SCALE === '1') {
  test('C9 real 420000-row v2 lineage passes new-parent guard and physical request', async t => {
    const started = process.hrtime.bigint();
    const f = fixture(t);
    const newCap = 420_010;
    const authorization = { ...f.authorization, newRequestCap: newCap };
    const ledger = { ...f.oldLedger, requestCap: newCap };
    const newParent = authorizeChainedBenchmarkRequestCapV2(authorization);
    const afterTransition = process.hrtime.bigint();
    const db = new DatabaseSync(filename(ledger));
    try {
      db.exec('BEGIN IMMEDIATE');
      const insert = db.prepare(`INSERT INTO attempts
        (attempt_id, channel, reserved_micro_usd, outcome, actual_micro_usd)
        VALUES (?, 'host-embedding', 0, 'unknown', NULL)`);
      for (let index = 4; index < 420_000; index += 1) {
        insert.run(`f0000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`);
      }
      db.prepare('UPDATE run_config SET request_count = 420000 WHERE singleton = 1').run();
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* Preserve the insertion error. */ }
      throw error;
    } finally { db.close(); }
    const afterBulk = process.hrtime.bigint();
    const snapshot = inspectEmbeddingExperimentBudgetSnapshot(ledger);
    assert.equal(snapshot.requestCount, 420_000);
    assert.equal(snapshot.reservedMicroUsd, 72);
    assert.equal(assertChainedBenchmarkParentForEmbeddingSnapshot({ ledger, policy: f.policy,
      benchmarkExtension: newParent, snapshot }), undefined);
    assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot({ ledger, policy: f.policy,
      benchmarkExtension: newParent, snapshot: structuredClone(snapshot) }), denied('policy_mismatch'));
    const afterParent = process.hrtime.bigint();
    f.ledger = ledger;
    const guardTiming = await reserveOneMixedEmbedding(f, newParent, snapshot);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    const stage = (from, to) => Math.round(Number(to - from) / 1e6);
    console.log(`C9 synthetic rows=420000 elapsedMs=${Math.round(elapsedMs)} `
      + `setupTransitionMs=${stage(started, afterTransition)} bulkInsertMs=${stage(afterTransition, afterBulk)} `
      + `snapshotParentMs=${stage(afterBulk, afterParent)} capabilityMs=${guardTiming.capabilityMs} `
      + `guardCreateMs=${guardTiming.guardCreateMs} firstCaseMs=${guardTiming.firstCaseMs} `
      + `embeddingRequestMs=${guardTiming.embeddingRequestMs} stateReadCloseMs=${guardTiming.stateReadCloseMs} `
      + `rssMiB=${Math.round(process.memoryUsage().rss / 2 ** 20)}`);
  });
}
