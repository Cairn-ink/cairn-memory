import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { DEFAULT_MODEL } from '../../../adapters/openai/profiles.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createExperimentBudget } from '../../experiment-budget/index.mjs';
import {
  authorizeBenchmarkExtension,
  createBenchmarkExperimentRequestGuard,
  createExperimentRequestGuard,
} from '../../experiment-budget/request-guard.mjs';
import { experimentPolicy } from '../session.mjs';

// Offline-only diagnostic: synthetic SQLite stores, synthetic key text, fake HTTP,
// and a fresh temporary ledger. It never reads an environment credential.
const namespace = { ownerId: 'classification-count-diagnostic', scope: 'project', projectId: 'synthetic' };
const urls = {
  count: 'https://api.openai.com/v1/responses/input_tokens',
  generation: 'https://api.openai.com/v1/responses',
};
const syntheticKey = 'synthetic-offline-key';
const price = (microUsdNumerator, tokenDenominator) => ({ microUsdNumerator, tokenDenominator });
const stages = {
  answer: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4.1-mini-2025-04-14',
    reservedMicroUsd: 60_000, maxRequestBytes: 1_500_000, maxResponseBytes: 262_144,
    timeoutMs: 5_000, maxInputTokens: 125_000, maxOutputTokens: 512, inputTokenFraming: 1_024,
    inputPrice: price(2, 5), outputPrice: price(8, 5) },
  judge: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-2024-08-06',
    reservedMicroUsd: 11_000, maxRequestBytes: 100_000, maxResponseBytes: 65_536,
    timeoutMs: 5_000, maxInputTokens: 4_096, maxOutputTokens: 16, inputTokenFraming: 256,
    inputPrice: price(5, 2), outputPrice: price(10, 1) },
};

const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const errorCode = (result, code) => {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, code, JSON.stringify(result));
  return result.error.code;
};
const request = (core, memories) => ({
  namespace,
  memoryIds: memories.map((memory) => memory.id),
  expectedMemoryRevisions: memories.map((memory) => ({ memoryId: memory.id, revision: memory.revision })),
  mapRevision: ok(core.map({ namespace, purpose: 'classification', limit: 1 })).indexRevision,
});

function fakeTransport() {
  let providerCount = 100;
  const calls = [];
  return {
    calls,
    setProviderCount(value) { providerCount = value; },
    async fetch(url, options) {
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      if (url === urls.count) {
        return Response.json({ object: 'response.input_tokens', input_tokens: providerCount });
      }
      assert.equal(url, urls.generation);
      const input = JSON.parse(body.input[0].content[0].text);
      const text = JSON.stringify({ items: input.memories.map((memory) => ({ memoryId: memory.id, parentIds: [] })) });
      const outputTokens = 10;
      return Response.json({
        id: 'resp_synthetic', object: 'response', model: DEFAULT_MODEL, status: 'completed',
        error: null, incomplete_details: null,
        output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text, annotations: [] }] }],
        usage: { input_tokens: providerCount, output_tokens: outputTokens,
          total_tokens: providerCount + outputTokens },
      });
    },
  };
}

function admit(core, content, index) {
  return ok(core.admit({ namespace, memory: { content, kind: 'fact' }, receipts: [{
    client: 'synthetic-diagnostic', sessionId: 'offline', eventId: `event-${index}`,
    role: 'user', excerpt: content,
  }] })).memory;
}

function seedTopics(core, start, count) {
  for (let offset = 0; offset < count; offset += 5) {
    const indices = Array.from({ length: Math.min(5, count - offset) }, (_, inner) => start + offset + inner);
    const memories = indices.map((index) => admit(core,
      `DO_NOT_SEND_STORED_SOURCE_${String(index).padStart(3, '0')}`, `topic-${index}`));
    ok(core.applyPlacement({
      namespace,
      proposal: { items: memories.map((memory, inner) => ({
        memoryId: memory.id,
        parentIds: [],
        newL1: { title: `Synthetic catalog topic ${String(indices[inner]).padStart(3, '0')}`, parentL2Ids: [] },
      })) },
      expectedMemoryRevisions: memories.map((memory) => ({ memoryId: memory.id, revision: memory.revision })),
      expectedIndexRevision: ok(core.map({ namespace, purpose: 'classification', limit: 1 })).indexRevision,
    }));
  }
}

function countRows(path) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return {
      storedCards: database.prepare("SELECT COUNT(*) count FROM memories WHERE deleted = 0 AND currentness = 'current'").get().count,
      storedMocs: database.prepare('SELECT COUNT(*) count FROM mocs').get().count,
    };
  } finally { database.close(); }
}

