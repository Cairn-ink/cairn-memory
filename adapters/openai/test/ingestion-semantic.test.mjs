import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createExperimentBudget, inspectExperimentBudgetForEmbeddingUpgrade, upgradeExperimentBudgetForEmbeddings,
  inspectEmbeddingExperimentBudgetSnapshot, reopenEmbeddingExperimentBudget } from '../../../evaluation/experiment-budget/index.mjs';
import { createIngestionSemanticTransport, combinedBodies, probeLimits } from '../../../evaluation/ingestion-semantic/transport.mjs';
import { runIngestionSemanticProbe } from '../../../evaluation/ingestion-semantic/runner.mjs';
import { prepareCombined } from '../../../evaluation/ingestion-design/combined.mjs';
import { fixtures as designFixtures } from '../../../evaluation/ingestion-design/fixtures.mjs';
import { scriptedExtraction, scriptedCombined } from '../../../evaluation/ingestion-design/oracle.mjs';
import { wireFor } from '../../../evaluation/ingestion-design/report.mjs';
import { snapshotQualificationTextCatalog } from '../../../core/qualification-text-catalog.mjs';
import { fixtures as semanticFixtures, fixtureSha256 } from '../../../evaluation/ingestion-semantic/fixtures.mjs';

const key = 'synthetic-provider-key-never-persist';
const source = designFixtures.find(f => f.id === 'short-fact');
const deepFreeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(deepFreeze); Object.freeze(v); } return v; };
const code = expected => error => error?.code === expected;
function ledger(t, overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'cairn-ingestion-semantic-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const configuration = { directory: path.join(root, 'ledger'), runId: randomUUID(),
    limitMicroUsd: 200_000_000, requestCap: 420_000, ...overrides };
  createExperimentBudget(configuration).close();
  const old = inspectExperimentBudgetForEmbeddingUpgrade(configuration);
  upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: { requestCount: old.requestCount,
    reservedMicroUsd: old.reservedMicroUsd }, expectedHistorySha256: old.historySha256 });
  const initial = inspectEmbeddingExperimentBudgetSnapshot(configuration);
  return { configuration, checkpoint: { requestCount: initial.requestCount, reservedMicroUsd: initial.reservedMicroUsd },
    historySha256: initial.historySha256 };
}
function transport(t, f, fetchImpl, extra = {}) {
  const result = createIngestionSemanticTransport({ ...f, apiKey: key, fetchImpl, ...extra });
  t.after(() => result.close()); return result;
}
function envelope(output, usage = { input_tokens: 120, output_tokens: 80, total_tokens: 200 }) {
  return { object: 'response', model: 'gpt-4.1-mini-2025-04-14', status: 'completed', error: null,
    incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(output) }] }], usage };
}
async function beginCombined(g, fixture = source) {
  g.beginArm({ id: fixture.id, repetition: 0, name: 'combined', input: fixture.input });
  await g.prepareMethod('evaluation_combined_v1');
  return combinedBodies(prepareCombined(fixture.input));
}
const options = body => ({ method: 'POST', redirect: 'error', body, signal: new AbortController().signal });
const countUrl = 'https://api.openai.com/v1/responses/input_tokens';
const generationUrl = 'https://api.openai.com/v1/responses';
function twelve(medium = false) {
  return deepFreeze(Array.from({ length: 12 }, (_, i) => ({ id: `new-synthetic-${i}`,
    input: structuredClone((medium && i === 0 ? designFixtures.find(f => f.id === 'five-multi-source-medium') : source).input) })));
}

