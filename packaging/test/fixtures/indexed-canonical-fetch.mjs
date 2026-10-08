// Installed CLI preload: replace fetch completely; never forward ambient HTTP.
import assert from 'node:assert/strict';

globalThis.fetch = async (url, request = {}) => {
  const target = new URL(url);
  assert.equal(target.origin, 'https://api.openai.com');
  assert(!target.search && !target.hash);
  assert.notEqual(process.env.SYNTHETIC_CANONICAL_DENY_FETCH, '1', 'Synthetic keyless path forbids HTTP');
  const body = JSON.parse(request.body);
  if (target.pathname === '/v1/responses/input_tokens') {
    process.stderr.write('synthetic_fetch:input_tokens\n');
    return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
  }
  assert.equal(target.pathname, '/v1/responses');
  const method = body.text.format.name;
  process.stderr.write(`synthetic_fetch:${method}\n`);
  const mode = process.env.SYNTHETIC_CANONICAL_MODE ?? 'empty';
  if (mode === 'failure') throw new Error('SYNTHETIC_PRIVATE_PROVIDER_ERROR');
  let output;
  if (method === 'cairn_extract') {
    const input = JSON.parse(body.input[0].content[0].text);
    assert.equal(input.inputMode, 'indexed-windows-v1');
    output = mode === 'malformed' ? { items: 'invalid' } : mode === 'empty' ? { items: [] } : {
      items: [{ content: 'Synthetic installed interpretation', kind: 'context', confidence: 0.5, sourceIndices: [0] }] };
  } else if (method === 'cairn_classify') {
    const input = JSON.parse(body.input[0].content[0].text);
    output = { items: input.memories.map(({ id }) => ({ memoryId: id, parentIds: [] })) };
  } else assert.fail('Unexpected interpretation/qualification stage');
  return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
    incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
    usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 } });
};
