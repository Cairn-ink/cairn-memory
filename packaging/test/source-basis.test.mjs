import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildArtifact, command, packageName } from '../build.mjs';

test('installed source-basis review loads its prompt and compiles exact source units without persisting them', { timeout: 60000 }, async t => {
  const artifact = buildArtifact(); const root = mkdtempSync(join(tmpdir(), 'cairn-installed-basis-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-basis', private: true, version: '0.0.0' }), { flag: 'wx' });
  command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath], root, artifact.userconfig);
  const packageRoot = join(root, 'node_modules', packageName);
  const { openMemoryCore } = await import(pathToFileURL(join(packageRoot, 'core/index.mjs')).href);
  const { createOpenAIModel } = await import(pathToFileURL(join(packageRoot, 'adapters/openai/index.mjs')).href);
  const proposal = { units: [{ memory: 0, receipt: 0, role: 'decision', quote: 'I chose A' },
    { memory: 0, receipt: 0, role: 'premise', quote: 'it folds' }],
  links: [{ from: 1, to: 0, relation: 'supports-decision' }] };
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', basisModel: 'gpt-5.6-sol', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    return Response.json(url.endsWith('/input_tokens') ? { object: 'response.input_tokens', input_tokens: 500 } : {
      object: 'response', model: body.model, status: 'completed', error: null, incomplete_details: null,
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(proposal) }] }],
      usage: { input_tokens: 500, output_tokens: 100, total_tokens: 600 },
    });
  } });
  const path = join(root, 'memory.sqlite'); const core = openMemoryCore({ path, model }); t.after(() => core.close());
  const namespace = { ownerId: 'synthetic-private', scope: 'personal', projectId: null };
  const admitted = core.admit({ namespace, memory: { content: 'Misleading generated interpretation', kind: 'context' },
    receipts: [{ client: 'synthetic', sessionId: 'synthetic', eventId: 'synthetic', role: 'user', excerpt: 'I chose A because it folds. I learned it no longer folds.' }] });
  assert.equal(admitted.ok, true); const { id: memoryId, revision } = admitted.value.memory;
  const review = await core.reviewDecisionBasis({ namespace, refs: [{ memoryId, revision }] });
  assert.equal(review.ok, true); assert.equal(review.value.units.length, 2); assert.equal(review.value.persistence, 'not-stored');
  assert.equal(calls.length, 2); assert.equal(calls[1].text.format.name, 'cairn_reviewBasis');
  assert.equal(calls[1].model, 'gpt-5.6-sol'); assert.match(calls[1].instructions, /historically valid premise/);
  assert.equal(JSON.stringify(calls).includes('Misleading generated interpretation'), false);
  assert.match(calls[1].instructions, /that premise also supports a recorded decision/);
  const before = core.get({ namespace, memoryId }); const index = core.map({ namespace }).value.indexRevision;
  proposal.units.push({ memory: 0, receipt: 0, role: 'update', quote: 'I learned it no longer folds.' });
  proposal.links = [{ from: 2, to: 1, relation: 'challenges-current-basis' }];
  const orphan = await core.reviewDecisionBasis({ namespace, refs: [{ memoryId, revision }] });
  assert.equal(orphan.error.code, 'invalid_model_output');
  assert.deepEqual(core.get({ namespace, memoryId }), before);
  assert.equal(core.map({ namespace }).value.indexRevision, index);
  proposal.links.push({ from: 1, to: 0, relation: 'supports-decision' });
  const connected = await core.reviewDecisionBasis({ namespace, refs: [{ memoryId, revision }] });
  assert.equal(connected.ok, true); assert.equal(connected.value.links.length, 2);
  for (const unit of proposal.units) unit.context = { subject: 'I chose A', applies: null, scope: null, commitment: null };
  const contextual = await core.reviewDecisionBasis({ namespace, refs: [{ memoryId, revision }], inputMode: 'source-context-v1' });
  assert.equal(contextual.ok, true); assert.equal(contextual.value.inputMode, 'source-context-v1');
  assert.deepEqual(contextual.value.units[0].context.subject, { start: 0, end: 9, text: 'I chose A' });
  assert.match(calls.at(-1).instructions, /event time is not report arrival time/);
  assert.ok(calls.at(-1).text.format.schema.properties.units.items.anyOf[0].properties.context);
  assert.deepEqual(core.get({ namespace, memoryId }), before);
  assert.equal(core.map({ namespace }).value.indexRevision, index);
  core.close(); const cold = openMemoryCore({ path }); t.after(() => cold.close());
  assert.equal(cold.getRationale({ namespace, memoryId, revision }).value.edges.length, 0);
});
