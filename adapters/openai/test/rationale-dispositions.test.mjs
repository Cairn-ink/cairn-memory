import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createOpenAIModel } from '../index.mjs';
import { schemas, schemasFor } from '../schemas.mjs';
import { DEFAULT_MODEL } from '../profiles.mjs';
import { openMemoryCore } from '../../../core/index.mjs';
import { createExperimentBudget } from '../../../evaluation/experiment-budget/index.mjs';
import { createExperimentRequestGuard } from '../../../evaluation/experiment-budget/request-guard.mjs';
import { experimentPolicy } from '../../../evaluation/live/session.mjs';

const source = (index, excerpt, receipts = [{ index: 0, role: 'user', excerpt }]) => ({ index, receipts });
const old = (index, from, to, relation = 'supports-decision') =>
  ({ index, from, to, relation, fromReceipt: 0, toReceipt: 0, interpretationStatus: 'unverified' });
const input = () => ({ memories: [source(0, 'Team chose A.'), source(1, 'A price was lower.'),
  source(2, 'Later price changed.')], oldEdges: [old(0, 1, 0)] });
const proposal = () => ({ dispositions: [{ edge: 0, action: 'withdraw', evidence: [{ memory: 2, receipt: 0 }] }],
  additions: [{ from: 2, to: 1, relation: 'challenges-premise', fromReceipt: 0, toReceipt: 0 }] });
const request = value => ({ system: 'Synthetic disposition review.', input: value,
  maxOutputTokens: 1024, signal: new AbortController().signal });
const response = (body, value) => Response.json({ object: 'response', model: body.model, status: 'completed',
  error: null, incomplete_details: null,
  output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: typeof value === 'string' ? value : JSON.stringify(value) }] }],
  usage: { input_tokens: 120, output_tokens: 60, total_tokens: 180 } });
function fake(calls, output) {
  return async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, options, body });
    return url.endsWith('/input_tokens') ? Response.json({ object: 'response.input_tokens', input_tokens: 120 }) :
      response(body, typeof output === 'function' ? output(body) : output);
  };
}
const noHttp = () => assert.fail('invalid input must not reach HTTP');

test('DA1–3 optional method uses rationale profile, frozen two-phase transport and correlated strict schema', async () => {
  assert.equal(Object.hasOwn(schemas, 'reviewRationaleDispositions'), false);
  for (const rationaleModel of [DEFAULT_MODEL, 'gpt-5.6-luna', 'gpt-5.6-sol']) {
    const calls = [], value = proposal();
    const model = createOpenAIModel({ apiKey: 'synthetic', rationaleModel, fetchImpl: fake(calls, value) });
    assert.deepEqual(await model.reviewRationaleDispositions(request(input())), value);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(call => call.url),
      ['https://api.openai.com/v1/responses/input_tokens', 'https://api.openai.com/v1/responses']);
    const counted = calls[0].body, generated = calls[1].body;
    const { max_output_tokens, store, stream, ...same } = generated;
    assert.deepEqual(same, counted);
    assert.equal(max_output_tokens, 1024); assert.equal(store, false); assert.equal(stream, false);
    assert.equal(counted.model, rationaleModel);
    assert.deepEqual(counted.reasoning, rationaleModel === DEFAULT_MODEL ? undefined : { effort: 'none' });
    assert.equal(counted.truncation, 'disabled');
    assert.equal(counted.text.format.name, 'cairn_reviewRationaleDispositions');
    assert.equal(counted.text.format.strict, true);
    assert.deepEqual(JSON.parse(counted.input[0].content[0].text), input());
    assert.equal(JSON.stringify(counted).includes('synthetic'), false);
    assert.equal(calls[0].options.signal, calls[1].options.signal);
    const schema = counted.text.format.schema;
    assert.deepEqual(Object.keys(schema.properties), ['dispositions', 'additions']);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.dispositions.minItems, 1);
    assert.equal(schema.properties.dispositions.maxItems, 1);
    assert.deepEqual(schema.properties.dispositions.items.properties.edge.enum, [0]);
    assert.deepEqual(schema.properties.dispositions.items.properties.evidence.items.anyOf[2]
      .properties.memory.enum, [2]);
    assert.deepEqual(schema.properties.additions.items.properties.from.enum, [0, 1, 2]);
    assert.deepEqual(schema.properties.additions.items.properties.to.enum, [0, 1, 2]);
    assert.deepEqual(schema.properties.additions.items.properties.fromReceipt.enum, [0]);
    assert.equal(schema.properties.additions.maxItems, 10);
  }
});

