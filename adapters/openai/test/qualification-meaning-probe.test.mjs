import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createExperimentBudget, inspectExperimentBudgetForEmbeddingUpgrade, upgradeExperimentBudgetForEmbeddings,
  inspectEmbeddingExperimentBudgetSnapshot } from '../../../evaluation/experiment-budget/index.mjs';
import { createIngestionSemanticTransport, probeLimits } from '../../../evaluation/ingestion-semantic/transport.mjs';
import { runQualificationMeaningProbe } from '../../../evaluation/qualification-meaning/runner.mjs';
import { snapshotQualificationTextCatalog } from '../../../core/qualification-text-catalog.mjs';

const key = 'meaning-probe-synthetic-credential';
const freeze = value => { if (value && typeof value === 'object') {
  Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const code = expected => error => error?.code === expected;
function twelve(partition = false) {
  return freeze(Array.from({ length: 12 }, (_, i) => ({ id: `meaning-offline-${i}`, input: {
    namespace: { ownerId: 'synthetic', scope: 'project', projectId: 'meaning-offline' },
    client: 'synthetic', sessionId: `session-${i}`, eventId: `event-${i}`,
    messages: partition && i === 0 ? Array.from({ length: 20 }, (_, m) => ({ id: `message-${m}`, role: 'user',
      content: Array.from({ length: 5 }, (_, n) => createHash('sha256').update(`meaning-offline-${m}-${n}`).digest('hex')).join('').slice(0, 300) }))
      : [{ id: `message-${i}`, role: i % 3 === 0 ? 'assistant' : 'user',
        content: i % 2 ? `我在第${i}次採樣記錄看到一隻蜻蜓。` : `At survey ${i}, I observed a dragonfly.` }],
  } })));
}
function guard(t, fetchImpl, extra = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'cairn-meaning-offline-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const configuration = { directory: path.join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 200_000_000, requestCap: 420_000 };
  createExperimentBudget(configuration).close();
  const old = inspectExperimentBudgetForEmbeddingUpgrade(configuration);
  upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: {
    requestCount: old.requestCount, reservedMicroUsd: old.reservedMicroUsd }, expectedHistorySha256: old.historySha256 });
  const initial = inspectEmbeddingExperimentBudgetSnapshot(configuration);
  const transport = createIngestionSemanticTransport({ configuration, checkpoint: {
    requestCount: initial.requestCount, reservedMicroUsd: initial.reservedMicroUsd }, historySha256: initial.historySha256,
    apiKey: key, fetchImpl, ...extra });
  t.after(() => transport.close());
  return { transport, configuration };
}
function envelope(output, usage = { input_tokens: 120, output_tokens: 80, total_tokens: 200 }) {
  return { object: 'response', model: 'gpt-4.1-mini-2025-04-14', status: 'completed', error: null,
    incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(output) }] }], usage };
}
// Plumbing outputs deliberately contain no semantic oracle or rubric. Unknown
// descriptive fields plus one source anchor exercise the real wire/compiler.
function extraction(input, partition = false) {
  return { items: Array.from({ length: partition ? 5 : 1 }, (_, i) => ({
    content: `Synthetic plumbing card ${i}`, kind: 'context', confidence: 0.5,
    sourceIndices: partition ? [i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 3] : [input.messages.length - 1],
  })) };
}
function qualification(input) {
  const expanded = input.inputMode ? snapshotQualificationTextCatalog(input).expanded : input;
  return { wireVersion: 'evidence-pool-v1', qualifications: Object.fromEntries(expanded.items.map(item => [
    `item_${item.itemIndex}`, { itemIndex: item.itemIndex, pool: [item.candidates[0].candidateIndex],
      ...Object.fromEntries(['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'].map(field => [field,
        { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null,
          evidenceSlots: field === 'subject' ? [0] : [] }])) },
  ])) };
}
function fakeSuccess(url, options) {
  if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
  const body = JSON.parse(options.body), input = JSON.parse(body.input[0].content[0].text);
  assert.ok(['cairn_extract', 'cairn_qualifyCandidates'].includes(body.text.format.name));
  return Response.json(envelope(body.text.format.name === 'cairn_extract'
    ? extraction(input, input.messages.length === 20) : qualification(input)));
}

