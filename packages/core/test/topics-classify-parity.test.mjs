import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { classifyPlacement, CoreError } from '../src/index.mjs';

const { P8 } = JSON.parse(readFileSync(new URL('./fixtures/topics/engine-goldens.json', import.meta.url), 'utf8'));
const engineToCoreCodes = {
  model_not_configured: 'model_not_configured',
  token_count_unavailable: 'token_count_unavailable',
  context_budget_exceeded: 'context_budget_exceeded',
  model_timeout: 'model_timeout',
};
const byteCounter = (text) => Math.ceil(Buffer.byteLength(text, 'utf8') / 4);

for (const entry of P8) {
  test('P8 / ' + entry.name, async () => {
    const [engineCall] = entry.calls;
    // Use the recorded logical input for the exact boundary replay. The batch's
    // smaller memory projection is exercised separately by the adapter test.
    const { memories, ...catalog } = engineCall?.input ?? {
      memories: [{ id: entry.input.content, revision: entry.after.memories[0].revision,
        kind: 'instruction', content: entry.input.content }],
      map: [], mapExhausted: true,
    };
    const snapshot = { memories, indexRevision: entry.input.mapRevision };
    const calls = [];
    const counted = [];
    const byAlias = new Map(memories.map(({ id }, index) => ['m' + index.toString(36), id]));
    const byId = new Map([...byAlias].map(([alias, id]) => [id, alias]));
    const model = {
      model: 'scripted',
      contextWindow: entry.name === '4096-token context' ? 4096 : 8192,
      countTokens(text) {
        counted.push(text);
        if (entry.name === 'NaN counter') return NaN;
        if (entry.name === '6001-token request' && text.includes('"system"')) return 6001;
        return byteCounter(text);
      },
      async call(stage, request, options) {
        calls.push({ stage, request, options });
        if (entry.name === 'adapter timeout') throw Object.assign(new Error('synthetic timeout'), { code: 'model_timeout' });
        if (!entry.value) throw new Error('unscripted model call');
        return { items: entry.value.proposal.items.map((item) => ({
          ...item, memoryId: byId.get(item.memoryId),
        })) };
      },
    };
    if (entry.name === 'missing counter') delete model.countTokens;
    const run = () => classifyPlacement({
      model: entry.name === 'missing model' ? undefined : model, snapshot, catalog, async validateFresh() {},
    });
    if (entry.error) {
      assert.ok(Object.hasOwn(engineToCoreCodes, entry.error));
      await assert.rejects(run, { name: CoreError.name, code: engineToCoreCodes[entry.error] });
    } else {
      const { proposal, basedOn, classificationTruncated } = entry.value;
      assert.deepStrictEqual(await run(), {
        proposal, basedOn, ...(classificationTruncated && { classificationTruncated }),
      });
    }
    assert.equal(calls.length, entry.calls.length);
    for (const [index, { stage, request, options }] of calls.entries()) {
      assert.equal(stage, 'classify');
      assert.equal(request.schemaName, 'cairn_classify');
      assert.ok(request.schema);
      const { system, input: wire, maxOutputTokens } = request;
      const input = { ...wire, memories: wire.memories.map((memory) => ({
        ...memory, id: byAlias.get(memory.id),
      })) };
      assert.deepStrictEqual({ system, input, maxOutputTokens, hasAbortSignal: options.signal instanceof AbortSignal },
        entry.calls[index]);
      const sizingText = JSON.stringify({ system, input, maxOutputTokens });
      assert.deepStrictEqual(counted.slice(0, 2), [sizingText, sizingText]);
    }
  });
}
