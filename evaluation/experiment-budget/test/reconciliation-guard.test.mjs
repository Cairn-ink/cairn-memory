import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, linkSync, lstatSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { DEFAULT_MODEL, LUNA_EXTRACTION_MODEL, EXPERIMENTAL_EXTRACTION_MODEL } from '../../../adapters/openai/profiles.mjs';
import { schemasFor } from '../../../adapters/openai/schemas.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createExperimentBudget, reopenExperimentBudget } from '../index.mjs';
import * as guards from '../request-guard.mjs';

// Fresh synthetic ledgers and fake HTTP only. Scripted outputs verify mechanics,
// not semantic quality, human consent, actual provider spend, or a network sandbox.
const secret = 'synthetic-reconciliation-secret';
const privateText = 'synthetic-private-evidence';
const urls = { host: 'https://api.openai.com/v1/chat/completions', count: 'https://api.openai.com/v1/responses/input_tokens', generation: 'https://api.openai.com/v1/responses' };
const filenames = { policy: 'experiment-request-policy.json', extraction: 'experiment-extraction-extension.json', reconciliation: 'experiment-reconciliation-extension.json' };
const pricing = { microUsdNumerator: 1, tokenDenominator: 1000 };
function policy() {
  const channel = (endpoint, patch = {}) => ({ endpoint, model: DEFAULT_MODEL, reservedMicroUsd: 20,
    maxRequestBytes: 131072, maxResponseBytes: 131072, timeoutMs: 5000,
    maxInputTokens: 7024, maxOutputTokens: 1024, inputTokenFraming: 1024,
    inputPrice: { ...pricing }, outputPrice: { ...pricing }, ...patch });
  return { version: 1, hostCompletion: channel(urls.host, { reservedMicroUsd: 12, maxInputTokens: 10000, inputTokenFraming: 128 }),
    cairnCount: channel(urls.count, { reservedMicroUsd: 5, maxOutputTokens: 0 }), cairnGeneration: channel(urls.generation) };
}
const options = (body, patch = {}) => ({ method: 'POST', redirect: 'error', signal: new AbortController().signal,
  headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...patch });
const reconcileInput = () => ({ messages: [{ index: 0, role: 'user', content: privateText }],
  items: [{ index: 0, content: 'Deadline Monday', kind: 'fact', sourceIndices: [0] }],
  candidates: [{ index: 0, content: 'Deadline Friday', kind: 'fact', receipts: [{ role: 'user', excerpt: 'Deadline Friday' }] }] });
function body(method = 'reconcile', generation = true, model = DEFAULT_MODEL) {
  const input = method === 'reconcile' ? reconcileInput() : { messages: [{ index: 0, role: 'user', content: privateText }] };
  return { model, instructions: 'Synthetic instructions.', input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
    truncation: 'disabled', text: { format: { name: `cairn_${method}`, type: 'json_schema', strict: true, schema: schemasFor(method, input) } },
    ...(model === DEFAULT_MODEL ? {} : { reasoning: { effort: 'none' } }),
    ...(generation ? { max_output_tokens: 1024, store: false, stream: false } : {}) };
}
const hostBody = () => ({ model: DEFAULT_MODEL, messages: [{ role: 'user', content: privateText }], max_completion_tokens: 32, n: 1, store: false, stream: false });
const hostResponse = () => ({ id: 'chatcmpl_synthetic', object: 'chat.completion', model: DEFAULT_MODEL,
  choices: [{ index: 0, message: { role: 'assistant', content: 'Synthetic reply' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 } });
function generated(output, model = DEFAULT_MODEL, usage = { input_tokens: 100, output_tokens: 5, total_tokens: 105 }) {
  return { id: 'resp_synthetic', object: 'response', model, status: 'completed', error: null, incomplete_details: null,
    output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }], usage };
}
const fake = (calls) => async (url, request) => {
  const parsed = JSON.parse(request.body); calls.push({ url, body: parsed });
  if (url === urls.count) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
  if (url === urls.host) return Response.json(hostResponse());
  return Response.json(generated(parsed.text.format.name === 'cairn_reconcile' ? { transitions: [] } : { items: [] }, parsed.model));
};
const guardError = (code) => (error) => error instanceof guards.ExperimentRequestGuardError
  && error.code === code && error.message === code && !`${error} ${error.stack}`.includes(secret) && !`${error} ${error.stack}`.includes(privateText);
