import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRationaleDispositionControl } from '../../evaluation/architecture/rationale-disposition-control.mjs';
import { buildArtifact, command, packageName } from '../build.mjs';

test('DC4 installed adapter and installed core proposal helper use two fake phases with expanded source-only input',
  { timeout: 60000 }, async () => {
    const artifact = buildArtifact();
    const root = mkdtempSync(join(tmpdir(), 'cairn-installed-disposition-control-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-control',
      private: true, version: '0.0.0' }), { flag: 'wx' });
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      artifact.artifactPath], root, artifact.userconfig);
    const installed = join(root, 'node_modules', packageName);
    const { createOpenAIModel } = await import(pathToFileURL(join(installed, 'adapters/openai/index.mjs')).href);
    const { proposeRationale } = await import(pathToFileURL(join(installed, 'core/rationale.mjs')).href);
    const calls = [];
    const model = createOpenAIModel({ apiKey: 'synthetic', rationaleModel: 'gpt-5.6-luna',
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body); calls.push({ url, body, signal: options.signal });
        if (url.endsWith('/input_tokens')) {
          return Response.json({ object: 'response.input_tokens', input_tokens: 180 });
        }
        return Response.json({ object: 'response', model: body.model, status: 'completed',
          error: null, incomplete_details: null,
          output: [{ type: 'message', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: JSON.stringify({ edges: [
              { from: 1, to: 0, relation: 'supports-decision', fromReceipt: 0, toReceipt: 0 },
            ] }) }] }],
          usage: { input_tokens: 180, output_tokens: 60, total_tokens: 240 } });
      } });
    const oldEdges = [{ index: 0, from: 1, to: 0, relation: 'supports-decision',
      fromReceipt: 0, toReceipt: 0, interpretationStatus: 'unverified' }];
    const control = createRationaleDispositionControl(model, oldEdges);
    const sources = [
      { receipts: [{ role: 'user', excerpt: 'Team chose A because it was affordable.' }] },
      { receipts: [{ role: 'user', excerpt: 'A was cheaper at the time.' }] },
    ];
    let fresh = 0;
    const result = await proposeRationale(control, sources, () => { fresh++; });
    assert.deepEqual(result, [{ from: 1, to: 0, relation: 'supports-decision',
      fromReceipt: 0, toReceipt: 0 }]);
    assert.ok(fresh >= 2);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(call => call.url),
      ['https://api.openai.com/v1/responses/input_tokens', 'https://api.openai.com/v1/responses']);
    const { max_output_tokens, store, stream, ...counted } = calls[1].body;
    assert.deepEqual(counted, calls[0].body);
    assert.equal(max_output_tokens, 1024); assert.equal(store, false); assert.equal(stream, false);
    assert.equal(calls[0].body.model, 'gpt-5.6-luna');
    assert.equal(calls[0].body.text.format.name, 'cairn_relate');
    assert.deepEqual(calls[0].body.reasoning, { effort: 'none' });
    assert.equal(calls[0].signal, calls[1].signal);
    const transmitted = JSON.parse(calls[1].body.input[0].content[0].text);
    assert.deepEqual(transmitted, { memories: [
      { index: 0, receipts: [{ index: 0, role: 'user', excerpt: sources[0].receipts[0].excerpt }] },
      { index: 1, receipts: [{ index: 0, role: 'user', excerpt: sources[1].receipts[0].excerpt }] },
    ], oldEdges });
    assert.equal(JSON.stringify(calls).includes('ownerId'), false);
    assert.match(calls[1].body.instructions, /Old edges are unverified earlier model proposals/);
    assert.match(calls[1].body.instructions, /supports-decision: the from source states a premise/);
    assert.equal(Object.hasOwn(calls[1].body.text.format.schema.properties, 'dispositions'), false);
    // The facade is evaluation source only and is not exported by the archive.
    assert.equal(artifact.sourceHashes['evaluation/architecture/rationale-disposition-control.mjs'], undefined);
  });
