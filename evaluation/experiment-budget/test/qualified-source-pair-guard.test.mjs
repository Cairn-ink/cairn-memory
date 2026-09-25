import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { createExperimentBudget, reopenExperimentBudget } from '../index.mjs';
import { authorizeBenchmarkExtension, authorizeBenchmarkRequestAllowance,
  authorizeBenchmarkBudgetExtension, authorizeQualifiedSourcePairCapability,
  createExperimentRequestGuard, createQualifiedSourcePairExperimentRequestGuard } from '../request-guard.mjs';
import { benchmarkStagePolicy } from '../../live/public-pilot.mjs';
import { experimentPolicy } from '../../live/session.mjs';

const hash = (domain, value) => createHash('sha256')
  .update(JSON.stringify([domain, value]), 'utf8').digest('hex');
const names = ['qualified-prefix', 'indexed-windows'];
const questionId = `lme-case-${'a'.repeat(64)}`;
const roster = [{ questionId, protocolDigest: 'b'.repeat(64), armOrder: names,
  arms: names.map((name) => ({ name,
    scopeId: `lme-case-${hash('cairn.lme.source-pair.scope.v1', [questionId, name])}` })) }];
const fails = (code) => (error) => error?.code === code;
const guardUrl = new URL('../request-guard.mjs', import.meta.url).href;
const request = (body) => ({ method: 'POST', redirect: 'error',
  signal: new AbortController().signal,
  headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' },
  body: JSON.stringify(body) });

async function adapterWire(method, input) {
  const captured = [];
  const model = createOpenAIModel({ apiKey: 'synthetic-only', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    captured.push({ url, body });
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    const empty = { value: null, evidenceIndices: [] };
    const unknown = { value: 'unknown', evidenceIndices: [] };
    const output = method === 'extract' ? { items: [] } : { qualifications: {
      item_0: { itemIndex: 0, subject: empty, property: empty, scope: empty,
        applies: empty, value: empty, attribution: unknown, commitment: unknown },
    } };
    return Response.json({ id: 'resp_synthetic', object: 'response', model: body.model,
      status: 'completed', error: null, incomplete_details: null,
      output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
      usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } });
  } });
  await model[method]({ system: 'Synthetic system.', input, maxOutputTokens: 1024,
    signal: new AbortController().signal });
  return captured;
}