function fixture(t, overrides = {}, deferExtraction = false) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-reconciliation-guard-'));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 100000, requestCap: 100, ...overrides };
  createExperimentBudget(ledger).close(); const configured = policy();
  guards.createExperimentRequestGuard({ ledger, policy: configured, fetchImpl: async () => assert.fail('no I/O at setup') }).close();
  const extension = deferExtraction ? undefined
    : guards.authorizeExtractionModelExtension({ ledger, policy: configured, authorizationId: 'synthetic-extraction-approval' });
  const authorization = { ledger, policy: configured, extension, authorizationId: 'synthetic-reconciliation-approval' };
  return { root, ledger, configured, extension, authorization };
}
function provision(t, overrides) {
  const f = fixture(t, overrides);
  return { ...f, reconciliationExtension: guards.authorizeReconciliationExtension(f.authorization) };
}
const combined = (f, fetchImpl) => guards.createReconciliationExperimentRequestGuard({ ledger: f.ledger, policy: f.configured,
  extension: f.extension, reconciliationExtension: f.reconciliationExtension, fetchImpl });
function state(ledger) { const h = reopenExperimentBudget(ledger); try { return h.getState(); } finally { h.close(); } }
const file = (f, name) => join(f.ledger.directory, filenames[name]);
function frozen(value) { assert.equal(Object.isFrozen(value), true); for (const entry of Object.values(value)) if (entry && typeof entry === 'object') frozen(entry); }

test('R1 both original guards reject reconcile count and generation even after separate capability exists', async (t) => {
  const f = provision(t); let sends = 0;
  for (const extended of [false, true]) {
    const guardOptions = { ledger: f.ledger, policy: f.configured, fetchImpl: async () => { sends++; assert.fail('no I/O'); } };
    const guard = extended ? guards.createExtendedExperimentRequestGuard({ ...guardOptions, extension: f.extension }) : guards.createExperimentRequestGuard(guardOptions);
    try {
      for (const generation of [false, true]) await assert.rejects(guard.cairnFetch(generation ? urls.generation : urls.count,
        options(body('reconcile', generation))), guardError('unsupported_request'));
    } finally { guard.close(); }
  }
  assert.equal(sends, 0); assert.equal(state(f.ledger).requestCount, 0);
});

test('R1 combined construction and provisioning require exact explicit tokens and closed options', (t) => {
  const f = provision(t);
  const valid = { ledger: f.ledger, policy: f.configured, extension: f.extension, reconciliationExtension: f.reconciliationExtension,
    fetchImpl: async () => assert.fail('no I/O') };
  for (const key of Object.keys(valid)) { const invalid = { ...valid }; delete invalid[key];
    assert.throws(() => guards.createReconciliationExperimentRequestGuard(invalid), guards.ExperimentRequestGuardError); }
  assert.throws(() => guards.createReconciliationExperimentRequestGuard({ ...valid, extra: true }), guardError('invalid_options'));
  assert.throws(() => guards.authorizeReconciliationExtension({ ...f.authorization, extra: true }), guardError('invalid_options'));
  for (const value of [null, false, [], {}, 'forged']) for (const key of ['extension', 'reconciliationExtension'])
    assert.throws(() => guards.createReconciliationExperimentRequestGuard({ ...valid, [key]: value }), guardError('invalid_extension'));
  for (const value of [null, 12, '', '../unsafe']) assert.throws(() => guards.authorizeReconciliationExtension({ ...f.authorization, authorizationId: value }), guardError('invalid_extension'));
  assert.equal(state(f.ledger).requestCount, 0);
});