test('real core paired arms use exact serializers, both repetitions and alternate order; no evaluator in runner', async t => {
  const frozen = twelve(true), f = ledger(t), callbacks = []; let active, calls = 0;
  const g = transport(t, f, async (url, o) => {
    calls += 1;
    assert.equal(o.redirect, 'error'); assert.equal(o.headers.Authorization, `Bearer ${key}`);
    const p = JSON.parse(o.body), input = JSON.parse(p.input[0].content[0].text);
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    const fixture = active.id === 'new-synthetic-0' ? designFixtures.find(f => f.id === 'five-multi-source-medium') : source;
    const expanded = input.inputMode ? snapshotQualificationTextCatalog(input).expanded : input;
    const output = p.text.format.name === 'cairn_extract' ? scriptedExtraction(fixture)
      : p.text.format.name === 'cairn_qualifyCandidates' ? wireFor(fixture, expanded)
        : scriptedCombined(fixture, prepareCombined(frozen.find(x => x.id === active.id).input));
    return Response.json(envelope(output));
  }, { onRecord: r => { active = r; callbacks.push(r); } });
  const result = await runIngestionSemanticProbe({ fixtures: frozen, transport: g });
  assert.equal(result.attempts.length, 48);
  assert.equal(result.attemptDenominatorPerArm, 24);
  assert.deepEqual(result.attempts.slice(0, 4).map(a => a.arm), ['baseline', 'combined', 'combined', 'baseline']);
  assert.deepEqual(result.attempts.slice(24, 26).map(a => a.arm), ['combined', 'baseline']);
  for (const row of result.attempts) {
    if (row.id === 'new-synthetic-0' && row.arm === 'combined') {
      // This frozen design case deliberately needs baseline partitioning and
      // does not fit the unchanged combined ceiling. Retain its failed attempt.
      assert.equal(row.status, 'failed'); assert.equal(row.reason, 'context_budget_exceeded'); assert.equal(row.records.length, 0);
    } else assert.equal(row.status, 'completed', JSON.stringify({ id: row.id, arm: row.arm, reason: row.reason }));
  }
  const partitioned = result.attempts.find(a => a.id === 'new-synthetic-0' && a.arm === 'baseline');
  assert.equal(partitioned.records.filter(r => r.endpoint === 'responses' && r.method === 'qualifyCandidates').length, 5);
  assert.equal(partitioned.compiledItems.length, 5);
  assert.equal(calls, result.records.length); assert.equal(callbacks.length, calls * 2);
  assert.ok(!JSON.stringify(result).includes(key));
  assert.equal(result.finalBudget.reservedMicroUsd, calls * 4448);
  assert.ok(result.records.filter(r => r.endpoint === 'responses').every(r => r.actualMicroUsd === 176));
  assert.ok(result.records.filter(r => r.endpoint.endsWith('input_tokens')).every(r => r.actualMicroUsd === null));
});

test('exact derived combined schema, method lifecycle, redirects and count/generation body mutation denied before dispatch', async t => {
  for (const mutation of ['schema', 'instructions', 'source', 'model', 'tools', 'endpoint', 'redirect', 'method']) {
    const f = ledger(t); let dispatched = 0;
    const g = transport(t, f, async () => { dispatched += 1; return Response.json({}); });
    const bodies = await beginCombined(g), o = options(bodies.count), body = JSON.parse(o.body);
    let url = countUrl;
    if (mutation === 'schema') body.text.format.schema.properties.items.maxItems = 99;
    if (mutation === 'instructions') body.instructions += ' rogue';
    if (mutation === 'source') body.input[0].content[0].text = '{"sources":[]}';
    if (mutation === 'model') body.model = 'gpt-5';
    if (mutation === 'tools') body.tools = [];
    if (mutation === 'endpoint') url = 'https://attacker.invalid/v1/responses/input_tokens';
    if (mutation === 'redirect') o.redirect = 'follow';
    if (mutation === 'method') o.method = 'GET';
    o.body = JSON.stringify(body);
    await assert.rejects(g.fetch(url, o), code('probe_request_denied'));
    assert.equal(dispatched, 0); assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.configuration).requestCount, 0);
  }
  const f = ledger(t), g = transport(t, f, async () => Response.json({}));
  g.beginArm({ id: source.id, repetition: 0, name: 'baseline', input: source.input });
  await assert.rejects(g.prepareMethod('classify', {}), code('probe_method_denied'));
});

