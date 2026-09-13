import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, linkSync, lstatSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { DEFAULT_MODEL, LUNA_EXTRACTION_MODEL, EXPERIMENTAL_EXTRACTION_MODEL } from '../../../adapters/openai/profiles.mjs';
import { schemas, schemasFor } from '../../../adapters/openai/schemas.mjs';
import { createExperimentBudget, reopenExperimentBudget } from '../index.mjs';
import * as guards from '../request-guard.mjs';

// Synthetic disposable ledgers and fake HTTP only. No real account or model use.
const secret = 'synthetic-qualification-key';
const evidence = 'Synthetic private choice';
const urls = { host: 'https://api.openai.com/v1/chat/completions', count: 'https://api.openai.com/v1/responses/input_tokens',
  generation: 'https://api.openai.com/v1/responses' };
const filename = 'experiment-qualification-extension.json';
function policy() {
  const price = { microUsdNumerator: 1, tokenDenominator: 1000 };
  const channel = (endpoint, patch = {}) => ({ endpoint, model: DEFAULT_MODEL, reservedMicroUsd: 20,
    maxRequestBytes: 131072, maxResponseBytes: 131072, timeoutMs: 5000,
    maxInputTokens: 7024, maxOutputTokens: 1024, inputTokenFraming: 1024,
    inputPrice: { ...price }, outputPrice: { ...price }, ...patch });
  return { version: 1, hostCompletion: channel(urls.host, { reservedMicroUsd: 12, maxInputTokens: 10000, inputTokenFraming: 128 }),
    cairnCount: channel(urls.count, { reservedMicroUsd: 5, maxOutputTokens: 0 }), cairnGeneration: channel(urls.generation) };
}
const input = () => ({ items: [{ itemIndex: 0, content: evidence, kind: 'decision',
  sources: [{ receiptIndex: 0, role: 'user', excerpt: evidence }] }] });
const output = () => ({ qualifications: [{ itemIndex: 0, qualification: { version: 1,
  slot: { subject: null, property: null, scope: null, applies: null }, value: null,
  attribution: 'unknown', commitment: 'unknown', anchors: [{ receiptIndex: 0, start: 0, end: evidence.length,
    text: evidence, fields: ['value'] }] } }] });
function body(generation = true) {
  return { model: DEFAULT_MODEL, instructions: 'Synthetic source binding.',
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input()) }] }],
    truncation: 'disabled', text: { format: { name: 'cairn_qualify', type: 'json_schema', strict: true,
      schema: schemasFor('qualify', input()) } }, ...(generation ? { max_output_tokens: 1024, store: false, stream: false } : {}) };
}
const request = (value = body(), patch = {}) => ({ method: 'POST', redirect: 'error', signal: new AbortController().signal,
  headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(value), ...patch });
const response = () => ({ id: 'resp_synthetic', object: 'response', model: DEFAULT_MODEL, status: 'completed', error: null,
  incomplete_details: null, output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(output()), annotations: [] }] }],
  usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180 } });
const fake = (calls) => async (url, request) => { calls.push({ url, body: JSON.parse(request.body) });
  return Response.json(url === urls.count ? { object: 'response.input_tokens', input_tokens: 100 } : response()); };
const guardError = (code) => (error) => error instanceof guards.ExperimentRequestGuardError && error.code === code
  && error.message === code && !`${error} ${error.stack}`.includes(secret) && !`${error} ${error.stack}`.includes(evidence);
function fixture(overrides = {}, provision = true) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-qualification-guard-'));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 100000, requestCap: 100, ...overrides };
  createExperimentBudget(ledger).close(); const configured = policy();
  guards.createExperimentRequestGuard({ ledger, policy: configured, fetchImpl: async () => assert.fail('no setup I/O') }).close();
  const authorization = { ledger, policy: configured, authorizationId: 'synthetic-qualification-approval' };
  return { root, ledger, configured, authorization,
    qualificationExtension: provision ? guards.authorizeQualificationExtension(authorization) : undefined };
}
const makeGuard = (f, fetchImpl) => guards.createQualificationExperimentRequestGuard({ ledger: f.ledger,
  policy: f.configured, qualificationExtension: f.qualificationExtension, fetchImpl });
