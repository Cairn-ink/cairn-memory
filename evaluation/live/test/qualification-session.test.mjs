import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createExperimentBudget } from '../../experiment-budget/index.mjs';
import { createExperimentRequestGuard, authorizeQualificationExtension } from '../../experiment-budget/request-guard.mjs';
import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { schemasFor } from '../../../adapters/openai/schemas.mjs';
import { createLiveSession, experimentPolicy, MODEL_ID } from '../session.mjs';
import { createQualificationLiveSession } from '../qualification-session.mjs';

const input = { items: [{ itemIndex: 0, content: 'Synthetic preference', kind: 'preference',
  sources: [{ receiptIndex: 0, role: 'user', excerpt: 'Synthetic preference' }] }] };
const countBody = () => ({ model: MODEL_ID, instructions: 'Synthetic qualification test.', truncation: 'disabled',
  input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
  text: { format: { name: 'cairn_qualify', type: 'json_schema', strict: true, schema: schemasFor('qualify', input) } } });

function fixture(t, limitMicroUsd = 50_000_000) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-qualification-session-'));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd, requestCap: 100 };
  createExperimentBudget(ledger).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger, policy, fetchImpl: () => assert.fail('No setup transport') }).close();
  const qualificationExtension = authorizeQualificationExtension({ ledger, policy, authorizationId: 'synthetic-session' });
  let sends = 0;
  const apiKey = 'synthetic-parent-only';
  const fetchImpl = async (url, options) => {
    sends++;
    assert.equal(new Headers(options.headers).get('authorization'), `Bearer ${apiKey}`);
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 10 });
    const body = JSON.parse(options.body);
    return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
      incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify({ qualifications: [] }) }] }],
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } });
  };
  const options = { ledger, qualificationExtension, apiKey, fetchImpl };
  const session = createQualificationLiveSession(options);
  t.after(() => session.close());
  return { options, session, sends: () => sends };
}

test('qualification session rejects invalid credentials, transport and widened configuration before storage', () => {
  const directory = join(mkdtempSync(join(tmpdir(), 'cairn-invalid-qualification-session-')), 'absent');
  const base = { ledger: { directory, limitMicroUsd: 50_000_000 }, qualificationExtension: {},
    apiKey: 'synthetic-only', fetchImpl: () => assert.fail('No invalid session transport') };
  for (const options of [undefined, null, [], { ...base, extra: true },
    ...['', ' ', 'bad\nkey', undefined].map(apiKey => ({ ...base, apiKey })),
    { ...base, fetchImpl: undefined },
    ...[0, -1, 50_000_001, NaN, '50000000'].map(limitMicroUsd => ({ ...base, ledger: { ...base.ledger, limitMicroUsd } }))]) {
    assert.throws(() => createQualificationLiveSession(options), /invalid_qualification_session/);
    assert.equal(existsSync(directory), false);
  }
});

test('qualification session denies non-capture methods and routes before transport or reservation', async (t) => {
  const f = fixture(t); const before = f.session.getState();
  assert.deepEqual(Object.keys(f.session).sort(), ['close', 'getState', 'request']);
  for (const path of ['/chat/completions', '/responses/extra', 'https://other.test/responses']) {
    await assert.rejects(f.session.request(path, countBody()), /invalid_live_route/);
  }
  for (const name of ['cairn_select', 'cairn_rank', 'cairn_reconcile', 'other']) {
    const body = countBody(); body.text.format.name = name;
    await assert.rejects(f.session.request('/responses/input_tokens', body), /invalid_qualification_request/);
  }
  await assert.rejects(f.session.request('/responses/input_tokens', '{'), /invalid_qualification_request/);
  await assert.rejects(f.session.request('/responses/input_tokens', { ...countBody(), model: 'other-model' }), /invalid_qualification_request/);
  assert.equal(f.sends(), 0); assert.deepEqual(f.session.getState(), before);
});

test('qualification session carries real adapter framing, preserves ledger snapshot and closes without implicit retries', async (t) => {
  const f = fixture(t);
  const model = createOpenAIModel({ apiKey: 'synthetic-child-capability',
    fetchImpl: (url, options) => f.session.request(new URL(url).pathname.slice(3), options.body, { signal: options.signal }) });
  f.options.ledger.limitMicroUsd = 1;
  assert.deepEqual(await model.qualify({ system: 'Synthetic qualification test.', input, maxOutputTokens: 1024,
    signal: new AbortController().signal }), { qualifications: [] });
  const state = f.session.getState();
  assert.equal(state.requestCount, 2); assert.equal(state.reservedMicroUsd, 10_000);
  assert.equal(state.limitMicroUsd, 50_000_000); assert.equal(f.sends(), 2);
  assert.equal(state.attempts.filter(attempt => attempt.actualMicroUsd === null).length, 1);
  assert.ok(state.attempts.every(attempt => attempt.outcome !== null));
  f.session.close();
  await assert.rejects(f.session.request('/responses/input_tokens', countBody()), /guard_closed/);
  assert.equal(f.sends(), 2);
});

test('existing live session keeps its old ceiling and denies qualification even after provisioning', async (t) => {
  const f = fixture(t, 20_000_000);
  const old = createLiveSession({ ledger: f.options.ledger, apiKey: f.options.apiKey, fetchImpl: f.options.fetchImpl });
  t.after(() => old.close());
  const before = old.getState();
  await assert.rejects(old.request('/responses/input_tokens', countBody()), /unsupported_request/);
  assert.deepEqual(old.getState(), before); assert.equal(f.sends(), 0);
  assert.throws(() => createLiveSession({ ...f.options, ledger: { ...f.options.ledger, limitMicroUsd: 50_000_000 } }), /invalid_live_session/);
});

test('qualification session rejects an already cancelled caller before reservation or transport', async (t) => {
  const f = fixture(t); const controller = new AbortController(); controller.abort();
  await assert.rejects(f.session.request('/responses/input_tokens', countBody(), { signal: controller.signal }), /request_aborted/);
  assert.equal(f.sends(), 0);
  const state = f.session.getState();
  assert.equal(state.requestCount, 0); assert.equal(state.reservedMicroUsd, 0);
  assert.deepEqual(state.attempts, []);
});
