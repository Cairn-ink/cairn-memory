import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { BUNDLE_RANK_INSTRUCTION, prepareBundleRankRequest } from '../source-bundle-rank.mjs';
import { createSourceBundlePlanRankTransport } from '../source-bundle-plan-rank-transport.mjs';

const MODEL = 'gpt-4.1-mini-2025-04-14', KEY = 'synthetic_offline_key_123456';
const sha = text => createHash('sha256').update(text).digest('hex');
const code = expected => error => error?.code === expected;
const identifier = text => `lme-turn-${sha(text)}`;
const [major, minor] = process.versions.node.split('.').map(Number);
const supportsSqlite = major > 22 || major === 22 && minor >= 16;
async function prerequisites(supported, required, load) {
  if (!supported) { if (required) throw new Error('required_sqlite_unavailable'); return null; }
  try { return await load(); }
  catch (error) {
    if (!required && error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes("Cannot find package 'tiktoken'")) return null;
    throw error;
  }
}
test('prerequisite selection skips only explicitly optional SQLite/tokenizer absence', async () => {
  const missing = Object.assign(new Error("Cannot find package 'tiktoken'"), { code: 'ERR_MODULE_NOT_FOUND' });
  assert.equal(await prerequisites(false, false, () => { throw new Error('never'); }), null);
  await assert.rejects(prerequisites(false, true, () => {}), /required_sqlite_unavailable/u);
  assert.equal(await prerequisites(true, false, () => { throw missing; }), null);
  await assert.rejects(prerequisites(true, true, () => { throw missing; }), error => error === missing);
  const other = new Error('unrelated');
  await assert.rejects(prerequisites(true, false, () => { throw other; }), error => error === other);
  const poison = new Proxy({}, { getPrototypeOf() { throw new Error(KEY); } });
  await assert.rejects(createSourceBundlePlanRankTransport(poison), code('invalid_configuration'));
});

