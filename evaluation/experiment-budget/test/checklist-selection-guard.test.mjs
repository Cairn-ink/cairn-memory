import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync, symlinkSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { schemasFor } from '../../../adapters/openai/schemas.mjs';
import { createExperimentBudget, reopenExperimentBudget } from '../index.mjs';
import * as guards from '../request-guard.mjs';
import { experimentPolicy } from '../../live/session.mjs';

const filename = 'experiment-checklist-selection-extension.json';
const modelId = 'gpt-4.1-mini-2025-04-14';
const input = () => ({ query: 'Why now?', maxRefs: 24, maps: [{ namespaceIndex: 0, exhausted: true,
  items: [{ type: 'unfiled', ref: { memoryId: 'visible', revision: 1 }, label: 'Synthetic note' }] }] });
const proposal = () => ({ requests: [{ start: 0, end: 3, refs: [{ namespaceIndex: 0, memoryId: 'visible', revision: 1 }] }] });
const body = (generate = false) => ({ model: modelId, instructions: 'Synthetic checklist.', truncation: 'disabled',
  input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input()) }] }],
  text: { format: { type: 'json_schema', name: 'cairn_selectChecklist', strict: true, schema: schemasFor('selectChecklist', input()) } },
  ...(generate ? { max_output_tokens: 1024, store: false, stream: false } : {}) });
const url = generate => `https://api.openai.com/v1/responses${generate ? '' : '/input_tokens'}`;
const request = value => ({ method: 'POST', redirect: 'error', signal: new AbortController().signal,
  headers: { authorization: 'Bearer synthetic-checklist-key', 'content-type': 'application/json' }, body: JSON.stringify(value) });
const response = () => ({ object: 'response', model: modelId, status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(proposal()) }] }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
const fake = calls => async (target, options) => { calls.push({ target, options });
  return Response.json(target.endsWith('/input_tokens') ? { object: 'response.input_tokens', input_tokens: 100 } : response()); };
function fixture(provision = true, limits = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-checklist-capability-'));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 50000000, requestCap: 100, ...limits };
  createExperimentBudget(ledger).close(); const policy = experimentPolicy();
  guards.createExperimentRequestGuard({ ledger, policy, fetchImpl: () => assert.fail('No setup I/O') }).close();
  const authorization = { ledger, policy, authorizationId: 'synthetic-checklist-approval' };
  return { root, ledger, policy, authorization,
    checklistSelectionExtension: provision ? guards.authorizeChecklistSelectionExtension(authorization) : undefined };
}
const make = (f, fetchImpl) => guards.createChecklistSelectionExperimentRequestGuard({ ledger: f.ledger, policy: f.policy,
  checklistSelectionExtension: f.checklistSelectionExtension, fetchImpl });
const state = f => { const ledger = reopenExperimentBudget(f.ledger); try { return ledger.getState(); } finally { ledger.close(); } };

test('actual checklist adapter count and generation settle in the existing ledger', async t => {
  const f = fixture(), calls = [], guard = make(f, fake(calls)); t.after(() => guard.close());
  const model = createOpenAIModel({ apiKey: 'synthetic-checklist-key', fetchImpl: guard.cairnFetch });
  assert.deepEqual(await model.selectChecklist({ system: 'Synthetic checklist.', input: input(), maxOutputTokens: 1024,
    signal: new AbortController().signal }), proposal());
  assert.deepEqual(calls.map(call => call.target), [url(false), url(true)]);
  const observed = guard.getState();
  assert.equal(observed.requestCount, 2); assert.equal(observed.reservedMicroUsd, 10000);
  assert.equal(observed.attempts.filter(attempt => attempt.actualMicroUsd === null).length, 1);
  assert.ok(observed.attempts.every(attempt => attempt.outcome !== null));
});

