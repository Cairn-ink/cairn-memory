import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { DEFAULT_MODEL, EXPERIMENTAL_EXTRACTION_MODEL, LUNA_EXTRACTION_MODEL } from '../../../adapters/openai/profiles.mjs';
import { schemasFor } from '../../../adapters/openai/schemas.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createExperimentBudget, reopenExperimentBudget } from '../index.mjs';
import {
  ExperimentRequestGuardError,
  createExperimentRequestGuard,
  createExtendedExperimentRequestGuard,
  authorizeExtractionModelExtension,
} from '../request-guard.mjs';

const secret = 'synthetic-secret-never-expose';
const sensitive = 'synthetic-private-prompt-never-expose';
const urls = {
  host: 'https://api.openai.com/v1/chat/completions',
  count: 'https://api.openai.com/v1/responses/input_tokens',
  generation: 'https://api.openai.com/v1/responses',
};

function workspace(t, overrides = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cairn-request-guard-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ledger = {
    directory: path.join(root, 'ledger'),
    runId: randomUUID(),
    limitMicroUsd: 1_000,
    requestCap: 10,
    ...overrides,
  };
  const created = createExperimentBudget(ledger);
  created.close();
  return { root, ledger };
}

function price(microUsdNumerator = 1, tokenDenominator = 1_000) {
  return { microUsdNumerator, tokenDenominator };
}

function channel(endpoint, overrides = {}) {
  return {
    endpoint,
    model: DEFAULT_MODEL,
    reservedMicroUsd: 20,
    maxRequestBytes: 131_072,
    maxResponseBytes: 131_072,
    timeoutMs: 250,
    maxInputTokens: 7_024,
    maxOutputTokens: 1_024,
    inputTokenFraming: 1_024,
    inputPrice: price(),
    outputPrice: price(),
    ...overrides,
  };
}

function policy(overrides = {}) {
  return {
    version: 1,
    hostCompletion: channel(urls.host, {
      reservedMicroUsd: 12,
      maxInputTokens: 10_000,
      maxOutputTokens: 1_024,
      inputTokenFraming: 128,
    }),
    cairnCount: channel(urls.count, {
      reservedMicroUsd: 5,
      maxOutputTokens: 0,
    }),
    cairnGeneration: channel(urls.generation),
    ...overrides,
  };
}

function options(body, signal = new AbortController().signal, overrides = {}) {
  return {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...overrides,
  };
}

function hostBody(overrides = {}) {
  return {
    model: DEFAULT_MODEL,
    messages: [{ role: 'user', content: sensitive }],
    max_completion_tokens: 32,
    n: 1,
    store: false,
    stream: false,
    ...overrides,
  };
}

