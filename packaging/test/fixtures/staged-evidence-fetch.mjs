// Installed CLI preload: synthetic provider only; never forward to the network.
globalThis.fetch = async (url, request = {}) => {
  console.error('synthetic_staging_fetch');
  if (process.env.SYNTHETIC_DENY_FETCH === '1') throw new Error('synthetic_unexpected_fetch');
  const route = new URL(url).pathname;
  const body = JSON.parse(request.body);
  if (route.endsWith('/responses/input_tokens')) return Response.json({
    object: 'response.input_tokens', input_tokens: 100 });
  if (!route.endsWith('/responses')) throw new Error('synthetic_unexpected_route');
  let output;
  if (body.text.format.name === 'cairn_extract') output = { items: [{
    content: 'Synthetic generated interpretation', kind: 'context', confidence: 0.5, sourceIndices: [0] }] };
  else if (body.text.format.name === 'cairn_qualifyCandidates') output = { qualifications: {} };
  else throw new Error('synthetic_unexpected_method');
  return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
    incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
    usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 } });
};
