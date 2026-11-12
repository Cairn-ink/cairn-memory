// Offline synthetic capture measurement. Uses the production request envelope
// and tokenizer; the fake model never has a transport.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { mock } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemoryCore } from '../../core/index.mjs';
import { createOpenAIModel } from '../../adapters/openai/index.mjs';
import { countTokens } from '../../core/model-budget.mjs';
import { modelRequestText } from '../../core/model-call.mjs';

const tokenizer = createOpenAIModel({ apiKey: 'synthetic-offline', fetchImpl: () => { throw Error('offline_only'); } });
const namespace = { ownerId: 'synthetic-cost', scope: 'personal', projectId: null };
const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
let sequence = 0;
const uuid = mock.method(crypto, 'randomUUID', () => `00000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, '0')}`);
syncBuiltinESMExports();
mock.timers.enable({ apis: ['Date'], now: new Date('2025-03-01T00:00:00.000Z') });
async function capture(candidateCount, link, enabled) {
  sequence = 0;
  const directory = mkdtempSync(join(tmpdir(), 'relation-cost-'));
  const calls = [];
  const run = (method, output) => request => {
    calls.push({ method, inputTokens: countTokens(model, modelRequestText(request.system, request.input)), outputTokenCeiling: request.maxOutputTokens });
    return output(request.input);
  };
  const model = { contextWindow: 8192, countTokens: text => tokenizer.countTokens(text),
    extract: run('extract', input => ({ items: [{ content: input.messages[0].content, kind: 'fact', confidence: .9, sourceIndices: [0] }] })),
    classify: run('classify', input => ({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) })),
    relateMemories: run('relateMemories', input => {
      assert.equal(input.candidates[0].length, candidateCount);
      return { facts: [{ factIndex: 0, edges: link ? [{ candidateId: input.candidates[0][0].id, relation: 'supersedes', confidence: .9 }] : [] }] };
    }),
  };
  const core = openMemoryCore({ path: join(directory, 'store.sqlite'), model, memoryRelations: enabled });
  try {
    for (let i = 0; i < candidateCount; i++) value(core.admit({ namespace,
      memory: { content: `My breakfast is oats variant ${String.fromCharCode(65 + i)}.`, kind: 'fact' },
      receipts: [{ client: 'synthetic', sessionId: 'synthetic', eventId: `source-${i}`, role: 'user', excerpt: 'Synthetic earlier breakfast.' }] }));
    const captured = value(await core.capture({ namespace, client: 'synthetic', sessionId: 'synthetic', eventId: 'capture',
      messages: [{ id: 'message', role: 'user', content: 'My breakfast is eggs.', occurredAt: '2025-03-01T00:00:00.000Z' }] }));
    const inspected = value(core.get({ namespace, memoryId: captured.admission.memories[0].id }));
    assert.equal(inspected.relations?.length ?? 0, enabled && link ? 1 : 0);
    return { modelRequests: calls.length, inputTokens: calls.reduce((sum, call) => sum + call.inputTokens, 0),
      outputTokenCeiling: calls.reduce((sum, call) => sum + call.outputTokenCeiling, 0), calls };
  } finally { await core.close(); rmSync(directory, { recursive: true, force: true }); }
}
try {
  const results = [];
  for (const [scenario, candidates, link] of [['no candidates', 0, false], ['one candidate, no link', 1, false], ['one earlier Memory linked', 1, true], ['candidate limit', 8, true]]) {
    const off = await capture(candidates, link, false), on = await capture(candidates, link, true);
    const increase = Object.fromEntries(['modelRequests', 'inputTokens', 'outputTokenCeiling'].map(key => [key, on[key] - off[key]]));
    results.push({ scenario, candidates, off, on, increase });
  }
  console.log(JSON.stringify({ tokenizer: 'o200k_base', requestEnvelope: 'modelRequestText', results }, null, 2));
} finally { mock.timers.reset(); uuid.mock.restore(); syncBuiltinESMExports(); }