test('DA2 input shape, correlation, unverified marker and dense arrays reject before serialization/HTTP', async () => {
  let calls = 0;
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: () => { calls++; return noHttp(); } });
  const bad = [
    x => { x.extra = true; }, x => { x.memories[0].extra = true; },
    x => { x.memories[0].receipts[0].client = 'private'; },
    x => { x.memories[1].index = 0; }, x => { x.memories[0].receipts[0].index = 1; },
    x => { x.memories[0].receipts[0].role = 'system'; },
    x => { x.oldEdges[0].interpretationStatus = 'confirmed'; },
    x => { x.oldEdges[0].fromReceipt = 1; }, x => { x.oldEdges[0].to = 3; },
    x => { x.oldEdges[0].relation = 'retired'; }, x => { x.oldEdges.push({ ...x.oldEdges[0], index: 1 }); },
    x => { x.oldEdges[0].index = 1; }, x => { x.oldEdges[0].metadata = 'private'; },
    x => { x.oldEdges[0].from = 0; x.oldEdges[0].to = 0; x.oldEdges[0].relation = 'challenges-premise'; },
    x => { x.memories.length = 7; }, x => { x.oldEdges.length = 11; },
    x => { x.memories[0].receipts = []; }, x => { x.memories[0].receipts[0].excerpt = ''; },
    x => { x.memories[0].receipts[0].excerpt = 'x'.repeat(801); },
    x => { x.memories[0].receipts[0].excerpt = '\ud800'; },
    x => { delete x.memories[0]; }, x => { x.oldEdges.length = 2; },
    x => { x.memories[0].receipts.note = 'private'; },
    x => { Object.setPrototypeOf(x.memories, { toJSON: () => [] }); },
    x => { Object.setPrototypeOf(x.oldEdges, Object.create(Array.prototype, { toJSON: { value: () => [] } })); },
    x => { Object.defineProperty(x.memories[0], 'index', { get: () => 0 }); },
    x => { Object.defineProperty(x.oldEdges[0], 'to', { get: () => 0 }); },
    x => { Object.setPrototypeOf(x.memories[0], { index: 0 }); },
  ];
  for (const mutate of bad) {
    const value = input(); mutate(value);
    await assert.rejects(model.reviewRationaleDispositions(request(value)), /invalid_openai_request/);
  }
  assert.equal(calls, 0);
  assert.deepEqual(schemasFor('reviewRationaleDispositions', { memories: [source(0, 'Only source.')], oldEdges: [] })
    .properties.dispositions.maxItems, 0);
});

test('DA2 maximum indexed input generates bounded provider schema without quadratic receipt enums', () => {
  const memories = Array.from({ length: 6 }, (_, memory) => source(memory, 'x',
    Array.from({ length: 100 }, (_, receipt) => ({ index: receipt, role: 'user', excerpt: 'x' }))));
  const oldEdges = Array.from({ length: 10 }, (_, index) => old(index, index % 6, Math.floor(index / 6)));
  const schema = schemasFor('reviewRationaleDispositions', { memories, oldEdges });
  let enums = 0, properties = 0, depth = 0;
  const walk = (value, level = 0) => {
    if (!value || typeof value !== 'object') return;
    depth = Math.max(depth, level);
    if (Array.isArray(value.enum)) enums += value.enum.length;
    if (value.properties) properties += Object.keys(value.properties).length;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'properties') for (const nested of Object.values(child)) walk(nested, level + 1);
      else if (Array.isArray(child)) for (const nested of child) walk(nested, level + 1);
      else if (child && typeof child === 'object') walk(child, level + 1);
    }
  };
  walk(schema);
  assert.ok(enums <= 1000, `${enums} enum values`);
  assert.ok(properties <= 5000, `${properties} properties`);
  assert.ok(depth <= 10, `${depth} schema levels`);
  assert.equal(schema.properties.dispositions.maxItems, 10);
  assert.equal(schema.properties.additions.maxItems, 10);
});

