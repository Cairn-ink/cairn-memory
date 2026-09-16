import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { schemasFor } from '../../../adapters/openai/schemas.mjs';
import { createExperimentBudget, reopenExperimentBudget } from '../index.mjs';
import { authorizeBasisModelsExtension, authorizeCandidateQualificationExtension,
  authorizeChecklistSelectionExtension, authorizeDispositionComparisonExtension,
  authorizeQualificationExtension, authorizeRationaleExtension, authorizeRationaleModelsExtension,
  createBasisModelsExperimentRequestGuard, createCandidateQualificationExperimentRequestGuard,
  createChecklistSelectionExperimentRequestGuard, createQualificationExperimentRequestGuard,
  createDispositionComparisonExperimentRequestGuard, createExperimentRequestGuard,
  createRationaleExperimentRequestGuard, createRationaleModelsExperimentRequestGuard } from '../request-guard.mjs';
import { createDispositionComparisonLiveSession } from '../../live/qualification-session.mjs';
import { createDispositionComparisonAttempt } from '../../live/qualification-pilot-attempt.mjs';
import { experimentPolicy } from '../../live/session.mjs';

const modelId = 'gpt-4.1-mini-2025-04-14';
const filename = 'experiment-disposition-comparison-extension.json';
const input = () => ({ memories: [
  { index: 0, receipts: [{ index: 0, role: 'user', excerpt: 'Chose A because it was cheaper.' }] },
  { index: 1, receipts: [{ index: 0, role: 'user', excerpt: 'A was cheaper then.' }] },
], oldEdges: [{ index: 0, from: 1, to: 0, relation: 'supports-decision',
  fromReceipt: 0, toReceipt: 0, interpretationStatus: 'unverified' }] });
const modelRequest = () => ({ system: 'Synthetic fixed comparison.', input: input(), maxOutputTokens: 1024,
  signal: new AbortController().signal });
const route = generation => `https://api.openai.com/v1/responses${generation ? '' : '/input_tokens'}`;
const body = (method, generation = false, source = input()) => ({ model: modelId,
  instructions: 'Synthetic fixed comparison.',
  input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(source) }] }],
  text: { format: { type: 'json_schema', name: `cairn_${method}`, strict: true,
    schema: schemasFor(method, source) } }, truncation: 'disabled',
  ...(generation ? { max_output_tokens: 1024, store: false, stream: false } : {}) });
const request = value => ({ method: 'POST', redirect: 'error', signal: new AbortController().signal,
  headers: { authorization: 'Bearer synthetic-only', 'content-type': 'application/json' },
  body: JSON.stringify(value) });
const output = (method, count = 1) => method === 'relate' ? { edges: [] } : {
  dispositions: Array.from({ length: count }, (_, edge) => ({ edge, action: 'unknown', evidence: [] })),
  additions: [] };
const fake = calls => async (url, options) => {
  const parsed = JSON.parse(options.body); calls.push({ url, parsed });
  if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
  return Response.json({ object: 'response', model: parsed.model, status: 'completed', error: null,
    incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(output(parsed.text.format.name.slice(6),
        JSON.parse(parsed.input[0].content[0].text).oldEdges.length)) }] }],
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
};
function fixture(t, fetchImpl = () => assert.fail('Denied HTTP'), ledgerChanges = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-dp-guard-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(),
    limitMicroUsd: 50_000_000, requestCap: 5000, ...ledgerChanges };
  createExperimentBudget(ledger).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger, policy, fetchImpl }).close();
  const auth = { ledger, policy, authorizationId: 'synthetic-dp' };
  const extension = authorizeDispositionComparisonExtension(auth);
  const config = { ledger, policy, dispositionComparisonExtension: extension, fetchImpl };
  const state = () => { const opened = reopenExperimentBudget(ledger);
    try { return opened.getState(); } finally { opened.close(); } };
  return { root, ledger, policy, auth, extension, config, state };
}

test('DP1–3 immutable separate baseline grant transports both methods and both phases', async t => {
  const calls = [], f = fixture(t, fake(calls));
  const file = join(f.ledger.directory, filename), bytes = readFileSync(file);
  assert.equal(lstatSync(file).mode & 0o777, 0o600);
  assert.deepEqual(f.extension.methods, ['cairn_relate', 'cairn_reviewRationaleDispositions']);
  assert.equal(f.extension.model, modelId);
  assert.equal(Object.isFrozen(f.extension), true);
  assert.deepEqual(authorizeDispositionComparisonExtension(f.auth), f.extension);
  assert.deepEqual(readFileSync(file), bytes);
  const session = createDispositionComparisonLiveSession({ ledger: f.ledger,
    dispositionComparisonExtension: f.extension, apiKey: 'synthetic-only', fetchImpl: f.config.fetchImpl });
  t.after(() => session.close());
  const adapter = createOpenAIModel({ apiKey: 'synthetic-adapter', fetchImpl: (url, options) => session.request(
    url.endsWith('/input_tokens') ? '/responses/input_tokens' : '/responses', options.body,
    { signal: options.signal }) });
  assert.deepEqual(await adapter.relate(modelRequest()), output('relate'));
  assert.deepEqual(await adapter.reviewRationaleDispositions(modelRequest()),
    output('reviewRationaleDispositions'));
  assert.deepEqual(calls.map(call => call.url), [route(false), route(true), route(false), route(true)]);
  assert.deepEqual(calls.map(call => call.parsed.text.format.name),
    ['cairn_relate', 'cairn_relate', 'cairn_reviewRationaleDispositions', 'cairn_reviewRationaleDispositions']);
  assert.ok(calls.every(call => JSON.stringify(JSON.parse(call.parsed.input[0].content[0].text)) === JSON.stringify(input())));
  assert.equal(session.getState().requestCount, 4);
  assert.equal(session.getState().reservedMicroUsd, 20_000);
  assert.ok(session.getState().attempts.every(attempt => attempt.outcome !== null));
});