function hostEnvelope(overrides = {}) {
  return {
    id: 'chatcmpl_synthetic',
    object: 'chat.completion',
    model: DEFAULT_MODEL,
    choices: [{ index: 0, message: { role: 'assistant', content: 'Synthetic reply.' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 },
    ...overrides,
  };
}

function countEnvelope(inputTokens = 100) {
  return { object: 'response.input_tokens', input_tokens: inputTokens };
}

function generationEnvelope(name, inputTokens = 100) {
  const output = name === 'extract' || name === 'classify' ? { items: [] } : { refs: [] };
  return {
    id: 'resp_synthetic',
    object: 'response',
    model: DEFAULT_MODEL,
    status: 'completed',
    error: null,
    incomplete_details: null,
    output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
    usage: { input_tokens: inputTokens, output_tokens: 5, total_tokens: inputTokens + 5 },
  };
}

function fakeOpenAI(calls, host = hostEnvelope()) {
  return async (url, request) => {
    const body = JSON.parse(request.body);
    calls.push({ url, body, signal: request.signal });
    if (url === urls.count) return Response.json(countEnvelope());
    if (url === urls.generation) {
      const name = body.text.format.name.slice('cairn_'.length);
      return Response.json(generationEnvelope(name));
    }
    if (url === urls.host) return Response.json(host);
    throw new Error('unexpected synthetic endpoint');
  };
}

const guardError = (code) => (error) => error instanceof ExperimentRequestGuardError
  && error.code === code && error.message === code && !`${error} ${error.stack}`.includes(sensitive)
  && !`${error} ${error.stack}`.includes(secret);

function extractionBody(model = LUNA_EXTRACTION_MODEL, generation = true) {
  const input = { messages: [{ index: 0, role: 'user', content: 'Synthetic.' }] };
  return { model, instructions: 'Synthetic system.',
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
    truncation: 'disabled',
    text: { format: { name: 'cairn_extract', type: 'json_schema', strict: true, schema: schemasFor('extract', input) } },
    ...(model === DEFAULT_MODEL ? {} : { reasoning: { effort: 'none' } }),
    ...(generation ? { max_output_tokens: 1024, store: false, stream: false } : {}) };
}

function extendedWorkspace(t, overrides = {}) {
  const { ledger } = workspace(t, { limitMicroUsd: 30_000, ...overrides });
  const configured = policy();
  const baseline = createExperimentRequestGuard({ ledger, policy: configured, fetchImpl: async () => assert.fail('no I/O') });
  baseline.close();
  const provisioning = { ledger, policy: configured, authorizationId: 'synthetic-luna-comparison-v1' };
  const extension = authorizeExtractionModelExtension(provisioning);
  return { ledger, configured, provisioning, extension };
}

test('L4: explicit extension preserves original binding and historical settled ledger, and old guard never opts in', async (t) => {
  const { ledger } = workspace(t, { limitMicroUsd: 30_000 });
  const configured = policy();
  const old = createExperimentRequestGuard({ ledger, policy: configured, fetchImpl: fakeOpenAI([]) });
  await old.hostFetch(urls.host, options(hostBody()));
  const before = old.getState();
  const binding = readFileSync(path.join(ledger.directory, 'experiment-request-policy.json'));
  const provisioning = { ledger, policy: configured, authorizationId: 'synthetic-approval' };
  const extension = authorizeExtractionModelExtension(provisioning);
  assert.deepEqual(old.getState(), before);
  assert.deepEqual(readFileSync(path.join(ledger.directory, 'experiment-request-policy.json')), binding);
  assert.deepEqual(authorizeExtractionModelExtension(provisioning), extension);
  assert.equal(extension.models[LUNA_EXTRACTION_MODEL].cairnGeneration.reservedMicroUsd, 2985);
  assert.equal(extension.models[EXPERIMENTAL_EXTRACTION_MODEL].cairnGeneration.reservedMicroUsd, 9876);
  assert.equal(Object.isFrozen(extension.models[LUNA_EXTRACTION_MODEL].cairnCount), true);
  await assert.rejects(old.cairnFetch(urls.generation, options(extractionBody())), guardError('unsupported_request'));
  assert.deepEqual(old.getState(), before);
  old.close();
  assert.throws(() => authorizeExtractionModelExtension({ ...provisioning, authorizationId: 'other' }), guardError('policy_mismatch'));
});

test('L4/L5: mixed model requests reserve atomically in one ledger and reopen retains pricing and quotas', async (t) => {
  const { ledger, configured, extension } = extendedWorkspace(t, { limitMicroUsd: 12_900 });
  const calls = [];
  const fetchImpl = async (url, request) => {
    const body = JSON.parse(request.body); calls.push(body.model);
    return Response.json(url === urls.count ? countEnvelope() : { ...generationEnvelope('extract'), model: body.model });
  };
  const construct = () => createExtendedExperimentRequestGuard({ ledger, policy: configured, extension, fetchImpl });
  const first = construct(); const second = construct();
  await Promise.all([
    first.cairnFetch(urls.generation, options(extractionBody(LUNA_EXTRACTION_MODEL))),
    second.cairnFetch(urls.generation, options(extractionBody(EXPERIMENTAL_EXTRACTION_MODEL))),
  ]);
  assert.equal(first.getState().reservedMicroUsd, 12861);
  assert.deepEqual(first.getState().attempts.map((item) => item.actualMicroUsd), [31, 98]);
  first.close(); second.close();
  const reopened = construct();
  await assert.rejects(reopened.cairnFetch(urls.generation, options(extractionBody())), { code: 'budget_exceeded' });
  assert.equal(calls.length, 2);
  assert.equal(reopened.getState().requestCount, 2);
  reopened.close();
});

test('L4: extension refuses missing, malformed, changed, unsafe, symlink and mismatched authorization files before I/O', async (t) => {
  for (const scenario of ['missing', 'malformed', 'changed', 'unsafe', 'symlink']) {
    await t.test(scenario, async (t) => {
      const { ledger, configured, extension } = extendedWorkspace(t);
      let sends = 0;
      const opts = { ledger, policy: configured, extension, fetchImpl: async () => { sends += 1; assert.fail('no I/O'); } };
      const guard = createExtendedExperimentRequestGuard(opts);
      const filename = path.join(ledger.directory, 'experiment-extraction-extension.json');
      if (scenario === 'missing') unlinkSync(filename);
      if (scenario === 'malformed') writeFileSync(filename, '{');
      if (scenario === 'changed') writeFileSync(filename, JSON.stringify({ ...extension, authorizationId: 'changed' }));
      if (scenario === 'unsafe') chmodSync(filename, 0o644);
      if (scenario === 'symlink') { unlinkSync(filename); symlinkSync('experiment-request-policy.json', filename); }
      assert.throws(() => createExtendedExperimentRequestGuard(opts), ExperimentRequestGuardError);
      await assert.rejects(guard.cairnFetch(urls.generation, options(extractionBody())), ExperimentRequestGuardError);
      assert.equal(guard.getState().requestCount, 0); assert.equal(sends, 0); guard.close();
    });
  }
});

test('L4: unsupported method/model/reasoning and widened extension rejected before reservation', async (t) => {
  const { ledger, configured, extension } = extendedWorkspace(t);
  const opts = { ledger, policy: configured, extension, fetchImpl: async () => assert.fail('no I/O') };
  for (const invalid of [null, undefined, false, [], {}]) {
    assert.throws(() => createExtendedExperimentRequestGuard({ ...opts, extension: invalid }), guardError('invalid_extension'));
  }
  const guard = createExtendedExperimentRequestGuard(opts);
  for (const body of [extractionBody('unknown-model'),
    { ...extractionBody(), reasoning: { effort: 'high' } },
    { ...extractionBody(), text: { format: { ...extractionBody().text.format, name: 'cairn_classify' } } }]) {
    await assert.rejects(guard.cairnFetch(urls.generation, options(body)), guardError('unsupported_request'));
  }
  await assert.rejects(guard.hostFetch(urls.host, options(hostBody({ model: LUNA_EXTRACTION_MODEL }))), guardError('unsupported_request'));
  const changed = structuredClone(extension); changed.models[LUNA_EXTRACTION_MODEL].cairnCount.maxInputTokens += 1;
  assert.throws(() => createExtendedExperimentRequestGuard({ ...opts, extension: changed }), guardError('invalid_extension'));
  assert.throws(() => authorizeExtractionModelExtension({ ledger, policy: configured, authorizationId: '../bad' }), guardError('invalid_extension'));
  assert.throws(() => authorizeExtractionModelExtension({ ledger, policy: configured, authorizationId: 123 }), guardError('invalid_extension'));
  assert.equal(guard.getState().requestCount, 0); guard.close();
});

test('ordered reconciliation is not implicitly authorized by either existing guard', async (t) => {
  for (const extended of [false, true]) {
    await t.test(extended ? 'extraction extension' : 'baseline', async (t) => {
      const { ledger, configured, extension } = extendedWorkspace(t);
      let sends = 0;
      const opts = { ledger, policy: configured, fetchImpl: async () => { sends += 1; assert.fail('no I/O'); } };
      const guard = extended
        ? createExtendedExperimentRequestGuard({ ...opts, extension })
        : createExperimentRequestGuard(opts);
      const input = {
        messages: [{ index: 0, role: 'user', content: 'Move the review to Monday.' }],
        items: [{ index: 0, content: 'Review is Monday.', kind: 'fact', sourceIndices: [0] }],
        candidates: [{ index: 0, content: 'Review is Friday.', kind: 'fact',
          receipts: [{ role: 'user', excerpt: 'Review is Friday.' }] }],
      };
      try {
        for (const generation of [false, true]) {
          const body = { ...extractionBody(DEFAULT_MODEL, generation),
            input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
            text: { format: { name: 'cairn_reconcile', type: 'json_schema', strict: true,
              schema: schemasFor('reconcile', input) } } };
          await assert.rejects(guard.cairnFetch(generation ? urls.generation : urls.count, options(body)),
            guardError('unsupported_request'));
        }
        assert.equal(guard.getState().requestCount, 0);
        assert.equal(guard.getState().reservedMicroUsd, 0);
        assert.equal(sends, 0);
      } finally { guard.close(); }
    });
  }
});

test('L4/L5: alternate count and baseline host retain shared request cap without model fallback', async (t) => {
  const { ledger, configured, extension } = extendedWorkspace(t, { requestCap: 2 });
  const calls = [];
  const guard = createExtendedExperimentRequestGuard({ ledger, policy: configured, extension, fetchImpl: fakeOpenAI(calls) });
  await guard.cairnFetch(urls.count, options(extractionBody(LUNA_EXTRACTION_MODEL, false)));
  await guard.hostFetch(urls.host, options(hostBody()));
  await assert.rejects(guard.cairnFetch(urls.count, options(extractionBody(EXPERIMENTAL_EXTRACTION_MODEL, false))), { code: 'request_cap_exceeded' });
  assert.deepEqual(calls.map((call) => call.body.model), [LUNA_EXTRACTION_MODEL, DEFAULT_MODEL]);
  assert.equal(guard.getState().reservedMicroUsd, 1756 + 12);
  assert.equal(guard.getState().attempts[0].actualMicroUsd, null);
  guard.close();
});

test('L4: original baseline restriction, unsafe path, and forged checkpoint fail closed', (t) => {
  const { ledger, configured, extension, provisioning } = extendedWorkspace(t);
  assert.throws(() => authorizeExtractionModelExtension({ ...provisioning,
    policy: policy({ cairnCount: channel(urls.count, { model: EXPERIMENTAL_EXTRACTION_MODEL, maxOutputTokens: 0 }) }) }), guardError('invalid_extension'));
  const alias = path.join(path.dirname(ledger.directory), 'alias');
  symlinkSync(ledger.directory, alias);
  assert.throws(() => createExtendedExperimentRequestGuard({ ledger: { ...ledger, directory: alias }, policy: configured, extension,
    fetchImpl: async () => assert.fail('no I/O') }));
  const forged = structuredClone(extension); forged.checkpoint.requestCount = 1; forged.checkpoint.reservedMicroUsd = 5;
  writeFileSync(path.join(ledger.directory, 'experiment-extraction-extension.json'), JSON.stringify(forged));
  assert.throws(() => createExtendedExperimentRequestGuard({ ledger, policy: configured, extension: forged,
    fetchImpl: async () => assert.fail('no I/O') }), guardError('policy_mismatch'));
});

test('L4: an already-open extension rejects a rolled-back ledger checkpoint before network or reservation', async (t) => {
  const { ledger } = workspace(t, { limitMicroUsd: 30_000 });
  const configured = policy();
  const baseline = createExperimentRequestGuard({ ledger, policy: configured, fetchImpl: fakeOpenAI([]) });
  await baseline.hostFetch(urls.host, options(hostBody())); baseline.close();
  const extension = authorizeExtractionModelExtension({ ledger, policy: configured, authorizationId: 'rollback-check' });
  const guard = createExtendedExperimentRequestGuard({ ledger, policy: configured, extension,
    fetchImpl: async () => assert.fail('no I/O') });
  // Deliberately emulate a restored older, internally consistent synthetic ledger.
  const db = new DatabaseSync(path.join(ledger.directory, 'experiment-budget.sqlite'));
  db.exec('BEGIN IMMEDIATE; DELETE FROM attempts; UPDATE run_config SET reserved_micro_usd = 0, request_count = 0; COMMIT');
  db.close();
  await assert.rejects(guard.cairnFetch(urls.generation, options(extractionBody())), guardError('policy_mismatch'));
  assert.equal(guard.getState().requestCount, 0); guard.close();
});

test('L4/L5: setup refuses unsettled attempts; interrupted and spoofed responses retain reservations', async (t) => {
  const { ledger, configured, extension, provisioning } = extendedWorkspace(t);
  const handle = reopenExperimentBudget(ledger);
  const attemptId = randomUUID(); handle.reserve({ attemptId, channel: 'cairn-count', reservedMicroUsd: 5 });
  assert.throws(() => authorizeExtractionModelExtension(provisioning), guardError('extension_busy'));
  handle.recordOutcome({ attemptId, outcome: 'unknown' }); handle.close();
  let calls = 0;
  const guard = createExtendedExperimentRequestGuard({ ledger, policy: configured, extension, fetchImpl: async () => {
    calls += 1;
    if (calls === 1) throw new Error('synthetic interrupt');
    return Response.json(generationEnvelope('extract'));
  } });
  await assert.rejects(guard.cairnFetch(urls.generation, options(extractionBody())), guardError('transport_failed'));
  await assert.rejects(guard.cairnFetch(urls.generation, options(extractionBody())), guardError('invalid_response'));
  assert.equal(guard.getState().reservedMicroUsd, 5975);
  assert.equal(guard.getState().attempts.filter((attempt) => attempt.outcome === 'unknown').length, 3);
  guard.close();
});

test('G01: reopen-only constructor snapshots and durably binds one explicit immutable policy', (t) => {
  const { ledger } = workspace(t);
  const configured = policy();
  const guard = createExperimentRequestGuard({ ledger, policy: configured, fetchImpl: async () => assert.fail('no I/O') });
  assert.equal(Object.isFrozen(guard), true);
  assert.equal(Object.isFrozen(guard.policy), true);
  assert.equal(Object.isFrozen(guard.policy.hostCompletion.inputPrice), true);
  configured.hostCompletion.model = 'mutated-after-construction';
  assert.equal(guard.policy.hostCompletion.model, DEFAULT_MODEL);
  const binding = path.join(ledger.directory, 'experiment-request-policy.json');
  assert.equal(JSON.parse(readFileSync(binding, 'utf8')).runId, ledger.runId);
  if (process.platform !== 'win32') assert.equal(lstatSync(binding).mode & 0o777, 0o600);
  guard.close();

  const reopened = createExperimentRequestGuard({ ledger, policy: policy(), fetchImpl: async () => assert.fail('no I/O') });
  reopened.close();
  assert.throws(() => createExperimentRequestGuard({
    ledger,
    policy: policy({ hostCompletion: channel(urls.host, { reservedMicroUsd: 13,
      maxInputTokens: 10_000, inputTokenFraming: 128 }) }),
    fetchImpl: async () => assert.fail('no I/O'),
  }), guardError('policy_mismatch'));

  unlinkSync(binding);
  const used = createExperimentBudget({ ...ledger, directory: path.join(path.dirname(ledger.directory), 'used') });
  const usedLedger = { ...ledger, directory: path.join(path.dirname(ledger.directory), 'used') };
  used.reserve({ attemptId: randomUUID(), channel: 'host-completion', reservedMicroUsd: 1 });
  used.close();
  assert.throws(() => createExperimentRequestGuard({
    ledger: usedLedger, policy: policy(), fetchImpl: async () => assert.fail('no I/O'),
  }), guardError('policy_binding_missing'));
});

test('G01: constructor rejects fractional, under-reserved, overflowing, and unsafe timer policies', (t) => {
  const { ledger } = workspace(t);
  const invalid = [
    policy({ hostCompletion: channel(urls.host, { reservedMicroUsd: 12.5,
      maxInputTokens: 10_000, inputTokenFraming: 128 }) }),
    policy({ hostCompletion: channel(urls.host, { reservedMicroUsd: 1,
      maxInputTokens: 10_000, inputTokenFraming: 128 }) }),
    policy({ hostCompletion: channel(urls.host, { reservedMicroUsd: Number.MAX_SAFE_INTEGER,
      maxInputTokens: Number.MAX_SAFE_INTEGER, maxOutputTokens: Number.MAX_SAFE_INTEGER,
      inputTokenFraming: 0, inputPrice: price(Number.MAX_SAFE_INTEGER, 1),
      outputPrice: price(Number.MAX_SAFE_INTEGER, 1) }) }),
    policy({ hostCompletion: channel(urls.host, { timeoutMs: 2_147_483_648,
      reservedMicroUsd: 12, maxInputTokens: 10_000, inputTokenFraming: 128 }) }),
    policy({ cairnCount: channel(urls.count, { reservedMicroUsd: 5, maxOutputTokens: 0,
      inputPrice: price(1, 1.5) }) }),
  ];
  for (const requestPolicy of invalid) {
    assert.throws(() => createExperimentRequestGuard({
      ledger, policy: requestPolicy, fetchImpl: async () => assert.fail('no I/O'),
    }), guardError('invalid_policy'));
  }
  assert.equal(lstatSync(ledger.directory).isDirectory(), true);
});

test('G02: policy bounds and closed host shape reject before reservation or transport', async (t) => {
  const { ledger } = workspace(t);
  let calls = 0;
  const guard = createExperimentRequestGuard({ ledger, policy: policy(), fetchImpl: async () => { calls += 1; return Response.json(hostEnvelope()); } });
  t.after(() => guard.close());
  const controller = new AbortController();
  controller.abort();
  const invalid = [
    [urls.host, options(hostBody({ model: 'gpt-floating-alias' }))],
    ['http://api.openai.com/v1/chat/completions', options(hostBody())],
    [urls.host, options(hostBody(), new AbortController().signal, { redirect: 'follow' })],
    [urls.host, options(hostBody(), new AbortController().signal, { cache: 'default' })],
    [urls.host, options(hostBody({ stream: true }))],
    [urls.host, options(hostBody({ store: true }))],
    [urls.host, options(hostBody({ n: 2 }))],
    [urls.host, options(hostBody({ max_completion_tokens: 1_025 }))],
    [urls.host, options(hostBody({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:x' } }] }] }))],
    [urls.host, options(hostBody({ audio: {} }))],
    [urls.host, options(hostBody(), controller.signal)],
  ];
  for (const [url, request] of invalid) await assert.rejects(guard.hostFetch(url, request), guardError(
    request.signal.aborted ? 'request_aborted' : url.startsWith('http:') || request.redirect === 'follow' || own(request, 'cache')
      ? 'invalid_request' : 'unsupported_request'));
  assert.equal(calls, 0);
  assert.equal(guard.getState().requestCount, 0);

  const missingMax = hostBody();
  delete missingMax.max_completion_tokens;
  await assert.rejects(guard.hostFetch(urls.host, options(missingMax)), guardError('unsupported_request'));
  assert.equal(guard.getState().requestCount, 0);
});

test('G02: Cairn accepts only actual adapter framing and enforces its local-count input bound', async (t) => {
  const captured = [];
  const probe = createOpenAIModel({ apiKey: secret, fetchImpl: async (url, request) => {
    captured.push({ url, request });
    if (url === urls.count) return Response.json(countEnvelope());
    return Response.json(generationEnvelope('extract'));
  } });
  await probe.extract({
    system: 'Synthetic system.',
    input: { messages: [{ index: 0, role: 'user', content: 'Synthetic.' }] },
    maxOutputTokens: 1024,
    signal: new AbortController().signal,
  });
  const { ledger } = workspace(t);
  let sends = 0;
  const guard = createExperimentRequestGuard({ ledger, policy: policy(), fetchImpl: async () => { sends += 1; return Response.json(countEnvelope()); } });
  t.after(() => guard.close());
  const body = JSON.parse(captured[0].request.body);
  body.instructions = ' x'.repeat(6_100);
  await assert.rejects(guard.cairnFetch(urls.count, {
    ...captured[0].request,
    signal: new AbortController().signal,
    body: JSON.stringify(body),
  }), guardError('input_bound_exceeded'));
  const malformed = JSON.parse(captured[0].request.body);
  malformed.text.format.schema = { type: 'object', additionalProperties: true };
  await assert.rejects(guard.cairnFetch(urls.count, {
    ...captured[0].request,
    signal: new AbortController().signal,
    body: JSON.stringify(malformed),
  }), guardError('unsupported_request'));
  assert.equal(sends, 0);
  assert.equal(guard.getState().requestCount, 0);
});

function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }

test('G03/T06: actual public capture and actual OpenAI adapter share one ledger with host completion', async (t) => {
  const { root, ledger } = workspace(t, { limitMicroUsd: 37, requestCap: 3 });
  const calls = [];
  const guard = createExperimentRequestGuard({ ledger, policy: policy(), fetchImpl: fakeOpenAI(calls) });
  t.after(() => guard.close());
  const model = createOpenAIModel({ apiKey: secret, fetchImpl: guard.cairnFetch });
  const core = openMemoryCore({ path: path.join(root, 'memory.sqlite'), model });
  t.after(() => core.close());
  const captured = await core.capture({
    namespace: { ownerId: 'synthetic-owner', scope: 'personal', projectId: null },
    client: 'synthetic', eventId: 'event', sessionId: 'session',
    messages: [{ id: 'message', role: 'user', content: 'Synthetic public operation.' }],
  });
  assert.equal(captured.ok, true);
  assert.deepEqual(captured.value.admission.memories, []);
  const hostResponse = await guard.hostFetch(urls.host, options(hostBody()));
  assert.equal((await hostResponse.json()).choices[0].message.content, 'Synthetic reply.');
  assert.deepEqual(calls.map((call) => call.url), [urls.count, urls.generation, urls.host]);
  assert.ok(calls.every((call) => call.signal instanceof AbortSignal));
  assert.deepEqual(guard.getState().attempts.map(({ channel: name, outcome }) => [name, outcome]), [
    ['cairn-count', 'succeeded'], ['cairn-generation', 'succeeded'], ['host-completion', 'succeeded'],
  ]);
  await assert.rejects(guard.hostFetch(urls.host, options(hostBody())),
    (error) => error.code === 'request_cap_exceeded');
  assert.equal(calls.length, 3);
});

test('G04: separate handles enforce exact shared ceilings and every external retry reserves again', async (t) => {
  const { ledger } = workspace(t, { limitMicroUsd: 24, requestCap: 3 });
  let calls = 0;
  const transport = async () => {
    calls += 1;
    if (calls === 1) return new Response('synthetic failure', { status: 503 });
    return Response.json(hostEnvelope());
  };
  const first = createExperimentRequestGuard({ ledger, policy: policy(), fetchImpl: transport });
  const second = createExperimentRequestGuard({ ledger, policy: policy(), fetchImpl: transport });
  t.after(() => { first.close(); second.close(); });
  await assert.rejects(first.hostFetch(urls.host, options(hostBody())), guardError('http_failed'));
  assert.equal((await second.hostFetch(urls.host, options(hostBody()))).status, 200);
  await assert.rejects(first.hostFetch(urls.host, options(hostBody())),
    (error) => error.code === 'budget_exceeded');
  assert.equal(calls, 2);
  assert.deepEqual(second.getState().attempts.map(({ outcome }) => outcome), ['failed', 'succeeded']);
});

test('G05: missing or malformed usage is unknown, while observed overrun persists and blocks', async (t) => {
  for (const malformed of [
    { ...hostEnvelope(), usage: undefined },
    hostEnvelope({ usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 99 } }),
    hostEnvelope({ object: 'response' }),
    hostEnvelope({ model: 'gpt-4.1-mini' }),
  ]) {
    const { ledger } = workspace(t);
    const guard = createExperimentRequestGuard({ ledger, policy: policy(), fetchImpl: async () => Response.json(malformed) });
    await assert.rejects(guard.hostFetch(urls.host, options(hostBody())), guardError('invalid_response'));
    assert.deepEqual(guard.getState().attempts.map(({ outcome, actualMicroUsd }) => ({ outcome, actualMicroUsd })),
      [{ outcome: 'unknown', actualMicroUsd: null }]);
    guard.close();
  }

  const { ledger } = workspace(t);
  const overrun = hostEnvelope({ usage: { prompt_tokens: 20_000, completion_tokens: 2_000, total_tokens: 22_000 } });
  let calls = 0;
  const guard = createExperimentRequestGuard({ ledger, policy: policy(), fetchImpl: async () => { calls += 1; return Response.json(overrun); } });
  t.after(() => guard.close());
  await assert.rejects(guard.hostFetch(urls.host, options(hostBody())), guardError('usage_bound_exceeded'));
  const state = guard.getState();
  assert.equal(state.state, 'overrun');
  assert.equal(state.attempts[0].actualMicroUsd, 22);
  await assert.rejects(guard.hostFetch(urls.host, options(hostBody())),
    (error) => error.code === 'budget_blocked');
  assert.equal(calls, 1);
});

test('G05: observed output beyond the request limit is accounted before response rejection', async (t) => {
  const { ledger } = workspace(t);
  const response = hostEnvelope({
    usage: { prompt_tokens: 20, completion_tokens: 33, total_tokens: 53 },
  });
  const guard = createExperimentRequestGuard({ ledger, policy: policy(), fetchImpl: async () => Response.json(response) });
  t.after(() => guard.close());
  await assert.rejects(guard.hostFetch(urls.host, options(hostBody({ max_completion_tokens: 32 }))),
    guardError('usage_bound_exceeded'));
  assert.deepEqual(guard.getState().attempts.map(({ outcome, actualMicroUsd }) => ({ outcome, actualMicroUsd })),
    [{ outcome: 'succeeded', actualMicroUsd: 2 }]);
});

test('G06: response overflow and hung fetch/read abort promptly, cancel readers, and never expose content', async (t) => {
  const cases = ['overflow', 'fetch-timeout', 'read-timeout'];
  for (const kind of cases) {
    const { ledger } = workspace(t);
    let cancelled = false;
    const bounded = policy({ hostCompletion: channel(urls.host, {
      reservedMicroUsd: 12, maxInputTokens: 10_000, inputTokenFraming: 128,
      maxResponseBytes: 64, timeoutMs: 25,
    }) });
    const transport = () => {
      if (kind === 'fetch-timeout') return new Promise(() => {});
      if (kind === 'read-timeout') return new Response(new ReadableStream({
        pull() { return new Promise(() => {}); },
        cancel() { cancelled = true; },
      }));
      return new Response(new ReadableStream({
        pull(controller) { controller.enqueue(new TextEncoder().encode(sensitive.repeat(10))); },
        cancel() { cancelled = true; },
      }));
    };
    const guard = createExperimentRequestGuard({ ledger, policy: bounded, fetchImpl: transport });
    const expected = kind === 'overflow' ? 'response_too_large' : 'request_timeout';
    await assert.rejects(guard.hostFetch(urls.host, options(hostBody())), guardError(expected));
    assert.equal(guard.getState().attempts[0].outcome, 'unknown');
    if (kind !== 'fetch-timeout') assert.equal(cancelled, true);
    guard.close();
  }
});

test('G07: caller cancellation propagates, close rejects in-flight work, and late transport settles safely', async (t) => {
  const { ledger } = workspace(t);
  let transportCalls = 0;
  let transportSignal;
  let resolveLate;
  let lateCancelled = false;
  const guard = createExperimentRequestGuard({ ledger, policy: policy(), fetchImpl: (_url, request) => {
    transportCalls += 1;
    transportSignal = request.signal;
    return new Promise((resolve) => { resolveLate = () => resolve(new Response(new ReadableStream({
      cancel() { lateCancelled = true; },
    }))); });
  } });
  const immediate = new AbortController();
  const neverSent = guard.hostFetch(urls.host, options(hostBody(), immediate.signal));
  immediate.abort();
  await assert.rejects(neverSent, guardError('request_aborted'));
  assert.equal(transportCalls, 0);

  const controller = new AbortController();
  const pending = guard.hostFetch(urls.host, options(hostBody(), controller.signal));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(transportCalls, 1);
  assert.throws(() => guard.close(), guardError('guard_busy'));
  controller.abort(new Error(`${secret} ${sensitive}`));
  await assert.rejects(pending, guardError('request_aborted'));
  assert.equal(transportSignal.aborted, true);
  resolveLate();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lateCancelled, true);
  assert.deepEqual(guard.getState().attempts.map(({ outcome }) => outcome), ['unknown', 'unknown']);
  guard.close();
});

test('G08: binding replacement, permissions and disappearance after use fail closed', async (t) => {
  const { ledger } = workspace(t);
  const guard = createExperimentRequestGuard({ ledger, policy: policy(), fetchImpl: async () => Response.json(hostEnvelope()) });
  await guard.hostFetch(urls.host, options(hostBody()));
  guard.close();
  const binding = path.join(ledger.directory, 'experiment-request-policy.json');
  unlinkSync(binding);
  assert.throws(() => createExperimentRequestGuard({ ledger, policy: policy(), fetchImpl: async () => assert.fail('no I/O') }),
    guardError('policy_binding_missing'));
  const replacement = path.join(ledger.directory, 'experiment-request-policy.json');
  // Recreate through a fresh unused ledger, then make the binding unsafe.
  const fresh = { ...ledger, directory: path.join(path.dirname(ledger.directory), 'fresh'), runId: randomUUID() };
  const created = createExperimentBudget(fresh); created.close();
  const bound = createExperimentRequestGuard({ ledger: fresh, policy: policy(), fetchImpl: async () => assert.fail('no I/O') });
  bound.close();
  if (process.platform !== 'win32') {
    chmodSync(path.join(fresh.directory, path.basename(replacement)), 0o644);
    assert.throws(() => createExperimentRequestGuard({ ledger: fresh, policy: policy(), fetchImpl: async () => assert.fail('no I/O') }),
      guardError('unsafe_policy_binding'));
    chmodSync(path.join(fresh.directory, path.basename(replacement)), 0o600);
  }
  writeFileSync(path.join(fresh.directory, path.basename(replacement)), '{partial', { mode: 0o600 });
  assert.throws(() => createExperimentRequestGuard({ ledger: fresh, policy: policy(), fetchImpl: async () => assert.fail('no I/O') }),
    guardError('unsafe_policy_binding'));
  unlinkSync(path.join(fresh.directory, path.basename(replacement)));
  const target = path.join(path.dirname(fresh.directory), 'binding-target');
  writeFileSync(target, '{}', { mode: 0o600 });
  symlinkSync(target, path.join(fresh.directory, path.basename(replacement)));
  assert.throws(() => createExperimentRequestGuard({ ledger: fresh, policy: policy(), fetchImpl: async () => assert.fail('no I/O') }),
    guardError('unsafe_policy_binding'));
});
