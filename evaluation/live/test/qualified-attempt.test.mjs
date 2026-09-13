import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, lstatSync, symlinkSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createQualifiedAttempt, writeQualifiedEvidence } from '../qualified-attempt.mjs';
import { experimentPolicy } from '../session.mjs';
import { createExperimentBudget } from '../../experiment-budget/index.mjs';
import { createExperimentRequestGuard, authorizeExtractionModelExtension, authorizeReconciliationExtension,
  createReconciliationExperimentRequestGuard } from '../../experiment-budget/request-guard.mjs';
import { createOpenAIModel } from '../../../adapters/openai/index.mjs';

const request = (overrides = {}) => ({ caseId: 'Q01', arm: 'baseline',
  url: 'https://api.openai.com/v1/responses',
  body: JSON.stringify({ model: 'gpt-4.1-mini-2025-04-14', text: { format: { name: 'cairn_classify' } } }), ...overrides });
function fixture(options = {}) {
  const ledger = { state: 'open', requests: 1919, reservedMicroUsd: 15706048, unsettled: 0 };
  const events = [];
  let sends = 0;
  const gate = createQualifiedAttempt({ readState: () => ({ ...ledger }),
    checkPins: () => {}, persist: async (name, value) => { events.push({ name, value }); },
    send: async ({ body, channel, url }) => {
      sends += 1;
      assert.match(events.at(-1).name, /-reserved$/u);
      const extract = JSON.parse(body).model === 'gpt-5.4-mini-2026-03-17';
      ledger.requests += 1;
      ledger.reservedMicroUsd += channel === 'host' ? 50000 : extract ? (url.endsWith('input_tokens') ? 5268 : 9876) : 5000;
      return new Response('{}');
    }, ...options });
  return { gate, ledger, events, sends: () => sends };
}
test('paired cap permits exactly272 worst-shape guarded requests, with no refunds', async () => {
  const f = fixture();
  for (let i = 1; i <= 8; i++) for (const arm of ['baseline', 'qualified']) {
    const base = { caseId: `Q0${i}`, arm };
    for (let pair = 0; pair < 8; pair++) for (const suffix of ['/input_tokens', '']) {
      await f.gate.request(request({ ...base, url: `https://api.openai.com/v1/responses${suffix}`,
        ...(pair < 2 ? { body: JSON.stringify({ model: 'gpt-5.4-mini-2026-03-17', text: { format: { name: 'cairn_extract' } } }) } : {}) }));
    }
    await f.gate.request(request({ ...base, url: 'https://api.openai.com/v1/chat/completions',
      body: JSON.stringify({ model: 'gpt-4.1-mini-2025-04-14' }) }));
  }
  assert.equal(f.sends(), 272);
  assert.equal(f.gate.getState().reservedMicroUsd, 2244608);
  await assert.rejects(f.gate.request(request()), /attempt_limit/u);
  assert.equal(f.sends(), 272);
});
test('dollar ceiling stops even adversarial allowed-channel sequences before forwarding', async () => {
  const f = fixture();
  let stopped = false;
  for (let i = 1; i <= 8 && !stopped; i++) for (const arm of ['baseline', 'qualified']) {
    for (let j = 0; j < 16; j++) {
      try { await f.gate.request(request({ caseId: `Q0${i}`, arm,
        body: JSON.stringify({ model: 'gpt-5.4-mini-2026-03-17', text: { format: { name: 'cairn_extract' } } }) })); }
      catch { stopped = true; break; }
    }
    if (stopped) break;
  }
  assert.equal(stopped, true);
  assert.equal(f.sends(), Math.floor(2300000 / 9876));
  assert.ok(f.gate.getState().reservedMicroUsd <= 2300000);
});
test('serializes concurrent calls and rejects repeat host or model-cap excess', async () => {
  const f = fixture();
  await Promise.all(Array.from({ length: 16 }, () => f.gate.request(request())));
  await assert.rejects(f.gate.request(request()), /attempt_limit/u);
  assert.equal(f.sends(), 16);
  const g = fixture();
  const host = request({ url: 'https://api.openai.com/v1/chat/completions', body: JSON.stringify({ model: 'gpt-4.1-mini-2025-04-14' }) });
  await g.gate.request(host);
  await assert.rejects(g.gate.request(host), /attempt_limit/u);
  assert.equal(g.sends(), 1);
});
test('invalid route/model/method/context rejects before transport and latches', async () => {
  for (const bad of [{ url: 'https://example.com' }, { body: '{}' }, { body: 'invalid' },
    { caseId: 'Q09' }, { arm: 'other' }, { body: JSON.stringify({ model: 'gpt-4.1-mini-2025-04-14', text: { format: { name: 'cairn_extract' } } }) }]) {
    const f = fixture();
    await assert.rejects(f.gate.request(request(bad)));
    await assert.rejects(f.gate.request(request()));
    assert.equal(f.sends(), 0);
  }
});
test('pin/persistence/guard/non2xx/accounting failures halt without retry or refund', async () => {
  for (const options of [
    { checkPins: () => { throw new Error('changed'); } },
    { persist: () => { throw new Error('disk'); } },
    { send: () => { throw new Error('transport'); } },
    { send: () => new Response('', { status: 500 }) },
    { send: () => new Response('{}') },
  ]) {
    const f = fixture(options);
    await assert.rejects(f.gate.request(request()));
    const charged = f.gate.getState().reservedMicroUsd;
    await assert.rejects(f.gate.request(request()));
    assert.equal(f.gate.getState().reservedMicroUsd, charged);
    assert.notEqual(f.gate.getState().halted, null);
  }
  const f = fixture();
  f.ledger.requests += 1;
  await assert.rejects(f.gate.request(request()), /unexpected_accounting/u);
  assert.equal(f.sends(), 0);
});
test('preflight requires settled open campaign and conservative headroom', () => {
  for (const patch of [{ state: 'closed' }, { unsettled: 1 }, { requests: 3900 },
    { reservedMicroUsd: 18000000 }, { requests: NaN }]) {
    assert.throws(() => fixture({ readState: () => ({ state: 'open', requests: 1919,
      reservedMicroUsd: 15706048, unsettled: 0, ...patch }) }), /insufficient_budget/u);
  }
  assert.throws(() => createQualifiedAttempt(), /invalid_attempt/u);
});
test('exclusive durable intent refuses reuse and unsafe paths without overwrite', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'cairn-attempt-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeQualifiedEvidence(directory, 'intent', { frozen: true });
  const filename = path.join(directory, 'intent.json');
  assert.equal(lstatSync(filename).mode & 0o077, 0);
  assert.throws(() => writeQualifiedEvidence(directory, 'intent', { frozen: false }), /EEXIST/u);
  assert.deepEqual(JSON.parse(readFileSync(filename, 'utf8')), { frozen: true });
  assert.throws(() => writeQualifiedEvidence(directory, '../escape', {}), /unsafe_evidence_name/u);
  symlinkSync(directory, path.join(directory, 'alias'));
  assert.throws(() => writeQualifiedEvidence(path.join(directory, 'alias'), 'intent', {}), /unsafe_evidence_directory/u);
});

