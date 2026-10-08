import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { inspectEmbeddingExperimentBudgetSnapshot } from '../index.mjs';
import { compileSourceRoleArm } from '../../source-role-ablation/compiler.mjs';
import { grantedFixture, sourceRoleFixture, checkpointOptions, settleFixture,
  guardOptions, denied, noHttp, urls, fakeResponse, httpOptions, fixtureChild } from './source-role-ablation-fixture.mjs';

import * as guards from '../request-guard.mjs';

test('N29A distinct source-role authority exists independently of pair grants', () => {
  assert.equal(typeof guards.authorizeSourceRoleAblationCapability, 'function');
  assert.equal(typeof guards.createSourceRoleAblationRequestGuard, 'function');
});

const slot = (index = 1) => ({ slot: index, ordinal: Math.ceil(index / 2),
  arm: index % 4 === 1 || index % 4 === 0 ? 'baseline' : 'candidate' });
const wire = async () => (await compileSourceRoleArm({ caseOrdinal: 1, arm: 'baseline',
  scriptedOutput: { items: [] } })).httpBodies;
const grantFile = f => path.join(f.ledger.directory,
  `experiment-source-role-extraction-${f.capability.executionId}.json`);

test('N29A actual adapter serialization, immutable grant, exclusive one-shot claim and replay', async t => {
  const f = await grantedFixture(t);
  const expected = await wire();
  assert.equal(f.capability.protocol.slots[0].countBodySha256,
    createHash('sha256').update(expected[0].bodyText).digest('hex'));
  assert.equal(f.capability.protocol.slots[0].generationBodySha256,
    createHash('sha256').update(expected[1].bodyText).digest('hex'));
  assert.equal(Object.isFrozen(f.capability.protocol.slots[0]), true);
  const grantBytes = readFileSync(grantFile(f));
  await assert.rejects(guards.authorizeSourceRoleAblationCapability(f.options), denied('unsafe_policy_binding'));
  assert.deepEqual(readFileSync(grantFile(f)), grantBytes);
  const guard = await guards.createSourceRoleAblationRequestGuard(guardOptions(f));
  f.workspace.defer(() => guard.close());
  assert.equal(Object.hasOwn(guard, 'withCaseScope'), false);
  await assert.rejects(guards.createSourceRoleAblationRequestGuard(guardOptions(f)), denied('capability_consumed'));
  assert.equal(guard.getState().requestCount, f.before.requestCount);
});

test('N29A real constructor process race consumes exactly one claim', async t => {
  const f = await grantedFixture(t);
  const outcomes = await Promise.all([fixtureChild(f, 'claim'), fixtureChild(f, 'claim')]);
  assert.equal(outcomes.filter(row => row.claimed).length, 1);
  assert.equal(outcomes.filter(row => row.code === 'capability_consumed').length, 1);
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.ledger).requestCount, f.before.requestCount);
});

test('N29A zero-send post-claim constructor failure remains consumed with finite errors', async t => {
  const f = await grantedFixture(t);
  assert.deepEqual(await fixtureChild(f, 'constructor-failure'),
    { claimed: true, ownedRequests: 0, code: 'invalid_capability', replay: 'capability_consumed' });
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.ledger).requestCount, f.before.requestCount);
});

test('N29A malformed own-data, forged capability, partial grant and stale checkpoint deny before HTTP', async t => {
  const f = await grantedFixture(t);
  let getters = 0;
  const accessor = { ...guardOptions(f) };
  Object.defineProperty(accessor, 'fetchImpl', { enumerable: true, get() { getters++; return noHttp; } });
  await assert.rejects(guards.createSourceRoleAblationRequestGuard(accessor), denied('invalid_capability'));
  assert.equal(getters, 0);
  const forged = structuredClone(f.capability);
  forged.protocol.slots[0].countBodySha256 = '0'.repeat(64);
  await assert.rejects(guards.createSourceRoleAblationRequestGuard({ ...guardOptions(f),
    sourceRoleAblationCapability: forged }), denied('policy_mismatch'));
  settleFixture(f, 1, 1);
  await assert.rejects(guards.createSourceRoleAblationRequestGuard(guardOptions(f)), denied('policy_mismatch'));
  writeFileSync(grantFile(f), '{', { mode: 0o600 });
  await assert.rejects(guards.createSourceRoleAblationRequestGuard(guardOptions(f)), denied('unsafe_policy_binding'));
  assert.equal(readFileSync(grantFile(f), 'utf8'), '{', 'partial file retained, never repaired');
});

