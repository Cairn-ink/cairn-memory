import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, linkSync, lstatSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { DEFAULT_MODEL, LUNA_EXTRACTION_MODEL } from '../../../adapters/openai/profiles.mjs';
import { schemasFor } from '../../../adapters/openai/schemas.mjs';
import { qualificationPoolWire } from '../../../adapters/openai/test/qualification-pool-wire.mjs';
import { createQualificationTextCatalog } from '../../../core/qualification-text-catalog.mjs';
import { createExperimentBudget, reopenExperimentBudget } from '../index.mjs';
import * as guards from '../request-guard.mjs';
import { experimentPolicy } from '../../live/session.mjs';
import { createCandidateQualificationLiveSession } from '../../live/qualification-session.mjs';

// Actual adapter with guarded fake upstream and disposable synthetic ledgers.
const filename = 'experiment-candidate-qualification-extension.json';
const key = 'synthetic-candidate-parent-key';
const urls = { count: 'https://api.openai.com/v1/responses/input_tokens', generation: 'https://api.openai.com/v1/responses' };
const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const input = () => ({ items: [{ itemIndex: 0, content: 'Synthetic note', kind: 'context',
  candidates: [{ candidateIndex: 0, role: 'user', text: 'Synthetic note' }] }] });
const output = () => ({ qualifications: [{ itemIndex: 0, ...Object.fromEntries(fields.map((field) => [field,
  { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null, evidenceIndices: field === 'value' ? [0] : [] }])) }] });
const body = (generation = true) => ({ model: DEFAULT_MODEL, instructions: 'Synthetic evidence selection.',
  input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input()) }] }], truncation: 'disabled',
  text: { format: { name: 'cairn_qualifyCandidates', type: 'json_schema', strict: true, schema: schemasFor('qualifyCandidates', input()) } },
  ...(generation ? { max_output_tokens: 1024, store: false, stream: false } : {}) });
const request = (value = body()) => ({ method: 'POST', redirect: 'error', signal: new AbortController().signal,
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
const response = () => ({ object: 'response', model: DEFAULT_MODEL, status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text',
    text: JSON.stringify(qualificationPoolWire(input(), output())) }] }],
  usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } });
const fake = (calls) => async (url, options) => { calls.push({ url, body: JSON.parse(options.body) });
  return Response.json(url === urls.count ? { object: 'response.input_tokens', input_tokens: 100 } : response()); };
function fixture(provision = true) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-candidate-guard-'));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 50000000, requestCap: 1000 };
  createExperimentBudget(ledger).close(); const policy = experimentPolicy();
  guards.createExperimentRequestGuard({ ledger, policy, fetchImpl: () => assert.fail('No setup transport') }).close();
  const authorization = { ledger, policy, authorizationId: 'synthetic-candidate-approval' };
  return { root, ledger, policy, authorization,
    candidateQualificationExtension: provision ? guards.authorizeCandidateQualificationExtension(authorization) : undefined };
}
const make = (f, fetchImpl) => guards.createCandidateQualificationExperimentRequestGuard({ ledger: f.ledger, policy: f.policy,
  candidateQualificationExtension: f.candidateQualificationExtension, fetchImpl });
const file = (f) => join(f.ledger.directory, filename);
const state = (ledger) => { const h = reopenExperimentBudget(ledger); try { return h.getState(); } finally { h.close(); } };

test('CG1 actual candidate adapter uses new guard baseline framing and retains unknown count costs', async (t) => {
  const f = fixture(); const calls = []; const guard = make(f, fake(calls)); t.after(() => guard.close());
  const model = createOpenAIModel({ apiKey: key, fetchImpl: guard.cairnFetch });
  assert.deepEqual(await model.qualifyCandidates({ system: 'Synthetic.', input: input(), maxOutputTokens: 1024,
    signal: new AbortController().signal }), output());
  assert.deepEqual(calls.map((call) => [call.url, call.body.model, call.body.text.format.name]),
    [[urls.count, DEFAULT_MODEL, 'cairn_qualifyCandidates'], [urls.generation, DEFAULT_MODEL, 'cairn_qualifyCandidates']]);
  assert.equal(guard.getState().reservedMicroUsd, 10000);
  assert.equal(guard.getState().attempts[0].actualMicroUsd, null);
});

