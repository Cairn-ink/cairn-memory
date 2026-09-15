import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createExperimentBudget } from '../../experiment-budget/index.mjs';
import { createExperimentRequestGuard, authorizeChecklistSelectionExtension } from '../../experiment-budget/request-guard.mjs';
import { createChecklistSelectionLiveSession } from '../qualification-session.mjs';
import { experimentPolicy, createLiveSession } from '../session.mjs';
import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { schemasFor } from '../../../adapters/openai/schemas.mjs';

const modelId = 'gpt-4.1-mini-2025-04-14';
const input = { query: 'Why now?', maps: [{ namespaceIndex: 0, items: [], exhausted: true }], maxRefs: 24 };
const body = () => ({ model: modelId, instructions: 'Synthetic checklist.', truncation: 'disabled',
  input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
  text: { format: { name: 'cairn_selectChecklist', type: 'json_schema', strict: true, schema: schemasFor('selectChecklist', input) } } });
function fixture(t) {
  const directory = join(mkdtempSync(join(tmpdir(), 'cairn-checklist-session-')), 'ledger');
  const ledger = { directory, runId: randomUUID(), limitMicroUsd: 20000000, requestCap: 100 };
  createExperimentBudget(ledger).close(); const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger, policy, fetchImpl: () => assert.fail('No setup transport') }).close();
  const checklistSelectionExtension = authorizeChecklistSelectionExtension({ ledger, policy, authorizationId: 'synthetic-parent-checklist' });
  const calls = [], apiKey = 'synthetic-parent-only-key';
  const fetchImpl = async (url, options) => {
    assert.equal(new Headers(options.headers).get('authorization'), `Bearer ${apiKey}`);
    calls.push({ url, options });
    return Response.json(url.endsWith('/input_tokens') ? { object: 'response.input_tokens', input_tokens: 10 } : {
      object: 'response', model: modelId, status: 'completed', error: null, incomplete_details: null,
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"requests":[]}' }] }],
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    });
  };
  const options = { ledger, checklistSelectionExtension, apiKey, fetchImpl };
  const session = createChecklistSelectionLiveSession(options); t.after(() => session.close());
  return { options, session, calls };
}

test('closed session rejects missing credentials and configuration expansion before creating storage', () => {
  const directory = join(mkdtempSync(join(tmpdir(), 'cairn-checklist-invalid-session-')), 'absent');
  const base = { ledger: { directory, limitMicroUsd: 50000000 }, checklistSelectionExtension: {},
    apiKey: 'synthetic-only-key', fetchImpl: () => assert.fail('No invalid session I/O') };
  for (const value of [undefined, null, [], { ...base, extra: true }, { ...base, guardFactory: () => {} },
    { ...base, methods: ['cairn_rank'] }, { ...base, model: modelId }, { ...base, policy: experimentPolicy() },
    ...['', ' ', 'bad\nkey', undefined].map(apiKey => ({ ...base, apiKey })), { ...base, fetchImpl: undefined },
    ...[0, -1, 50000001, NaN].map(limitMicroUsd => ({ ...base, ledger: { ...base.ledger, limitMicroUsd } }))]) {
    assert.throws(() => createChecklistSelectionLiveSession(value));
    assert.equal(existsSync(directory), false);
  }
});

test('session surface and method/model/routes stay closed with zero denied reservations', async t => {
  const { session, calls } = fixture(t), before = session.getState();
  assert.ok(Object.isFrozen(session)); assert.deepEqual(Object.keys(session).sort(), ['close', 'getState', 'request']);
  for (const route of ['/chat/completions', '/responses/extra', '/responses?x=1', 'https://api.openai.com/v1/responses']) {
    await assert.rejects(session.request(route, body()));
  }
  for (const name of ['cairn_select', 'cairn_rank', 'cairn_extract', 'cairn_qualifyCandidates', 'cairn_relate']) {
    const value = body(); value.text.format.name = name;
    await assert.rejects(session.request('/responses/input_tokens', value));
  }
  await assert.rejects(session.request('/responses/input_tokens', '{'));
  await assert.rejects(session.request('/responses/input_tokens', { ...body(), model: 'gpt-5.6-luna' }));
  const schema = body(); schema.text.format.schema.additionalProperties = true;
  await assert.rejects(session.request('/responses/input_tokens', schema));
  assert.equal(calls.length, 0); assert.deepEqual(session.getState(), before);
});

test('real adapter framing uses only parent credential and preserves budget through close', async t => {
  const { session, options, calls } = fixture(t);
  const model = createOpenAIModel({ apiKey: 'synthetic-child-token', fetchImpl: (url, options) =>
    session.request(new URL(url).pathname.slice(3), options.body, { signal: options.signal }) });
  options.apiKey = 'mutated-parent-key'; options.ledger.limitMicroUsd = 1;
  assert.deepEqual(await model.selectChecklist({ system: 'Synthetic checklist.', input, maxOutputTokens: 1024,
    signal: new AbortController().signal }), { requests: [] });
  const observed = session.getState(); assert.equal(observed.requestCount, 2); assert.equal(observed.reservedMicroUsd, 10000);
  assert.equal(observed.limitMicroUsd, 20000000); assert.equal(calls.length, 2);
  assert.equal(observed.attempts.filter(attempt => attempt.actualMicroUsd === null).length, 1);
  assert.ok(observed.attempts.every(attempt => attempt.outcome !== null));
  session.close();
  await assert.rejects(session.request('/responses/input_tokens', body()));
  assert.equal(calls.length, 2);
});

test('parent session honors cancellation before reservation and old session stays unauthorized', async t => {
  const { session, options, calls } = fixture(t), before = session.getState();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(session.request('/responses/input_tokens', body(), { signal: controller.signal }));
  assert.deepEqual(session.getState(), before);
  const old = createLiveSession({ ledger: options.ledger, apiKey: options.apiKey, fetchImpl: options.fetchImpl });
  t.after(() => old.close());
  for (const route of ['/responses/input_tokens', '/responses']) {
    const value = body(); if (route === '/responses') Object.assign(value, { max_output_tokens: 1024, store: false, stream: false });
    await assert.rejects(old.request(route, value));
  }
  assert.equal(calls.length, 0); assert.deepEqual(session.getState(), before);
});
