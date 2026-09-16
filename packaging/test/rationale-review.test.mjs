import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildArtifact, command, packageName } from '../build.mjs';

const sdk = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(sdk.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(sdk.resolve('@modelcontextprotocol/client/stdio'));
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

test('installed CLI corrects a scripted mistaken proposed challenge and cold keyless inspection uses no HTTP',
  { timeout: 60000 }, async t => {
    const artifact = buildArtifact(); const root = mkdtempSync(join(tmpdir(), 'cairn-installed-review-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-review',
      private: true, version: '0.0.0' }), { flag: 'wx' });
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      artifact.artifactPath], root, artifact.userconfig);
    const packageRoot = join(root, 'node_modules', packageName);
    for (const file of ['adapters/mcp/server.mjs', 'adapters/mcp/cli.mjs', 'core/contract.mjs', 'core/rationale-storage.mjs']) {
      assert.equal(createHash('sha256').update(readFileSync(join(packageRoot, file))).digest('hex'), artifact.sourceHashes[file]);
    }
    const path = join(root, 'memory.sqlite'); const phase = join(root, 'phase');
    writeFileSync(phase, 'capture');
    const preload = fileURLToPath(new URL('./fixtures/rationale-review-fetch.mjs', import.meta.url));
    const baseFlags = ['--db', path, '--owner', 'synthetic-review', '--rationale-review', 'replace-reviewed-v1'];
    let active;
    const start = async (flags, key) => {
      const transport = new StdioClientTransport({ command: process.execPath,
        args: ['--import', preload, join(root, 'node_modules/.bin/cairn-memory'), ...baseFlags, ...flags],
        env: { OPENAI_API_KEY: key, SYNTHETIC_REVIEW_PHASE: phase,
          SYNTHETIC_DENY_FETCH: key ? '0' : '1', NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
      let stderr = ''; transport.stderr.on('data', chunk => { stderr += chunk; });
      const client = new Client({ name: 'installed-review-test', version: '1.0.0' });
      await client.connect(transport);
      active = client;
      return { client, close: () => client.close(), stderr: () => stderr };
    };
    t.after(async () => { if (active) await active.close(); });
    const call = async (host, name, args) => {
      const response = await host.client.callTool({ name, arguments: args });
      const result = JSON.parse(response.content[0].text);
      assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
      assert.equal(Boolean(response.isError), !result.ok); return result;
    };
    const first = await start(['--capture-qualification', 'source-bound-v2',
      '--capture-rationale', 'source-bound-v1'], 'synthetic-not-a-provider-key');
    const names = (await first.client.listTools()).tools.map(tool => tool.name);
    assert.equal(names.filter(name => name === 'inspect_rationale').length, 1);
    assert.ok(names.includes('capture_memory')); assert.ok(names.includes('review_rationale'));
    const batches = [['one', 'I chose A because it supports offline work.'],
      ['two', 'The old note claiming A cannot work offline is a mistaken report.']]
      .map(([batchId, content]) => ({ batchId, messages: [{ role: 'user', content }] }));
    const captured = [];
    for (const batch of batches) {
      const result = ok(await call(first, 'capture_memory', batch));
      assert.equal(result.rationale.status, 'reviewed');
      captured.push(result);
    }
    const decision = captured[0].admission.memories[0];
    const report = captured[1].admission.memories[0];
    const ref = memory => ({ memoryId: memory.id, revision: memory.revision });
    const refs = [ref(decision), ref(report)];
    const original = ok(await call(first, 'inspect_memory', { memoryId: decision.id }));
    const wrong = ok(await call(first, 'inspect_rationale', ref(decision)));
    assert.equal(wrong.status, 'reconfirmation-suggested'); assert.equal(wrong.edges.length, 2);
    assert.ok(wrong.sources.some(source => source.receipts.some(receipt =>
      receipt.excerpt.includes('mistaken report'))));
    writeFileSync(phase, 'review');
    const corrected = ok(await call(first, 'review_rationale', { refs }));
    assert.equal(corrected.writeMode, 'replace-reviewed');
    assert.equal(corrected.proposed, 1); assert.equal(corrected.inserted, 0); assert.equal(corrected.removed, 1);
    assert.deepEqual(ok(await call(first, 'inspect_memory', { memoryId: decision.id })), original);
    assert.equal(ok(await call(first, 'inspect_rationale', ref(decision))).status, 'unassessed');
    await first.close(); active = null;
    const calls = first.stderr().match(/synthetic_review_fetch:[^\n]+/g) ?? [];
    assert.equal(calls.length, 18);
    assert.deepEqual(Object.fromEntries(['extract', 'qualifyCandidates', 'classify', 'relate'].map(method =>
      [method, calls.filter(call => call.includes(`:${method}:`)).length])),
    { extract: 4, qualifyCandidates: 4, classify: 4, relate: 6 });
    assert.equal(calls.filter(call => call.endsWith('/v1/responses/input_tokens')).length, 9);
    assert.equal(calls.filter(call => call.endsWith('/v1/responses')).length, 9);

    const cold = await start([], '');
    const persisted = ok(await call(cold, 'inspect_rationale', ref(decision)));
    assert.equal(persisted.status, 'unassessed'); assert.equal(persisted.edges.length, 1);
    assert.deepEqual(ok(await call(cold, 'inspect_memory', { memoryId: decision.id })), original);
    const withoutModel = await call(cold, 'review_rationale', { refs });
    assert.equal(withoutModel.ok, false); assert.equal(withoutModel.error.code, 'model_not_configured');
    await cold.close(); active = null;
    assert.equal(cold.stderr().includes('synthetic_review_fetch:'), false);
    assert.equal(cold.stderr().includes('synthetic_unexpected_fetch'), false);
  });
