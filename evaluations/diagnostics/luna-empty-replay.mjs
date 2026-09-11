import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../../core/contract.mjs';
import { createOpenAIModel } from '../../adapters/openai/index.mjs';
import { cases } from '../semantic-cases.mjs';

globalThis.fetch = () => assert.fail('Native HTTP is forbidden');
const fixture = cases.find(item => item.id === 'C12-instruction-like-evidence');
const namespace = { ownerId: 'synthetic-owner-a', scope: 'project', projectId: 'synthetic-harbor' };
const input = { namespace, client: 'semantic-fixture', sessionId: fixture.id,
  eventId: `${fixture.id}-capture`, messages: fixture.messages };
for (const mode of ['empty', 'supported_fact']) {
  const calls = [];
  const path = `${mkdtempSync('/tmp/cairn-luna-empty-offline-')}/memory.sqlite`;
  const adapter = createOpenAIModel({ apiKey: 'synthetic-offline-only', extractionModel: 'gpt-5.6-luna',
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ endpoint: new URL(url).pathname, model: body.model, method: body.text.format.name });
      const count = url.endsWith('/input_tokens');
      if (count) return Response.json({ object: 'response.input_tokens', input_tokens: 463 });
      let output;
      if (body.text.format.name === 'cairn_extract') {
        output = { items: mode === 'empty' ? [] : [{ content: 'Team review day is Friday.',
          kind: 'fact', confidence: 1, sourceIndices: [0] }] };
      } else {
        assert.equal(body.text.format.name, 'cairn_classify');
        const modelInput = JSON.parse(body.input[0].content[0].text);
        output = { items: modelInput.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
      }
      return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
        incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 463, output_tokens: mode === 'empty' ? 14 : 50,
          total_tokens: mode === 'empty' ? 477 : 513 } });
    } });
  const core = openMemoryCore({ path, model: adapter });
  let capture;
  try {
    capture = await core.capture(input);
    assert.equal(capture.ok, true);
    assert.equal(capture.value.admission.suppressedCount, 0);
    assert.equal(capture.value.admission.memories.length, mode === 'empty' ? 0 : 1);
    assert.equal(capture.value.classification.status, mode === 'empty' ? 'skipped' : 'applied');
    if (mode === 'empty') assert.equal(capture.value.classification.reason, 'empty');
    assert.equal(core.list({ namespace, limit: 100 }).value.memories.length, mode === 'empty' ? 0 : 1);
    assert.equal(calls.length, mode === 'empty' ? 2 : 4);
  } finally { core.close(); }
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const claims = db.prepare('SELECT state, memory_ids, suppressed_count FROM admission_claims').all();
    assert.equal(claims[0].state, 'completed');
    assert.equal(JSON.parse(claims[0].memory_ids).length, mode === 'empty' ? 0 : 1);
    assert.equal(db.prepare('SELECT count(*) AS count FROM suppressed').get().count, 0);
    console.log(JSON.stringify({ mode, path, capture, calls, claims,
      conclusion: 'Scripted transport reproduces behavior; not a reconstruction of the unavailable raw model response.' }));
  } finally { db.close(); }
}