test('R2 idempotent authorization freezes a detached token and preserves policy, extraction, ledger bytes and history', async (t) => {
  const f = fixture(t); const baseline = guards.createExtendedExperimentRequestGuard({ ledger: f.ledger, policy: f.configured,
    extension: f.extension, fetchImpl: fake([]) }); await baseline.hostFetch(urls.host, options(hostBody())); baseline.close();
  const before = state(f.ledger); const paths = [file(f, 'policy'), file(f, 'extraction'), join(f.ledger.directory, 'experiment-budget.sqlite')];
  const bytes = paths.map((p) => readFileSync(p));
  const token = guards.authorizeReconciliationExtension(f.authorization); frozen(token);
  assert.notEqual(token.extension, f.extension); assert.deepEqual(token.extension, f.extension);
  assert.equal(token.method, 'cairn_reconcile'); assert.equal(token.model, DEFAULT_MODEL);
  assert.deepEqual(token.checkpoint, { requestCount: 1, reservedMicroUsd: 12 });
  assert.equal(lstatSync(file(f, 'reconciliation')).mode & 0o777, 0o600);
  const authorizedBytes = readFileSync(file(f, 'reconciliation'));
  assert.deepEqual(guards.authorizeReconciliationExtension(f.authorization), token);
  assert.deepEqual(readFileSync(file(f, 'reconciliation')), authorizedBytes);
  assert.deepEqual(state(f.ledger), before); paths.forEach((p, i) => assert.deepEqual(readFileSync(p), bytes[i]));
  assert.throws(() => guards.authorizeReconciliationExtension({ ...f.authorization, authorizationId: 'changed' }), guardError('policy_mismatch'));
  assert.deepEqual(readFileSync(file(f, 'reconciliation')), authorizedBytes);
  const serialized = authorizedBytes.toString(); assert.ok(!serialized.includes(secret)); assert.ok(!serialized.includes(privateText));
  const guard = combined({ ...f, reconciliationExtension: token }, fake([]));
  await guard.cairnFetch(urls.count, options(body('reconcile', false))); guard.close();
  const afterRequest = state(f.ledger);
  assert.deepEqual(guards.authorizeReconciliationExtension(f.authorization), token);
  assert.deepEqual(readFileSync(file(f, 'reconciliation')), authorizedBytes);
  assert.deepEqual(state(f.ledger), afterRequest);
});

test('R2 provisioning requires settled open history, exact baseline bounds and a writable ledger lock', (t) => {
  const f = fixture(t); const h = reopenExperimentBudget(f.ledger); const id = randomUUID();
  h.reserve({ attemptId: id, channel: 'cairn-count', reservedMicroUsd: 5 });
  assert.throws(() => guards.authorizeReconciliationExtension(f.authorization), guardError('extension_busy'));
  h.recordOutcome({ attemptId: id, outcome: 'unknown' }); h.close();
  const altered = structuredClone(f.configured); altered.cairnCount.maxInputTokens = 7023;
  assert.throws(() => guards.authorizeReconciliationExtension({ ...f.authorization, policy: altered }), guards.ExperimentRequestGuardError);
  const db = new DatabaseSync(join(f.ledger.directory, 'experiment-budget.sqlite')); db.exec('BEGIN IMMEDIATE');
  try { assert.throws(() => guards.authorizeReconciliationExtension(f.authorization)); }
  finally { db.exec('ROLLBACK'); db.close(); }
  const token = guards.authorizeReconciliationExtension(f.authorization);
  assert.deepEqual(token.checkpoint, { requestCount: 1, reservedMicroUsd: 5 });
});

test('R2 missing, partial, oversized, unsafe, symlinked, hardlinked and swapped files fail on construction and every request', async (t) => {
  for (const name of ['policy', 'extraction', 'reconciliation']) for (const scenario of ['missing', 'partial', 'oversized', 'mode', 'symlink', 'hardlink', 'changed']) {
    const f = provision(t); let sends = 0; const transport = async () => { sends++; assert.fail('no I/O'); };
    const guard = combined(f, transport); const filename = file(f, name); const original = readFileSync(filename);
    if (scenario === 'missing') unlinkSync(filename);
    if (scenario === 'partial') writeFileSync(filename, '{partial');
    if (scenario === 'oversized') writeFileSync(filename, ' '.repeat(1000001));
    if (scenario === 'mode') chmodSync(filename, 0o644);
    if (scenario === 'changed') { const parsed = JSON.parse(original); parsed.authorizationId = 'changed'; writeFileSync(filename, JSON.stringify(parsed)); }
    if (scenario === 'symlink' || scenario === 'hardlink') {
      const target = join(f.root, `synthetic-${name}`); writeFileSync(target, original, { mode: 0o600 }); unlinkSync(filename);
      if (scenario === 'symlink') symlinkSync(target, filename); else linkSync(target, filename);
    }
    assert.throws(() => combined(f, transport), guards.ExperimentRequestGuardError, `${name}/${scenario}`);
    await assert.rejects(guard.cairnFetch(urls.generation, options(body())), guards.ExperimentRequestGuardError);
    assert.equal(guard.getState().requestCount, 0); assert.equal(sends, 0); guard.close();
  }
  const a = provision(t); const b = provision(t);
  writeFileSync(file(a, 'reconciliation'), readFileSync(file(b, 'reconciliation')));
  assert.throws(() => combined(a, async () => assert.fail('no I/O')), guardError('policy_mismatch'));
  assert.throws(() => combined({ ...a, reconciliationExtension: b.reconciliationExtension }, async () => assert.fail('no I/O')), guards.ExperimentRequestGuardError);
});