test('DP2 both methods accept the same valid empty-old-edge input without requiring a seed', async t => {
  const calls = [], f = fixture(t, fake(calls));
  const session = createDispositionComparisonLiveSession({ ledger: f.ledger,
    dispositionComparisonExtension: f.extension, apiKey: 'synthetic-only', fetchImpl: f.config.fetchImpl });
  t.after(() => session.close());
  const adapter = createOpenAIModel({ apiKey: 'synthetic-adapter', fetchImpl: (url, options) => session.request(
    url.endsWith('/input_tokens') ? '/responses/input_tokens' : '/responses', options.body,
    { signal: options.signal }) });
  const empty = input(); empty.oldEdges = [];
  for (const method of ['relate', 'reviewRationaleDispositions']) {
    assert.deepEqual(await adapter[method]({ ...modelRequest(), input: empty }), output(method, 0));
  }
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => JSON.parse(call.parsed.input[0].content[0].text).oldEdges.length === 0));
});

test('DP1–3 old grants deny disposition; new grant denies host, model, method, shape and schema before spend', async t => {
  const f = fixture(t), guard = createDispositionComparisonExperimentRequestGuard(f.config);
  t.after(() => guard.close());
  const base = { ledger: f.ledger, policy: f.policy, fetchImpl: f.config.fetchImpl };
  const old = [createExperimentRequestGuard(base),
    createQualificationExperimentRequestGuard({ ...base,
      qualificationExtension: authorizeQualificationExtension(f.auth) }),
    createCandidateQualificationExperimentRequestGuard({ ...base,
      candidateQualificationExtension: authorizeCandidateQualificationExtension(f.auth) }),
    createRationaleExperimentRequestGuard({ ...base,
      rationaleExtension: authorizeRationaleExtension(f.auth) }),
    createRationaleModelsExperimentRequestGuard({ ...base,
      rationaleModelsExtension: authorizeRationaleModelsExtension(f.auth) }),
    createBasisModelsExperimentRequestGuard({ ...base,
      basisModelsExtension: authorizeBasisModelsExtension(f.auth) }),
    createChecklistSelectionExperimentRequestGuard({ ...base,
      checklistSelectionExtension: authorizeChecklistSelectionExtension(f.auth) })];
  t.after(() => old.forEach(item => item.close()));
  for (const prior of old) for (const generation of [false, true]) {
    await assert.rejects(prior.cairnFetch(route(generation),
      request(body('reviewRationaleDispositions', generation))));
  }
  for (const method of ['relate', 'reviewRationaleDispositions']) for (const generation of [false, true]) {
    const invalid = [
      value => { value.model = 'gpt-5.6-luna'; },
      value => { value.text.format.name = 'cairn_reviewBasis'; },
      value => { value.text.format.schema = {}; },
      value => { value.input[0].content[0].text = JSON.stringify({ memories: input().memories }); },
      value => { const source = input(); source.oldEdges[0].interpretationStatus = 'confirmed';
        value.input[0].content[0].text = JSON.stringify(source); },
      value => { const source = input(); source.oldEdges[0].fromReceipt = 1;
        value.input[0].content[0].text = JSON.stringify(source); },
      value => { value.truncation = 'auto'; },
    ];
    for (const mutate of invalid) {
      const value = body(method, generation); mutate(value);
      await assert.rejects(guard.cairnFetch(route(generation), request(value)));
      assert.equal(guard.getState().requestCount, 0);
    }
  }
  await assert.rejects(guard.hostFetch('https://api.openai.com/v1/chat/completions', request({})));
  assert.throws(() => guard.cairnFetch(`${route(true)}?widen=1`, request(body('relate', true))));
  for (const patch of [{ extra: true }, { apiKey: '' }, { dispositionComparisonExtension: undefined }]) {
    assert.throws(() => createDispositionComparisonLiveSession({ ledger: f.ledger,
      dispositionComparisonExtension: f.extension, apiKey: 'synthetic-only', fetchImpl: f.config.fetchImpl,
      ...patch }));
  }
  const session = createDispositionComparisonLiveSession({ ledger: f.ledger,
    dispositionComparisonExtension: f.extension, apiKey: 'synthetic-only', fetchImpl: f.config.fetchImpl });
  t.after(() => session.close());
  await assert.rejects(session.request('/chat/completions', body('relate', true)));
  assert.equal(f.state().requestCount, 0);
});