test('checklist-only guard rejects method/model/schema/route expansion without reservation or I/O', async t => {
  const f = fixture(), guard = make(f, () => assert.fail('No denied request I/O')); t.after(() => guard.close());
  const before = guard.getState();
  for (const mutate of [v => { v.model = 'gpt-5.6-luna'; }, v => { v.extra = true; },
    v => { v.text.format.schema.additionalProperties = true; }, v => { v.text.format.strict = false; },
    v => { v.instructions = null; }, v => { v.max_output_tokens = 1025; },
    v => { v.input[0].content[0].text = JSON.stringify({ ...input(), maxRefs: 25 }); },
    ...['cairn_select', 'cairn_rank', 'cairn_extract', 'cairn_qualifyCandidates', 'cairn_relate'].map(name => v => { v.text.format.name = name; })]) {
    const value = body(true); mutate(value); await assert.rejects(guard.cairnFetch(url(true), request(value)));
    assert.deepEqual(guard.getState(), before, String(mutate));
  }
  for (const target of ['https://other.test/v1/responses', `${url(true)}?extra=1`, 'https://api.openai.com/v1/chat/completions']) {
    await assert.rejects(async () => guard.cairnFetch(target, request(body(true))));
  }
  await assert.rejects(guard.cairnFetch(url(true), { ...request(body(true)), redirect: 'follow' }));
  await assert.rejects(guard.hostFetch('https://api.openai.com/v1/chat/completions', request({ model: modelId,
    messages: [{ role: 'user', content: 'Synthetic question' }], max_completion_tokens: 1024, store: false, stream: false, n: 1 })));
  assert.deepEqual(guard.getState(), before);
});

test('new grant remains separate and all earlier guards deny checklist count and generation', async () => {
  const f = fixture();
  const base = { ledger: f.ledger, policy: f.policy, fetchImpl: () => assert.fail('No older guard I/O') };
  const extension = guards.authorizeExtractionModelExtension(f.authorization);
  const reconciliationExtension = guards.authorizeReconciliationExtension({ ...f.authorization, extension });
  const qualificationExtension = guards.authorizeQualificationExtension(f.authorization);
  const candidateQualificationExtension = guards.authorizeCandidateQualificationExtension(f.authorization);
  const rationaleExtension = guards.authorizeRationaleExtension(f.authorization);
  const rationaleModelsExtension = guards.authorizeRationaleModelsExtension(f.authorization);
  const basisModelsExtension = guards.authorizeBasisModelsExtension(f.authorization);
  const old = [guards.createExperimentRequestGuard(base), guards.createExtendedExperimentRequestGuard({ ...base, extension }),
    guards.createReconciliationExperimentRequestGuard({ ...base, extension, reconciliationExtension }),
    guards.createQualificationExperimentRequestGuard({ ...base, qualificationExtension }),
    guards.createCandidateQualificationExperimentRequestGuard({ ...base, candidateQualificationExtension }),
    guards.createRationaleExperimentRequestGuard({ ...base, rationaleExtension }),
    guards.createRationaleModelsExperimentRequestGuard({ ...base, rationaleModelsExtension }),
    guards.createBasisModelsExperimentRequestGuard({ ...base, basisModelsExtension })];
  for (const guard of old) try {
    for (const generate of [false, true]) await assert.rejects(guard.cairnFetch(url(generate), request(body(generate))));
  } finally { guard.close(); }
  assert.throws(() => make({ ...f, checklistSelectionExtension: candidateQualificationExtension }, base.fetchImpl));
  assert.throws(() => guards.createCandidateQualificationExperimentRequestGuard({ ...base, candidateQualificationExtension: f.checklistSelectionExtension }));
  assert.equal(state(f).requestCount, 0);
});

test('issuance requires a settled checkpoint and idempotent reuse never resets allowance', () => {
  const f = fixture(false), ledger = reopenExperimentBudget(f.ledger), attemptId = randomUUID();
  ledger.reserve({ attemptId, channel: 'cairn-count', reservedMicroUsd: 5000 });
  assert.throws(() => guards.authorizeChecklistSelectionExtension(f.authorization));
  ledger.recordOutcome({ attemptId, outcome: 'unknown' }); ledger.close();
  const before = state(f), grant = guards.authorizeChecklistSelectionExtension(f.authorization);
  assert.ok(Object.isFrozen(grant)); assert.ok(Object.isFrozen(grant.checkpoint));
  assert.equal(grant.method, 'cairn_selectChecklist'); assert.equal(grant.model, modelId);
  assert.deepEqual(grant.checkpoint, { requestCount: 1, reservedMicroUsd: 5000 });
  const path = join(f.ledger.directory, filename), bytes = readFileSync(path);
  assert.equal(lstatSync(path).mode & 0o777, 0o600);
  assert.deepEqual(guards.authorizeChecklistSelectionExtension(f.authorization), grant);
  assert.deepEqual(readFileSync(path), bytes); assert.deepEqual(state(f), before);
  assert.throws(() => guards.authorizeChecklistSelectionExtension({ ...f.authorization, authorizationId: 'other' }));
});