test('fixed 24 baseline attempts use actual core, source-only exact serializer and adaptive partitions', async t => {
  const fixtures = twelve(true), saved = []; let active, calls = 0;
  const { transport } = guard(t, (url, options) => {
    calls += 1;
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    const body = JSON.parse(options.body), input = JSON.parse(body.input[0].content[0].text);
    assert.equal(body.model, 'gpt-4.1-mini-2025-04-14');
    assert.equal(body.truncation, 'disabled');
    assert.equal(body.tools, undefined);
    if (!url.endsWith('/input_tokens')) {
      assert.equal(body.store, false); assert.equal(body.stream, false); assert.equal(body.max_output_tokens, 1024);
    }
    const fixture = fixtures.find(f => f.id === active.id);
    if (body.text.format.name === 'cairn_extract') {
      assert.deepEqual(input, { messages: fixture.input.messages.map(({ role, content }, index) => ({ index, role, content })) });
    } else {
      assert.equal(body.text.format.name, 'cairn_qualifyCandidates');
      const expanded = input.inputMode ? snapshotQualificationTextCatalog(input).expanded : input;
      for (const item of expanded.items) for (const candidate of item.candidates) {
        assert.ok(fixture.input.messages.some(m => m.role === candidate.role && m.content.includes(candidate.text)));
      }
    }
    return fakeSuccess(url, options);
  }, { onRecord: record => { active = record; } });
  const result = await runQualificationMeaningProbe({ fixtures, transport, onArm: row => {
    saved.push(row); row.compiledItems.length = 0;
  } });
  assert.equal(result.attemptDenominator, 24); assert.equal(result.fixtureDenominator, 12);
  assert.equal(result.attempts.length, 24); assert.equal(saved.length, 24);
  assert.deepEqual(result.attempts.map(r => [r.id, r.repetition]), [0, 1].flatMap(rep => fixtures.map(f => [f.id, rep])));
  assert.ok(result.attempts.every(r => r.arm === 'baseline' && r.status === 'completed'));
  assert.ok(result.attempts.every(r => r.compiledItems.length > 0));
  for (const row of result.attempts.filter(r => r.id === fixtures[0].id)) {
    assert.equal(row.compiledItems.length, 5);
    assert.equal(row.records.filter(r => r.endpoint === 'responses' && r.method === 'qualifyCandidates').length, 5);
  }
  assert.equal(calls, 112); assert.equal(result.records.length, calls);
  assert.ok(calls <= 288);
  assert.equal(result.finalBudget.reservedMicroUsd, calls * 4448);
  assert.ok(result.records.filter(r => r.endpoint === 'responses').every(r => r.actualMicroUsd === 176));
  assert.ok(result.records.filter(r => r.endpoint.endsWith('input_tokens')).every(r => r.actualMicroUsd === null));
  assert.ok(!JSON.stringify(result).includes(key));
  assert.equal(probeLimits.httpRequests, 576); assert.equal(probeLimits.reservedMicroUsd, 3_000_000);
  assert.deepEqual([probeLimits.callMs, probeLimits.armMs, probeLimits.probeMs], [30_000, 180_000, 5_400_000]);
});

test('bad count and generation failures retain denominator, original outputs, and never retry', async t => {
  for (const mode of ['bad-count', 'count-http', 'malformed', 'generation-http', 'refusal', 'empty', 'bad-qualification']) {
    const fixtures = twelve(), saved = []; let active;
    const { transport } = guard(t, (url, options) => {
      if (active.id !== fixtures[0].id) return fakeSuccess(url, options);
      const counting = url.endsWith('/input_tokens'), body = JSON.parse(options.body);
      if (mode === 'bad-count' && counting) return Response.json({ object: 'wrong', input_tokens: 120 });
      if (mode === 'count-http' && counting) return Response.json({ error: 'unavailable' }, { status: 503 });
      if (!counting) {
        if (mode === 'malformed') return new Response('{"unfinished":');
        if (mode === 'generation-http') return Response.json({ error: 'unavailable' }, { status: 500 });
        if (mode === 'refusal') return Response.json({ ...envelope({}), output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'refusal', refusal: 'synthetic refusal' }] }] });
        if (mode === 'empty') return Response.json(envelope({ items: [] }));
        if (mode === 'bad-qualification' && body.text.format.name === 'cairn_qualifyCandidates') return Response.json(envelope({}));
      }
      return fakeSuccess(url, options);
    }, { onRecord: r => { active = r; } });
    const result = await runQualificationMeaningProbe({ fixtures, transport, onArm: r => { saved.push(r); } });
    assert.equal(result.attempts.length, 24); assert.equal(result.attemptDenominator, 24);
    const affected = result.attempts.filter(r => r.id === fixtures[0].id);
    assert.equal(affected.length, 2);
    for (const row of affected) {
      assert.equal(row.compiledItems.length, 0);
      assert.equal(row.status, mode === 'empty' ? 'completed' : 'failed');
      assert.equal(row.records.length, ['bad-count', 'count-http'].includes(mode) ? 1 : mode === 'bad-qualification' ? 4 : 2);
      assert.equal(row.failureStage, mode === 'empty' ? null : mode === 'bad-qualification' ? 'qualification' : 'extract');
      if (mode === 'malformed') assert.equal(row.records[1].responseBody, '{"unfinished":');
    }
    assert.equal(saved.length, 24);
  }
});