test('failed count cannot authorize generation, no count replay and one generation per successful count', async t => {
  for (const bad of [{ object: 'wrong', input_tokens: 3 }, { object: 'response.input_tokens', input_tokens: 7025 }]) {
    const f = ledger(t); let calls = 0;
    const g = transport(t, f, async () => { calls += 1; return Response.json(bad); });
    const b = await beginCombined(g);
    await g.fetch(countUrl, options(b.count));
    await assert.rejects(g.fetch(generationUrl, options(b.generation)), code('probe_lifecycle'));
    assert.equal(calls, 1);
  }
  const f = ledger(t); let calls = 0;
  const g = transport(t, f, async url => { calls += 1;
    return Response.json(url.endsWith('/input_tokens') ? { object: 'response.input_tokens', input_tokens: 120 } : envelope({ items: [] })); });
  const b = await beginCombined(g);
  await g.fetch(countUrl, options(b.count)); await g.fetch(generationUrl, options(b.generation));
  await assert.rejects(g.fetch(generationUrl, options(b.generation)), code('probe_lifecycle'));
  assert.equal(calls, 2);
});

test('budget, initial checkpoint, pending row and foreign ledger append refuse before HTTP', async t => {
  const f = ledger(t, { limitMicroUsd: 1 }), g = transport(t, f, async () => assert.fail('dispatch forbidden'));
  const b = await beginCombined(g);
  await assert.rejects(g.fetch(countUrl, options(b.count)));
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.configuration).requestCount, 0);
  const fresh = ledger(t);
  assert.throws(() => createIngestionSemanticTransport({ ...fresh, apiKey: key,
    checkpoint: { requestCount: 1, reservedMicroUsd: 0 }, fetchImpl: () => assert.fail('dispatch forbidden') }));
  const pending = ledger(t), h = reopenEmbeddingExperimentBudget(pending.configuration);
  h.reserve({ attemptId: randomUUID(), channel: 'cairn-count', reservedMicroUsd: 4448 }); h.close();
  assert.throws(() => createIngestionSemanticTransport({ ...pending, apiKey: key }), code('budget_blocked'));
  const foreign = ledger(t), guard = transport(t, foreign, () => assert.fail('dispatch forbidden'));
  const body = await beginCombined(guard), other = reopenEmbeddingExperimentBudget(foreign.configuration), id = randomUUID();
  other.reserve({ attemptId: id, channel: 'host-completion', reservedMicroUsd: 1 });
  other.recordOutcome({ attemptId: id, outcome: 'unknown' }); other.close();
  await assert.rejects(guard.fetch(countUrl, options(body.count)), code('invalid_ledger'));
});

test('network/auth/accounting anomaly survives core error laundering and stops the entire runner', async t => {
  for (const mode of ['network', 'auth', 'overrun', 'persistence']) {
    const f = ledger(t); let calls = 0;
    const g = transport(t, f, async url => {
      calls += 1;
      if (mode === 'network') throw new Error('untrusted provider secret');
      if (mode === 'auth') return Response.json({ error: 'auth' }, { status: 401 });
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
      return Response.json(envelope(scriptedExtraction(source), { input_tokens: 7024, output_tokens: 1025, total_tokens: 8049 }));
    }, mode === 'persistence' ? { onRecord: () => { throw new Error('disk failure'); } } : {});
    await assert.rejects(runIngestionSemanticProbe({ fixtures: twelve(), transport: g }));
    assert.ok(calls <= 2); assert.ok(g.records().length <= 2);
    assert.ok(inspectEmbeddingExperimentBudgetSnapshot(f.configuration).attempts.every(a => a.outcome !== null));
  }
});

test('ordinary malformed output retained in fixed denominator without retries or partial items', async t => {
  const f = ledger(t); let active;
  const g = transport(t, f, async (url, o) => {
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    const p = JSON.parse(o.body);
    if (active.id === 'new-synthetic-0') return new Response('{"unfinished":');
    const input = JSON.parse(p.input[0].content[0].text);
    return Response.json(envelope(p.text.format.name === 'cairn_extract' ? scriptedExtraction(source)
      : p.text.format.name === 'cairn_qualifyCandidates' ? wireFor(source, input)
        : scriptedCombined(source, prepareCombined(source.input))));
  }, { onRecord: r => { active = r; } });
  const result = await runIngestionSemanticProbe({ fixtures: twelve(), transport: g });
  const failed = result.attempts.filter(a => a.id === 'new-synthetic-0');
  assert.equal(result.attempts.length, 48); assert.equal(failed.length, 4);
  assert.ok(failed.every(a => a.status === 'failed' && a.compiledItems.length === 0 && a.records.length === 2));
  assert.ok(failed.every(a => a.records[1].responseBody === '{"unfinished":'));
});