const state = (ledger) => { const h = reopenExperimentBudget(ledger); try { return h.getState(); } finally { h.close(); } };
const file = (f) => join(f.ledger.directory, filename);
function frozen(value) { assert.equal(Object.isFrozen(value), true);
  for (const item of Object.values(value)) if (item && typeof item === 'object') frozen(item); }

test('QG1 actual adapter qualifies through baseline count/generate with retained unknown count reservation', async (t) => {
  const f = fixture(); const calls = []; const guard = makeGuard(f, fake(calls)); t.after(() => guard.close());
  const model = createOpenAIModel({ apiKey: secret, fetchImpl: guard.cairnFetch });
  assert.equal(calls.length, 0); assert.ok(model.countTokens(evidence) > 0); assert.equal(calls.length, 0);
  assert.deepEqual(await model.qualify({ system: 'Synthetic source binding.', input: input(), maxOutputTokens: 1024,
    signal: new AbortController().signal }), output());
  assert.deepEqual(calls.map((call) => [call.url, call.body.model, call.body.text.format.name]),
    [[urls.count, DEFAULT_MODEL, 'cairn_qualify'], [urls.generation, DEFAULT_MODEL, 'cairn_qualify']]);
  assert.deepEqual(guard.getState().attempts.map((a) => [a.channel, a.reservedMicroUsd]), [['cairn-count', 5], ['cairn-generation', 20]]);
  assert.equal(guard.getState().attempts[0].outcome, 'succeeded');
  assert.equal(guard.getState().attempts[0].actualMicroUsd, null); assert.equal(guard.getState().reservedMicroUsd, 25);
  assert.equal(Object.hasOwn(schemas, 'qualify'), false);
});

test('QG1 three legacy constructors continue rejecting qualification after independent provisioning', async () => {
  const f = fixture(); const extension = guards.authorizeExtractionModelExtension({ ...f.authorization, authorizationId: 'synthetic-extraction' });
  const reconciliationExtension = guards.authorizeReconciliationExtension({ ...f.authorization, extension, authorizationId: 'synthetic-reconcile' });
  let sends = 0; const fetchImpl = async () => { sends++; assert.fail('no transport'); };
  for (const guard of [guards.createExperimentRequestGuard({ ledger: f.ledger, policy: f.configured, fetchImpl }),
    guards.createExtendedExperimentRequestGuard({ ledger: f.ledger, policy: f.configured, extension, fetchImpl }),
    guards.createReconciliationExperimentRequestGuard({ ledger: f.ledger, policy: f.configured, extension, reconciliationExtension, fetchImpl })]) {
    try { for (const generation of [false, true]) await assert.rejects(guard.cairnFetch(generation ? urls.generation : urls.count,
      request(body(generation))), guardError('unsupported_request')); } finally { guard.close(); }
  }
  assert.equal(sends, 0); assert.equal(state(f.ledger).requestCount, 0);
});

test('QG2 exact constructors and authorization reject missing, forged and extra capabilities', () => {
  const f = fixture(); const args = { ledger: f.ledger, policy: f.configured, qualificationExtension: f.qualificationExtension,
    fetchImpl: async () => assert.fail('no transport') };
  for (const key of Object.keys(args)) { const invalid = { ...args }; delete invalid[key];
    assert.throws(() => guards.createQualificationExperimentRequestGuard(invalid), guards.ExperimentRequestGuardError); }
  assert.throws(() => guards.createQualificationExperimentRequestGuard({ ...args, extra: true }), guardError('invalid_options'));
  assert.throws(() => guards.authorizeQualificationExtension({ ...f.authorization, extra: true }), guardError('invalid_options'));
  for (const qualificationExtension of [undefined, null, false, [], {}, 'forged'])
    assert.throws(() => guards.createQualificationExperimentRequestGuard({ ...args, qualificationExtension }), guardError('invalid_extension'));
  for (const authorizationId of [null, 1, '', '../unsafe'])
    assert.throws(() => guards.authorizeQualificationExtension({ ...f.authorization, authorizationId }), guardError('invalid_extension'));
  assert.equal(state(f.ledger).requestCount, 0);
});