test('R2 request snapshot accessor cannot remove authorization between initial verification and reservation', async (t) => {
  const f = provision(t); let sends = 0; let accessed = false;
  const guard = combined(f, async () => { sends++; assert.fail('no I/O'); }); t.after(() => guard.close());
  const before = guard.getState(); const request = options(body()); const headers = request.headers;
  Object.defineProperty(request, 'headers', { enumerable: true, get() {
    if (!accessed) { accessed = true; unlinkSync(file(f, 'reconciliation')); }
    return headers;
  } });
  await assert.rejects(guard.cairnFetch(urls.generation, request), guards.ExperimentRequestGuardError);
  assert.equal(accessed, true); assert.equal(sends, 0);
  assert.deepEqual(guard.getState(), before);
});

test('R2 partial setup is retained and rejected rather than repaired or reset', (t) => {
  const f = fixture(t); const filename = file(f, 'reconciliation');
  writeFileSync(filename, '{partial', { mode: 0o600 }); const before = state(f.ledger);
  assert.throws(() => guards.authorizeReconciliationExtension(f.authorization), guardError('unsafe_policy_binding'));
  assert.equal(readFileSync(filename, 'utf8'), '{partial'); assert.deepEqual(state(f.ledger), before);
});

test('R2 already-open guards reject rollback of either settled historical reservation prefix', async (t) => {
  for (const mutation of ['reconciliation-rollback', 'extraction-rollback', 'unsettle']) {
    const f = fixture(t, {}, true); const baseline = guards.createExperimentRequestGuard({ ledger: f.ledger, policy: f.configured, fetchImpl: fake([]) });
    await baseline.hostFetch(urls.host, options(hostBody()));
    f.extension = guards.authorizeExtractionModelExtension({ ledger: f.ledger, policy: f.configured, authorizationId: 'synthetic-extraction-approval' });
    f.authorization.extension = f.extension;
    await baseline.hostFetch(urls.host, options(hostBody())); baseline.close();
    const reconciliationExtension = guards.authorizeReconciliationExtension(f.authorization);
    assert.equal(f.extension.checkpoint.requestCount, 1); assert.equal(reconciliationExtension.checkpoint.requestCount, 2);
    const guard = combined({ ...f, reconciliationExtension }, async () => assert.fail('no I/O'));
    const db = new DatabaseSync(join(f.ledger.directory, 'experiment-budget.sqlite'));
    if (mutation === 'extraction-rollback') db.exec('BEGIN IMMEDIATE; DELETE FROM attempts; UPDATE run_config SET request_count=0,reserved_micro_usd=0; COMMIT');
    else if (mutation === 'reconciliation-rollback') db.exec('BEGIN IMMEDIATE; DELETE FROM attempts WHERE rowid > 1; UPDATE run_config SET request_count=1,reserved_micro_usd=12; COMMIT');
    else db.exec('UPDATE attempts SET outcome=NULL,actual_micro_usd=NULL WHERE rowid=1');
    db.close(); const before = guard.getState();
    await assert.rejects(guard.cairnFetch(urls.generation, options(body())), guardError('policy_mismatch'));
    assert.deepEqual(guard.getState(), before); guard.close();
  }
});