test('external abort defeats injected hung fetch, settles unknown and retains bounded partial body on hung reader', async t => {
  for (const stream of [false, true]) {
    const f = ledger(t);
    const g = transport(t, f, async () => stream ? new Response(new ReadableStream({ start(c) {
      c.enqueue(new TextEncoder().encode('{"partial":')); } })) : new Promise(() => {}));
    const b = await beginCombined(g), o = options(b.count), c = new AbortController(); o.signal = c.signal;
    const timer = setTimeout(() => c.abort(), 10);
    try { await assert.rejects(g.fetch(countUrl, o), e => e.name === 'AbortError'); } finally { clearTimeout(timer); }
    g.assertHealthy();
    assert.equal(g.records()[0].outcome, 'unknown'); assert.equal(g.records()[0].failure, 'model_timeout');
    if (stream) assert.equal(g.records()[0].responseBody, '{"partial":');
    assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.configuration).attempts[0].outcome, 'unknown');
  }
});

test('provider credential echo is fatal and never reaches caller or retained raw records', async t => {
  for (const escaped of [false, true]) {
    const f = ledger(t), raw = escaped ? `{"echoed":"\\u0073${key.slice(1)}"}` : JSON.stringify({ echoed: key });
    const g = transport(t, f, async () => new Response(raw));
    const b = await beginCombined(g);
    await assert.rejects(g.fetch(countUrl, options(b.count)), code('probe_credential_echo'));
    assert.ok(!JSON.stringify(g.records()).includes(key));
    assert.ok(g.records()[0].responseBody.includes('[REDACTED]'));
  }
});

test('concurrent dispatch and repeated arm identities are fenced, bounded oversized bodies retained', async t => {
  const f = ledger(t); let release, calls = 0;
  const g = transport(t, f, async () => { calls += 1; return new Promise(resolve => { release = resolve; }); });
  const b = await beginCombined(g), first = g.fetch(countUrl, options(b.count));
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(g.fetch(countUrl, options(b.count)), code('probe_lifecycle'));
  release(Response.json({ object: 'response.input_tokens', input_tokens: 120 }));
  await assert.rejects(first, code('probe_lifecycle')); assert.equal(calls, 1);
  const another = ledger(t), guard = transport(t, another, async () => new Response('x'.repeat(65537)));
  const body = await beginCombined(guard);
  await assert.rejects(guard.fetch(countUrl, options(body.count)), code('response_body_bounds'));
  assert.equal(guard.records()[0].responseBody.length, 65536);
  assert.equal(guard.records()[0].responseTruncated, true);
  guard.assertHealthy(); guard.endArm();
  assert.throws(() => guard.beginArm({ id: source.id, repetition: 0, name: 'combined', input: source.input }), code('probe_lifecycle'));
});

test('local unfit input never reserves or dispatches; read chunks are owned before a later reader mutation', async t => {
  const f = ledger(t), g = transport(t, f, () => assert.fail('local refusal must not dispatch'));
  g.beginArm({ id: 'unfit', repetition: 0, name: 'combined', input: designFixtures.find(f => f.id === 'unfit').input });
  await assert.rejects(g.prepareMethod('evaluation_combined_v1'), code('context_budget_exceeded'));
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.configuration).requestCount, 0);
  const another = ledger(t), bytes = new TextEncoder().encode('{"object":"response.input_tokens","input_tokens":120}');
  const guard = transport(t, another, async () => {
    let delivered = false;
    const response = new Response('');
    Object.defineProperty(response, 'body', { value: { getReader: () => ({
      async read() {
        if (!delivered) { delivered = true; return { done: false, value: bytes }; }
        bytes.fill(120); return { done: true };
      }, cancel: () => Promise.resolve(),
    }) } });
    return response;
  });
  const b = await beginCombined(guard), counted = await guard.fetch(countUrl, options(b.count));
  assert.equal((await counted.json()).input_tokens, 120);
  assert.equal(JSON.parse(guard.records()[0].responseBody).input_tokens, 120);
});