test('DA3 adapter returns parseable malformed output unchanged; core rejects it without repairing or storing', async t => {
  const output = { dispositions: [], additions: [] }, calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: fake(calls, () => output) });
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-da-core-')), 'store.sqlite');
  const scripted = { contextWindow: model.contextWindow, countTokens: model.countTokens,
    relate: () => ({ edges: [{ from: 1, to: 0, relation: 'supports-decision', fromReceipt: 0, toReceipt: 0 }] }) };
  const core = openMemoryCore({ path, model: scripted }); t.after(() => core.close());
  const namespace = { ownerId: 'synthetic-da', scope: 'personal', projectId: null };
  const refs = [];
  for (const [index, text] of ['Team chose A.', 'A price was lower.', 'Later price changed.'].entries()) {
    const receipts = [{ client: 'synthetic', sessionId: 'synthetic', eventId: `event-${index}`,
      role: 'user', excerpt: text }];
    if (index === 0) receipts.push({ client: 'synthetic', sessionId: 'synthetic',
      eventId: 'event-0-extra', role: 'user', excerpt: 'The choice was explicit.' });
    const admitted = core.admit({ namespace, memory: { content: text, kind: 'context' }, receipts });
    assert.equal(admitted.ok, true); refs.push({ memoryId: admitted.value.memory.id, revision: admitted.value.memory.revision });
  }
  assert.equal((await core.reviewRationale({ namespace, refs })).ok, true);
  core.close();
  const reopened = openMemoryCore({ path, model }); t.after(() => reopened.close());
  const before = reopened.getRationale({ namespace, ...refs[0] });
  const epoch = reopened.map({ namespace }).value.indexRevision;
  const result = await reopened.reviewRationaleDispositions({ namespace, refs });
  assert.equal(result.error.code, 'invalid_model_output');
  assert.deepEqual(reopened.getRationale({ namespace, ...refs[0] }), before);
  assert.equal(reopened.map({ namespace }).value.indexRevision, epoch);
  output.dispositions = [{ edge: 0, action: 'withdraw', evidence: [{ memory: 1, receipt: 1 }] }];
  assert.equal((await reopened.reviewRationaleDispositions({ namespace, refs })).error.code,
    'invalid_model_output');
  output.dispositions = [{ edge: 0, action: 'keep', evidence: [] }];
  output.additions = [{ from: 1, to: 2, relation: 'supports-decision',
    fromReceipt: 1, toReceipt: 0 }];
  assert.equal((await reopened.reviewRationaleDispositions({ namespace, refs })).error.code,
    'invalid_model_output');
  assert.deepEqual(reopened.getRationale({ namespace, ...refs[0] }), before);
  assert.equal(reopened.map({ namespace }).value.indexRevision, epoch);
  assert.equal(calls.length, 6);
  assert.deepEqual(await model.reviewRationaleDispositions(request(input())), output);
});

test('DA5 real core mixed and empty-old reviews stay ephemeral across keyless cold read', async t => {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-da-positive-')), 'store.sqlite');
  const namespace = { ownerId: 'synthetic-da-positive', scope: 'personal', projectId: null };
  const seedModel = { contextWindow: 8192, countTokens: () => 1,
    relate: () => ({ edges: [{ from: 1, to: 0, relation: 'supports-decision', fromReceipt: 0, toReceipt: 0 },
      { from: 2, to: 0, relation: 'supports-decision', fromReceipt: 0, toReceipt: 0 },
      { from: 3, to: 1, relation: 'challenges-premise', fromReceipt: 0, toReceipt: 0 }] }) };
  const seed = openMemoryCore({ path, model: seedModel });
  const refs = [];
  for (const [index, excerpt] of ['Team chose A.', 'A was cheaper.', 'A had good quality.',
    'A price changed later.'].entries()) {
    const admitted = seed.admit({ namespace, memory: { content: excerpt, kind: 'context' }, receipts: [{
      client: 'synthetic', sessionId: 'synthetic', eventId: `positive-${index}`, role: 'user', excerpt }] });
    assert.equal(admitted.ok, true); refs.push({ memoryId: admitted.value.memory.id, revision: admitted.value.memory.revision });
  }
  assert.equal((await seed.reviewRationale({ namespace, refs })).ok, true); seed.close();
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: fake(calls, body => {
    const proposed = JSON.parse(body.input[0].content[0].text);
    if (!proposed.oldEdges.length) return { dispositions: [], additions: [
      { from: 1, to: 0, relation: 'supports-decision', fromReceipt: 0, toReceipt: 0 }] };
    return { dispositions: proposed.oldEdges.map(edge => ({ edge: edge.index,
      action: edge.from === 3 ? 'withdraw' : edge.from === 2 ? 'unknown' : 'keep',
      evidence: edge.from === 3 ? [{ memory: 3, receipt: 0 }] : [] })),
    additions: [{ from: 3, to: 2, relation: 'challenges-premise', fromReceipt: 0, toReceipt: 0 }] };
  }) });
  const core = openMemoryCore({ path, model }); t.after(() => core.close());
  const before = refs.map(ref => core.get({ namespace, memoryId: ref.memoryId }));
  const graph = core.getRationale({ namespace, ...refs[0] });
  const epoch = core.map({ namespace }).value.indexRevision;
  const mixed = await core.reviewRationaleDispositions({ namespace, refs });
  assert.equal(mixed.ok, true, JSON.stringify(mixed));
  assert.deepEqual(mixed.value.dispositions.map(item => item.action).sort(), ['keep', 'unknown', 'withdraw']);
  assert.equal(mixed.value.projectedEdges.length, 3);
  assert.equal(mixed.value.unresolvedCount, 1);
  assert.equal(mixed.value.persistence, 'not-stored');
  assert.equal(mixed.value.projectedEdges.some(edge => edge.disposition === 'unknown'), true);
  assert.equal(JSON.stringify(calls).includes(refs[0].memoryId), false);
  const empty = await core.reviewRationaleDispositions({ namespace, refs: refs.slice(2) });
  assert.equal(empty.ok, true, JSON.stringify(empty));
  assert.deepEqual(empty.value.oldEdges, []);
  assert.equal(empty.value.additions.length, 1);
  assert.deepEqual(refs.map(ref => core.get({ namespace, memoryId: ref.memoryId })), before);
  assert.deepEqual(core.getRationale({ namespace, ...refs[0] }), graph);
  assert.equal(core.map({ namespace }).value.indexRevision, epoch);
  assert.equal(calls.length, 4);
  core.close();
  const cold = openMemoryCore({ path }); t.after(() => cold.close());
  assert.deepEqual(cold.getRationale({ namespace, ...refs[0] }), graph);
});

