// Actual adapter and stdio, fake upstream only; no model-quality claim.
import assert from 'node:assert/strict';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createCairnServer } from '../../server.mjs';
import { parseConfiguration } from '../../cli.mjs';
import { createOpenAIModel } from '../../../openai/index.mjs';
globalThis.fetch = () => assert.fail('Native HTTP forbidden');
const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const model = createOpenAIModel({ apiKey: 'synthetic-candidate-key', fetchImpl: async (url, request) => {
  assert.notEqual(process.env.SYNTHETIC_FORBID_HTTP, '1', 'Replay must not request HTTP');
  const body = JSON.parse(request.body); const method = body.text.format.name;
  process.stderr.write(`synthetic_http:${method}\n`);
  if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
  const input = JSON.parse(body.input[0].content[0].text); let result;
  if (method === 'cairn_extract') result = { items: input.messages.map((message) => ({ content: message.content.slice(0, 180),
    kind: 'context', confidence: 0.8, sourceIndices: [message.index] })) };
  else if (method === 'cairn_qualifyCandidates') result = { qualifications: input.items.map((item) => ({ itemIndex: item.itemIndex,
    ...Object.fromEntries(fields.map((field) => [field, { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null,
      evidenceIndices: field === 'value' ? [item.content.includes('INVALID_CANDIDATE') ? 999 : item.candidates[0].candidateIndex] : [] }])) })) };
  else if (method === 'cairn_qualify') result = { qualifications: input.items.map((item) => ({ itemIndex: item.itemIndex,
    qualification: { version: 1, slot: { subject: null, property: null, scope: null, applies: null }, value: null,
      attribution: 'unknown', commitment: 'unknown', anchors: [{ receiptIndex: 0, start: 0,
        end: item.sources[0].excerpt.length, text: item.sources[0].excerpt, fields: ['value'] }] } })) };
  else {
    assert.equal(method, 'cairn_classify'); result = { items: input.memories.map((memory) => ({ memoryId: memory.id, parentIds: [] })) };
  }
  if (method === 'cairn_qualifyCandidates') {
    result.qualifications = Object.fromEntries(result.qualifications.map(item => ['item_' + item.itemIndex, item]));
  }
  return Response.json({ object: 'response', model: body.model, status: 'completed', error: null, incomplete_details: null,
    output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(result) }] }],
    usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } });
} });
const options = { ...parseConfiguration(process.argv.slice(2)), model };
const server = createCairnServer(options);
options.namespace.ownerId = 'mutated-after-construction'; options.captureQualification = 'invalid-after-construction';
const handle = serveStdio(() => server, {
  transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 65536 }),
  onerror: () => console.error('synthetic_transport_error'),
});
process.stdin.once('end', () => { void handle.close(); }); process.once('SIGTERM', () => { void handle.close(); });