test('CG1 all four old guards deny candidate count/generation after new capability exists and tokens cannot cross versions', async () => {
  const f = fixture(); const extension = guards.authorizeExtractionModelExtension(f.authorization);
  const reconciliationExtension = guards.authorizeReconciliationExtension({ ...f.authorization, extension });
  const qualificationExtension = guards.authorizeQualificationExtension(f.authorization);
  const fetchImpl = () => assert.fail('No transport'); const base = { ledger: f.ledger, policy: f.policy, fetchImpl };
  for (const guard of [guards.createExperimentRequestGuard(base), guards.createExtendedExperimentRequestGuard({ ...base, extension }),
    guards.createReconciliationExperimentRequestGuard({ ...base, extension, reconciliationExtension }),
    guards.createQualificationExperimentRequestGuard({ ...base, qualificationExtension })]) {
    try { for (const generation of [true, false]) await assert.rejects(guard.cairnFetch(generation ? urls.generation : urls.count,
      request(body(generation))), { code: 'unsupported_request' }); } finally { guard.close(); }
  }
  assert.throws(() => make({ ...f, candidateQualificationExtension: qualificationExtension }, fetchImpl));
  assert.throws(() => guards.createQualificationExperimentRequestGuard({ ...base, qualificationExtension: f.candidateQualificationExtension }));
  assert.equal(state(f.ledger).requestCount, 0);
});

test('CG1 actual opt-in catalog adapter wire remains denied by every old guard without reservation', async () => {
  const catalog = createQualificationTextCatalog(input()).catalog;
  const unguarded = [];
  const model = createOpenAIModel({ apiKey: key, qualificationInputMode: 'adaptive-text-catalog-v1',
    fetchImpl: fake(unguarded) });
  assert.deepEqual(await model.qualifyCandidates({ system: 'Synthetic.', input: catalog,
    maxOutputTokens: 1024, signal: new AbortController().signal }), output());
  assert.equal(unguarded.length, 2);
  assert.equal(JSON.parse(unguarded[0].body.input[0].content[0].text).inputMode, 'text-catalog-v1');
  const f = fixture(); const extension = guards.authorizeExtractionModelExtension(f.authorization);
  const reconciliationExtension = guards.authorizeReconciliationExtension({ ...f.authorization, extension });
  const qualificationExtension = guards.authorizeQualificationExtension(f.authorization);
  const base = { ledger: f.ledger, policy: f.policy, fetchImpl: () => assert.fail('No guarded transport') };
  const all = [guards.createExperimentRequestGuard(base),
    guards.createExtendedExperimentRequestGuard({ ...base, extension }),
    guards.createReconciliationExperimentRequestGuard({ ...base, extension, reconciliationExtension }),
    guards.createQualificationExperimentRequestGuard({ ...base, qualificationExtension }),
    make(f, base.fetchImpl)];
  for (const guard of all) {
    try {
      for (const wire of unguarded) {
        await assert.rejects(guard.cairnFetch(wire.url, request(wire.body)), { code: 'unsupported_request' });
      }
      assert.equal(guard.getState().requestCount, 0);
    } finally { guard.close(); }
  }
  assert.equal(state(f.ledger).requestCount, 0);
});