function tokenMetrics(model, body, store) {
  const input = JSON.parse(body.input[0].content[0].text);
  const schema = body.text.format.schema;
  const schemaText = JSON.stringify(schema);
  const visibleIds = [...input.memories.map((memory) => memory.id),
    ...input.map.filter((item) => item.type === 'moc').map((item) => item.moc.id)];
  const idOccurrences = visibleIds.map((id) => ({ id, occurrences: schemaText.split(id).length - 1 }));
  const occurrences = idOccurrences.reduce((total, entry) => total + entry.occurrences, 0);
  const schemaWithoutIds = visibleIds.reduce((text, id) => text.replaceAll(id, '<id>'), schemaText);
  const component = (value) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return { bytes: Buffer.byteLength(text, 'utf8'), localTokens: model.countTokens(text) };
  };
  return {
    ...store,
    visibleTargetCards: input.memories.length,
    visibleMocs: input.map.length,
    mapExhausted: input.mapExhausted,
    instructions: component(body.instructions),
    targetMemories: component(input.memories),
    catalogMap: component(input.map),
    jsonSchema: component(schema),
    localPreflightTokens: model.countTokens(JSON.stringify({
      system: body.instructions, input, maxOutputTokens: 1024,
    })),
    providerRequestBytes: Buffer.byteLength(JSON.stringify(body), 'utf8'),
    schemaVisibleIdOccurrences: occurrences,
    schemaRepeatedVisibleIdOccurrences: occurrences - visibleIds.length,
    schemaVisibleIdLiteralBytes: idOccurrences.reduce((total, entry) =>
      total + entry.occurrences * Buffer.byteLength(JSON.stringify(entry.id), 'utf8'), 0),
    schemaVisibleIdTokenDelta: model.countTokens(schemaText) - model.countTokens(schemaWithoutIds),
    containsStoredSourceBodies: JSON.stringify(input).includes('DO_NOT_SEND_STORED_SOURCE_'),
    containsUnrelatedBodies: JSON.stringify(input).includes('DO_NOT_SEND_UNRELATED_'),
  };
}

function latestCountBody(transport) {
  return transport.calls.filter((call) => call.url === urls.count).at(-1)?.body;
}

