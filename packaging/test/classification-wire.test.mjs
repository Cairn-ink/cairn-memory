import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { buildArtifact, command, packageName } from '../build.mjs';

test('installed adapter packages classification wire aliases and round-trips only original IDs', { timeout: 60_000 }, async (t) => {
  const artifact = buildArtifact();
  const root = mkdtempSync(join(tmpdir(), 'cairn-installed-classification-wire-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'synthetic-classification-wire', private: true, version: '0.0.0',
  }), { flag: 'wx' });
  command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    artifact.artifactPath], root, artifact.userconfig);
  assert.ok(artifact.files.includes('adapters/openai/classification-wire.mjs'));

  const packageRoot = join(root, 'node_modules', packageName);
  const { createOpenAIModel } = await import(pathToFileURL(join(packageRoot, 'adapters/openai/index.mjs')).href);
  const memoryId = '10000000-0000-4000-8000-000000000001';
  const mocId = '20000000-0000-4000-8000-000000000001';
  const bodies = [];
  const model = createOpenAIModel({ apiKey: 'synthetic-installed-key', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); bodies.push(body);
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    const wire = JSON.parse(body.input[0].content[0].text);
    const output = { items: [{ memoryId: wire.memories[0].id, parentIds: [wire.map[0].moc.id] }] };
    return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
      incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
  } });
  const input = { memories: [{ id: memoryId, content: `Literal ${mocId} stays content.`, revision: 1 }],
    map: [{ type: 'moc', moc: { id: mocId, level: 'L1', title: `Literal ${memoryId} stays title.` } }],
    mapExhausted: true };
  const output = await model.classify({ system: 'Synthetic installed classification.', input,
    maxOutputTokens: 1024, signal: new AbortController().signal });
  assert.deepEqual(output, { items: [{ memoryId, parentIds: [mocId] }] });
  assert.equal(bodies.length, 2);
  const wire = JSON.parse(bodies[0].input[0].content[0].text);
  assert.equal(wire.memories[0].id, 'm0');
  assert.equal(wire.map[0].moc.id, 'c0');
  assert.equal(wire.memories[0].content, input.memories[0].content);
  assert.equal(wire.map[0].moc.title, input.map[0].moc.title);
  assert.equal(JSON.stringify(bodies[0].text.format.schema).includes(memoryId), false);
  assert.equal(JSON.stringify(bodies[0].text.format.schema).includes(mocId), false);
});
