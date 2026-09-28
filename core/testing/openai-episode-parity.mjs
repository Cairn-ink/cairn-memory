import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

// Frozen against 7f9ee869 before adapter changes. Tests never invoke Git or
// regenerate the oracle; transport bodies and returned values are exact bytes.
export async function captureOpenAIParity(root) {
  const { createOpenAIModel } = await import(pathToFileURL(`${root}/adapters/openai/index.mjs`));
  const fixture = JSON.parse(readFileSync(new URL('./episode-v15-fixture.json', import.meta.url), 'utf8'));
  const results = [];
  const messages = [{ index: 0, role: 'user', content: 'Synthetic evidence.' }];
  const candidates = { items: [{ itemIndex: 0, content: 'Synthetic preference', kind: 'preference',
    candidates: [{ candidateIndex: 0, role: 'user', text: 'Synthetic evidence.' }] }] };
  const extra = [
    ['qualify', { items: [{ itemIndex: 0, sources: [{ receiptIndex: 0, text: 'Synthetic evidence.' }] }] }],
    ['relate', { memories: [{ index: 0, receipts: [{ index: 0, text: 'Synthetic evidence.' }] }] }],
    ['reviewBasis', { memories: [{ index: 0, receipts: [{ index: 0, text: 'Synthetic evidence.' }] }] }],
    ['select', { maxRefs: 1, maps: [{ namespaceIndex: 0, items: [{ type: 'unfiled', ref: { memoryId: 'memory', revision: 1 } }] }] }],
    ['selectChecklist', { query: 'Synthetic query', maxRefs: 1, maps: [] }],
    ['rank', { limit: 1, candidates: [{ namespaceIndex: 0, memory: { id: 'memory', revision: 1 } }] }],
    ['reconcile', { messages, items: [{ index: 0 }], candidates: [{ index: 0 }] }],
    ['extract', { inputMode: 'indexed-windows-v1', messages: messages.map(message => ({ ...message, messageIndex: 0 })) }],
    ['extract', { messages: [] }],
    ['qualifyCandidates', candidates],
    ['qualifyCandidates', { inputMode: 'text-catalog-v1', texts: ['Synthetic evidence.'],
      items: [{ ...candidates.items[0], candidates: [{ candidateIndex: 0, role: 'user', textIndex: 0 }] }] },
    { qualificationInputMode: 'adaptive-text-catalog-v1' }],
    ...['gpt-5.4-mini-2026-03-17', 'gpt-5.6-luna'].map(extractionModel => ['extract', { messages }, { extractionModel }]),
  ].map(([method, input, adapterOptions = {}]) => ({ config: { case: method, adapterOptions }, adapterOptions,
    expected: { calls: [[method, { system: 'Synthetic legacy parity.', input, maxOutputTokens: 1024 }]] } }));
  for (const { config, expected, adapterOptions = {} } of [...fixture.parity, ...extra]) {
    for (const [method, original] of expected.calls) {
      for (const variant of ['valid', 'tag', 'partial', 'malformed', 'usage', 'transport']) {
        const calls = [], diagnostics = [];
        const model = createOpenAIModel({ apiKey: ['synthetic', 'parity'].join('-'), ...adapterOptions,
          onDiagnostic: event => diagnostics.push(event),
          fetchImpl: async (url, options) => {
            calls.push({ url, body: options.body });
            const body = JSON.parse(options.body);
            if (variant === 'transport') throw Error('synthetic provider error');
            if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
            const input = JSON.parse(body.input[0].content[0].text);
            let output;
            if (method === 'extract') output = { items: [{ content: 'I prefer offline tools.', kind: 'preference',
              confidence: 0.9, sourceIndices: [0], ...(variant === 'tag' ? { procedural: true } : {}) }] };
            if (method === 'classify') output = { items: input.memories.map(memory => ({ memoryId: memory.id,
              parentIds: [], ...(variant === 'tag' ? { procedural: true } : {}) })) };
            if (method === 'qualifyCandidates') output = { wireVersion: 'evidence-pool-v1',
              qualifications: Object.fromEntries(input.items.map(item => [`item_${item.itemIndex}`, {
                itemIndex: item.itemIndex, pool: [item.candidates[0].candidateIndex],
                ...Object.fromEntries(['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment']
                  .map(field => [field, { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null,
                    evidenceSlots: field === 'value' ? [0] : [] }])),
                ...(variant === 'tag' ? { procedural: { evidenceIndices: [0] } } : {}),
              }])) };
            if (['select', 'rank'].includes(method)) output = { refs: [] };
            if (method === 'selectChecklist') output = { requests: [] };
            if (method === 'qualify') output = { qualifications: [] };
            if (method === 'relate') output = { edges: [] };
            if (method === 'reviewBasis') output = { units: [], links: [] };
            if (method === 'reconcile') output = { transitions: [] };
            if (variant === 'partial') output = {};
            return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
              incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
                content: [{ type: 'output_text', text: variant === 'malformed' ? '{' : JSON.stringify(output) }] }],
              usage: { input_tokens: 120, output_tokens: 80, total_tokens: variant === 'usage' ? 0 : 200 } });
          } });
        let outcome;
        try { outcome = { output: JSON.stringify(await model[method]({ ...original, signal: new AbortController().signal })) }; }
        catch (error) { outcome = { error: { name: error.name, message: error.message, ...(error.code ? { code: error.code } : {}) } }; }
        results.push({ config, method, variant, calls, outcome, diagnostics });
      }
    }
  }
  return results;
}