test('abort from persistence callback or its queued microtask prevents even an abort-ignoring fetch', async t => {
  for (const queued of [false, true]) {
    const f = ledger(t), c = new AbortController(); let calls = 0;
    const g = transport(t, f, async () => { calls += 1; return Response.json({ object: 'response.input_tokens', input_tokens: 120 }); },
      { onRecord: r => { if (r.latencyMs === undefined) { if (queued) queueMicrotask(() => c.abort()); else c.abort(); } } });
    const b = await beginCombined(g), o = options(b.count); o.signal = c.signal;
    await assert.rejects(g.fetch(countUrl, o), e => e.name === 'AbortError');
    assert.equal(calls, 0); assert.equal(g.records()[0].outcome, 'unknown');
    assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.configuration).attempts[0].outcome, 'unknown');
  }
});

test('constants retain approved ceilings and modules have no launch side effects', () => {
  assert.equal(probeLimits.reservationMicroUsd, 4448); assert.equal(probeLimits.httpRequests, 576);
  assert.equal(probeLimits.callMs, 30_000); assert.equal(probeLimits.armMs, 180_000);
  assert.ok(probeLimits.httpRequests * probeLimits.reservationMicroUsd < probeLimits.reservedMicroUsd);
});

test('published paid artifact preserves frozen inputs, blind joins, fixed scores and resource accounting offline', () => {
  const read = filename => readFileSync(new URL('../../../' + filename, import.meta.url), 'utf8');
  const sha = text => createHash('sha256').update(text).digest('hex');
  const result = JSON.parse(read('evaluation/ingestion-semantic/results.json'));
  const dimensions = ['supportedMeaning', 'uncertaintyPreserved', 'attributionPreserved',
    'scopeTimePreserved', 'usefulCoverage', 'evidenceEntails'];
  const canonicalHash = document => sha(JSON.stringify(document, null, 2) + '\n');
  assert.equal(result.provenance.fixtureSha256, fixtureSha256);
  assert.equal(fixtureSha256, 'a1dd2918160f5575a8c77e1a495add5a322dd83ab72c9b4a8ceac805b36e9478');
  assert.equal(sha(read('evaluation/ingestion-semantic/fixtures.mjs')),
    '1200b0054ed90784a971f3d8068558cda76a21f0ef38885898c536c50657dcc4');
  assert.equal(sha(read('evaluation/ingestion-semantic/rubric.json')),
    'eae9ac9e5f8fd76bca476f59d741447023cb005bb7bb74ee354e070cf6737512');
  for (const filename of ['evaluation/ingestion-semantic/fixtures.mjs', 'evaluation/ingestion-semantic/rubric.json']) {
    assert.equal(sha(read(filename)), result.provenance.frozenFiles[filename], filename);
  }
  const originalDocuments = { blind: result.blind, 'blind-mapping': result.mapping,
    'rater-a': result.raterA, 'rater-b': result.raterB, adjudication: result.adjudication };
  for (const [name, document] of Object.entries(originalDocuments)) {
    assert.equal(canonicalHash(document), result.provenance.originalInputSha256[name], name);
  }
  assert.equal(canonicalHash(result.adjudication),
    '1e215c4948e05ab07c58c53ee5be146d645e20376e3bb5c762f64ec76aae05b9');
  assert.equal(result.adjudication.inputs.blindSha256, canonicalHash(result.blind));
  assert.equal(result.adjudication.inputs.raterASha256, canonicalHash(result.raterA));
  assert.equal(result.adjudication.inputs.raterBSha256, canonicalHash(result.raterB));
  assert.equal(result.fixtureCount, 12); assert.equal(result.repetitions, 2);
  assert.equal(result.attemptDenominatorPerArm, 24); assert.equal(result.attempts.length, 48);
  const tuple = row => JSON.stringify([row.id, row.arm, row.repetition]);
  assert.equal(new Set(result.attempts.map(tuple)).size, 48);
  assert.equal(result.mapping.mapping.length, 48);
  const mapping = new Map(result.mapping.mapping.map(row => [row.id, row]));
  assert.equal(mapping.size, 48);
  const blind = new Map(result.blind.rows.map(row => [row.id, row]));
  assert.equal(blind.size, 48);
  const ratings = [result.raterA.ratings, result.raterB.ratings, result.adjudication.ratings];
  for (const rows of ratings) {
    assert.equal(rows.length, 48); assert.equal(new Set(rows.map(r => r.id)).size, 48);
    assert.deepEqual(rows.map(r => r.id).sort(), [...mapping.keys()].sort());
  }
  for (const row of result.attempts) {
    assert.deepEqual(Object.keys(row).sort(), ['id', 'repetition', 'arm', 'blindId', 'status', 'reason',
      'failureStage', 'compiledCards', 'instrumentedArmLatencyMs', 'httpMetrics'].sort());
    const identity = mapping.get(row.blindId), projection = blind.get(row.blindId);
    assert.deepEqual([identity.scenarioId, identity.arm, identity.repetition], [row.id, row.arm, row.repetition]);
    assert.equal(projection.scenarioId, row.id);
    assert.equal(projection.mechanicalCompletion, row.status === 'completed');
    const fixture = semanticFixtures.find(f => f.id === row.id);
    assert.deepEqual(projection.sources, fixture.input.messages.map((m, sourceIndex) => ({ sourceIndex, role: m.role, text: m.content })));
    assert.deepEqual(row.compiledCards.map(({ confidence, ...card }) => card), projection.cards);
    for (const card of row.compiledCards) {
      assert.ok(Number.isFinite(card.confidence) && card.confidence >= 0 && card.confidence <= 1);
      for (const receipt of card.receipts) {
        assert.deepEqual(Object.keys(receipt).sort(), ['sourceIndex', 'role', 'excerpt'].sort());
        const source = projection.sources[receipt.sourceIndex];
        assert.equal(receipt.role, source.role); assert.equal(receipt.excerpt, source.text);
      }
      for (const anchor of card.qualification.anchors) {
        assert.equal(card.receipts[anchor.receiptIndex].excerpt.slice(anchor.start, anchor.end), anchor.text);
      }
    }
    for (const set of ratings) {
      const rating = set.find(r => r.id === row.blindId);
      for (const d of dimensions) assert.ok(row.status === 'completed' ? typeof rating[d] === 'boolean' : rating[d] === null);
      assert.equal(rating.fullSuccess, row.status === 'completed' && dimensions.every(d => rating[d] === true));
    }
    if (row.status !== 'completed') assert.deepEqual(row.compiledCards, []);
    assert.ok(Number.isFinite(row.instrumentedArmLatencyMs) && row.instrumentedArmLatencyMs > 0);
    for (const metric of row.httpMetrics) {
      assert.deepEqual(Object.keys(metric).sort(), ['method', 'endpoint', 'httpStatus', 'outcome', 'failure',
        'usage', 'reservedMicroUsd', 'actualMicroUsd', 'latencyMs'].sort());
      assert.equal(metric.reservedMicroUsd, 4448);
      assert.equal(metric.httpStatus, 200); assert.equal(metric.outcome, 'succeeded');
      assert.equal(metric.failure, null); assert.ok(Number.isFinite(metric.latencyMs) && metric.latencyMs >= 0);
      assert.ok((row.arm === 'combined' ? ['evaluation_combined_v1'] : ['extract', 'qualifyCandidates']).includes(metric.method));
      if (metric.endpoint === 'responses/input_tokens') {
        assert.equal(metric.usage, null); assert.equal(metric.actualMicroUsd, null);
      } else {
        assert.equal(metric.endpoint, 'responses');
        const u = metric.usage;
        assert.ok(Number.isSafeInteger(u.input_tokens) && u.input_tokens >= 0 && u.input_tokens <= 7024);
        assert.ok(Number.isSafeInteger(u.output_tokens) && u.output_tokens >= 0 && u.output_tokens <= 1024);
        assert.equal(u.total_tokens, u.input_tokens + u.output_tokens);
        assert.equal(metric.actualMicroUsd, Math.ceil((u.input_tokens * 4 + u.output_tokens * 16) / 10));
      }
    }
  }
  const scores = (selected, set) => {
    const joined = selected.map(row => set.find(r => r.id === row.blindId));
    return { denominator: selected.length, mechanicalCompletion: selected.filter(r => r.status === 'completed').length,
      fullSuccess: joined.filter(r => r.fullSuccess).length,
      dimensions: Object.fromEntries(dimensions.map(d => [d, joined.filter(r => r[d] === true).length])),
      unsupportedAssertionAttempts: joined.filter(r => r.unsupportedAssertions.length).length,
      omissionAttempts: joined.filter(r => r.omissions.length).length };
  };
  for (const [arm, expectedDimensions, expectedFull, expectedMechanical, rawA, rawB, omissions] of [
    ['baseline', [13, 13, 21, 23, 19, 13], 11, 23, 9, 11, 4],
    ['combined', [14, 17, 20, 22, 18, 14], 12, 24, 12, 15, 6],
  ]) {
    const selected = result.attempts.filter(row => row.arm === arm), aggregate = result.aggregates[arm];
    assert.equal(selected.length, 24);
    for (const fixture of semanticFixtures) {
      const caseRows = selected.filter(r => r.id === fixture.id);
      assert.equal(caseRows.length, 2); assert.deepEqual(caseRows.map(r => r.repetition).sort(), [0, 1]);
      const { unsupportedAssertionAttempts, omissionAttempts, ...caseScore } = scores(caseRows, result.adjudication.ratings);
      assert.deepEqual(result.perCase.find(r => r.id === fixture.id)[arm], caseScore);
    }
    assert.deepEqual(aggregate.strict, scores(selected, result.adjudication.ratings));
    assert.deepEqual(aggregate.rawRaterA, scores(selected, result.raterA.ratings));
    assert.deepEqual(aggregate.rawRaterB, scores(selected, result.raterB.ratings));
    assert.equal(aggregate.strict.fullSuccess, expectedFull); assert.equal(aggregate.strict.mechanicalCompletion, expectedMechanical);
    assert.deepEqual(dimensions.map(d => aggregate.strict.dimensions[d]), expectedDimensions);
    assert.equal(aggregate.rawRaterA.fullSuccess, rawA); assert.equal(aggregate.rawRaterB.fullSuccess, rawB);
    assert.equal(aggregate.strict.unsupportedAssertionAttempts, 10); assert.equal(aggregate.strict.omissionAttempts, omissions);
    const metrics = selected.flatMap(r => r.httpMetrics), times = selected.map(r => r.instrumentedArmLatencyMs).sort((a, b) => a - b);
    const resources = { httpRequests: metrics.length, generations: metrics.filter(r => r.endpoint === 'responses').length,
      inputTokens: metrics.reduce((sum, r) => sum + (r.usage?.input_tokens ?? 0), 0),
      outputTokens: metrics.reduce((sum, r) => sum + (r.usage?.output_tokens ?? 0), 0),
      knownUsageUncachedCeilingMicroUsd: metrics.reduce((sum, r) => sum + (r.actualMicroUsd ?? 0), 0),
      reservedMicroUsd: metrics.reduce((sum, r) => sum + r.reservedMicroUsd, 0),
      unknownCostCountRequests: metrics.filter(r => r.endpoint === 'responses/input_tokens' && r.actualMicroUsd === null).length,
      medianInstrumentedArmLatencyMs: (times[11] + times[12]) / 2,
      totalGuardedHttpLatencyMs: metrics.reduce((sum, r) => sum + r.latencyMs, 0) };
    assert.deepEqual(aggregate.resources, resources);
    assert.deepEqual([resources.httpRequests, resources.generations, resources.inputTokens, resources.outputTokens,
      resources.knownUsageUncachedCeilingMicroUsd, resources.reservedMicroUsd, resources.unknownCostCountRequests],
      arm === 'baseline' ? [96, 48, 57952, 5945, 32713, 427008, 48] : [48, 24, 44754, 4970, 25864, 213504, 24]);
    assert.ok(Math.abs(resources.medianInstrumentedArmLatencyMs - (arm === 'baseline' ? 5794.5835 : 3566.1748)) < 0.0001);
    assert.ok(Math.abs(resources.totalGuardedHttpLatencyMs - (arm === 'baseline' ? 101521.8172 : 64000.3657)) < 0.0001);
    const sensitive = selected.filter(r => result.adjudication.exploratorySensitivity.commitmentOnlyIds.includes(r.blindId));
    assert.ok(sensitive.every(r => !result.adjudication.ratings.find(x => x.id === r.blindId).fullSuccess));
    assert.equal(aggregate.postHocCommitmentSensitivityFullSuccess, expectedFull + sensitive.length);
    assert.equal(aggregate.postHocCommitmentSensitivityFullSuccess, 17);
  }
  assert.equal(result.perCase.length, 12); assert.equal(result.adjudication.exploratorySensitivity.commitmentOnlyIds.length, 11);
  const disagreements = result.raterA.ratings.flatMap(a => {
    const b = result.raterB.ratings.find(r => r.id === a.id), differences = dimensions.filter(d => a[d] !== b[d]);
    return differences.length ? [{ id: a.id, dimensions: differences }] : [];
  });
  assert.deepEqual(disagreements.map(r => ({ ...r, dimensions: [...r.dimensions].sort() })).sort((a, b) => a.id.localeCompare(b.id)),
    result.adjudication.disagreements.map(r => ({ ...r, dimensions: [...r.dimensions].sort() })).sort((a, b) => a.id.localeCompare(b.id)));
  assert.equal(disagreements.length, 6); assert.equal(disagreements.reduce((sum, r) => sum + r.dimensions.length, 0), 11);
  const failed = result.attempts.filter(r => r.status !== 'completed');
  assert.equal(failed.length, 1);
  assert.deepEqual([failed[0].id, failed[0].arm, failed[0].repetition, failed[0].failureStage, failed[0].reason],
    ['conditional-cap-exception', 'baseline', 1, 'qualification', 'invalid_model_output']);
  assert.deepEqual(result.failureDiagnosis.evidenceSlots, [1, 1]); assert.deepEqual(result.failureDiagnosis.pool, [1, 2]);
  const campaign = result.campaignAggregates, allMetrics = result.attempts.flatMap(r => r.httpMetrics);
  assert.equal(campaign.newReservedMicroUsd, allMetrics.reduce((sum, r) => sum + r.reservedMicroUsd, 0));
  assert.equal(campaign.newReservedMicroUsd, 640512);
  assert.equal(campaign.finalReservedMicroUsd, campaign.initialReservedMicroUsd + campaign.newReservedMicroUsd);
  assert.equal(campaign.remainingMicroUsd, campaign.limitMicroUsd - campaign.finalReservedMicroUsd);
  assert.equal(campaign.finalRequestCount, campaign.initialRequestCount + allMetrics.length);
  assert.equal(campaign.pendingAttempts, 0); assert.equal(campaign.limitMicroUsd, 200000000);
  assert.ok(result.aggregates.combined.strict.dimensions.usefulCoverage < result.aggregates.baseline.strict.dimensions.usefulCoverage);
  assert.equal(result.decision, 'do-not-adopt-combined');
  const forbidden = new Set(['requestBody', 'responseBody', 'attemptId', 'runId', 'eventId', 'sessionId',
    'Authorization', 'apiKey', 'headers']);
  const visit = value => {
    if (typeof value === 'string') assert.ok(!/\b(?:resp_|msg_)[a-z0-9]+|\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/.test(value));
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      assert.ok(!forbidden.has(key), key); visit(child);
    }
  };
  visit(result);
});