test('wrong ledger/run/policy/checkpoint and widened constructor options cannot bind a grant', () => {
  const f = fixture(), other = fixture(), fetchImpl = () => assert.fail('No binding I/O');
  for (const changed of [{ ...f, ledger: other.ledger }, { ...f, ledger: { ...f.ledger, runId: randomUUID() } },
    { ...f, policy: { ...f.policy, unknown: true } }, { ...f, checklistSelectionExtension: undefined },
    { ...f, checklistSelectionExtension: { ...f.checklistSelectionExtension, checkpoint: { requestCount: 1, reservedMicroUsd: 5000 } } }]) {
    assert.throws(() => make(changed, fetchImpl));
  }
  assert.throws(() => guards.createChecklistSelectionExperimentRequestGuard({ ledger: f.ledger, policy: f.policy,
    checklistSelectionExtension: f.checklistSelectionExtension, fetchImpl, factory: () => {} }));
  assert.equal(state(f).requestCount, 0);
});

test('missing tampered symlink and unsafe grants fail construction and recheck before every request', async () => {
  for (const mode of ['missing', 'corrupt', 'method', 'permissions', 'symlink']) {
    const f = fixture(), guard = make(f, () => assert.fail('No tampered grant I/O'));
    const path = join(f.ledger.directory, filename), bytes = readFileSync(path);
    if (mode === 'missing') unlinkSync(path);
    if (mode === 'corrupt') writeFileSync(path, '{');
    if (mode === 'method') writeFileSync(path, JSON.stringify({ ...JSON.parse(bytes), method: 'cairn_select' }));
    if (mode === 'permissions') chmodSync(path, 0o644);
    if (mode === 'symlink') { const target = join(f.root, 'synthetic-grant'); writeFileSync(target, bytes, { mode: 0o600 }); unlinkSync(path); symlinkSync(target, path); }
    try { assert.throws(() => make(f, () => assert.fail('No construction I/O')));
      await assert.rejects(guard.cairnFetch(url(false), request(body()))); assert.equal(guard.getState().requestCount, 0);
    } finally { guard.close(); }
  }
});

test('provider failure and inflight cancellation retain reservations and settle without retries', async t => {
  for (const mode of ['failure', 'cancel']) {
    const f = fixture(); let start, calls = 0;
    const ready = new Promise(resolve => { start = resolve; });
    const guard = make(f, () => { calls++; start(); if (mode === 'failure') throw new Error('Synthetic failure'); return new Promise(() => {}); });
    t.after(() => guard.close());
    const controller = new AbortController();
    const pending = guard.cairnFetch(url(true), { ...request(body(true)), signal: controller.signal });
    await ready; if (mode === 'cancel') controller.abort(); await assert.rejects(pending);
    const observed = guard.getState(); assert.equal(calls, 1); assert.equal(observed.reservedMicroUsd, 5000);
    assert.equal(observed.attempts[0].actualMicroUsd, null); assert.notEqual(observed.attempts[0].outcome, null);
  }
});

test('aggregate reservation and request ceilings prevent a second request without resetting the grant', async t => {
  for (const limits of [{ limitMicroUsd: 5000 }, { requestCap: 1 }]) {
    const f = fixture(true, limits), calls = [], guard = make(f, fake(calls)); t.after(() => guard.close());
    await guard.cairnFetch(url(false), request(body())); const before = guard.getState();
    await assert.rejects(guard.cairnFetch(url(false), request(body())));
    assert.equal(calls.length, 1); assert.deepEqual(guard.getState(), before);
  }
});

test('valid-shaped but token-heavy checklist input rejects before reservation or provider I/O', async t => {
  const f = fixture(), guard = make(f, () => assert.fail('No oversized input I/O')); t.after(() => guard.close());
  const heavy = input(); heavy.maps[0].items[0].label = '界'.repeat(6001);
  assert.ok(Buffer.byteLength(JSON.stringify(heavy)) < 24000);
  const value = body(); value.input[0].content[0].text = JSON.stringify(heavy);
  value.text.format.schema = schemasFor('selectChecklist', heavy);
  const before = guard.getState();
  await assert.rejects(guard.cairnFetch(url(false), request(value)));
  assert.deepEqual(guard.getState(), before);
});
