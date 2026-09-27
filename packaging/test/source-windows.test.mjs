import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildArtifact, command, packageName } from '../build.mjs';
import { qualificationPoolWire } from '../../adapters/openai/test/qualification-pool-wire.mjs';

test('W8/W9 installed core and actual adapter select a synthetic tail window through fake HTTP', { timeout: 90000 }, async t => {
  const artifact = buildArtifact();
  for (const file of ['core/source-windows.mjs', 'core/prompts/extract-source-windows.md']) {
    assert.ok(artifact.files.includes(file));
  }
  const root = mkdtempSync(join(tmpdir(), 'cairn-installed-source-windows-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-window-install', private: true,
    version: '0.0.0' }), { flag: 'wx' });
  command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    artifact.artifactPath], root, artifact.userconfig);
  const packageRoot = join(root, 'node_modules', packageName);
  const { openMemoryCore } = await import(pathToFileURL(join(packageRoot, 'core/index.mjs')).href);
  const { createOpenAIModel } = await import(pathToFileURL(join(packageRoot, 'adapters/openai/index.mjs')).href);
  const bodies = [];
  const tail = 'TAIL_SYNTHETIC_ONLY_FRIDAY';
  const model = createOpenAIModel({ apiKey: 'synthetic-installed-key', fetchImpl: async (url, options) => {
    assert.equal(new URL(url).origin, 'https://api.openai.com');
    const body = JSON.parse(options.body); bodies.push(body);
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    const wire = JSON.parse(body.input[0].content[0].text);
    let output;
    if (body.text.format.name === 'cairn_extract') {
      assert.equal(wire.inputMode, 'indexed-windows-v1');
      assert.deepEqual(wire.messages.map(entry => entry.index), [0, 1]);
      assert.equal(wire.messages[1].content, tail);
      output = { items: [{ content: 'Friday only, synthetic.', kind: 'context', confidence: 0.8,
        sourceIndices: [1] }] };
    } else if (body.text.format.name === 'cairn_qualifyCandidates') {
      const candidate = wire.items[0].candidates[0].candidateIndex;
      const field = (value, indices = []) => ({ value, evidenceIndices: indices });
      output = qualificationPoolWire(wire, { qualifications: [{ itemIndex: 0,
        subject: field(null), property: field(null), scope: field(null), applies: field(null),
        value: field(null, [candidate]), attribution: field('unknown'), commitment: field('unknown') }] });
    } else if (body.text.format.name === 'cairn_classify') {
      output = { items: wire.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
    } else assert.fail('Unexpected installed model method');
    return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
      incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
      usage: { input_tokens: 120, output_tokens: 60, total_tokens: 180 } });
  } });
  const path = join(root, 'memory.sqlite'); const core = openMemoryCore({ path, model,
    captureQualification: 'source-bound-v2', captureSourcePolicy: 'indexed-windows-v1' });
  t.after(() => core.close());
  const namespace = { ownerId: 'installed-window-test', scope: 'personal', projectId: null };
  const request = { namespace, client: 'synthetic', sessionId: 'session', eventId: 'batch',
    messages: [{ id: 'original-message', role: 'user', content: 'x'.repeat(800) + tail }] };
  const result = await core.capture(request);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.sourceWindowCatalog.windowCount, 2);
  const id = result.value.admission.memories[0].id;
  const stored = core.get({ namespace, memoryId: id, includeQualification: true });
  assert.equal(stored.ok, true);
  assert.deepEqual(stored.value.receipts.map(receipt => [receipt.eventId, receipt.role, receipt.excerpt]),
    [['original-message', 'user', tail]]);
  assert.equal(stored.value.qualification.anchors[0].text, tail);
  assert.equal(bodies.length, 6);
  assert.deepEqual(bodies[0].input, bodies[1].input);
  assert.deepEqual(bodies[0].text, bodies[1].text);
  const before = bodies.length;
  const duplicate = await core.capture(request);
  assert.equal(duplicate.ok, true); assert.equal(duplicate.value.duplicate, true);
  assert.equal(bodies.length, before);
});
