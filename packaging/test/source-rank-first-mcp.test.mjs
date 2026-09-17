import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildArtifact, command, packageName } from '../build.mjs';

const sdk = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(sdk.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(sdk.resolve('@modelcontextprotocol/client/stdio'));
const namespace = { ownerId: 'synthetic-installed-source-first', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

test('SRF6 installed MCP ranks original sources before selected-root expansion in a fresh database',
  { timeout: 60000 }, async t => {
    const artifact = buildArtifact();
    const root = mkdtempSync(join(tmpdir(), 'cairn-installed-source-first-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-source-first',
      private: true, version: '0.0.0' }), { flag: 'wx' });
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      artifact.artifactPath], root, artifact.userconfig);
    const packageRoot = join(root, 'node_modules', packageName);
    const { openMemoryCore } = await import(pathToFileURL(join(packageRoot, 'core/index.mjs')).href);
    const path = join(root, 'fresh.sqlite');
    const model = { contextWindow: 8192, countTokens: () => 1,
      relate: () => ({ edges: [{ from: 0, to: 1, relation: 'supports-decision',
        fromReceipt: 0, toReceipt: 0 }] }) };
    const core = openMemoryCore({ path, model });
    const admit = name => ok(core.admit({ namespace, memory: { content: `Interpretation ${name}.`, kind: 'decision' },
      receipts: [{ client: 'synthetic', sessionId: 'synthetic', eventId: name,
        role: 'user', excerpt: `Original ${name}.` }] })).memory;
    const ref = memory => ({ memoryId: memory.id, revision: memory.revision });
    const good = admit('good'), bad = admit('bad');
    for (let i = 0; i < 6; i++) {
      const neighbor = admit(`bad-neighbor-${i}`);
      ok(await core.reviewRationale({ namespace, refs: [ref(neighbor), ref(bad)] }));
    }
    assert.equal(ok(core.fetch({ namespace, refs: [ref(good)],
      contextMode: 'rationale-neighborhood-evidence' })).items.length, 1);
    assert.equal(core.fetch({ namespace, refs: [ref(bad)],
      contextMode: 'rationale-neighborhood-evidence' }).error.code, 'rationale_limit');
    core.close();

    const fixture = join(packageRoot, 'source-first-fixture.mjs');
    writeFileSync(fixture, `import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createCairnServer } from './adapters/mcp/server.mjs';
globalThis.fetch = () => { throw new Error('network_forbidden'); };
const model = { contextWindow: 8192, countTokens: () => 1,
  select: ({ input }) => { process.stderr.write('select\\n'); return { refs: input.maps.flatMap(map => map.items.filter(item =>
    item.type === 'unfiled' && [${JSON.stringify(good.id)}, ${JSON.stringify(bad.id)}].includes(item.ref.memoryId))
    .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) }; },
  rank: ({ input }) => { process.stderr.write('rank:' + JSON.stringify(input) + '\\n');
    return { refs: input.candidates.filter(item => item.memory.id === ${JSON.stringify(good.id)})
      .map(item => ({ namespaceIndex: item.namespaceIndex, memoryId: item.memory.id,
        revision: item.memory.revision })) }; } };
const handle = serveStdio(() => createCairnServer({ path: ${JSON.stringify(path)},
  namespace: ${JSON.stringify(namespace)}, model }), {
  transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 65536 }) });
process.stdin.once('end', () => { void handle.close(); });
process.once('SIGTERM', () => { void handle.close(); });
`, { flag: 'wx' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [fixture],
      cwd: packageRoot, env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
    let stderr = ''; transport.stderr.on('data', chunk => { stderr += chunk; });
    const client = new Client({ name: 'installed-source-first', version: '1.0.0' });
    await client.connect(transport); t.after(() => client.close());
    const call = async args => {
      const response = await client.callTool({ name: 'recall_memory', arguments: { query: 'Original good?', ...args } });
      const parsed = JSON.parse(response.content[0].text);
      assert.equal(Boolean(response.isError), !parsed.ok); return parsed;
    };
    const base = { contextMode: 'rationale-neighborhood-evidence',
      sourceProjection: 'neighborhood-sources-v1' };
    assert.equal((await call(base)).error.code, 'rationale_limit');
    assert.equal(stderr.includes('rank:'), false);
    const result = ok(await call({ ...base, rankingMode: 'source-evidence-first-v1' }));
    assert.equal(result.rankingMode, 'source-evidence-first-v1');
    assert.deepEqual(result.memories.map(item => item.memory.id), [good.id]);
    assert.equal(JSON.stringify(result).includes('Interpretation'), false);
    const rankLine = stderr.split('\n').find(line => line.startsWith('rank:'));
    assert.ok(rankLine, stderr);
    const rank = JSON.parse(rankLine.slice(5));
    assert.deepEqual(new Set(rank.candidates.map(item => item.memory.id)), new Set([good.id, bad.id]));
    assert.ok(rank.candidates.every(item => !Object.hasOwn(item, 'rationale')));
    const beforeInvalid = stderr.split('\n').filter(line => line === 'select' || line.startsWith('rank:')).length;
    for (const invalid of [{ rankingMode: 'unknown' }, { rankingMode: 'source-evidence-first-v1' },
      { ...base, rankingMode: 'source-evidence-first-v1', selectionMode: 'bounded-source-scan' },
      { ...base, rankingMode: 'source-evidence-first-v1', includeQualification: true },
      { ...base, rankingMode: 'source-evidence-first-v1', contextMode: 'source-evidence' }]) {
      try {
        const response = await client.callTool({ name: 'recall_memory', arguments: { query: 'Original good?', ...invalid } });
        assert.equal(response.isError, true);
      } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
        assert.match(String(error), /invalid|validation|unrecognized|required/i);
      }
    }
    assert.equal(stderr.split('\n').filter(line => line === 'select' || line.startsWith('rank:')).length, beforeInvalid);
    assert.equal(stderr.split('\n').filter(line => line.startsWith('rank:')).length, 1);
  });
