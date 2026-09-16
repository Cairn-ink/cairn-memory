import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildArtifact, command, packageName } from '../build.mjs';

test('DA6 installed core and adapter fake-HTTP disposition review remains ephemeral and cold-readable',
  { timeout: 60000 }, async t => {
    const artifact = buildArtifact();
    const root = mkdtempSync(join(tmpdir(), 'cairn-installed-disposition-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-disposition',
      private: true, version: '0.0.0' }), { flag: 'wx' });
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      artifact.artifactPath], root, artifact.userconfig);
    const packageRoot = join(root, 'node_modules', packageName);
    const { openMemoryCore } = await import(pathToFileURL(join(packageRoot, 'core/index.mjs')).href);
    const { createOpenAIModel } = await import(pathToFileURL(join(packageRoot, 'adapters/openai/index.mjs')).href);
    const path = join(root, 'store.sqlite');
    const namespace = { ownerId: 'synthetic-installed-disposition', scope: 'personal', projectId: null };
    const seed = openMemoryCore({ path, model: { contextWindow: 8192, countTokens: () => 1,
      relate: () => ({ edges: [{ from: 1, to: 0, relation: 'supports-decision',
        fromReceipt: 0, toReceipt: 0 }] }) } });
    const refs = [];
    for (const [index, excerpt] of ['Team chose A.', 'A was cheaper.', 'Later A price rose.'].entries()) {
      const admitted = seed.admit({ namespace, memory: { content: excerpt, kind: 'context' },
        receipts: [{ client: 'synthetic', sessionId: 'synthetic', eventId: `installed-${index}`,
          role: 'user', excerpt }] });
      assert.equal(admitted.ok, true); refs.push({ memoryId: admitted.value.memory.id,
        revision: admitted.value.memory.revision });
    }
    assert.equal((await seed.reviewRationale({ namespace, refs })).ok, true); seed.close();
    const calls = [];
    const model = createOpenAIModel({ apiKey: 'synthetic', rationaleModel: 'gpt-5.6-luna',
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body); calls.push({ url, body });
        if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
        return Response.json({ object: 'response', model: body.model, status: 'completed',
          error: null, incomplete_details: null,
          output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text',
            text: JSON.stringify({ dispositions: [{ edge: 0, action: 'withdraw',
              evidence: [{ memory: 2, receipt: 0 }] }], additions: [{ from: 2, to: 1,
              relation: 'challenges-premise', fromReceipt: 0, toReceipt: 0 }] }) }] }],
          usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
      } });
    const core = openMemoryCore({ path, model }); t.after(() => core.close());
    const before = core.getRationale({ namespace, ...refs[0] });
    const epoch = core.map({ namespace }).value.indexRevision;
    const result = await core.reviewRationaleDispositions({ namespace, refs });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.value.dispositions[0].action, 'withdraw');
    assert.equal(result.value.projectedEdges.length, 1);
    assert.equal(result.value.persistence, 'not-stored');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.model, 'gpt-5.6-luna');
    assert.equal(calls[1].body.text.format.name, 'cairn_reviewRationaleDispositions');
    const transmitted = JSON.parse(calls[1].body.input[0].content[0].text);
    assert.equal(transmitted.oldEdges[0].interpretationStatus, 'unverified');
    for (const privateValue of [namespace.ownerId, refs[0].memoryId, 'installed-0']) {
      assert.equal(JSON.stringify(calls).includes(privateValue), false);
    }
    assert.deepEqual(core.getRationale({ namespace, ...refs[0] }), before);
    assert.equal(core.map({ namespace }).value.indexRevision, epoch);
    core.close();
    const cold = openMemoryCore({ path }); t.after(() => cold.close());
    assert.deepEqual(cold.getRationale({ namespace, ...refs[0] }), before);
  });
