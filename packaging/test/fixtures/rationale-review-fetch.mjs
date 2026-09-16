// Installed CLI preload: all provider responses are scripted; no network fallback.
import { readFileSync } from 'node:fs';
import { rationaleModel } from '../../../core/testing/rationale-model.mjs';

const mock = rationaleModel();
globalThis.fetch = async (url, request = {}) => {
  if (process.env.SYNTHETIC_DENY_FETCH === '1') {
    console.error('synthetic_unexpected_fetch'); throw new Error('synthetic_unexpected_fetch');
  }
  const target = new URL(url);
  if (target.origin !== 'https://api.openai.com' || target.search || target.hash ||
      !['/v1/responses/input_tokens', '/v1/responses'].includes(target.pathname)) {
    throw new Error('synthetic_unexpected_route');
  }
  const body = JSON.parse(request.body);
  const method = body.text.format.name.slice('cairn_'.length);
  console.error(`synthetic_review_fetch:${method}:${target.pathname}`);
  if (target.pathname.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
  if (typeof mock[method] !== 'function') throw new Error('synthetic_unexpected_method');
  const input = JSON.parse(body.input[0].content[0].text);
  let output = await mock[method]({ input });
  if (method === 'classify') {
    output = { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [],
      newL1: { title: memory.content.startsWith('I chose A') ? 'Synthetic offline choice' : 'Synthetic report',
        parentL2Ids: [] } })) };
  }
  if (method === 'qualifyCandidates') {
    output.qualifications = Object.fromEntries(output.qualifications.map(item => [`item_${item.itemIndex}`, item]));
  }
  if (method === 'relate' && readFileSync(process.env.SYNTHETIC_REVIEW_PHASE, 'utf8').trim() === 'review') {
    const decision = input.memories.find(memory => memory.receipts.some(receipt => receipt.excerpt.startsWith('I chose A')));
    output = { edges: decision ? [{ from: decision.index, to: decision.index,
      relation: 'supports-decision', fromReceipt: 0, toReceipt: 0 }] : [] };
  }
  return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
    incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
    usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
};
