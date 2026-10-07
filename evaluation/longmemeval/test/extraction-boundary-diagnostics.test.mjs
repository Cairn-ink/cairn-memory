import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { captureSnapshot } from '../../../core/capture-input.mjs';
import { extractedWindowItems, sourceWindowCatalog } from '../../../core/source-windows.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createMixedModelDiagnosticObserver } from '../mixed-ingestion-diagnostics.mjs';

const namespace = { ownerId: 'synthetic-boundaries', scope: 'personal', projectId: null };
const item = (content, sourceIndices = [0]) => ({ content, sourceIndices, kind: 'fact', confidence: 0.8 });
const cases = [
  ['300 ligatures', item('ﬁ'.repeat(300)), null],
  ['301 ligatures', item('ﬁ'.repeat(301)), 'text_nfkc_bounds'],
  ['redaction expansion', item('x'.repeat(582) + ' password=abcdefgh'), 'text_redaction_bounds'],
  ['provider-schema-nonconforming raw 601', item('x'.repeat(601)), 'text_original_bounds'],
  ['provider-schema-nonconforming whitespace contraction', item(' '.repeat(19400) + 'x'.repeat(600)), null],
  ['300 astrals', item('😀'.repeat(300)), null],
  ['301 astrals', item('😀'.repeat(301)), 'text_original_bounds'],
  ['duplicate indices', item('Synthetic fact', [0, 0]), 'source_duplicate'],
  ['same canonical receipt', item('Synthetic fact', [0, 1]), 'receipt_duplicate', 'x'.repeat(1600)],
  ['different receipts', item('Synthetic fact', [0, 1]), null, 'x'.repeat(800) + 'y'.repeat(800)],
  ['reverse selected receipts', item('Synthetic fact', [1, 0]), null, 'x'.repeat(800) + 'y'.repeat(800)],
  ['malformed array', item('Synthetic fact', null), 'source_shape'],
  ['oversized array', item('Synthetic fact', [0, 0, 0, 0, 0]), 'source_shape'],
  ['out of range', item('Synthetic fact', [99]), 'source_range'],
  ['fractional', item('Synthetic fact', [0.5]), 'source_range'],
  ['mixed types', item('Synthetic fact', [0, '0']), 'source_range'],
  ['duplicate precedence', item('Synthetic fact', [0, 0, '0']), 'source_duplicate'],
  ['malformed item', { ...item('Synthetic fact'), extra: true }, 'item_shape'],
];

test('N20D real adapter/indexed capture finite boundary matrix and atomicity', async t => {
  for (const [name, selected, category, source = 'Synthetic source'] of cases) {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-extraction-boundary-' });
    const events = [], requests = [], endpoints = [], observer = createMixedModelDiagnosticObserver();
    const model = createOpenAIModel({ apiKey: 'synthetic-not-a-provider-key', onDiagnostic(event) {
      events.push(event); observer.onDiagnostic(event);
    }, fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      if (String(url).endsWith('/input_tokens')) {
        endpoints.push('count');
        return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      }
      endpoints.push('generate');
      const method = body.text.format.name;
      requests.push(method);
      const wire = JSON.parse(body.input[0].content[0].text);
      const output = method === 'cairn_extract' ? { items: [item('Valid first item'), selected] }
        : { items: wire.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
      return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
        incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } });
    } });
    const core = openMemoryCore({ path: join(workspace.path, 'memory.sqlite'), model,
      captureSourcePolicy: 'indexed-evidence-v1' });
    workspace.defer(() => core.close());
    const input = { namespace, client: 'synthetic', sessionId: 'session', eventId: 'event',
      messages: [{ id: 'message', role: 'user', content: source }] };
    const result = await core.capture(input);
    if (category) {
      assert.deepEqual(result, { ok: false, error: { code: 'invalid_model_output', retryable: false } }, name);
      assert.deepEqual(core.list({ namespace }).value.memories, [], name);
      assert.deepEqual(requests, ['cairn_extract'], name);
      assert.deepEqual(endpoints, ['count', 'generate'], name);
      assert.deepEqual(events, [{ version: 1, stage: 'extract', layer: 'core_validation',
        reason: `invalid_extraction_${category}` }], name);
    } else {
      assert.equal(result.ok, true, name);
      const memories = core.list({ namespace }).value.memories;
      assert.equal(memories.length, 2, name);
      const retained = core.get({ namespace, memoryId: memories.find(memory =>
        core.get({ namespace, memoryId: memory.id }).value.memory.content !== 'Valid first item').id }).value;
      assert.equal(retained.memory.content, selected.content.normalize('NFKC').replace(/\s+/gu, ' ').trim(), name);
      assert.equal(retained.receipts.length, selected.sourceIndices.length, name);
      const expectedReceipts = selected.sourceIndices.map(index => ({
        client: 'synthetic', sessionId: 'session', eventId: 'message', role: 'user',
        excerpt: source.slice(index * 800, (index + 1) * 800) }));
      // Public get sorts by created_at/id, not source selection order. Compare
      // the complete binding set; extraction itself retains selected-index order.
      const bindings = rows => rows.map(({ client, sessionId, eventId, role, excerpt }) =>
        JSON.stringify([client, sessionId, eventId, role, excerpt])).sort();
      assert.deepEqual(bindings(retained.receipts), bindings(expectedReceipts), name);
      const snapshot = captureSnapshot(input, undefined, 'indexed-evidence-v1');
      assert.deepEqual(extractedWindowItems({ items: [selected] }, snapshot,
        sourceWindowCatalog(snapshot))[0].receipts, expectedReceipts, name);
      assert.deepEqual(requests, ['cairn_extract', 'cairn_classify'], name);
      assert.deepEqual(events, [], name);
      assert.equal((await core.capture(input)).value.duplicate, true, name);
      assert.equal(requests.length, 2, name);
      assert.deepEqual(endpoints, ['count', 'generate', 'count', 'generate'], name);
    }
    assert.deepEqual(observer.snapshot().events, events, name);
    await workspace.cleanup();
    assert.equal(existsSync(workspace.path), false, name);
  }
});
