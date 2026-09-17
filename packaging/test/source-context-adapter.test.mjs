import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildArtifact, command, packageName } from '../build.mjs';

test('installed core and adapter cold-bind CU units through two fake HTTP calls only',
  { timeout: 60000 }, async t => {
    const artifact = buildArtifact();
    const root = mkdtempSync(join(tmpdir(), 'cairn-installed-context-adapter-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-context-adapter',
      private: true, version: '0.0.0' }), { flag: 'wx' });
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit',
      '--no-fund', artifact.artifactPath], root, artifact.userconfig);
    const packageRoot = join(root, 'node_modules', packageName);
    const { openMemoryCore } = await import(pathToFileURL(join(packageRoot, 'core/index.mjs')).href);
    const path = join(root, 'memory.sqlite');
    const namespace = { ownerId: 'installed-context-owner', scope: 'personal', projectId: null };
    const excerpt = 'The team considered A; adoption is still pending.';
    const core = openMemoryCore({ path }); t.after(() => core.close());
    const admission = core.admit({ namespace, memory: { content: 'Generated interpretation', kind: 'context' },
      receipts: [{ client: 'synthetic-client', sessionId: 'synthetic-session',
        eventId: 'synthetic-event', role: 'user', excerpt }] });
    assert.equal(admission.ok, true, JSON.stringify(admission));
    const ref = { memoryId: admission.value.memory.id, revision: admission.value.memory.revision };
    core.close();
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { pathToFileURL } from 'node:url';
      const packageRoot = process.argv[1];
      const { openMemoryCore } = await import(pathToFileURL(packageRoot + '/core/index.mjs').href);
      const { createOpenAIModel } = await import(pathToFileURL(packageRoot + '/adapters/openai/index.mjs').href);
      const namespace = JSON.parse(process.argv[3]); const ref = JSON.parse(process.argv[4]);
      const field = (value, evidence = []) => ({ value, evidence });
      const proposal = { units: [{ source: 0, receipt: 0, kind: 'decision_state',
        subject: field(null, [0]), property: field(null), scope: field(null), applies: field(null),
        value: field(null), attribution: field('unknown'), polarity: field('unknown'),
        quantifier: field('unknown'), state: field('considered', [0]),
        eventTimeContext: [], reporterContext: [] }] };
      const calls = [];
      const model = createOpenAIModel({ apiKey: 'synthetic-only', fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body); calls.push({ url, body });
        if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
        return Response.json({ object: 'response', model: body.model, status: 'completed',
          error: null, incomplete_details: null,
          output: [{ type: 'message', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: JSON.stringify(proposal) }] }],
          usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } });
      } });
      const core = openMemoryCore({ path: process.argv[2], model });
      const prior = core.getRationale({ namespace, ...ref });
      const review = await core.reviewSourceContext({ namespace, refs: [ref] });
      core.close();
      process.stdout.write(JSON.stringify({ prior, review, calls }));
    `, packageRoot, path, JSON.stringify(namespace), JSON.stringify(ref)],
    { encoding: 'utf8', timeout: 30000 });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.prior.value.edges.length, 0);
    assert.equal(result.review.ok, true, JSON.stringify(result.review));
    assert.equal(result.review.value.units[0].memoryId, ref.memoryId);
    assert.equal(result.review.value.units[0].receiptId,
      result.review.value.sources[0].receipts[0].id);
    assert.equal(result.review.value.units[0].state.value, 'considered');
    assert.equal(result.review.value.units[0].interpretationStatus, 'model-proposed-unverified');
    assert.deepEqual(result.calls.map(call => call.url), [
      'https://api.openai.com/v1/responses/input_tokens', 'https://api.openai.com/v1/responses']);
    assert.equal(result.calls[1].body.max_output_tokens, 3072);
    assert.equal(JSON.stringify(result.calls).includes('Generated interpretation'), false);
    assert.equal(JSON.stringify(result.calls).includes(ref.memoryId), false);
  });