test('QG2 authorization locks a settled prefix, freezes detached token and preserves bytes idempotently', () => {
  const f = fixture({}, false); const h = reopenExperimentBudget(f.ledger); const attemptId = randomUUID();
  h.reserve({ attemptId, channel: 'cairn-count', reservedMicroUsd: 5 });
  assert.throws(() => guards.authorizeQualificationExtension(f.authorization), guardError('extension_busy'));
  assert.equal(existsSync(file(f)), false);
  h.recordOutcome({ attemptId, outcome: 'unknown' }); h.close();
  const paths = [join(f.ledger.directory, 'experiment-request-policy.json'), join(f.ledger.directory, 'experiment-budget.sqlite')];
  const bytes = paths.map((path) => readFileSync(path)); const before = state(f.ledger);
  const token = guards.authorizeQualificationExtension(f.authorization); frozen(token);
  assert.equal(token.method, 'cairn_qualify'); assert.equal(token.model, DEFAULT_MODEL);
  assert.deepEqual(token.checkpoint, { requestCount: 1, reservedMicroUsd: 5 });
  assert.notEqual(token.ledger, f.ledger); assert.equal(lstatSync(file(f)).mode & 0o777, 0o600);
  const binding = readFileSync(file(f)); assert.deepEqual(guards.authorizeQualificationExtension(f.authorization), token);
  assert.deepEqual(readFileSync(file(f)), binding); assert.deepEqual(state(f.ledger), before);
  paths.forEach((path, i) => assert.deepEqual(readFileSync(path), bytes[i]));
  assert.throws(() => guards.authorizeQualificationExtension({ ...f.authorization, authorizationId: 'changed' }), guardError('policy_mismatch'));
  assert.deepEqual(readFileSync(file(f)), binding);
  assert.ok(!binding.toString().includes(secret)); assert.ok(!binding.toString().includes(evidence));
});

test('QG2 existing exact policy and writable writer lock required; partial binding never repaired', () => {
  const f = fixture({}, false); const altered = structuredClone(f.configured); altered.cairnCount.maxInputTokens = 7023;
  assert.throws(() => guards.authorizeQualificationExtension({ ...f.authorization, policy: altered }), guards.ExperimentRequestGuardError);
  const db = new DatabaseSync(join(f.ledger.directory, 'experiment-budget.sqlite')); db.exec('BEGIN IMMEDIATE');
  try { assert.throws(() => guards.authorizeQualificationExtension(f.authorization)); } finally { db.exec('ROLLBACK'); db.close(); }
  writeFileSync(file(f), '{partial', { mode: 0o600 }); const before = state(f.ledger);
  assert.throws(() => guards.authorizeQualificationExtension(f.authorization), guardError('unsafe_policy_binding'));
  assert.equal(readFileSync(file(f), 'utf8'), '{partial'); assert.deepEqual(state(f.ledger), before);
  const unbound = fixture({}, false); unlinkSync(join(unbound.ledger.directory, 'experiment-request-policy.json'));
  assert.throws(() => guards.authorizeQualificationExtension(unbound.authorization), guards.ExperimentRequestGuardError);
  assert.equal(existsSync(file(unbound)), false);
});