test('N29B next slot, scope overlap, count-before-generation, duplicates and sealed/late callbacks', async t => {
  const f = await grantedFixture(t);
  const bodies = await wire();
  let sends = 0;
  const guard = await guards.createSourceRoleAblationRequestGuard(guardOptions(f, async url => {
    sends++; return fakeResponse(url);
  }));
  f.workspace.defer(() => guard.close());
  await assert.rejects(guard.cairnFetch(urls.count, httpOptions(bodies[0].bodyText)), denied('case_scope_required'));
  await assert.rejects(guard.withSlotScope(slot(2), async () => {}), denied('case_schedule_mismatch'));
  let late;
  await guard.withSlotScope(slot(), async () => {
    await assert.rejects(guard.withSlotScope(slot(), async () => {}), denied('case_scope_busy'));
    await assert.rejects(guard.cairnFetch(urls.generation, httpOptions(bodies[1].bodyText)), denied('case_scope_violation'));
    await assert.rejects(guard.answerFetch('https://api.openai.com/v1/chat/completions', {}), denied('case_scope_violation'));
    await assert.rejects(guard.judgeFetch('https://api.openai.com/v1/chat/completions', {}), denied('case_scope_violation'));
    await assert.rejects(guard.hostFetch(), denied('unsupported_request'));
    const first = guard.cairnFetch(urls.count, httpOptions(bodies[0].bodyText));
    await assert.rejects(guard.cairnFetch(urls.generation, httpOptions(bodies[1].bodyText)), denied('guard_busy'));
    await first;
    await assert.rejects(guard.cairnFetch(urls.count, httpOptions(bodies[0].bodyText)), denied('case_scope_violation'));
    await guard.cairnFetch(urls.generation, httpOptions(bodies[1].bodyText));
    await assert.rejects(guard.cairnFetch(urls.generation, httpOptions(bodies[1].bodyText)), denied('case_scope_violation'));
    late = new Promise(resolve => { const deferred = () => guard.cairnFetch(urls.count, httpOptions(bodies[0].bodyText));
      resolve(deferred); });
    // This callback's async-local context is retained after the slot closes.
    const gate = new Promise(resolve => { f.releaseLate = resolve; });
    f.lateRequest = gate.then(() => guard.cairnFetch(urls.count, httpOptions(bodies[0].bodyText)));
    f.lateRequest.catch(() => {});
  });
  await assert.rejects(guard.withSlotScope(slot(), async () => {}), denied('case_schedule_mismatch'));
  await guard.withSlotScope(slot(2), async () => {
    f.releaseLate();
    await assert.rejects(f.lateRequest, denied('case_scope_required'));
  });
  assert.equal(typeof await late, 'function');
  for (let index = 3; index <= 24; index++) await guard.withSlotScope(slot(index), async () => {});
  await assert.rejects(guard.withSlotScope(slot(24), async () => {}), denied('case_schedule_mismatch'));
  assert.equal(sends, 2);
  assert.equal(guard.isHalted(), false);
});

test('N29B body, prompt, input, schema, model and method drift deny before reserve', async t => {
  const bodies = await wire();
  for (const change of ['whitespace', 'prompt', 'input', 'schema', 'model', 'classify', 'rank', 'qualify']) {
    const f = await grantedFixture(t, { executionId: `drift-${change}` });
    const guard = await guards.createSourceRoleAblationRequestGuard(guardOptions(f));
    f.workspace.defer(() => guard.close());
    const body = JSON.parse(bodies[0].bodyText);
    if (change === 'prompt') body.instructions += ' drift';
    if (change === 'input') body.input[0].content[0].text += ' ';
    if (change === 'schema') body.text.format.schema.extra = true;
    if (change === 'model') body.model = 'gpt-4o-2024-08-06';
    if (['classify', 'rank', 'qualify'].includes(change)) body.text.format.name = `cairn_${change}`;
    await assert.rejects(guard.withSlotScope(slot(), async () => {
      await guard.cairnFetch(urls.count, httpOptions(change === 'whitespace' ? ` ${bodies[0].bodyText}` : JSON.stringify(body)));
    }), denied('unsupported_request'), change);
    assert.equal(guard.attempts().length, 0, change);
    assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.ledger).requestCount, f.before.requestCount, change);
  }
});