test('actual adapter and two combined guards share one synthetic ledger under the additional cap', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'cairn-attempt-guard-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const ledger = { directory: path.join(directory, 'ledger'), runId: randomUUID(), limitMicroUsd: 20000000, requestCap: 4000 };
  createExperimentBudget(ledger).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger, policy, fetchImpl: () => assert.fail('setup is offline') }).close();
  const extension = authorizeExtractionModelExtension({ ledger, policy, authorizationId: 'synthetic-extraction' });
  const reconciliationExtension = authorizeReconciliationExtension({ ledger, policy, extension, authorizationId: 'synthetic-reconciliation' });
  let sends = 0;
  const fetchImpl = async (url, init) => {
    sends++;
    const body = JSON.parse(init.body);
    if (url.endsWith('input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    return Response.json({ object: 'response', model: body.model, status: 'completed', error: null, incomplete_details: null,
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text',
        text: JSON.stringify(body.text.format.name === 'cairn_reconcile' ? { transitions: [] } : { items: [] }) }] }],
      usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } });
  };
  const guards = Object.fromEntries(['baseline', 'qualified'].map(arm => [arm,
    createReconciliationExperimentRequestGuard({ ledger, policy, extension, reconciliationExtension, fetchImpl })]));
  t.after(() => Object.values(guards).forEach(guard => guard.close()));
  const attempt = createQualifiedAttempt({ checkPins: () => {}, persist: () => {}, readState: () => {
    const state = guards.baseline.getState();
    return { state: state.state, requests: state.requestCount, reservedMicroUsd: state.reservedMicroUsd,
      unsettled: state.attempts.filter(row => row.outcome === null).length };
  }, send: ({ arm, url, body, signal }) => guards[arm].cairnFetch(url, { method: 'POST', redirect: 'error',
    body, signal, headers: { authorization: 'Bearer synthetic-key', 'content-type': 'application/json' } }) });
  for (const arm of ['baseline', 'qualified']) {
    const model = createOpenAIModel({ apiKey: 'synthetic-key', extractionModel: 'gpt-5.4-mini-2026-03-17',
      fetchImpl: (url, init) => attempt.request({ caseId: 'Q01', arm, url, body: init.body, signal: init.signal }) });
    const common = { system: 'Synthetic offline instructions.', maxOutputTokens: 1024, signal: new AbortController().signal };
    assert.deepEqual(await model.extract({ ...common, input: { messages: [{ index: 0, role: 'user', content: 'Synthetic statement.' }] } }), { items: [] });
    assert.deepEqual(await model.reconcile({ ...common, input: { messages: [{ index: 0, role: 'user', content: 'Synthetic statement.' }],
      items: [{ index: 0, content: 'New value', kind: 'fact', sourceIndices: [0] }],
      candidates: [{ index: 0, content: 'Old value', kind: 'fact', receipts: [{ role: 'user', excerpt: 'Old value' }] }] } }), { transitions: [] });
  }
  assert.equal(sends, 8);
  assert.equal(attempt.getState().reservedMicroUsd, 50288);
  assert.equal(guards.qualified.getState().reservedMicroUsd, 50288);
});