function fakeHttp(url, options) {
  const body = JSON.parse(options.body);
  if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
  if (url.endsWith('/responses')) return Response.json({ id: 'resp_synthetic', object: 'response',
    model: body.model, status: 'completed', error: null, incomplete_details: null,
    output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: '{"items":[]}', annotations: [] }] }],
    usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } });
  return Response.json({ id: 'chat_synthetic', object: 'chat.completion', model: body.model,
    choices: [{ index: 0, message: { role: 'assistant', content: 'synthetic' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } });
}

function fixture(t, { stageTimeoutMs = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-pair-guard-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = { directory: join(root, 'budget'), runId: randomUUID(),
    limitMicroUsd: 50_000_000, requestCap: 5 };
  createExperimentBudget(first).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger: first, policy,
    fetchImpl: () => assert.fail('no provider') }).close();
  const stages = benchmarkStagePolicy();
  if (stageTimeoutMs !== null) {
    stages.answer.timeoutMs = stageTimeoutMs;
    stages.judge.timeoutMs = stageTimeoutMs;
  }
  const original = authorizeBenchmarkExtension({ ledger: first, policy,
    authorizationId: 'original', stages });
  const allowance = authorizeBenchmarkRequestAllowance({ oldLedger: first, policy,
    benchmarkExtension: original, authorizationId: 'allowance', newRequestCap: 20,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const second = { ...first, requestCap: 20 };
  const parent = authorizeBenchmarkBudgetExtension({ oldLedger: second, policy,
    requestAllowance: allowance, authorizationId: 'budget-parent',
    newLimitMicroUsd: 100_000_000, newRequestCap: 40,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const ledger = { ...second, limitMicroUsd: 100_000_000, requestCap: 40 };
  const options = { ledger, policy, benchmarkExtension: parent,
    authorizationId: 'pair-auth', executionId: 'pair-execution',
    checkpoint: { requestCount: 0, reservedMicroUsd: 0 }, roster };
  return { options, ledger, policy, parent, stages };
}

const answerRequest = (stage) => request({ model: stage.model,
  messages: [{ role: 'user', content: 'Synthetic answer.' }],
  n: 1, temperature: 0, max_tokens: 16, store: false, stream: false });

test('G2 compact source-pair authorization and same-connection claim produce one scoped grant', async (t) => {
  const f = fixture(t);
  const capability = authorizeQualifiedSourcePairCapability(f.options);
  assert.equal(capability.version, 'qualified-source-pair-case-v1');
  assert.equal(capability.schedule.length, 4);
  assert.deepEqual(capability.schedule.map((entry) => entry.phase),
    ['generation', 'generation', 'scoring', 'scoring']);
  assert.deepEqual(authorizeQualifiedSourcePairCapability(f.options), capability);
  const guard = createQualifiedSourcePairExperimentRequestGuard({ ledger: f.ledger, policy: f.policy,
    benchmarkExtension: f.parent, qualifiedSourcePairCapability: capability,
    fetchImpl: () => assert.fail('no provider') });
  t.after(() => guard.close());
  assert.equal(guard.caseDeadlineCapability, undefined);
  assert.deepEqual(guard.qualifiedSourcePairCapability, capability);
  for (const slot of capability.schedule) {
    await guard.withCaseScope(slot, async (scope) => {
      assert.equal(scope.snapshot().status, 'active');
    });
  }
  assert.equal(guard.getState().requestCount, 0);
  assert.throws(() => createQualifiedSourcePairExperimentRequestGuard({ ledger: f.ledger,
    policy: f.policy, benchmarkExtension: f.parent, qualifiedSourcePairCapability: capability,
    fetchImpl: () => assert.fail('no provider') }), fails('capability_consumed'));
});

test('G2 sparse roster, wrong scope and optional null diagnostics fail before file creation', (t) => {
  const f = fixture(t);
  const masked = [roster[0], ,];
  masked.foo = 'mask';
  assert.throws(() => authorizeQualifiedSourcePairCapability({ ...f.options, roster: masked }),
    fails('invalid_capability'));
  assert.throws(() => authorizeQualifiedSourcePairCapability({ ...f.options,
    roster: [{ ...roster[0], arms: [{ ...roster[0].arms[0], scopeId: 'wrong' }, roster[0].arms[1]] }] }),
  fails('invalid_capability'));
  const files = join(f.ledger.directory, `experiment-qualified-source-pair-${f.options.executionId}`);
  assert.equal(existsSync(`${files}.json`), false);
  assert.equal(existsSync(`${files}.claim.json`), false);
  const capability = authorizeQualifiedSourcePairCapability(f.options);
  assert.throws(() => createQualifiedSourcePairExperimentRequestGuard({ ledger: f.ledger,
    policy: f.policy, benchmarkExtension: f.parent, qualifiedSourcePairCapability: capability,
    fetchImpl: () => {}, transportDiagnostics: null }), fails('invalid_options'));
  assert.equal(existsSync(`${files}.claim.json`), false);
});

test('G3 adapter wire grants both source policies, qualification, answer and judge in one schedule', async (t) => {
  const prefix = await adapterWire('extract', { messages: [
    { index: 0, role: 'user', content: 'Synthetic prefix source.' }] });
  const indexed = await adapterWire('extract', { inputMode: 'indexed-windows-v1', messages: [
    { index: 0, messageIndex: 0, role: 'user', content: 'Synthetic indexed source.' }] });
  const qualification = await adapterWire('qualifyCandidates', { items: [
    { itemIndex: 0, content: 'Synthetic preference', kind: 'preference',
      candidates: [{ candidateIndex: 0, role: 'user', text: 'Synthetic preference' }] }] });
  assert.deepEqual(prefix.map((entry) => entry.body.text.format.name), ['cairn_extract', 'cairn_extract']);
  assert.deepEqual(indexed.map((entry) => entry.body.text.format.name), ['cairn_extract', 'cairn_extract']);
  assert.deepEqual(qualification.map((entry) => entry.body.text.format.name),
    ['cairn_qualifyCandidates', 'cairn_qualifyCandidates']);
  const f = fixture(t);
  const capability = authorizeQualifiedSourcePairCapability(f.options);
  const forwarded = [];
  const guard = createQualifiedSourcePairExperimentRequestGuard({ ledger: f.ledger,
    policy: f.policy, benchmarkExtension: f.parent, qualifiedSourcePairCapability: capability,
    fetchImpl: (url, options) => { forwarded.push(url); return fakeHttp(url, options); } });
  t.after(() => guard.close());
  const stages = benchmarkStagePolicy();
  for (const [index, wire] of [[0, prefix], [1, indexed]]) {
    await guard.withCaseScope(capability.schedule[index], async () => {
      for (const item of [...wire, ...qualification]) {
        const response = await guard.cairnFetch(item.url, request(item.body));
        assert.equal(response.status, 200);
      }
      const response = await guard.answerFetch(stages.answer.endpoint,
        request({ model: stages.answer.model, messages: [{ role: 'user', content: 'Synthetic answer.' }],
          n: 1, temperature: 0, max_tokens: 16, store: false, stream: false }));
      assert.equal(response.status, 200);
    });
  }
  for (const slot of capability.schedule.slice(2)) {
    await guard.withCaseScope(slot, async () => {
      const response = await guard.judgeFetch(stages.judge.endpoint,
        request({ model: stages.judge.model, messages: [{ role: 'user', content: 'Synthetic judge.' }],
          n: 1, temperature: 0, max_tokens: 16, store: false, stream: false }));
      assert.equal(response.status, 200);
    });
  }
  assert.equal(forwarded.length, 12);
  assert.equal(guard.getState().requestCount, 12);
  assert.equal(guard.attempts().length, 12);
  assert.equal(guard.isHalted(), false);
});

test('G3 wrong source arm, schema, method, model, stage and endpoint never reserve or forward', async (t) => {
  const prefix = await adapterWire('extract', { messages: [
    { index: 0, role: 'user', content: 'Prefix.' }] });
  const indexed = await adapterWire('extract', { inputMode: 'indexed-windows-v1', messages: [
    { index: 0, messageIndex: 0, role: 'user', content: 'Indexed.' }] });
  const qualification = await adapterWire('qualifyCandidates', { items: [
    { itemIndex: 0, content: 'Synthetic preference', kind: 'preference',
      candidates: [{ candidateIndex: 0, role: 'user', text: 'Synthetic preference' }] }] });
  const alteredSchema = structuredClone(prefix[1].body);
  alteredSchema.text.format.schema = {};
  const alteredMethod = structuredClone(prefix[1].body);
  alteredMethod.text.format.name = 'cairn_reconcile';
  const alteredModel = structuredClone(prefix[1].body);
  alteredModel.model = 'wrong-model';
  const qualifiedWithMode = structuredClone(qualification[1].body);
  const qualifiedInput = JSON.parse(qualifiedWithMode.input[0].content[0].text);
  qualifiedWithMode.input[0].content[0].text = JSON.stringify({ ...qualifiedInput,
    inputMode: 'indexed-windows-v1' });
  const cases = [
    { name: 'indexed-in-prefix', body: indexed[1].body, url: indexed[1].url, slot: 0 },
    { name: 'legacy-in-indexed', body: prefix[1].body, url: prefix[1].url,
      reverse: true, slot: 0 },
    { name: 'wrong-schema', body: alteredSchema, url: prefix[1].url, slot: 0 },
    { name: 'wrong-method', body: alteredMethod, url: prefix[1].url, slot: 0 },
    { name: 'wrong-model', body: alteredModel, url: prefix[1].url, slot: 0 },
    { name: 'qualification-input-mode', body: qualifiedWithMode, url: qualification[1].url, slot: 0 },
    ...['cairn_qualify', 'cairn_relate', 'cairn_reviewBasis', 'cairn_selectChecklist']
      .map((method) => ({ name: method, body: { ...prefix[1].body,
        text: { format: { ...prefix[1].body.text.format, name: method } } },
      url: prefix[1].url, slot: 0 })),
  ];
  for (const invalid of cases) {
    await t.test(invalid.name, async (nested) => {
      const f = fixture(nested);
      if (invalid.reverse) f.options.roster = [{ ...roster[0], armOrder: [...names].reverse() }];
      const capability = authorizeQualifiedSourcePairCapability(f.options);
      let calls = 0;
      const guard = createQualifiedSourcePairExperimentRequestGuard({ ledger: f.ledger,
        policy: f.policy, benchmarkExtension: f.parent, qualifiedSourcePairCapability: capability,
        fetchImpl: () => { calls += 1; return fakeHttp(invalid.url, request(invalid.body)); } });
      nested.after(() => guard.close());
      const before = guard.getState();
      await guard.withCaseScope(capability.schedule[invalid.slot], async () => {
        await assert.rejects(guard.cairnFetch(invalid.url, request(invalid.body)),
          fails('unsupported_request'));
      });
      assert.equal(guard.isHalted(), true);
      assert.equal(calls, 0);
      assert.deepEqual(guard.getState(), before);
    });
  }
  const f = fixture(t);
  const capability = authorizeQualifiedSourcePairCapability(f.options);
  let calls = 0;
  const guard = createQualifiedSourcePairExperimentRequestGuard({ ledger: f.ledger,
    policy: f.policy, benchmarkExtension: f.parent, qualifiedSourcePairCapability: capability,
    fetchImpl: () => { calls += 1; return fakeHttp('ignored', request({})); } });
  t.after(() => guard.close());
  assert.throws(() => guard.cairnFetch('https://example.invalid/unlisted', request(prefix[1].body)),
    fails('invalid_request'));
  await guard.withCaseScope(capability.schedule[0], async () => {
    await assert.rejects(guard.judgeFetch(benchmarkStagePolicy().judge.endpoint,
      request({ model: benchmarkStagePolicy().judge.model, messages: [{ role: 'user', content: 'x' }],
        n: 1, temperature: 0, max_tokens: 1, store: false, stream: false })),
    fails('case_scope_violation'));
  });
  assert.equal(calls, 0);
  assert.equal(guard.getState().requestCount, 0);
});

test('G2 tampered capability and binding or parent chain refuse before a claim', (t) => {
  const f = fixture(t);
  const capability = authorizeQualifiedSourcePairCapability(f.options);
  const args = { ledger: f.ledger, policy: f.policy, benchmarkExtension: f.parent,
    qualifiedSourcePairCapability: capability, fetchImpl: () => assert.fail('provider') };
  assert.throws(() => createQualifiedSourcePairExperimentRequestGuard({ ...args,
    qualifiedSourcePairCapability: { ...capability, rosterDigest: '0'.repeat(64) } }),
  fails('invalid_capability'));
  const binding = join(f.ledger.directory,
    `experiment-qualified-source-pair-${capability.executionId}.json`);
  writeFileSync(binding, '{}\n');
  assert.throws(() => createQualifiedSourcePairExperimentRequestGuard(args),
    fails('policy_mismatch'));
  assert.equal(existsSync(join(f.ledger.directory,
    `experiment-qualified-source-pair-${capability.executionId}.claim.json`)), false);
  const parentFixture = fixture(t);
  const parentCapability = authorizeQualifiedSourcePairCapability(parentFixture.options);
  const parentFile = join(parentFixture.ledger.directory,
    `experiment-benchmark-budget-extension-${parentFixture.parent.originalRequestAllowance.authorizationId}.json`);
  writeFileSync(parentFile, '{}\n');
  assert.throws(() => createQualifiedSourcePairExperimentRequestGuard({
    ledger: parentFixture.ledger, policy: parentFixture.policy,
    benchmarkExtension: parentFixture.parent,
    qualifiedSourcePairCapability: parentCapability,
    fetchImpl: () => assert.fail('provider') }), fails('policy_mismatch'));
  assert.equal(existsSync(join(parentFixture.ledger.directory,
    `experiment-qualified-source-pair-${parentCapability.executionId}.claim.json`)), false);
});

test('G4 recognized transport deadline isolates one slot; HTTP 429 globally halts', async (t) => {
  await t.test('deadline', async (nested) => {
    const f = fixture(nested, { stageTimeoutMs: 30 });
    const capability = authorizeQualifiedSourcePairCapability(f.options);
    let calls = 0;
    const guard = createQualifiedSourcePairExperimentRequestGuard({ ledger: f.ledger,
      policy: f.policy, benchmarkExtension: f.parent, qualifiedSourcePairCapability: capability,
      fetchImpl: (url, options) => ++calls === 1 ? new Promise(() => {}) : fakeHttp(url, options) });
    nested.after(() => guard.close());
    await guard.withCaseScope(capability.schedule[0], async () => {
      await assert.rejects(guard.answerFetch(f.stages.answer.endpoint,
        answerRequest(f.stages.answer)), fails('case_deadline_exceeded'));
    });
    assert.equal(guard.isHalted(), false);
    await guard.withCaseScope(capability.schedule[1], async () => {
      const response = await guard.answerFetch(f.stages.answer.endpoint,
        answerRequest(f.stages.answer));
      assert.equal(response.status, 200);
    });
    assert.equal(calls, 2);
    assert.deepEqual(guard.attempts().map((attempt) => attempt.outcome), ['unknown', 'succeeded']);
    assert.equal(guard.getState().attempts[0].actualMicroUsd, null);
    assert.equal(guard.getState().reservedMicroUsd,
      guard.attempts().reduce((sum, attempt) => sum + attempt.reservedMicroUsd, 0));
  });
  await t.test('http-429', async (nested) => {
    const f = fixture(nested);
    const capability = authorizeQualifiedSourcePairCapability(f.options);
    let calls = 0;
    const guard = createQualifiedSourcePairExperimentRequestGuard({ ledger: f.ledger,
      policy: f.policy, benchmarkExtension: f.parent, qualifiedSourcePairCapability: capability,
      fetchImpl: () => { calls += 1; return new Response('rate limited', { status: 429 }); } });
    nested.after(() => guard.close());
    await guard.withCaseScope(capability.schedule[0], async () => {
      await assert.rejects(guard.answerFetch(f.stages.answer.endpoint,
        answerRequest(f.stages.answer)), fails('http_failed'));
    });
    assert.equal(guard.isHalted(), true);
    await assert.rejects(guard.withCaseScope(capability.schedule[1], async () => {}),
      fails('paid_work_halted'));
    assert.equal(calls, 1);
    assert.equal(guard.getState().requestCount, 1);
    assert.equal(guard.getState().attempts[0].outcome, 'failed');
  });
});

test('G4 concurrent child constructors consume exactly one durable claim', async (t) => {
  const f = fixture(t);
  const capability = authorizeQualifiedSourcePairCapability(f.options);
  const data = JSON.stringify({ ledger: f.ledger, policy: f.policy,
    benchmarkExtension: f.parent, qualifiedSourcePairCapability: capability });
  const source = `
    import { createQualifiedSourcePairExperimentRequestGuard } from ${JSON.stringify(guardUrl)};
    const options = JSON.parse(process.argv[1]);
    process.stdout.write('ready\\n');
    await new Promise((resolve) => process.stdin.once('data', resolve));
    try {
      const guard = createQualifiedSourcePairExperimentRequestGuard({ ...options,
        fetchImpl: () => { throw new Error('no provider'); } });
      guard.close();
      console.log(JSON.stringify({ result: 'owned' }));
    } catch (error) { console.log(JSON.stringify({ result: error.code ?? 'unexpected' })); }
  `;
  const runChild = () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, data], {
      env: { NODE_NO_WARNINGS: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    let readyResolve;
    let readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const finished = new Promise((resolve, reject) => {
      child.stdout.on('data', (chunk) => {
        out += chunk;
        if (out.startsWith('ready\n')) readyResolve();
      });
      child.stderr.on('data', (chunk) => { err += chunk; });
      child.on('error', (error) => { readyReject(error); reject(error); });
      child.on('close', (status) => {
        clearTimeout(timer);
        if (status !== 0) {
          const error = new Error(`child status ${status}: ${err}`);
          readyReject(error); reject(error);
        } else {
          try { resolve(JSON.parse(out.slice('ready\n'.length).trim())); }
          catch (error) { reject(error); }
        }
      });
    });
    return { ready, finished, start: () => child.stdin.end('go\n') };
  };
  const children = [runChild(), runChild()];
  await Promise.all(children.map((child) => child.ready));
  children.forEach((child) => child.start());
  const results = await Promise.all(children.map((child) => child.finished));
  assert.equal(results.filter((entry) => entry.result === 'owned').length, 1, JSON.stringify(results));
  assert.ok(results.some((entry) => ['capability_consumed', 'ledger_busy'].includes(entry.result)),
    JSON.stringify(results));
  const filename = join(f.ledger.directory,
    `experiment-qualified-source-pair-${capability.executionId}.claim.json`);
  const claim = JSON.parse(readFileSync(filename, 'utf8'));
  assert.deepEqual(Object.keys(claim).sort(), ['capabilityDigest', 'executionId', 'version']);
  assert.equal(claim.version, 'qualified-source-pair-claim-v1');
  assert.equal(claim.executionId, capability.executionId);
  assert.match(claim.capabilityDigest, /^[0-9a-f]{64}$/u);
  assert.equal(lstatSync(filename).mode & 0o777, 0o600);
});

test('G4 partial claim write or fsync failure never makes a reusable grant', (t) => {
  for (const mode of ['partial-write', 'fsync']) {
    const f = fixture(t);
    const capability = authorizeQualifiedSourcePairCapability(f.options);
    const data = JSON.stringify({ ledger: f.ledger, policy: f.policy,
      benchmarkExtension: f.parent, qualifiedSourcePairCapability: capability });
    const source = `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const mode = process.argv[2];
      const original = mode === 'partial-write' ? fs.writeFileSync : fs.fsyncSync;
      if (mode === 'partial-write') fs.writeFileSync = function (fd, bytes, options) {
        fs.writeFileSync = original;
        syncBuiltinESMExports();
        original.call(fs, fd, String(bytes).slice(0, 5), options);
        throw new Error('synthetic partial claim');
      };
      else fs.fsyncSync = function () {
        fs.fsyncSync = original;
        syncBuiltinESMExports();
        throw new Error('synthetic fsync failure');
      };
      syncBuiltinESMExports();
      const { createQualifiedSourcePairExperimentRequestGuard } =
        await import(${JSON.stringify(guardUrl)});
      try {
        createQualifiedSourcePairExperimentRequestGuard({ ...JSON.parse(process.argv[1]),
          fetchImpl: () => { throw new Error('provider'); } });
        console.log(JSON.stringify({ result: 'unexpected-success' }));
      } catch (error) { console.log(JSON.stringify({ result: error.code ?? 'unexpected-error' })); }
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', source, data, mode],
      { encoding: 'utf8', timeout: 10_000, env: { NODE_NO_WARNINGS: '1' } });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(JSON.parse(child.stdout.trim()).result, 'ledger_failed');
    const claim = join(f.ledger.directory,
      `experiment-qualified-source-pair-${capability.executionId}.claim.json`);
    assert.equal(existsSync(claim), true);
    assert.throws(() => createQualifiedSourcePairExperimentRequestGuard({ ...JSON.parse(data),
      fetchImpl: () => assert.fail('provider') }), fails('capability_consumed'));
  }
});

test('G4 constructor pre-/post-COMMIT or close failure retains its consumed claim', (t) => {
  for (const mode of ['before-commit', 'after-commit', 'close-failure']) {
    const f = fixture(t);
    const capability = authorizeQualifiedSourcePairCapability(f.options);
    const data = JSON.stringify({ ledger: f.ledger, policy: f.policy,
      benchmarkExtension: f.parent, qualifiedSourcePairCapability: capability });
    const source = `
      import { DatabaseSync } from 'node:sqlite';
      import { createQualifiedSourcePairExperimentRequestGuard } from ${JSON.stringify(guardUrl)};
      const mode = process.argv[2];
      const options = JSON.parse(process.argv[1]);
      const originalExec = DatabaseSync.prototype.exec;
      const originalClose = DatabaseSync.prototype.close;
      DatabaseSync.prototype.exec = function (sql) {
        if (sql === 'COMMIT') {
          DatabaseSync.prototype.exec = originalExec;
          if (mode === 'before-commit') throw new Error('synthetic precommit');
          originalExec.call(this, sql);
          if (mode === 'after-commit') throw new Error('synthetic postcommit');
          return;
        }
        return originalExec.call(this, sql);
      };
      if (mode === 'close-failure') DatabaseSync.prototype.close = function () {
        DatabaseSync.prototype.close = originalClose;
        originalClose.call(this);
        throw new Error('synthetic close failure');
      };
      let result;
      try {
        const guard = createQualifiedSourcePairExperimentRequestGuard({ ...options,
          fetchImpl: () => { throw new Error('provider'); } });
        guard.close();
        result = 'unexpected-success';
      } catch (error) { result = error.code ?? 'unexpected-error'; }
      console.log(JSON.stringify({ result }));
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', source, data, mode],
      { encoding: 'utf8', timeout: 10_000, env: { NODE_NO_WARNINGS: '1' } });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(JSON.parse(child.stdout.trim()).result, 'ledger_failed');
    const claim = join(f.ledger.directory,
      `experiment-qualified-source-pair-${capability.executionId}.claim.json`);
    assert.equal(existsSync(claim), true);
    assert.throws(() => createQualifiedSourcePairExperimentRequestGuard({ ...JSON.parse(data),
      fetchImpl: () => assert.fail('provider') }), fails('capability_consumed'));
    const observer = reopenExperimentBudget(f.ledger);
    assert.equal(observer.getState().requestCount, 0);
    observer.close();
  }
});

test('G4 external abort and unknown usage halt globally without losing reservations', async (t) => {
  for (const failure of ['external-abort', 'unknown-usage']) {
    await t.test(failure, async (nested) => {
      const f = fixture(nested);
      const capability = authorizeQualifiedSourcePairCapability(f.options);
      let entered;
      const enteredPromise = new Promise((resolve) => { entered = resolve; });
      let calls = 0;
      const guard = createQualifiedSourcePairExperimentRequestGuard({ ledger: f.ledger,
        policy: f.policy, benchmarkExtension: f.parent, qualifiedSourcePairCapability: capability,
        fetchImpl: (url, options) => {
          calls += 1;
          entered();
          if (failure === 'external-abort') return new Promise(() => {});
          const body = JSON.parse(options.body);
          return Response.json({ id: 'chat_synthetic', object: 'chat.completion', model: body.model,
            choices: [{ index: 0, message: { role: 'assistant', content: 'Friday' },
              finish_reason: 'stop' }] });
        } });
      nested.after(() => guard.close());
      const controller = new AbortController();
      const operation = guard.withCaseScope(capability.schedule[0], async () => {
        const pending = guard.answerFetch(f.stages.answer.endpoint,
          { ...answerRequest(f.stages.answer), signal: controller.signal });
        if (failure === 'external-abort') {
          await enteredPromise;
          controller.abort('synthetic external stop');
        }
        await assert.rejects(pending, fails(failure === 'external-abort'
          ? 'request_aborted' : 'invalid_response'));
      });
      await operation;
      assert.equal(guard.isHalted(), true);
      assert.equal(calls, 1);
      assert.equal(guard.getState().requestCount, 1);
      assert.equal(guard.getState().attempts[0].outcome, 'unknown');
      assert.equal(guard.getState().attempts[0].actualMicroUsd, null);
      await assert.rejects(guard.withCaseScope(capability.schedule[1], async () => {}),
        fails('paid_work_halted'));
    });
  }
});

test('G4 finite request-cap exhaustion does not forward an unreserved request', async (t) => {
  const f = fixture(t);
  const old = reopenExperimentBudget(f.ledger);
  for (let index = 0; index < 39; index += 1) {
    const attemptId = randomUUID();
    old.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: 1 });
    old.recordOutcome({ attemptId, outcome: 'unknown' });
  }
  old.close();
  f.options.checkpoint = { requestCount: 39, reservedMicroUsd: 39 };
  const capability = authorizeQualifiedSourcePairCapability(f.options);
  let calls = 0;
  const guard = createQualifiedSourcePairExperimentRequestGuard({ ledger: f.ledger,
    policy: f.policy, benchmarkExtension: f.parent, qualifiedSourcePairCapability: capability,
    fetchImpl: (url, options) => { calls += 1; return fakeHttp(url, options); } });
  t.after(() => guard.close());
  await guard.withCaseScope(capability.schedule[0], async () => {
    assert.equal((await guard.answerFetch(f.stages.answer.endpoint,
      answerRequest(f.stages.answer))).status, 200);
  });
  await assert.rejects(guard.withCaseScope(capability.schedule[1], async () => {
    await assert.rejects(guard.answerFetch(f.stages.answer.endpoint,
      answerRequest(f.stages.answer)), fails('request_cap_exceeded'));
  }), fails('ledger_closed'));
  assert.equal(calls, 1);
  assert.equal(guard.isHalted(), true);
  assert.throws(() => guard.getState(), fails('ledger_closed'));
  const observer = reopenExperimentBudget(f.ledger);
  assert.equal(observer.getState().requestCount, 40);
  assert.equal(observer.getState().attempts[39].outcome, 'succeeded');
  observer.close();
});

test('G2 caller data and fetch references are captured once before authorization callbacks', (t) => {
  const f = fixture(t);
  const grantOptions = { ...f.options };
  let rosterReads = 0;
  Object.defineProperty(grantOptions, 'roster', { enumerable: true, get() {
    rosterReads += 1;
    return rosterReads === 1 ? roster : [];
  } });
  const capability = authorizeQualifiedSourcePairCapability(grantOptions);
  assert.equal(rosterReads, 1);
  assert.equal(capability.roster.length, 1);
  const caller = { ledger: f.ledger, policy: f.policy, benchmarkExtension: f.parent,
    qualifiedSourcePairCapability: capability, fetchImpl: () => assert.fail('provider') };
  let capabilityReads = 0;
  let fetchReads = 0;
  Object.defineProperty(caller, 'qualifiedSourcePairCapability', { enumerable: true, get() {
    capabilityReads += 1;
    return capabilityReads === 1 ? capability : {};
  } });
  Object.defineProperty(caller, 'fetchImpl', { enumerable: true, get() {
    fetchReads += 1;
    return fetchReads === 1 ? (() => assert.fail('provider')) : null;
  } });
  const guard = createQualifiedSourcePairExperimentRequestGuard(caller);
  t.after(() => guard.close());
  assert.equal(capabilityReads, 1);
  assert.equal(fetchReads, 1);
});

test('G4 callback exit and escaped descendants never open the next paid slot', async (t) => {
  const f = fixture(t);
  const capability = authorizeQualifiedSourcePairCapability(f.options);
  let calls = 0;
  const guard = createQualifiedSourcePairExperimentRequestGuard({ ledger: f.ledger,
    policy: f.policy, benchmarkExtension: f.parent, qualifiedSourcePairCapability: capability,
    fetchImpl: (url, options) => { calls += 1; return fakeHttp(url, options); } });
  t.after(() => guard.close());
  let escaped;
  await assert.rejects(guard.withCaseScope(capability.schedule[0], async () => {
    assert.equal((await guard.answerFetch(f.stages.answer.endpoint,
      answerRequest(f.stages.answer))).status, 200);
    escaped = new Promise((resolve) => setImmediate(async () => {
      try { await guard.answerFetch(f.stages.answer.endpoint, answerRequest(f.stages.answer)); }
      catch (error) { resolve(error.code); }
    }));
    throw new Error('synthetic wrapper exit failure');
  }), /synthetic wrapper exit failure/u);
  assert.equal(await escaped, 'paid_work_halted');
  assert.equal(guard.isHalted(), true);
  await assert.rejects(guard.withCaseScope(capability.schedule[1], async () => {}),
    fails('paid_work_halted'));
  assert.equal(calls, 1);
  assert.equal(guard.getState().requestCount, 1);
  assert.equal(guard.getState().attempts[0].outcome, 'succeeded');

  const clean = fixture(t);
  const cleanCapability = authorizeQualifiedSourcePairCapability(clean.options);
  let cleanCalls = 0;
  const cleanGuard = createQualifiedSourcePairExperimentRequestGuard({ ledger: clean.ledger,
    policy: clean.policy, benchmarkExtension: clean.parent,
    qualifiedSourcePairCapability: cleanCapability,
    fetchImpl: () => { cleanCalls += 1; return fakeHttp('unused', { body: '{}' }); } });
  t.after(() => cleanGuard.close());
  let late;
  await cleanGuard.withCaseScope(cleanCapability.schedule[0], async () => {
    late = new Promise((resolve) => setImmediate(async () => {
      try { await cleanGuard.answerFetch(clean.stages.answer.endpoint,
        answerRequest(clean.stages.answer)); }
      catch (error) { resolve(error.code); }
    }));
  });
  assert.equal(await late, 'case_scope_required');
  assert.equal(cleanCalls, 0);
  assert.equal(cleanGuard.getState().requestCount, 0);
  assert.equal(cleanGuard.isHalted(), false);
});

test('G4 foreign insertion between guard precheck and reserve cannot forward or enter witness', async (t) => {
  const f = fixture(t);
  const capability = authorizeQualifiedSourcePairCapability(f.options);
  let forwards = 0;
  const guard = createQualifiedSourcePairExperimentRequestGuard({ ledger: f.ledger,
    policy: f.policy, benchmarkExtension: f.parent, qualifiedSourcePairCapability: capability,
    fetchImpl: () => { forwards += 1; return fakeHttp('unused', { body: '{}' }); } });
  t.after(() => guard.close());
  const foreignId = randomUUID();
  const original = DatabaseSync.prototype.exec;
  let injected = false;
  DatabaseSync.prototype.exec = function (sql) {
    if (!injected && sql === 'BEGIN IMMEDIATE') {
      injected = true;
      DatabaseSync.prototype.exec = original;
      const foreign = reopenExperimentBudget(f.ledger);
      foreign.reserve({ attemptId: foreignId, channel: 'cairn-count', reservedMicroUsd: 3 });
      foreign.recordOutcome({ attemptId: foreignId, outcome: 'unknown' });
      foreign.close();
    }
    return original.call(this, sql);
  };
  let firstFailure;
  try {
    await assert.rejects(guard.withCaseScope(capability.schedule[0], async () => {
      try { await guard.answerFetch(f.stages.answer.endpoint, answerRequest(f.stages.answer)); }
      catch (error) { firstFailure = error.code; }
    }), fails('ledger_closed'));
  } finally { DatabaseSync.prototype.exec = original; }
  assert.equal(injected, true);
  assert.equal(firstFailure, 'invalid_ledger');
  assert.equal(guard.isHalted(), true);
  assert.equal(forwards, 0);
  const observer = reopenExperimentBudget(f.ledger);
  const state = observer.getState();
  observer.close();
  assert.equal(state.requestCount, 1);
  assert.equal(state.attempts[0].attemptId, foreignId);
  assert.equal(state.attempts[0].outcome, 'unknown');
});

test('G4 settlement write failure leaves one pending reservation and fences transport', async (t) => {
  const f = fixture(t);
  const capability = authorizeQualifiedSourcePairCapability(f.options);
  const original = DatabaseSync.prototype.prepare;
  let calls = 0;
  const guard = createQualifiedSourcePairExperimentRequestGuard({ ledger: f.ledger,
    policy: f.policy, benchmarkExtension: f.parent, qualifiedSourcePairCapability: capability,
    fetchImpl: (url, options) => {
      calls += 1;
      DatabaseSync.prototype.prepare = function (sql) {
        if (sql.includes('UPDATE attempts SET outcome')) {
          DatabaseSync.prototype.prepare = original;
          throw new Error('synthetic settlement failure');
        }
        return original.call(this, sql);
      };
      return fakeHttp(url, options);
    } });
  t.after(() => guard.close());
  let firstFailure;
  try {
    await assert.rejects(guard.withCaseScope(capability.schedule[0], async () => {
      try { await guard.answerFetch(f.stages.answer.endpoint, answerRequest(f.stages.answer)); }
      catch (error) { firstFailure = error.code; }
    }), fails('guard_busy'));
  } finally { DatabaseSync.prototype.prepare = original; }
  assert.equal(firstFailure, 'ledger_failed');
  assert.equal(guard.isHalted(), true);
  assert.equal(calls, 1);
  const observer = reopenExperimentBudget(f.ledger);
  const state = observer.getState();
  observer.close();
  assert.equal(state.requestCount, 1);
  assert.equal(state.attempts[0].outcome, null);
  assert.equal(state.reservedMicroUsd, f.stages.answer.reservedMicroUsd);
});

test('G4 late body after a transport deadline never settles the old reservation twice', async (t) => {
  const f = fixture(t, { stageTimeoutMs: 30 });
  const capability = authorizeQualifiedSourcePairCapability(f.options);
  let release;
  let calls = 0;
  const guard = createQualifiedSourcePairExperimentRequestGuard({ ledger: f.ledger,
    policy: f.policy, benchmarkExtension: f.parent, qualifiedSourcePairCapability: capability,
    fetchImpl: (url, options) => {
      calls += 1;
      if (calls > 1) return fakeHttp(url, options);
      return new Response(new ReadableStream({ start(controller) {
        release = () => {
          try { controller.enqueue(new TextEncoder().encode('{}')); controller.close(); }
          catch { /* The timed-out reader may already have cancelled the stream. */ }
        };
      } }), { status: 200, headers: { 'content-type': 'application/json' } });
    } });
  t.after(() => guard.close());
  await guard.withCaseScope(capability.schedule[0], async () => {
    await assert.rejects(guard.answerFetch(f.stages.answer.endpoint,
      answerRequest(f.stages.answer)), fails('case_deadline_exceeded'));
  });
  assert.equal(guard.getState().requestCount, 1);
  assert.equal(guard.getState().attempts[0].outcome, 'unknown');
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(guard.getState().attempts[0].outcome, 'unknown');
  await guard.withCaseScope(capability.schedule[1], async () => {
    assert.equal((await guard.answerFetch(f.stages.answer.endpoint,
      answerRequest(f.stages.answer))).status, 200);
  });
  assert.equal(calls, 2);
  assert.deepEqual(guard.attempts().map((attempt) => attempt.outcome), ['unknown', 'succeeded']);
});