test('CG1 candidate capability grants neither legacy qualification, reconciliation nor alternative extraction', async (t) => {
  const f = fixture(); const guard = make(f, () => assert.fail('No transport')); t.after(() => guard.close());
  for (const name of ['cairn_qualify', 'cairn_reconcile']) {
    const changed = body(); changed.text.format.name = name;
    await assert.rejects(guard.cairnFetch(urls.generation, request(changed)), { code: 'unsupported_request' });
  }
  const alternate = body(); alternate.model = LUNA_EXTRACTION_MODEL; alternate.reasoning = { effort: 'none' };
  const evidence = { messages: [{ index: 0, role: 'user', content: 'Synthetic' }] };
  alternate.input[0].content[0].text = JSON.stringify(evidence); alternate.text.format.name = 'cairn_extract';
  alternate.text.format.schema = schemasFor('extract', evidence);
  await assert.rejects(guard.cairnFetch(urls.generation, request(alternate)), { code: 'unsupported_request' });
  assert.equal(guard.getState().requestCount, 0);
});

test('CG2 independent immutable authorization requires settled checkpoint and remains idempotent without changing history', () => {
  const f = fixture(false); const h = reopenExperimentBudget(f.ledger); const attemptId = randomUUID();
  h.reserve({ attemptId, channel: 'cairn-count', reservedMicroUsd: 5000 });
  assert.throws(() => guards.authorizeCandidateQualificationExtension(f.authorization), { code: 'extension_busy' });
  h.recordOutcome({ attemptId, outcome: 'unknown' }); h.close();
  const before = state(f.ledger); const cap = guards.authorizeCandidateQualificationExtension(f.authorization);
  assert.equal(Object.isFrozen(cap), true); assert.equal(Object.isFrozen(cap.checkpoint), true);
  assert.equal(cap.method, 'cairn_qualifyCandidates'); assert.equal(cap.model, DEFAULT_MODEL);
  assert.deepEqual(cap.checkpoint, { requestCount: 1, reservedMicroUsd: 5000 }); assert.equal(lstatSync(file(f)).mode & 0o777, 0o600);
  const bytes = readFileSync(file(f)); assert.deepEqual(guards.authorizeCandidateQualificationExtension(f.authorization), cap);
  assert.deepEqual(readFileSync(file(f)), bytes); assert.deepEqual(state(f.ledger), before);
  assert.throws(() => guards.authorizeCandidateQualificationExtension({ ...f.authorization, authorizationId: 'different' }), { code: 'policy_mismatch' });
});

test('CG2 partial missing corrupt linked or unsafe capability refuses construction and every request without repair', async () => {
  for (const scenario of ['partial', 'missing', 'mode', 'symlink', 'hardlink', 'changed', 'oversize']) {
    const f = fixture(); const guard = make(f, () => assert.fail('No transport')); const bytes = readFileSync(file(f));
    if (scenario === 'partial') writeFileSync(file(f), '{partial');
    if (scenario === 'missing') unlinkSync(file(f));
    if (scenario === 'mode') chmodSync(file(f), 0o644);
    if (scenario === 'changed') { const changed = JSON.parse(bytes); changed.method = 'cairn_qualify'; writeFileSync(file(f), JSON.stringify(changed)); }
    if (scenario === 'oversize') writeFileSync(file(f), 'x'.repeat(1000001));
    if (scenario === 'symlink' || scenario === 'hardlink') {
      const target = join(f.root, 'target'); writeFileSync(target, bytes, { mode: 0o600 }); unlinkSync(file(f));
      if (scenario === 'symlink') symlinkSync(target, file(f)); else linkSync(target, file(f));
    }
    try { assert.throws(() => make(f, () => assert.fail('No transport')));
      await assert.rejects(guard.cairnFetch(urls.generation, request())); assert.equal(guard.getState().requestCount, 0);
    } finally { guard.close(); }
  }
});

test('CG2 request header getter cannot remove capability after first check and still reserve', async (t) => {
  const f = fixture(); const guard = make(f, () => assert.fail('No transport')); t.after(() => guard.close());
  const req = request(); const headers = req.headers; let read = false;
  Object.defineProperty(req, 'headers', { enumerable: true, get() { if (!read) unlinkSync(file(f)); read = true; return headers; } });
  await assert.rejects(guard.cairnFetch(urls.generation, req)); assert.equal(read, true); assert.equal(guard.getState().requestCount, 0);
});

