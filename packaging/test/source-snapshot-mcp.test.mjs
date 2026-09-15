import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildArtifact, command, packageName } from '../build.mjs';

const sdk = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(sdk.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(sdk.resolve('@modelcontextprotocol/client/stdio'));

test('installed keyless CLI returns bounded complete sources after cold restart and forgetting, without provider transport',
  { timeout: 60000 }, async t => {
    const artifact = buildArtifact(); const root = mkdtempSync(join(tmpdir(), 'cairn-installed-source-snapshot-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-source-snapshot', private: true, version: '0.0.0' }), { flag: 'wx' });
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath], root, artifact.userconfig);
    const packageRoot = join(root, 'node_modules', packageName);
    for (const file of ['adapters/mcp/cli.mjs', 'adapters/mcp/server.mjs', 'adapters/openai/index.mjs', 'core/contract.mjs', 'core/runtime.mjs']) {
      assert.equal(createHash('sha256').update(readFileSync(join(packageRoot, file))).digest('hex'), artifact.sourceHashes[file]);
    }
    const cli = join(root, 'node_modules/.bin/cairn-memory'), path = join(root, 'synthetic.sqlite');
    const args = ['--db', path, '--owner', 'synthetic-installed-reader', '--source-snapshot', 'current-admitted-v1'];
    const guard = 'data:text/javascript,globalThis.fetch=()=>{process.exit(91)}';
    const check = spawnSync(process.execPath, ['--import', guard, cli, '--check-config', ...args],
      { encoding: 'utf8', timeout: 5000, env: { NODE_NO_WARNINGS: '1' } });
    assert.equal(check.status, 0, check.stderr); const config = JSON.parse(check.stdout);
    assert.equal(config.sourceSnapshot, 'current-admitted-v1'); assert.equal(config.sourceSnapshotTokenizer, 'o200k_base');
    assert.equal(config.databaseOpened, false); assert.equal(config.providerContacted, false); assert.equal(existsSync(path), false);
    const start = async () => {
      const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', guard, cli, ...args],
        env: { NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
      const client = new Client({ name: 'synthetic-installed-reader', version: '1.0.0' });
      t.after(() => client.close()); await client.connect(transport); return client;
    };
    const call = async (client, name, args = {}) => {
      const response = await client.callTool({ name, arguments: args }); const result = JSON.parse(response.content[0].text);
      assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions'); assert.equal(Boolean(response.isError), !result.ok); return result;
    };
    const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
    const first = await start();
    const sources = ['Mira would attend only if an evening seat opens.', 'The quiet workshop is her stated reason.'];
    const memories = [];
    for (const content of sources) memories.push(ok(await call(first, 'remember_memory', { content })).memory);
    await first.close();
    const cold = await start(); const tools = (await cold.listTools()).tools;
    assert.equal(tools.length, 6); assert.equal(tools.find(tool => tool.name === 'read_memory_sources').annotations.openWorldHint, false);
    const complete = ok(await call(cold, 'read_memory_sources'));
    assert.equal(complete.coverage, 'complete-current-admitted'); assert.equal(complete.semanticCoverage, 'unassessed');
    assert.deepEqual(complete.memories.flatMap(item => item.receipts.map(receipt => receipt.excerpt)).sort(), [...sources].sort());
    assert.ok(complete.memories.every(item => item.namespaceIndex === 0 && item.interpretationStatus === 'omitted'
      && !Object.hasOwn(item.memory, 'content')));
    for (const bounds of [{ limit: 1 }, { tokenBudget: 1 }]) {
      const rejected = await call(cold, 'read_memory_sources', bounds);
      assert.equal(rejected.error.code, 'context_item_too_large'); assert.equal(Object.hasOwn(rejected, 'value'), false);
    }
    ok(await call(cold, 'forget_memory', { memoryId: memories[0].id, expectedRevision: memories[0].revision }));
    await cold.close();
    const final = await start(); const after = ok(await call(final, 'read_memory_sources', { limit: 1 }));
    assert.deepEqual(after.memories.map(item => item.memory.id), [memories[1].id]);
    assert.equal(JSON.stringify(after).includes(sources[0]), false);
    const relevance = await call(final, 'recall_memory', { query: 'What is relevant?' });
    assert.equal(relevance.error.code, 'model_not_configured');
  });