test('QG3 missing corrupt unsafe linked oversized and swapped files fail construction and every request', async () => {
  for (const scenario of ['missing', 'partial', 'oversized', 'mode', 'symlink', 'hardlink', 'changed']) {
    const f = fixture(); let sends = 0; const fetchImpl = async () => { sends++; assert.fail('no transport'); };
    const guard = makeGuard(f, fetchImpl); const original = readFileSync(file(f));
    if (scenario === 'missing') unlinkSync(file(f));
    if (scenario === 'partial') writeFileSync(file(f), '{partial');
    if (scenario === 'oversized') writeFileSync(file(f), ' '.repeat(1000001));
    if (scenario === 'mode') chmodSync(file(f), 0o644);
    if (scenario === 'changed') { const parsed = JSON.parse(original); parsed.authorizationId = 'changed'; writeFileSync(file(f), JSON.stringify(parsed)); }
    if (scenario === 'symlink' || scenario === 'hardlink') {
      const target = join(f.root, 'synthetic-target'); writeFileSync(target, original, { mode: 0o600 }); unlinkSync(file(f));
      if (scenario === 'symlink') symlinkSync(target, file(f)); else linkSync(target, file(f));
    }
    try {
      assert.throws(() => makeGuard(f, fetchImpl), guards.ExperimentRequestGuardError, scenario);
      await assert.rejects(guard.cairnFetch(urls.generation, request()), guards.ExperimentRequestGuardError);
      assert.equal(guard.getState().requestCount, 0); assert.equal(sends, 0);
    } finally { guard.close(); }
  }
  const one = fixture(); const other = fixture(); writeFileSync(file(one), readFileSync(file(other)));
  assert.throws(() => makeGuard(one, fake([])), guards.ExperimentRequestGuardError);
  assert.throws(() => makeGuard({ ...one, qualificationExtension: other.qualificationExtension }, fake([])), guards.ExperimentRequestGuardError);
});

test('QG3 capability rechecked after caller request accessor tampering before reservation', async (t) => {
  const f = fixture(); let sends = 0; let accessed = false;
  const guard = makeGuard(f, async () => { sends++; assert.fail('no transport'); }); t.after(() => guard.close());
  const before = guard.getState(); const req = request(); const headers = req.headers;
  Object.defineProperty(req, 'headers', { enumerable: true, get() { accessed = true; unlinkSync(file(f)); return headers; } });
  await assert.rejects(guard.cairnFetch(urls.generation, req), guards.ExperimentRequestGuardError);
  assert.equal(accessed, true); assert.equal(sends, 0); assert.deepEqual(guard.getState(), before);
});

test('QG3 forged checkpoint and rollback or unsettled prefix reject without reservation', async () => {
  for (const mutation of ['forged', 'rollback', 'unsettle']) {
    const f = fixture({}, false); const h = reopenExperimentBudget(f.ledger); const attemptId = randomUUID();
    h.reserve({ attemptId, channel: 'cairn-count', reservedMicroUsd: 5 }); h.recordOutcome({ attemptId, outcome: 'unknown' }); h.close();
    f.qualificationExtension = guards.authorizeQualificationExtension(f.authorization);
    const guard = makeGuard(f, async () => assert.fail('no transport'));
    if (mutation === 'forged') {
      const forged = structuredClone(f.qualificationExtension); forged.checkpoint.requestCount = 2;
      writeFileSync(file(f), JSON.stringify(forged));
      assert.throws(() => makeGuard({ ...f, qualificationExtension: forged }, fake([])), guards.ExperimentRequestGuardError);
    } else {
      const db = new DatabaseSync(join(f.ledger.directory, 'experiment-budget.sqlite'));
      if (mutation === 'rollback') db.exec('BEGIN IMMEDIATE; DELETE FROM attempts; UPDATE run_config SET request_count=0,reserved_micro_usd=0; COMMIT');
      else db.exec('UPDATE attempts SET outcome=NULL,actual_micro_usd=NULL');
      db.close(); const before = guard.getState();
      await assert.rejects(guard.cairnFetch(urls.generation, request()), guardError('policy_mismatch'));
      assert.deepEqual(guard.getState(), before);
    }
    guard.close();
  }
});