test('CG3 candidate parent session has exact explicit options and closed routes with no key discovery or default transport', async (t) => {
  const f = fixture(); const calls = []; const options = { ledger: f.ledger, candidateQualificationExtension: f.candidateQualificationExtension,
    apiKey: key, fetchImpl: fake(calls) };
  for (const property of Object.keys(options)) { const bad = { ...options }; delete bad[property]; assert.throws(() => createCandidateQualificationLiveSession(bad)); }
  assert.throws(() => createCandidateQualificationLiveSession({ ...options, extra: true }));
  assert.throws(() => createCandidateQualificationLiveSession({ ...options, apiKey: 'bad key' }));
  assert.throws(() => createCandidateQualificationLiveSession({ ...options, ledger: { ...f.ledger, limitMicroUsd: 50000001 } }));
  const session = createCandidateQualificationLiveSession(options); t.after(() => session.close());
  assert.deepEqual(Object.keys(session).sort(), ['close', 'getState', 'request']);
  for (const route of ['/chat/completions', '/responses/other', 'https://api.openai.com/v1/responses']) await assert.rejects(session.request(route, body()));
  for (const name of ['cairn_qualify', 'cairn_reconcile', 'cairn_rank']) {
    const bad = body(); bad.text.format.name = name; await assert.rejects(session.request('/responses', bad));
  }
  assert.equal(calls.length, 0); assert.equal(session.getState().requestCount, 0);
  await session.request('/responses/input_tokens', body(false)); await session.request('/responses', body());
  assert.equal(calls.length, 2); assert.equal(session.getState().reservedMicroUsd, 10000);
});

test('CG2 transport failure and cancellation settle unknown cost without refunds', async (t) => {
  for (const mode of ['throw', 'cancel']) {
    const f = fixture(); let ready; const entered = new Promise((resolve) => { ready = resolve; });
    const guard = make(f, () => { ready(); if (mode === 'throw') throw new Error('synthetic-secret'); return new Promise(() => {}); });
    t.after(() => guard.close()); const controller = new AbortController(); const req = request(); req.signal = controller.signal;
    const pending = guard.cairnFetch(urls.generation, req); await entered;
    if (mode === 'cancel') controller.abort(); await assert.rejects(pending);
    assert.equal(guard.getState().reservedMicroUsd, 5000);
    assert.equal(guard.getState().attempts[0].actualMicroUsd, null);
  }
});

test('CG2 forged checkpoint or rollback of captured settled history prevents reservation', async () => {
  for (const mode of ['forged', 'rollback', 'unsettled']) {
    const f = fixture(false); const ledger = reopenExperimentBudget(f.ledger); const attemptId = randomUUID();
    ledger.reserve({ attemptId, channel: 'cairn-count', reservedMicroUsd: 5000 }); ledger.recordOutcome({ attemptId, outcome: 'unknown' }); ledger.close();
    f.candidateQualificationExtension = guards.authorizeCandidateQualificationExtension(f.authorization);
    const guard = make(f, () => assert.fail('No transport'));
    try {
      if (mode === 'forged') {
        const forged = structuredClone(f.candidateQualificationExtension); forged.checkpoint.requestCount = 2;
        writeFileSync(file(f), JSON.stringify(forged));
        assert.throws(() => make({ ...f, candidateQualificationExtension: forged }, () => assert.fail('No transport')));
      } else {
        const db = new DatabaseSync(join(f.ledger.directory, 'experiment-budget.sqlite'));
        if (mode === 'rollback') db.exec('BEGIN IMMEDIATE; DELETE FROM attempts; UPDATE run_config SET request_count=0,reserved_micro_usd=0; COMMIT');
        else db.exec('UPDATE attempts SET outcome=NULL,actual_micro_usd=NULL');
        db.close();
      }
      const before = guard.getState(); await assert.rejects(guard.cairnFetch(urls.generation, request())); assert.deepEqual(guard.getState(), before);
    } finally { guard.close(); }
  }
});