test('DA5 count-phase concurrent source mutation is caught by core freshness without retry or graph write', async t => {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-da-race-')), 'store.sqlite');
  const namespace = { ownerId: 'synthetic-da-race', scope: 'personal', projectId: null };
  let core, calls = 0;
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async (url, options) => {
    calls++;
    if (url.endsWith('/input_tokens')) {
      const changed = core.admit({ namespace, memory: { content: 'Concurrent source.', kind: 'context' },
        receipts: [{ client: 'synthetic', sessionId: 'synthetic', eventId: 'race-2',
          role: 'user', excerpt: 'Concurrent source.' }] });
      assert.equal(changed.ok, true);
      return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    }
    return response(JSON.parse(options.body), { dispositions: [], additions: [] });
  } });
  core = openMemoryCore({ path, model }); t.after(() => core.close());
  const admitted = core.admit({ namespace, memory: { content: 'Initial source.', kind: 'context' },
    receipts: [{ client: 'synthetic', sessionId: 'synthetic', eventId: 'race-1',
      role: 'user', excerpt: 'Initial source.' }] });
  assert.equal(admitted.ok, true);
  const ref = { memoryId: admitted.value.memory.id, revision: admitted.value.memory.revision };
  const result = await core.reviewRationaleDispositions({ namespace, refs: [ref] });
  assert.equal(result.error.code, 'revision_conflict');
  assert.equal(calls, 2);
  assert.equal(core.getRationale({ namespace, ...ref }).value.edges.length, 0);
});

test('DA4 existing paid guard refuses new method before reservation or transport', async () => {
  const directory = join(mkdtempSync(join(tmpdir(), 'cairn-da-guard-')), 'ledger');
  const ledger = { directory, runId: randomUUID(), limitMicroUsd: 1000000, requestCap: 20 };
  createExperimentBudget(ledger).close();
  const guard = createExperimentRequestGuard({ ledger, policy: experimentPolicy(), fetchImpl: noHttp });
  const calls = [];
  await createOpenAIModel({ apiKey: 'synthetic', fetchImpl: fake(calls, proposal()) })
    .reviewRationaleDispositions(request(input()));
  try {
    for (const call of calls) {
      await assert.rejects(guard.cairnFetch(call.url, call.options), { code: 'unsupported_request' });
      assert.equal(guard.getState().requestCount, 0);
    }
  } finally { guard.close(); }
});

test('DA1/DA5 cancellation, count bounds and malformed framing never retry', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async () => {
    calls++; return Response.json({ object: 'response.input_tokens', input_tokens: 7025 });
  } });
  await assert.rejects(model.reviewRationaleDispositions({ ...request(input()), signal: controller.signal }),
    { name: 'AbortError' });
  assert.equal(calls, 0);
  await assert.rejects(model.reviewRationaleDispositions(request(input())), { code: 'context_budget_exceeded' });
  assert.equal(calls, 1);
  const bad = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async (url, options) => {
    calls++; return url.endsWith('/input_tokens') ?
      Response.json({ object: 'response.input_tokens', input_tokens: 100 }) : response(JSON.parse(options.body), '{');
  } });
  await assert.rejects(bad.reviewRationaleDispositions(request(input())), { code: 'invalid_model_output' });
  assert.equal(calls, 3);
});