test('R3 actual adapter reconcile count and generation use baseline reservations and real tokenizer without constructor I/O', async (t) => {
  const f = provision(t); const calls = []; const guard = combined(f, fake(calls)); t.after(() => guard.close());
  const model = createOpenAIModel({ apiKey: secret, fetchImpl: guard.cairnFetch });
  assert.equal(calls.length, 0); assert.ok(model.countTokens('Synthetic token count.') > 0); assert.equal(calls.length, 0);
  assert.deepEqual(await model.reconcile({ system: 'Synthetic instructions.', input: reconcileInput(), maxOutputTokens: 1024, signal: new AbortController().signal }), { transitions: [] });
  assert.deepEqual(calls.map((c) => [c.url, c.body.model, c.body.text.format.name]),
    [[urls.count, DEFAULT_MODEL, 'cairn_reconcile'], [urls.generation, DEFAULT_MODEL, 'cairn_reconcile']]);
  assert.deepEqual(guard.getState().attempts.map((a) => [a.channel, a.reservedMicroUsd]), [['cairn-count', 5], ['cairn-generation', 20]]);
  assert.equal(guard.getState().reservedMicroUsd, 25);
});

test('R3 alternate judgment, changed schema and unsupported transport shape reject before reservation and I/O', async (t) => {
  const f = provision(t); let sends = 0; const guard = combined(f, async () => { sends++; assert.fail('no I/O'); }); t.after(() => guard.close());
  const changedSchema = body(); changedSchema.text.format.schema = { type: 'object', additionalProperties: true };
  const wrongName = body(); wrongName.text.format.name = 'cairn_unknown';
  for (const invalid of [body('reconcile', true, LUNA_EXTRACTION_MODEL), body('reconcile', true, EXPERIMENTAL_EXTRACTION_MODEL),
    { ...body(), reasoning: { effort: 'none' } }, { ...body(), tools: [] }, { ...body(), model: 'unapproved' }, changedSchema, wrongName])
    await assert.rejects(guard.cairnFetch(urls.generation, options(invalid)), guardError('unsupported_request'));
  for (const patch of [{ method: 'GET' }, { redirect: 'follow' }, { headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', 'X-Unknown': 'bad' } },
    { body: '{partial' }, { body: 'x'.repeat(131073) }]) await assert.rejects(guard.cairnFetch(urls.generation, options(body(), patch)), guards.ExperimentRequestGuardError);
  assert.throws(() => guard.cairnFetch('https://other.invalid/v1/responses', options(body())), guardError('invalid_request'));
  const tooManyTokens = body(); tooManyTokens.instructions = ' word'.repeat(8000);
  await assert.rejects(guard.cairnFetch(urls.generation, options(tooManyTokens)), guardError('input_bound_exceeded'));
  assert.equal(sends, 0); assert.equal(guard.getState().requestCount, 0);
});

test('R3 concurrent handles and reopen share original caps across reconcile, extraction and host calls', async (t) => {
  const f = provision(t, { requestCap: 3 }); const calls = []; const one = combined(f, fake(calls)); const two = combined(f, fake(calls));
  await Promise.all([one.cairnFetch(urls.generation, options(body())), two.cairnFetch(urls.generation, options(body('extract', true, LUNA_EXTRACTION_MODEL)))]);
  await two.hostFetch(urls.host, options(hostBody()));
  const expectedReservation = f.configured.cairnGeneration.reservedMicroUsd
    + f.extension.models[LUNA_EXTRACTION_MODEL].cairnGeneration.reservedMicroUsd
    + f.configured.hostCompletion.reservedMicroUsd;
  assert.equal(one.getState().requestCount, 3); assert.equal(one.getState().reservedMicroUsd, expectedReservation);
  one.close(); two.close(); const reopened = combined(f, fake(calls)); t.after(() => reopened.close());
  await assert.rejects(reopened.cairnFetch(urls.count, options(body('reconcile', false))), { code: 'request_cap_exceeded' });
  assert.equal(calls.length, 3); assert.equal(reopened.getState().reservedMicroUsd, expectedReservation);
});

test('R3 cumulative reservations are never refunded for malformed usage or transport failures', async (t) => {
  const f = provision(t, { limitMicroUsd: 40 }); let calls = 0;
  const guard = combined(f, async () => { calls++; if (calls === 1) throw new Error(`${secret} ${privateText}`);
    return Response.json(generated({ transitions: [] }, DEFAULT_MODEL, undefined)); }); t.after(() => guard.close());
  await assert.rejects(guard.cairnFetch(urls.generation, options(body())), guardError('transport_failed'));
  // Explicitly malformed usage (rather than an omitted argument's default).
  guard.close(); const second = combined(f, async () => { calls++; const response = generated({ transitions: [] }); delete response.usage; return Response.json(response); }); t.after(() => second.close());
  await assert.rejects(second.cairnFetch(urls.generation, options(body())), guardError('invalid_response'));
  assert.deepEqual(second.getState().attempts.map((a) => [a.outcome, a.actualMicroUsd]), [['unknown', null], ['unknown', null]]);
  await assert.rejects(second.cairnFetch(urls.count, options(body('reconcile', false))), { code: 'budget_exceeded' });
  assert.equal(second.getState().reservedMicroUsd, 40); assert.equal(calls, 2);
});

test('R3 in-flight abort retains reservation and blocks close until bounded settlement', async (t) => {
  const f = provision(t); let entered; let signal; const ready = new Promise((resolve) => { entered = resolve; });
  const guard = combined(f, (_url, request) => { signal = request.signal; entered(); return new Promise(() => {}); }); t.after(() => guard.close());
  const controller = new AbortController(); const pending = guard.cairnFetch(urls.generation, options(body(), { signal: controller.signal })); await ready;
  assert.throws(() => guard.close(), guardError('guard_busy')); controller.abort(new Error(secret));
  await assert.rejects(pending, guardError('request_aborted')); assert.equal(signal.aborted, true);
  assert.deepEqual(guard.getState().attempts.map((a) => [a.outcome, a.reservedMicroUsd]), [['unknown', 20]]);
});

test('R4 actual core ordered capture through actual adapter and combined guard automatically creates Friday history', async (t) => {
  const f = provision(t); const calls = [];
  const guard = combined(f, async (url, request) => {
    const b = JSON.parse(request.body); calls.push({ url, body: b });
    if (url === urls.count) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    const input = JSON.parse(b.input[0].content[0].text); const method = b.text.format.name;
    const output = method === 'cairn_extract' ? { items: [{ content: input.messages[0].content, kind: 'fact', confidence: 0.8, sourceIndices: [0] }] }
      : method === 'cairn_reconcile' ? { transitions: [{ replacementIndex: 0, predecessorIndex: 0, evidenceIndices: [0],
        relation: 'supersedes', valueChange: 'changed', adoption: 'explicit' }] }
        : { items: input.memories.map((m) => ({ memoryId: m.id, parentIds: [], newL1: { title: m.content, parentL2Ids: [] } })) };
    return Response.json(generated(output));
  }); t.after(() => guard.close());
  const model = createOpenAIModel({ apiKey: secret, fetchImpl: guard.cairnFetch });
  const core = openMemoryCore({ path: join(f.root, 'memory.sqlite'), model }); t.after(() => core.close());
  const namespace = { ownerId: 'synthetic-owner', scope: 'personal', projectId: null };
  const capture = (sequence, content) => ({ namespace, client: 'synthetic', eventId: `event-${sequence}`, sessionId: 'session',
    causal: { streamId: 'synthetic-source', sequence }, messages: [{ id: `message-${sequence}`, role: 'user', content }] });
  const first = await core.capture(capture(1, 'Deadline Friday')); assert.equal(first.ok, true, JSON.stringify(first));
  const second = await core.capture(capture(2, 'Deadline Monday')); assert.equal(second.ok, true, JSON.stringify(second));
  assert.deepEqual(second.value.reconciliation, { status: 'applied', reason: null, retiredCount: 1 });
  const old = core.get({ namespace, memoryId: first.value.admission.memories[0].id });
  const current = core.get({ namespace, memoryId: second.value.admission.memories[0].id });
  assert.equal(old.value.memory.state, 'historical'); assert.equal(current.value.memory.state, 'active');
  assert.equal(current.value.memory.origin, 'agent-inferred'); assert.equal(old.value.supersession.replacement.memoryId, current.value.memory.id);
  assert.deepEqual(calls.filter((c) => c.url === urls.generation).map((c) => c.body.text.format.name),
    ['cairn_extract', 'cairn_classify', 'cairn_extract', 'cairn_reconcile', 'cairn_classify']);
  assert.equal(guard.getState().requestCount, 10); assert.equal(guard.getState().reservedMicroUsd, 125);
});