test('offline classification count overflow reproduces benchmark unknown/halt while input stays catalog-and-target bounded',
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'cairn-classification-count-'));
    const path = join(root, 'memory.sqlite');
    const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 50_000_000, requestCap: 100 };
    const policy = experimentPolicy();
    const guardedTransport = fakeTransport();
    let core;
    let guard;
    t.after(() => {
      try { core?.close(); } catch { /* best-effort test cleanup */ }
      try { guard?.close(); } catch { /* best-effort test cleanup */ }
      rmSync(root, { recursive: true, force: true });
    });

    createExperimentBudget(ledger).close();
    createExperimentRequestGuard({ ledger, policy, fetchImpl: () => assert.fail('setup transport') }).close();
    const benchmarkExtension = authorizeBenchmarkExtension({
      ledger, policy, authorizationId: 'synthetic-classification-count', stages,
    });
    guard = createBenchmarkExperimentRequestGuard({ ledger, policy, benchmarkExtension,
      fetchImpl: guardedTransport.fetch });
    const guardedModel = createOpenAIModel({ apiKey: syntheticKey, fetchImpl: guard.cairnFetch });
    core = openMemoryCore({ path, model: guardedModel });

    const targets = Array.from({ length: 5 }, (_, index) =>
      admit(core, `TARGET_CARD_${index}: synthetic current placement candidate.`, `target-${index}`));
    for (let index = 0; index < 50; index++) {
      admit(core, `DO_NOT_SEND_UNRELATED_${String(index).padStart(3, '0')}`, `unrelated-${index}`);
    }

    const growth = [];
    for (const [topicCount, add] of [[0, 0], [25, 25], [101, 76]]) {
      if (add) seedTopics(core, topicCount - add, add);
      guardedTransport.setProviderCount(100);
      const result = await core.classifyPlacement(request(core, targets));
      assert.equal(result.ok, true, JSON.stringify(result));
      const metric = tokenMetrics(guardedModel, latestCountBody(guardedTransport), countRows(path));
      const sent = JSON.parse(latestCountBody(guardedTransport).input[0].content[0].text);
      assert.deepEqual(sent.memories.map((memory) => memory.id), targets.map((memory) => memory.id));
      assert.ok(sent.map.every((item) => item.type === 'moc'));
      assert.equal(metric.storedMocs, topicCount);
      assert.equal(metric.visibleTargetCards, 5);
      assert.equal(metric.containsStoredSourceBodies, false);
      assert.equal(metric.containsUnrelatedBodies, false);
      assert.ok(metric.visibleMocs <= 100);
      assert.ok(metric.catalogMap.localTokens <= 4_000);
      if (topicCount <= 25) {
        assert.equal(metric.visibleMocs, topicCount);
        assert.equal(metric.mapExhausted, true);
      } else {
        assert.ok(metric.visibleMocs > 0 && metric.visibleMocs < topicCount);
        assert.equal(metric.mapExhausted, false);
      }
      growth.push({ topicCount, ...metric });
    }

    const fullRequest = request(core, targets);
    guardedTransport.setProviderCount(7_024);
    const edge = await core.classifyPlacement(fullRequest);
    assert.equal(edge.ok, true, JSON.stringify(edge));
    const edgeMetrics = tokenMetrics(guardedModel, latestCountBody(guardedTransport), countRows(path));

    guardedTransport.setProviderCount(7_025);
    const callsBeforeOverflow = guardedTransport.calls.length;
    const overflow = await core.classifyPlacement(fullRequest);
    errorCode(overflow, 'classification_failed');
    assert.equal(guardedTransport.calls.length, callsBeforeOverflow + 1, 'overflow must stop before generation');
    assert.equal(guard.isHalted(), true);
    const attemptsAfterOverflow = guard.attempts();
    assert.equal(attemptsAfterOverflow.at(-1).stage, 'cairn-count');
    assert.equal(attemptsAfterOverflow.at(-1).outcome, 'unknown');
    assert.equal(attemptsAfterOverflow.at(-1).actualMicroUsd, null);
    const callsBeforeHaltedRetry = guardedTransport.calls.length;
    const haltedRetry = await core.classifyPlacement(fullRequest);
    errorCode(haltedRetry, 'classification_failed');
    assert.equal(guardedTransport.calls.length, callsBeforeHaltedRetry, 'halted retry must not reach fake HTTP');

    core.close();
    core = undefined;
    guard.close();
    guard = undefined;

    const ordinaryTransport = fakeTransport();
    ordinaryTransport.setProviderCount(7_025);
    const ordinaryModel = createOpenAIModel({ apiKey: syntheticKey, fetchImpl: ordinaryTransport.fetch });
    core = openMemoryCore({ path, model: ordinaryModel });
    const ordinaryFirst = await core.classifyPlacement(fullRequest);
    const ordinarySecond = await core.classifyPlacement(fullRequest);
    errorCode(ordinaryFirst, 'context_budget_exceeded');
    errorCode(ordinarySecond, 'context_budget_exceeded');
    assert.equal(ordinaryTransport.calls.length, 2, 'ordinary adapter retries count but never generates');
    assert.ok(ordinaryTransport.calls.every((call) => call.url === urls.count));

    const report = {
      evidenceKind: 'deterministic synthetic mechanism; not a reconstruction of the historical response',
      fixedBase: 'a31f9d9b948f1e9d7c7371be4d7e115a7cb021a8',
      bounds: { maximumTargets: 5, catalogPageLimit: 100, localInputLimit: 6_000,
        providerCountLimit: 7_024 },
      growth,
      edge: { fakeProviderCount: 7_024, result: edge.ok ? 'ok' : edge.error.code, metrics: edgeMetrics },
      guardedOverflow: { fakeProviderCount: 7_025, coreResult: overflow.error.code,
        countOutcome: attemptsAfterOverflow.at(-1).outcome, halted: true,
        retryTransportCalls: guardedTransport.calls.length - callsBeforeHaltedRetry },
      ordinaryOverflow: { fakeProviderCount: 7_025, first: ordinaryFirst.error.code,
        second: ordinarySecond.error.code, countCalls: ordinaryTransport.calls.length,
        generationCalls: ordinaryTransport.calls.filter((call) => call.url === urls.generation).length },
      limitations: [
        'The fake 7025 count proves the guarded failure mechanism, not the historical provider count or its cause.',
        'Component token counts use the local pinned tokenizer and are not additive estimates of provider framing.',
        'No historical response body or actual count value is retained by this diagnostic.',
      ],
    };
    t.diagnostic(JSON.stringify(report));

    // Opt-in red loop: the product adapter already classifies the same direct 7025
    // response as a context bound. This asks only for that diagnosable error at the
    // guarded seam; it does not authorize accepting >7024 or removing run-wide halt.
    if (process.env.CAIRN_EXPECT_COUNT_OVERFLOW_DIAGNOSTIC === '1') {
      assert.equal(overflow.error.code, 'context_budget_exceeded',
        'guarded fake count 7025 is currently obscured as classification_failed');
    }
  });