test('DP3 wrong/cross-kind binding and accessor-time mutation fail before reservation', async t => {
  const f = fixture(t), older = authorizeRationaleModelsExtension(f.auth);
  const unrelated = fixture(t);
  assert.throws(() => createDispositionComparisonExperimentRequestGuard({ ...f.config,
    ledger: unrelated.ledger }));
  const unboundRoot = mkdtempSync(join(tmpdir(), 'cairn-dp-unbound-'));
  t.after(() => rmSync(unboundRoot, { recursive: true, force: true }));
  const unboundLedger = { ...f.ledger, directory: join(unboundRoot, 'ledger'), runId: randomUUID() };
  createExperimentBudget(unboundLedger).close();
  assert.throws(() => createDispositionComparisonExperimentRequestGuard({ ...f.config,
    ledger: unboundLedger }));
  assert.throws(() => createDispositionComparisonExperimentRequestGuard({ ...f.config,
    dispositionComparisonExtension: { ...f.extension,
      checkpoint: { requestCount: 1, reservedMicroUsd: 5000 } } }));
  assert.throws(() => createDispositionComparisonExperimentRequestGuard({ ...f.config,
    dispositionComparisonExtension: older }));
  assert.throws(() => createRationaleModelsExperimentRequestGuard({ ledger: f.ledger, policy: f.policy,
    rationaleModelsExtension: f.extension, fetchImpl: f.config.fetchImpl }));
  assert.throws(() => createDispositionComparisonExperimentRequestGuard({ ...f.config, widen: true }));
  const guard = createDispositionComparisonExperimentRequestGuard(f.config); t.after(() => guard.close());
  const grantPath = join(f.ledger.directory, filename);
  const valid = request(body('relate', false));
  await assert.rejects(guard.cairnFetch(route(false), { ...valid,
    get headers() { writeFileSync(grantPath, '{}'); return valid.headers; } }));
  assert.equal(f.state().requestCount, 0);
  chmodSync(grantPath, 0o644);
  await assert.rejects(guard.cairnFetch(route(false), valid));
  assert.equal(f.state().requestCount, 0);
});

test('DP3 failed HTTP records one reservation with no refund or automatic retry', async t => {
  let calls = 0;
  const f = fixture(t, () => { calls++; return new Response('synthetic failure', { status: 429 }); });
  const guard = createDispositionComparisonExperimentRequestGuard(f.config); t.after(() => guard.close());
  await assert.rejects(guard.cairnFetch(route(false), request(body('relate', false))),
    { code: 'http_failed' });
  assert.equal(calls, 1);
  assert.equal(f.state().requestCount, 1);
  assert.equal(f.state().reservedMicroUsd, 5000);
  assert.equal(f.state().attempts[0].outcome, 'failed');
  assert.equal(f.state().attempts[0].actualMicroUsd, null);
});

test('DP3–5 integrated 429 halts queued attempt after one durable unknown-cost reservation', async t => {
  let calls = 0;
  const fetchImpl = () => { calls++; return new Response('synthetic rate limit', { status: 429 }); };
  const f = fixture(t, fetchImpl);
  const session = createDispositionComparisonLiveSession({ ledger: f.ledger,
    dispositionComparisonExtension: f.extension, apiKey: 'synthetic-only', fetchImpl });
  t.after(() => session.close());
  const attempt = createDispositionComparisonAttempt({ readState: session.getState,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 }, checkPins: () => {},
    persist: () => {}, send: (path, encoded, options) => session.request(path, encoded, options) });
  const results = await Promise.allSettled([attempt.request('/responses', JSON.stringify(body('relate', true))),
    attempt.request('/responses/input_tokens', JSON.stringify(body('reviewRationaleDispositions')))]);
  assert.ok(results.every(item => item.status === 'rejected'));
  assert.equal(calls, 1);
  assert.equal(attempt.getState().requests, 1);
  assert.equal(session.getState().requestCount, 1);
  assert.equal(session.getState().reservedMicroUsd, 5000);
  assert.equal(session.getState().attempts[0].outcome, 'failed');
  assert.equal(session.getState().attempts[0].actualMicroUsd, null);
});

test('DP3 transport uncertainty remains reserved and does not retry', async t => {
  let calls = 0;
  const f = fixture(t, () => { calls++; throw new Error('synthetic transport loss'); });
  const guard = createDispositionComparisonExperimentRequestGuard(f.config); t.after(() => guard.close());
  await assert.rejects(guard.cairnFetch(route(false), request(body('reviewRationaleDispositions'))),
    { code: 'transport_failed' });
  assert.equal(calls, 1);
  assert.equal(f.state().requestCount, 1);
  assert.equal(f.state().reservedMicroUsd, 5000);
  assert.equal(f.state().attempts[0].outcome, 'unknown');
  assert.equal(f.state().attempts[0].actualMicroUsd, null);
});