test('unfrozen, invalid later fixture, duplicate, sparse, accessor and evaluator payload fail before any dispatch', async () => {
  const base = twelve();
  const invalidLater = structuredClone(base); invalidLater[11].input.messages[0].role = 'system';
  const duplicate = structuredClone(base); duplicate[11].id = duplicate[0].id;
  const sparse = structuredClone(base); delete sparse[11];
  const oracle = structuredClone(base); oracle[11].expected = { commitment: 'adopted' };
  const truncated = structuredClone(base); truncated[11].input.messages[0].content = 'x'.repeat(801);
  const accessor = structuredClone(base); Object.defineProperty(accessor[11], 'input', { enumerable: true,
    get() { assert.fail('accessor must not execute'); } });
  Object.freeze(accessor[11]); Object.freeze(accessor);
  for (const fixtures of [structuredClone(base), freeze(invalidLater), freeze(duplicate), freeze(sparse), freeze(oracle), freeze(truncated), accessor]) {
    await assert.rejects(runQualificationMeaningProbe({ fixtures, transport: {
      assertHealthy: () => assert.fail('guard must not be entered'), fetch: () => assert.fail('dispatch forbidden'),
    } }), code('invalid_probe_fixtures'));
  }
});

test('fatal auth, network, accounting, authority and record persistence halt after retaining started row', async t => {
  for (const mode of ['auth', 'network', 'overrun', 'authority', 'persistence']) {
    const saved = []; let calls = 0;
    const { transport, configuration } = guard(t, (url, options) => {
      calls += 1;
      if (mode === 'auth') return Response.json({ error: 'unauthorized' }, { status: 401 });
      if (mode === 'network') throw new Error('untrusted network detail');
      if (mode === 'authority') return Response.json({}, { status: 302 });
      if (mode === 'overrun' && !url.endsWith('/input_tokens')) return Response.json(envelope({},
        { input_tokens: 7024, output_tokens: 1025, total_tokens: 8049 }));
      return fakeSuccess(url, options);
    }, mode === 'persistence' ? { onRecord: () => { throw new Error('disk failure'); } } : {});
    await assert.rejects(runQualificationMeaningProbe({ fixtures: twelve(), transport, onArm: row => { saved.push(row); } }),
      code(mode === 'persistence' ? 'probe_persistence_failure' : mode === 'overrun' ? 'probe_usage_overrun' : 'probe_transport_failure'));
    assert.equal(saved.length, 1); assert.equal(saved[0].status, 'failed'); assert.equal(saved[0].compiledItems.length, 0);
    assert.ok(calls <= 2); assert.ok(saved[0].records.length >= 1);
    assert.ok(inspectEmbeddingExperimentBudgetSnapshot(configuration).attempts.every(a => a.outcome !== null));
  }
});

test('attempt persistence failure is fatal without starting a later attempt', async t => {
  let calls = 0, saves = 0;
  const { transport } = guard(t, (url, options) => { calls += 1; return fakeSuccess(url, options); });
  await assert.rejects(runQualificationMeaningProbe({ fixtures: twelve(), transport,
    onArm: () => { saves += 1; throw new Error('disk failure'); } }), code('probe_persistence_failure'));
  assert.equal(saves, 1); assert.equal(calls, 4);
});

test('runner imports no fixture, rubric, oracle or combined pipeline and reads no provider environment', () => {
  const source = readFileSync(new URL('../../../evaluation/qualification-meaning/runner.mjs', import.meta.url), 'utf8');
  assert.ok(!/from\s+['"][^'"]*(?:fixtures|rubric|oracle|ingestion-design|combined)/.test(source));
  assert.ok(!/process\.env|evaluation_combined_v1|prepareCombined|compileCombined/.test(source));
});
