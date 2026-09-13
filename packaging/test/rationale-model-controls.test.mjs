import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildArtifact, command, packageName } from '../build.mjs';

test('installed core and adapter independently select the relation model with unchanged source focus', { timeout: 60000 }, async t => {
  const artifact = buildArtifact(); const root = mkdtempSync(join(tmpdir(), 'cairn-installed-rationale-model-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-model-control', private: true, version: '0.0.0' }), { flag: 'wx' });
  command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath], root, artifact.userconfig);
  const packageRoot = join(root, 'node_modules', packageName);
  const { openMemoryCore } = await import(pathToFileURL(join(packageRoot, 'core/index.mjs')).href);
  const { createOpenAIModel } = await import(pathToFileURL(join(packageRoot, 'adapters/openai/index.mjs')).href);
  const models = ['gpt-4.1-mini-2025-04-14', 'gpt-5.6-luna', 'gpt-5.6-sol'];
  for (const [index, rationaleModel] of models.entries()) {
    const calls = [];
    const model = createOpenAIModel({ apiKey: 'synthetic', rationaleModel, fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body); calls.push(body);
      return Response.json(url.endsWith('/input_tokens') ? { object: 'response.input_tokens', input_tokens: 500 } : {
        object: 'response', model: body.model, status: 'completed', error: null, incomplete_details: null,
        output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"edges":[]}' }] }],
        usage: { input_tokens: 500, output_tokens: 10, total_tokens: 510 },
      });
    } });
    const core = openMemoryCore({ path: join(root, `memory-${index}.sqlite`), model }); t.after(() => core.close());
    const namespace = { ownerId: 'synthetic', scope: 'personal', projectId: null };
    const admitted = core.admit({ namespace, memory: { content: 'I have not chosen.', kind: 'context' },
      receipts: [{ client: 'synthetic', sessionId: 'synthetic', eventId: 'synthetic', role: 'user', excerpt: 'I have not chosen.' }] });
    assert.equal(admitted.ok, true); const { id: memoryId, revision } = admitted.value.memory;
    const review = await core.reviewRationale({ namespace, refs: [{ memoryId, revision }], inputMode: 'claim-focus-v1' });
    assert.equal(review.ok, true); assert.equal(review.value.proposed, 0); assert.equal(calls.length, 2);
    assert.equal(calls[1].model, rationaleModel);
    assert.deepEqual(calls[1].reasoning, index ? { effort: 'none' } : undefined);
    const input = JSON.parse(calls[1].input[0].content[0].text);
    assert.deepEqual(input.memories[0].focus, { content: 'I have not chosen.', interpretationStatus: 'unverified' });
  }
});