test('QG3 wrong model method schema route and framing fail before transport and reservation', async (t) => {
  const f = fixture(); let sends = 0; const guard = makeGuard(f, async () => { sends++; assert.fail('no transport'); }); t.after(() => guard.close());
  const wrongSchema = body(); wrongSchema.text.format.schema = { type: 'object', additionalProperties: true };
  const reconcile = body(); reconcile.text.format.name = 'cairn_reconcile';
  for (const invalid of [wrongSchema, reconcile, ...[LUNA_EXTRACTION_MODEL, EXPERIMENTAL_EXTRACTION_MODEL, 'wrong-model'].map((model) => ({ ...body(), model })),
    { ...body(), reasoning: { effort: 'none' } }, { ...body(), tools: [] }, { ...body(), max_output_tokens: 1025 },
    { ...body(), store: true }, { ...body(), stream: true }])
    await assert.rejects(guard.cairnFetch(urls.generation, request(invalid)), guardError('unsupported_request'));
  const extractInput = { messages: [{ index: 0, role: 'user', content: evidence }] };
  for (const model of [LUNA_EXTRACTION_MODEL, EXPERIMENTAL_EXTRACTION_MODEL]) {
    const alternate = body(); alternate.model = model; alternate.reasoning = { effort: 'none' };
    alternate.input[0].content[0].text = JSON.stringify(extractInput);
    alternate.text.format.name = 'cairn_extract'; alternate.text.format.schema = schemasFor('extract', extractInput);
    await assert.rejects(guard.cairnFetch(urls.generation, request(alternate)), guardError('unsupported_request'));
  }
  assert.throws(() => guard.cairnFetch('https://other.invalid/v1/responses', request()), guardError('invalid_request'));
  const overflow = body(); overflow.instructions = ' word'.repeat(8000);
  await assert.rejects(guard.cairnFetch(urls.generation, request(overflow)), guardError('input_bound_exceeded'));
  assert.equal(sends, 0); assert.equal(guard.getState().requestCount, 0);
});

test('QG3 shared caps survive concurrent handles and reopen without refunding unknown costs', async (t) => {
  const f = fixture({ requestCap: 2 }); const calls = []; const a = makeGuard(f, fake(calls)); const b = makeGuard(f, fake(calls));
  await Promise.all([a.cairnFetch(urls.count, request(body(false))), b.cairnFetch(urls.generation, request())]);
  assert.equal(a.getState().reservedMicroUsd, 25); a.close(); b.close();
  const reopened = makeGuard(f, fake(calls)); t.after(() => reopened.close());
  await assert.rejects(reopened.cairnFetch(urls.count, request(body(false))), { code: 'request_cap_exceeded' });
  assert.equal(calls.length, 2); assert.equal(reopened.getState().reservedMicroUsd, 25);
});

test('QG3 transport failure malformed usage and budget exhaustion retain every reservation', async (t) => {
  const f = fixture({ limitMicroUsd: 40 }); let sends = 0;
  const guard = makeGuard(f, async () => { sends++; if (sends === 1) throw new Error(`${secret} ${evidence}`);
    const result = response(); delete result.usage; return Response.json(result); }); t.after(() => guard.close());
  await assert.rejects(guard.cairnFetch(urls.generation, request()), guardError('transport_failed'));
  await assert.rejects(guard.cairnFetch(urls.generation, request()), guardError('invalid_response'));
  assert.deepEqual(guard.getState().attempts.map((a) => [a.outcome, a.actualMicroUsd]), [['unknown', null], ['unknown', null]]);
  await assert.rejects(guard.cairnFetch(urls.count, request(body(false))), { code: 'budget_exceeded' });
  assert.equal(guard.getState().reservedMicroUsd, 40); assert.equal(sends, 2);
});

test('QG3 cancellation settles unknown and prevents busy close from losing reservation', async (t) => {
  const f = fixture(); let entered; let signal; const ready = new Promise((resolve) => { entered = resolve; });
  const guard = makeGuard(f, (_url, request) => { signal = request.signal; entered(); return new Promise(() => {}); }); t.after(() => guard.close());
  const controller = new AbortController(); const pending = guard.cairnFetch(urls.generation, request(body(), { signal: controller.signal })); await ready;
  assert.throws(() => guard.close(), guardError('guard_busy')); controller.abort(new Error(secret));
  await assert.rejects(pending, guardError('request_aborted')); assert.equal(signal.aborted, true);
  assert.deepEqual(guard.getState().attempts.map((a) => [a.outcome, a.reservedMicroUsd]), [['unknown', 20]]);
});