test('source-bundle one-shot transport with actual local tokenizer', async t => {
  const adapter = await prerequisites(supportsSqlite, process.env.CAIRN_BUNDLE_TRANSPORT_REQUIRED === '1',
    () => import('../../../adapters/openai/index.mjs'));
  if (!adapter) { t.skip('optional SQLite/tiktoken prerequisite unavailable'); return; }
  const counter = adapter.countOpenAITokens;
  const budget = await import('../../experiment-budget/index.mjs');
  const { DatabaseSync } = await import('node:sqlite');
  function prepared(controller, query = 'Which locker applies to parcel Cedar?', texts = ['Cedar is carrier PX-7.', 'PX-7 uses locker amber.']) {
    const candidates = texts.map((excerpt, index) => ({ namespaceIndex: 0,
      memory: { id: identifier(`memory/${index}`), revision: 1, currentness: 'current' },
      receipts: [{ id: identifier(`receipt/${index}`), role: 'user', excerpt }], receiptCount: 1,
      interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' }));
    return prepareBundleRankRequest({ system: 'Original core ranking instruction',
      input: { query, limit: 6, candidates }, maxOutputTokens: 1024, signal: controller.signal }, counter);
  }
  const proposal = { bundles: [{ sourceIndices: [0, 1], terminalSourceIndex: 1 }] };
  const envelope = (text = JSON.stringify(proposal), patch = {}) => ({ id: 'resp_synthetic', model: MODEL,
    status: 'completed', error: null, incomplete_details: null,
    output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text }] }],
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }, ...patch });
  const response = (value, status = 200) => new Response(typeof value === 'string' ? value : JSON.stringify(value), { status });
  function rows(config) {
    const db = new DatabaseSync(join(config.directory, 'experiment-budget.sqlite'), { readOnly: true });
    try { return db.prepare('SELECT rowid, * FROM attempts ORDER BY rowid').all(); } finally { db.close(); }
  }
  async function fixture(context, options = {}) {
    const workspace = createTestWorkspace(context, { prefix: 'cairn-bundle-transport-' });
    const handles = []; workspace.defer(() => { for (const handle of handles) handle.close(); });
    const config = { directory: join(workspace.path, 'budget'), runId: randomUUID(),
      limitMicroUsd: 400000000, requestCap: 20, ...options.config };
    const original = budget.createExperimentBudget(config);
    try { original.reserve({ attemptId: randomUUID(), channel: 'host-completion', reservedMicroUsd: 30 });
      original.recordOutcome({ attemptId: original.getState().attempts[0].attemptId, outcome: 'unknown' }); }
    finally { original.close(); }
    const prefix = rows(config), inspection = budget.inspectExperimentBudgetForEmbeddingUpgrade(config);
    budget.upgradeExperimentBudgetForEmbeddings({ ...config, expectedCheckpoint: { requestCount: inspection.requestCount,
      reservedMicroUsd: inspection.reservedMicroUsd }, expectedHistorySha256: inspection.historySha256 });
    const controller = new AbortController(), p = prepared(controller), calls = [], observations = [];
    const manifest = { version: 'source-bundle-plan-rank-v1', slotId: 'synthetic-slot-1',
      preparedRequestSha256: p.requestSha256, runDeadline: performance.now() + 10000, caseDeadline: performance.now() + 10000,
      ...options.manifest };
    const args = { configuration: config, checkpoint: { requestCount: inspection.requestCount, reservedMicroUsd: inspection.reservedMicroUsd },
      historySha256: inspection.historySha256, manifest, apiKey: KEY,
      fetchImpl: async (url, init) => { calls.push({ url, init });
        return options.fetch ? options.fetch(url, init, calls.length)
          : response(calls.length === 1 ? { object: 'response.input_tokens', input_tokens: 500 } : envelope()); },
      onRecord: record => { observations.push(record); return options.observe?.(record, controller); } };
    let transport;
    try { transport = await createSourceBundlePlanRankTransport(args); }
    catch (error) { await workspace.cleanup(); assert.equal(existsSync(workspace.path), false); throw error; }
    handles.push(transport);
    return { workspace, config, prefix, controller, p, calls, observations, args, transport,
      request: { ...p.request, signal: controller.signal }, checkPrefix() { assert.deepEqual(rows(config).slice(0, prefix.length), prefix); } };
  }
  function expectedWire(p) {
    // Independent wire oracle, including independently reconstructed schema.
    const index = { type: 'integer', minimum: 0, maximum: p.request.input.catalog.length - 1 };
    const schema = { type: 'object', additionalProperties: false, required: ['bundles'], properties: {
      bundles: { type: 'array', maxItems: 6, items: { type: 'object', additionalProperties: false,
        required: ['sourceIndices', 'terminalSourceIndex'], properties: {
          sourceIndices: { type: 'array', minItems: 1, maxItems: 6, items: index }, terminalSourceIndex: index } } } } };
    const count = { model: MODEL, instructions: BUNDLE_RANK_INSTRUCTION,
      input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(p.request.input) }] }],
      text: { format: { type: 'json_schema', name: 'cairn_source_bundle_plan_rank_v1', strict: true, schema } }, truncation: 'disabled' };
    return [JSON.stringify(count), JSON.stringify({ ...count, max_output_tokens: 1024, store: false, stream: false })];
  }
  await t.test('exact independent wire, source fidelity, reservations, immutable records and single use', async c => {
    const f = await fixture(c); assert.deepEqual(await f.transport.planRank(f.request), proposal);
    assert.deepEqual(f.calls.map(call => call.url), ['https://api.openai.com/v1/responses/input_tokens', 'https://api.openai.com/v1/responses']);
    assert.deepEqual(f.calls.map(call => call.init.body), expectedWire(f.p));
    assert.deepEqual(JSON.parse(JSON.parse(f.calls[1].init.body).input[0].content[0].text).catalog.map(source => source.excerpt),
      ['Cedar is carrier PX-7.', 'PX-7 uses locker amber.']);
    for (const [index, call] of f.calls.entries()) { assert.equal(call.init.method, 'POST'); assert.equal(call.init.redirect, 'error');
      assert.equal(f.transport.getRecords()[2 * index].requestSha256, sha(expectedWire(f.p)[index])); }
    const state = f.transport.getState(); assert.equal(state.requestCount, 3); assert.equal(state.reservedMicroUsd, 10030);
    assert.deepEqual(state.attempts.slice(1).map(row => [row.channel, row.reservedMicroUsd, row.outcome, row.actualMicroUsd]),
      [['cairn-count', 5000, 'succeeded', null], ['cairn-generation', 5000, 'succeeded', 72]]);
    assert.equal(f.transport.getRecords().length, 4); assert.ok(f.transport.getRecords().every(Object.isFrozen));
    assert.ok(!JSON.stringify(f.transport.getRecords()).includes(KEY)); assert.deepEqual(f.transport.health(), { state: 'consumed', fatalCode: null });
    await assert.rejects(f.transport.planRank(f.request), code('slot_consumed')); f.checkPrefix();
  });
  await t.test('empty proposal is returned unchanged', async c => {
    const f = await fixture(c, { fetch: (_, __, n) => response(n === 1 ? { object: 'response.input_tokens', input_tokens: 100 } : envelope('{"bundles":[]}')) });
    assert.deepEqual(await f.transport.planRank(f.request), { bundles: [] }); f.checkPrefix();
  });
  await t.test('descriptor, schema, sparse catalog and manifest digest denials make no request', async c => {
    for (const kind of ['getter', 'schema', 'sparse', 'hash', 'inherited']) {
      const f = await fixture(c); const request = structuredClone(f.p.request); request.signal = f.controller.signal;
      if (kind === 'getter') Object.defineProperty(request, 'system', { get() { throw new Error('must not execute'); }, enumerable: true });
      if (kind === 'schema') request.outputSchema.properties.bundles.maxItems = 7;
      if (kind === 'sparse') delete request.input.catalog[0];
      if (kind === 'hash') request.input.query = 'A different query';
      if (kind === 'inherited') Object.setPrototypeOf(request, { extra: 1 });
      await assert.rejects(f.transport.planRank(request), code('invalid_request')); assert.equal(f.calls.length, 0);
      assert.equal(f.transport.getState().requestCount, 1); f.checkPrefix();
    }
  });
  await t.test('complete provider envelope overflow precedes reservation', async c => {
    const f = await fixture(c); let found;
    for (let size = 550; size <= 650; size += 2) {
      try { const p = prepared(f.controller, 'Find the exact synthetic carrier.',
        Array.from({ length: 18 }, (_, i) => `${i} ` + 'ab_cd '.repeat(134).slice(0, size - 3)));
        if (counter(JSON.stringify(p.request)) <= 6000 && expectedWire(p).some(wire => counter(wire) > 6000)) { found = p; break; } }
      catch (error) { if (error.code !== 'context_budget_exceeded') throw error; }
    }
    assert.ok(found, 'A shape-valid prepared request must isolate the complete envelope boundary');
    f.transport.close(); const manifest = { ...f.args.manifest, preparedRequestSha256: found.requestSha256 };
    const transport = await createSourceBundlePlanRankTransport({ ...f.args, manifest }); f.workspace.defer(() => transport.close());
    await assert.rejects(transport.planRank({ ...found.request, signal: f.controller.signal }), code('context_budget_exceeded'));
    assert.equal(f.calls.length, 0); assert.equal(transport.getState().requestCount, 1); f.checkPrefix();
  });
  await t.test('invalid raw output and strict completed envelopes settle known usage without repair', async c => {
    const whitespace = ' \n'.repeat(2200) + '{"bundles":[]}';
    assert.ok(whitespace.length < 40000 && counter(whitespace) > 1024, 'Real-tokenizer pressure isolates raw rather than compact JSON');
    const cases = [envelope(' '.repeat(40001) + '{"bundles":[]}'), envelope(whitespace),
      envelope('{"bundles":[{"sourceIndices":[99],"terminalSourceIndex":99}]}'), envelope('{"bundles":[],"extra":1}'),
      envelope('{"bundles":[],"bundles":[]}'), envelope('\u00a0{"bundles":[]}'), envelope(undefined, { status: 'incomplete' }),
      envelope(undefined, { output: [{ type: 'function_call' }] }),
      envelope(undefined, { output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'no' }] }] }),
      envelope(undefined, { output: [...envelope().output, ...envelope().output] })];
    for (const value of cases) { const f = await fixture(c, { fetch: (_, __, n) => response(n === 1 ? { object: 'response.input_tokens', input_tokens: 100 } : value) });
      await assert.rejects(f.transport.planRank(f.request), code('invalid_model_output'));
      assert.equal(f.transport.getState().attempts.at(-1).actualMicroUsd, 72); assert.equal(f.transport.getState().attempts.at(-1).outcome, 'failed');
      assert.equal(f.transport.health().fatalCode, null); f.checkPrefix(); }
  });
  await t.test('non-JSON whitespace in provider envelope is rejected before trusting usage', async c => {
    const f = await fixture(c, { fetch: (_, __, n) => response(n === 1 ? { object: 'response.input_tokens', input_tokens: 100 }
      : '\u00a0' + JSON.stringify(envelope())) });
    await assert.rejects(f.transport.planRank(f.request), code('invalid_usage'));
    assert.equal(f.transport.getState().attempts.at(-1).actualMicroUsd, null); f.checkPrefix();
  });
  await t.test('failed HTTP/auth/redirect/model/overrun retain valid usage, malformed usage remains unknown', async c => {
    const variants = [
      { value: envelope(), status: 500, code: 'provider_failed', price: 72, fatal: null },
      { value: { error: { message: 'synthetic provider failure' } }, status: 500, code: 'provider_failed', price: null, fatal: null },
      { value: { model: MODEL }, code: 'invalid_usage', price: null, fatal: 'invalid_usage' },
      { value: envelope(), status: 401, code: 'authentication_failed', price: 72, fatal: 'authentication_failed' },
      { value: envelope(), status: 403, code: 'authentication_failed', price: 72, fatal: 'authentication_failed' },
      { value: envelope(), status: 302, code: 'redirect_rejected', price: 72, fatal: 'redirect_rejected' },
      { value: envelope(), status: 307, code: 'redirect_rejected', price: 72, fatal: 'redirect_rejected' },
      { value: envelope(undefined, { model: 'other' }), code: 'model_mismatch', price: 72, fatal: 'model_mismatch' },
      { value: envelope(undefined, { usage: { input_tokens: 100, output_tokens: 1025, total_tokens: 1125 } }), code: 'usage_overrun', price: 1680, fatal: 'usage_overrun' },
      { value: envelope(undefined, { usage: { input_tokens: 100, output_tokens: 'bad', total_tokens: 120 } }), code: 'invalid_usage', price: null, fatal: 'invalid_usage' },
      { value: '{"usage":{"input_tokens":100},"usage":null}', code: 'invalid_usage', price: null, fatal: 'invalid_usage' },
    ];
    for (const variant of variants) { const f = await fixture(c, { fetch: (_, __, n) => response(n === 1 ? { object: 'response.input_tokens', input_tokens: 100 } : variant.value, n === 1 ? 200 : variant.status ?? 200) });
      await assert.rejects(f.transport.planRank(f.request), code(variant.code));
      assert.equal(f.transport.getState().attempts.at(-1).actualMicroUsd, variant.price);
      assert.equal(f.transport.health().fatalCode, variant.fatal); assert.equal(f.transport.getState().attempts.at(-1).outcome, 'failed'); f.checkPrefix(); }
  });
  await t.test('QT correction: observed auth/redirect stays fatal despite malformed, oversized or stalled count body', async c => {
    for (const status of [401, 403, 301, 302, 307]) for (const body of ['malformed', 'oversized', 'stalled']) {
      await c.test(`${status}/${body}`, async child => {
        const expected = status < 300 || status >= 400 ? 'authentication_failed' : 'redirect_rejected';
        const failure = body === 'malformed' ? 'invalid_response' : body === 'oversized' ? 'response_too_large' : 'cancelled';
        let readerCanceled = false;
        const f = await fixture(child, { fetch() {
          if (body !== 'stalled') return response(body === 'malformed' ? 'not json' : 'x'.repeat(65537), status);
          return { ok: false, status, body: { getReader() { return {
            read() { f.controller.abort(); return new Promise(() => {}); },
            cancel() { readerCanceled = true; }, releaseLock() {} }; } } };
        } });
        await assert.rejects(f.transport.planRank(f.request), code(failure));
        assert.equal(f.transport.health().fatalCode, expected, 'Observed safety status must survive subsequent read/parse failure');
        assert.equal(f.calls.length, 1); assert.equal(f.transport.getState().requestCount, 2);
        assert.equal(f.transport.getState().attempts.at(-1).actualMicroUsd, null);
        assert.equal(f.transport.getRecords().at(-1).dispatched, true);
        assert.ok(f.transport.getState().attempts.at(-1).outcome !== null);
        if (body === 'stalled') assert.equal(readerCanceled, true);
        await assert.rejects(f.transport.planRank(f.request), code('slot_consumed')); f.checkPrefix();
      });
    }
  });
  await t.test('QT correction: witnesses and identifiers require primitive strings without getter/coercion execution', async c => {
    for (const kind of ['history-toString', 'history-primitive', 'history-getter', 'history-boxed', 'slot-number', 'slot-toString']) {
      await c.test(kind, async child => {
        const f = await fixture(child); f.transport.close(); let calls = 0, transport;
        const poison = kind === 'history-primitive' ? { [Symbol.toPrimitive]() { calls++; throw new Error(KEY); } }
          : kind === 'history-getter' ? Object.defineProperty({}, 'toString', { get() { calls++; throw new Error(KEY); } })
            : { toString() { calls++; throw new Error(KEY); } };
        const args = kind.startsWith('history') ? { ...f.args,
          historySha256: kind === 'history-boxed' ? new String(f.args.historySha256) : poison }
          : { ...f.args, manifest: { ...f.args.manifest, slotId: kind === 'slot-number' ? 123 : poison } };
        try { await assert.rejects(async () => { transport = await createSourceBundlePlanRankTransport(args); }, error => {
          assert.equal(error.message.includes(KEY), false); return error.code === 'invalid_configuration'; }); }
        finally { transport?.close(); }
        assert.equal(calls, 0); assert.equal(f.calls.length, 0); f.checkPrefix();
      });
    }
  });
  await t.test('QT native redirect regression: actual Fetch rejects count/generation without following', async c => {
    for (const status of [301, 302, 307]) for (const phase of ['count', 'generation']) {
      await c.test(`${status}/${phase}`, async child => {
        let requests = 0, serverClosed = false;
        const server = createServer((request, reply) => {
          requests++; request.resume(); reply.writeHead(status, { location: '/must-not-follow' }); reply.end('synthetic local redirect');
        });
        child.after(async () => { if (!serverClosed) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } });
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        const local = `http://127.0.0.1:${server.address().port}`;
        const f = await fixture(child, { fetch: (url, init, n) => {
          assert.equal(init.redirect, 'error');
          if (phase === 'generation' && n === 1) return response({ object: 'response.input_tokens', input_tokens: 100 });
          return fetch(local, init);
        } });
        try {
          await assert.rejects(f.transport.planRank(f.request), code('redirect_rejected'));
          assert.equal(f.controller.signal.aborted, false, 'This native failure is not cancellation');
          assert.equal(f.transport.health().fatalCode, 'redirect_rejected');
          assert.equal(requests, 1, 'No redirect follow or retry');
          assert.equal(f.calls.length, phase === 'count' ? 1 : 2);
          const last = f.transport.getState().attempts.at(-1);
          assert.equal(last.reservedMicroUsd, 5000); assert.equal(last.actualMicroUsd, null); assert.equal(last.outcome, 'unknown');
          assert.equal(f.transport.getRecords().at(-1).dispatched, true); f.checkPrefix();
        } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); serverClosed = true;
          await f.workspace.cleanup(); assert.equal(existsSync(f.workspace.path), false); }
        assert.equal(server.listening, false);
      });
    }
  });
  await t.test('QT native rejection controls: safe matching cause only, ordinary network failure and hostile hooks stay bounded', async c => {
    for (const mode of ['matching', 'ordinary', 'abort-matching', 'cause-getter', 'message-getter',
      'cause-message-getter', 'coercion', 'error-proxy', 'cause-proxy', 'sync-proxy']) {
      await c.test(mode, async child => {
        let hooks = 0;
        const trap = () => { hooks++; throw new Error(KEY); };
        let reason = new TypeError('fetch failed', { cause: new Error(mode === 'ordinary' ? 'ECONNRESET' : 'unexpected redirect') });
        if (mode === 'cause-getter') Object.defineProperty(reason, 'cause', { get: trap });
        if (mode === 'message-getter') Object.defineProperty(reason, 'message', { get: trap });
        if (mode === 'cause-message-getter') Object.defineProperty(reason.cause, 'message', { get: trap });
        if (mode === 'coercion') reason.cause.message = { toString: trap, [Symbol.toPrimitive]: trap };
        if (mode === 'error-proxy' || mode === 'sync-proxy') reason = new Proxy(reason,
          { get: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
        if (mode === 'cause-proxy') reason.cause = new Proxy(reason.cause,
          { get: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
        const f = await fixture(child, { fetch() {
          if (mode === 'abort-matching') f.controller.abort();
          if (mode === 'sync-proxy') throw reason;
          return Promise.reject(reason);
        } });
        if (mode === 'sync-proxy') {
          f.transport.close();
          f.transport = await createSourceBundlePlanRankTransport({ ...f.args,
            fetchImpl(url, init) { f.calls.push({ url, init }); throw reason; } });
          f.workspace.defer(() => f.transport.close());
        }
        const expected = mode === 'matching' ? 'redirect_rejected' : mode === 'abort-matching' ? 'cancelled' : 'provider_failed';
        await assert.rejects(f.transport.planRank(f.request), error => error.code === expected && !error.message.includes(KEY));
        assert.equal(f.transport.health().fatalCode, mode === 'matching' ? 'redirect_rejected' : null);
        assert.equal(hooks, 0, 'No getter/coercion/proxy trap may be invoked to classify rejection');
        assert.equal(f.calls.length, 1); assert.equal(f.transport.getState().attempts.at(-1).outcome, 'unknown');
        assert.equal(f.transport.getState().attempts.at(-1).actualMicroUsd, null);
        assert.ok(!JSON.stringify(f.transport.getRecords()).includes(KEY)); f.checkPrefix();
      });
    }
  });
  await t.test('unchanged combined price ceiling retains nonmultiple and credential-echo usage', async c => {
    for (const mode of ['none', 'direct', 'escaped']) {
      const credential = mode !== 'none';
      const f = await fixture(c, { fetch: (_, __, n) => {
        if (n === 1) return response({ object: 'response.input_tokens', input_tokens: 1 });
        let raw = JSON.stringify(envelope(credential ? JSON.stringify({ secret: KEY }) : '{"bundles":[]}',
          { ...(credential ? { id: KEY } : {}), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
        if (mode === 'escaped') { raw = raw.replaceAll(KEY, [...KEY].map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''));
          assert.equal(raw.includes(KEY), false); }
        return response(raw);
      } });
      if (credential) await assert.rejects(f.transport.planRank(f.request), code('credential_echo'));
      else assert.deepEqual(await f.transport.planRank(f.request), { bundles: [] });
      assert.equal(f.transport.getState().attempts.at(-1).actualMicroUsd, 2, 'ceil(1*0.4+1*1.6), not sum of separate ceilings');
      if (credential) { assert.equal(f.transport.getRecords().at(-1).responseBody, null);
        assert.equal(f.transport.getRecords().at(-1).requestId, null); assert.ok(!JSON.stringify(f.transport.getRecords()).includes(KEY)); } f.checkPrefix();
    }
  });
  await t.test('credential echo direct and JSON escaped never reaches records', async c => {
    for (const escaped of [false, true]) { const secret = escaped ? [...KEY].map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join('') : KEY;
      const f = await fixture(c, { fetch: () => response(`{"secret":"${secret}"}`) });
      await assert.rejects(f.transport.planRank(f.request), code('credential_echo'));
      assert.equal(f.transport.health().fatalCode, 'credential_echo'); assert.equal(f.transport.getRecords().at(-1).responseBody, null);
      assert.ok(!JSON.stringify(f.transport.getRecords()).includes(KEY)); f.checkPrefix(); }
  });
  await t.test('observable pre-reservation abort and expired deadline reserve nothing', async c => {
    for (const expired of [false, true]) { const f = await fixture(c, expired ? { manifest: { caseDeadline: performance.now() - 1 } } : {});
      if (!expired) f.controller.abort(); await assert.rejects(f.transport.planRank(f.request), code(expired ? 'deadline_exceeded' : 'cancelled'));
      assert.equal(f.calls.length, 0); assert.equal(f.transport.getState().requestCount, 1); f.checkPrefix(); }
  });
  await t.test('pre-observation abort/failure retain unsent intent and settle it', async c => {
    for (const mode of ['abort', 'throw', 'promise', 'return']) {
      const f = await fixture(c, { observe(record, controller) { if (record.phase !== 'pre') return;
        if (mode === 'abort') controller.abort(); if (mode === 'throw') throw new Error(KEY);
        if (mode === 'promise') return Promise.resolve(); if (mode === 'return') return 1; } });
      await assert.rejects(f.transport.planRank(f.request), code(mode === 'abort' ? 'cancelled' : 'record_persistence_failed'));
      const state = f.transport.getState(); assert.equal(state.requestCount, 2); assert.equal(state.reservedMicroUsd, 5030);
      assert.equal(state.attempts.at(-1).outcome, 'failed'); assert.equal(state.attempts.at(-1).actualMicroUsd, null);
      assert.equal(f.calls.length, 0); assert.equal(f.transport.getRecords().at(-1).dispatched, false); f.checkPrefix();
    }
  });
  await t.test('post-observation persistence failure settles dispatched count and prevents generation', async c => {
    const f = await fixture(c, { observe(record) { if (record.phase === 'post') throw new Error('synthetic observer failure'); } });
    await assert.rejects(f.transport.planRank(f.request), code('record_persistence_failed'));
    assert.equal(f.calls.length, 1); assert.equal(f.transport.getState().attempts.at(-1).outcome, 'succeeded');
    assert.equal(f.transport.health().fatalCode, 'record_persistence_failed'); f.checkPrefix();
    const g = await fixture(c, { observe(record) { if (record.phase === 'post' && record.kind === 'generation') throw new Error('synthetic observer failure'); } });
    await assert.rejects(g.transport.planRank(g.request), code('record_persistence_failed'));
    assert.equal(g.calls.length, 2); assert.equal(g.transport.getState().attempts.at(-1).outcome, 'succeeded');
    assert.equal(g.transport.getState().attempts.at(-1).actualMicroUsd, 72); g.checkPrefix();
  });
  await t.test('actual ledger settlement write failure is fatal, preserves pending reservation and stops HTTP', async c => {
    const originalExec = DatabaseSync.prototype.exec; let rejectWrite = false;
    const f = await fixture(c, { fetch() { rejectWrite = true; return response({ object: 'response.input_tokens', input_tokens: 100 }); } });
    try {
      DatabaseSync.prototype.exec = function(sql) { if (rejectWrite && sql === 'BEGIN IMMEDIATE') throw new Error('synthetic settlement storage failure');
        return originalExec.call(this, sql); };
      await assert.rejects(f.transport.planRank(f.request), code('ledger_failed'));
      assert.equal(f.calls.length, 1); assert.equal(f.transport.health().fatalCode, 'ledger_failed');
      assert.equal(f.transport.getRecords().at(-1).settlementPersisted, false);
    } finally { DatabaseSync.prototype.exec = originalExec; }
    const snapshot = budget.inspectEmbeddingExperimentBudgetSnapshot(f.config);
    assert.equal(snapshot.attempts.at(-1).outcome, null); assert.equal(snapshot.attempts.at(-1).reservedMicroUsd, 5000); f.checkPrefix();
  });
  await t.test('abort between count and generation uses one deadline and no second intent', async c => {
    const f = await fixture(c, { observe(record, controller) { if (record.phase === 'post') controller.abort(); } });
    await assert.rejects(f.transport.planRank(f.request), code('cancelled'));
    assert.equal(f.calls.length, 1); assert.equal(f.transport.getState().requestCount, 2); f.checkPrefix();
    const g = await fixture(c, { observe(record, controller) { if (record.phase === 'pre' && record.kind === 'generation') controller.abort(); } });
    await assert.rejects(g.transport.planRank(g.request), code('cancelled'));
    assert.equal(g.calls.length, 1); assert.equal(g.transport.getState().requestCount, 3);
    assert.equal(g.transport.getRecords().at(-1).dispatched, false); assert.equal(g.transport.getState().attempts.at(-1).outcome, 'failed'); g.checkPrefix();
  });
  await t.test('never-resolving fetch is bounded; active close/concurrent calls reject', async c => {
    const f = await fixture(c, { manifest: { caseDeadline: performance.now() + 250 }, fetch: () => new Promise(() => {}) });
    const running = f.transport.planRank(f.request);
    assert.throws(() => f.transport.close(), code('transport_busy'));
    await assert.rejects(f.transport.planRank(f.request), code('transport_busy'));
    await assert.rejects(running, code('deadline_exceeded'));
    assert.equal(f.transport.getState().attempts.at(-1).outcome, 'unknown'); assert.equal(f.transport.health().fatalCode, null); f.checkPrefix();
  });
  await t.test('late fetch body and never-resolving stream are canceled after external abort', async c => {
    let release, bodyCanceled = false;
    const f = await fixture(c, { fetch: () => new Promise(resolve => { release = resolve; }) });
    const running = f.transport.planRank(f.request); f.controller.abort(); await assert.rejects(running, code('cancelled'));
    release({ body: { cancel() { bodyCanceled = true; } } }); await new Promise(resolve => setImmediate(resolve));
    assert.equal(bodyCanceled, true); assert.equal(f.transport.getState().attempts.at(-1).outcome, 'unknown'); f.checkPrefix();
    let streamCanceled = false;
    const g = await fixture(c, { fetch() { queueMicrotask(() => g.controller.abort());
      return new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { streamCanceled = true; } })); } });
    await assert.rejects(g.transport.planRank(g.request), code('cancelled')); assert.equal(streamCanceled, true); g.checkPrefix();
  });
  await t.test('synchronous fetch abort still attaches late-body and rejection handling', async c => {
    let release, canceled = false;
    const f = await fixture(c, { fetch() { f.controller.abort(); return new Promise(resolve => { release = resolve; }); } });
    await assert.rejects(f.transport.planRank(f.request), code('cancelled'));
    release({ body: { cancel() { canceled = true; } } }); await new Promise(resolve => setImmediate(resolve));
    assert.equal(canceled, true); assert.equal(f.transport.getRecords().at(-1).dispatched, true); f.checkPrefix();
    const g = await fixture(c, { fetch() { g.controller.abort(); return Promise.reject(new Error('synthetic late network rejection')); } });
    await assert.rejects(g.transport.planRank(g.request), code('cancelled')); await new Promise(resolve => setImmediate(resolve)); g.checkPrefix();
    let readCanceled = false;
    const h = await fixture(c, { fetch() { return { ok: true, status: 200, body: { getReader() { return {
      read() { h.controller.abort(); return Promise.resolve({ done: true }); },
      cancel() { readCanceled = true; }, releaseLock() {} }; } } }; } });
    await assert.rejects(h.transport.planRank(h.request), code('cancelled')); assert.equal(readCanceled, true); h.checkPrefix();
  });
  await t.test('raw byte bounds and excessive provider count stop later dispatch', async c => {
    for (const oversized of [false, true]) { const f = await fixture(c, { fetch: () => response(oversized ? 'x'.repeat(65537) : { object: 'response.input_tokens', input_tokens: 7025 }) });
      await assert.rejects(f.transport.planRank(f.request), code(oversized ? 'response_too_large' : 'usage_overrun'));
      assert.equal(f.calls.length, 1); assert.equal(f.transport.getState().requestCount, 2); f.checkPrefix(); }
    const g = await fixture(c, { fetch: (_, __, n) => response(n === 1 ? { object: 'response.input_tokens', input_tokens: 100 } : 'x'.repeat(262145)) });
    await assert.rejects(g.transport.planRank(g.request), code('response_too_large'));
    assert.equal(g.calls.length, 2); assert.equal(g.transport.getState().attempts.at(-1).actualMicroUsd, null); g.checkPrefix();
  });
  await t.test('request mutation and foreign ledger append are fatal before further dispatch', async c => {
    const f = await fixture(c, { observe(record) { if (record.phase === 'pre') f.request.input.query = 'Changed'; } });
    // Use a detached mutable caller to test mutation rather than a frozen-object TypeError.
    f.request = { ...structuredClone(f.p.request), signal: f.controller.signal };
    await assert.rejects(f.transport.planRank(f.request), code('request_mutated'));
    assert.equal(f.calls.length, 0); assert.equal(f.transport.getState().attempts.at(-1).outcome, 'failed'); f.checkPrefix();
    const g = await fixture(c); const foreign = budget.reopenEmbeddingExperimentBudget(g.config);
    try { foreign.reserve({ attemptId: randomUUID(), channel: 'host-completion', reservedMicroUsd: 1 });
      foreign.recordOutcome({ attemptId: foreign.getState().attempts.at(-1).attemptId, outcome: 'unknown' }); } finally { foreign.close(); }
    await assert.rejects(g.transport.planRank(g.request), code('ledger_failed'));
    assert.equal(g.calls.length, 0); assert.equal(g.transport.health().fatalCode, 'ledger_failed'); g.checkPrefix();
  });
  await t.test('checkpoint mismatch and protected/request headroom reject construction', async c => {
    const f = await fixture(c); f.transport.close();
    await assert.rejects(createSourceBundlePlanRankTransport({ ...f.args, checkpoint: { requestCount: 0, reservedMicroUsd: 0 } }), code('ledger_failed'));
    for (const config of [{ limitMicroUsd: 30010029 }, { requestCap: 2 }]) {
      await assert.rejects(fixture(c, { config }), error => ['ledger_failed', 'budget_blocked'].includes(error.code)); }
    f.checkPrefix();
  });
  await t.test('same actual owned fixture removed after success/assertion/setup failures', async c => {
    for (const mode of ['success', 'assertion', 'setup']) {
      const f = await fixture(null); const path = f.workspace.path;
      try { if (mode === 'setup') { f.transport.close(); await createSourceBundlePlanRankTransport({ ...f.args, apiKey: 'bad' }); }
        if (mode === 'assertion') assert.fail('synthetic assertion failure');
        if (mode === 'success') await f.transport.planRank(f.request);
      } catch (error) { if (mode === 'success') throw error; assert.ok(error); }
      finally { await f.workspace.cleanup(); }
      assert.equal(existsSync(path), false);
    }
  });
});
