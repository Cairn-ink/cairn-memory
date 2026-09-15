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

test('installed MCP stages failed source and reopens keylessly in access-only mode without retention or retry',
  { timeout: 60000 }, async t => {
    const artifact = buildArtifact();
    const root = mkdtempSync(join(tmpdir(), 'cairn-installed-staged-mcp-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-staged-mcp',
      private: true, version: '0.0.0' }), { flag: 'wx' });
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      artifact.artifactPath], root, artifact.userconfig);
    const packageRoot = join(root, 'node_modules', packageName);
    for (const file of ['adapters/mcp/server.mjs', 'adapters/mcp/cli.mjs']) {
      assert.equal(createHash('sha256').update(readFileSync(join(packageRoot, file))).digest('hex'), artifact.sourceHashes[file]);
    }
    const start = async (flags, { key = '', deny = true, owner = 'synthetic-staging' } = {}) => {
      const transport = new StdioClientTransport({ command: process.execPath,
        args: ['--import', fileURLToPath(new URL('./fixtures/staged-evidence-fetch.mjs', import.meta.url)),
          join(root, 'node_modules/.bin/cairn-memory'), '--db', join(root, 'memory.sqlite'), '--owner', owner, ...flags],
        env: { OPENAI_API_KEY: key, SYNTHETIC_DENY_FETCH: deny ? '1' : '0', NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
      let stderr = ''; transport.stderr.on('data', chunk => { stderr += chunk; });
      const client = new Client({ name: 'synthetic-installed-staging', version: '1.0.0' });
      t.after(() => client.close()); await client.connect(transport);
      return { client, close: () => client.close(), calls: () => (stderr.match(/synthetic_staging_fetch/g) ?? []).length };
    };
    const call = async (host, name, args = {}) => {
      const response = await host.client.callTool({ name, arguments: args });
      const result = JSON.parse(response.content[0].text);
      assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
      assert.equal(Boolean(response.isError), !result.ok); return result;
    };
    const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
    const stageFlags = ['--capture-qualification', 'source-bound-v2', '--capture-evidence', 'staged-v1'];
    const accessFlags = ['--capture-evidence-access', 'staged-v1'];
    const source = 'Synthetic source kept separate from interpretation.';
    const batch = { batchId: 'installed-failed', messages: [{ role: 'assistant', content: source }] };
    const first = await start(stageFlags, { key: 'synthetic-not-a-provider-key', deny: false });
    assert.equal((await call(first, 'capture_memory', batch)).ok, false);
    assert.equal(first.calls(), 4);
    const saved = ok(await call(first, 'inspect_capture_evidence', { batchId: batch.batchId })).evidence;
    assert.equal(saved.state, 'failed');
    assert.deepEqual(saved.view.messages, [{ role: 'assistant', content: source,
      id: createHash('sha256').update(JSON.stringify(['cairn.mcp.submitted-message.v1', batch.batchId, 0])).digest('hex') }]);
    assert.deepEqual(ok(await call(first, 'inspect_memory')).memories, []);
    assert.equal(first.calls(), 4); await first.close();

    const cold = await start(accessFlags);
    const names = (await cold.client.listTools()).tools.map(tool => tool.name);
    assert.equal(names.length, 7); assert.equal(names.includes('capture_memory'), false);
    assert.deepEqual(ok(await call(cold, 'inspect_capture_evidence', { batchId: batch.batchId })).evidence, saved);
    const other = await start(accessFlags, { owner: 'synthetic-other' });
    assert.equal(ok(await call(other, 'inspect_capture_evidence', { batchId: batch.batchId })).evidence, null);
    await other.close();
    assert.deepEqual(ok(await call(cold, 'discard_capture_evidence', { batchId: batch.batchId })), { discarded: true });
    assert.equal(ok(await call(cold, 'inspect_capture_evidence', { batchId: batch.batchId })).evidence.view, null);
    assert.deepEqual(ok(await call(cold, 'discard_capture_evidence', { batchId: batch.batchId })), { discarded: false });
    assert.equal(cold.calls(), 0); await cold.close();
    for (const flags of [stageFlags, ['--capture-qualification', 'source-bound-v2']]) {
      const replay = await start(flags, { key: 'synthetic-not-a-provider-key' });
      const rejected = await call(replay, 'capture_memory', batch);
      assert.equal(rejected.ok, false); assert.equal(rejected.error.code, 'capture_evidence_closed');
      assert.equal(replay.calls(), 0); await replay.close();
    }
  });