test('N29C grant recheck after request getters and transactional foreign-history fence', async t => {
  const f = await grantedFixture(t);
  const bodies = await wire();
  const guard = await guards.createSourceRoleAblationRequestGuard(guardOptions(f));
  f.workspace.defer(() => guard.close());
  const headers = { 'Content-Type': 'application/json' };
  Object.defineProperty(headers, 'Authorization', { enumerable: true, get() {
    writeFileSync(grantFile(f), '{', { mode: 0o600 });
    return 'Bearer synthetic-private-key-never-report';
  } });
  await assert.rejects(guard.withSlotScope(slot(), async () => {
    await guard.cairnFetch(urls.count, httpOptions(bodies[0].bodyText, { headers }));
  }), denied('unsafe_policy_binding'));
  assert.equal(guard.attempts().length, 0);
  const foreign = await grantedFixture(t);
  assert.deepEqual(await fixtureChild(foreign, 'foreign-gap'),
    { inserted: true, ownedRequests: 0, halted: true, code: 'invalid_ledger' });
  const after = inspectEmbeddingExperimentBudgetSnapshot(foreign.ledger);
  assert.deepEqual(after.attempts.slice(0, foreign.before.requestCount), foreign.before.attempts);
  assert.equal(after.requestCount, foreign.before.requestCount + 1, 'only controlled foreign row remains');
});

test('N29C full reservation preflight preserves protected30 and needs all48 request slots', async t => {
  const boundary = sourceRoleFixture(t, { requestCap: 54 });
  settleFixture(boundary, 367_999_899);
  const capability = await guards.authorizeSourceRoleAblationCapability(checkpointOptions(boundary));
  assert.equal(capability.checkpoint.reservedMicroUsd + capability.limits.reservedMicroUsd, 370_000_000);
  const over = sourceRoleFixture(t);
  settleFixture(over, 367_999_900);
  await assert.rejects(guards.authorizeSourceRoleAblationCapability(checkpointOptions(over)), denied('invalid_capability'));
  const requests = sourceRoleFixture(t, { requestCap: 52 });
  await assert.rejects(guards.authorizeSourceRoleAblationCapability(requests.options), denied('invalid_capability'));
  const pending = sourceRoleFixture(t);
  const resource = await import('../index.mjs');
  const handle = resource.openBoundEmbeddingExperimentBudget({ configuration: pending.ledger, authorize() {} });
  pending.workspace.defer(() => handle.close());
  handle.reserve({ attemptId: '11111111-1111-4111-8111-111111111111', channel: 'host-embedding', reservedMicroUsd: 1 });
  await assert.rejects(guards.authorizeSourceRoleAblationCapability(checkpointOptions(pending)),
    error => error.code === 'budget_blocked');
});

test('N29 legacy guard import and construction do not load absent optional ablation assets', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-source-role-legacy-' });
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const copy = path.join(workspace.path, 'checkout');
  for (const directory of ['core', 'adapters/openai', 'evaluation/experiment-budget', 'plugins/cairn-memory/lib']) {
    const target = path.join(copy, directory);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(root, directory), target, { recursive: true,
      filter: filename => !filename.split(path.sep).includes('node_modules') });
  }
  symlinkSync(path.join(root, 'adapters/openai/node_modules'), path.join(copy, 'adapters/openai/node_modules'), 'dir');
  assert.equal(existsSync(path.join(copy, 'evaluation/source-role-ablation')), false);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const m=await import(${JSON.stringify(new URL(`file://${path.join(copy, 'evaluation/experiment-budget/request-guard.mjs')}`).href)});
     const b=await import(${JSON.stringify(new URL(`file://${path.join(copy, 'evaluation/experiment-budget/index.mjs')}`).href)});
     const {experimentPolicy}=await import(${JSON.stringify(new URL('../../live/session.mjs', import.meta.url).href)});
     const ledger={directory:${JSON.stringify(path.join(workspace.path, 'legacy-ledger'))},
       runId:'11111111-1111-4111-8111-111111111111',limitMicroUsd:1000000,requestCap:2};
     b.createExperimentBudget(ledger).close();
     const guard=m.createExperimentRequestGuard({ledger,policy:experimentPolicy(),fetchImpl:()=>{throw new Error('no HTTP')}});
     if(guard.getState().requestCount!==0) process.exit(1);
     guard.close();`],
  { env: { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, TMPDIR: workspace.path,
    NODE_DISABLE_COMPILE_CACHE: '1' }, encoding: 'utf8', maxBuffer: 4096, timeout: 10_000 });
  assert.equal(child.signal, null);
  assert.equal(child.status, 0);
});
