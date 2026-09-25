import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildArtifact, command, packageName } from '../build.mjs';
import { startExperimentProxy } from '../../evaluation/live/proxy.mjs';

const sdk = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(sdk.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(sdk.resolve('@modelcontextprotocol/client/stdio'));
const owner = 'synthetic-keyset-installed';
const foreign = 'synthetic-keyset-foreign';
const policy = 'bounded-keyset-v1';
const marker = index => `sourcemarker${String(index).padStart(5, '0')}`;
const unwrap = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

test('Z6–Z7 actual installed public-admit 1025 source diagnostic survives cold lifecycle and owner isolation',
  { timeout: 180000 }, async t => {
    const artifact = buildArtifact();
    const root = mkdtempSync(join(tmpdir(), 'cairn-installed-keyset-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-installed-keyset', private: true }), { flag: 'wx' });
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath],
      root, artifact.userconfig);
    const installed = join(root, 'node_modules', packageName);
    for (const file of ['adapters/mcp/cli.mjs', 'adapters/mcp/server.mjs', 'core/contract.mjs',
      'core/query-candidates.mjs', 'core/runtime.mjs']) {
      assert.equal(createHash('sha256').update(readFileSync(join(installed, file))).digest('hex'), artifact.sourceHashes[file]);
    }
    const { openMemoryCore } = await import(pathToFileURL(join(installed, 'core/contract.mjs')).href);
    const path = join(root, 'synthetic.sqlite');
    const namespace = { ownerId: owner, scope: 'personal', projectId: null };
    const core = openMemoryCore({ path });
    let coreOpen = true;
    const admissions = [];
    try {
      for (let index = 0; index < 1025; index++) {
        const source = `${marker(index)} retained original source`;
        const memory = unwrap(core.admit({ namespace,
          memory: { content: `Generic synthetic note ${String(index).padStart(5, '0')}`, kind: 'fact' },
          receipts: [{ client: 'synthetic-installed', sessionId: 'public-admit',
            eventId: `event-${index}`, role: 'user', excerpt: source }] })).memory;
        admissions.push({ memory, source });
      }
      const target = admissions.toSorted((a, b) => a.memory.id.localeCompare(b.memory.id)).at(-1);
      const query = target.source.split(' ')[0];
      assert.equal(unwrap(core.get({ namespace, memoryId: target.memory.id })).receipts[0].excerpt, target.source);
      assert.equal(admissions.filter(item => item.memory.id.localeCompare(target.memory.id) < 0).length, 1024);
      core.close();
      coreOpen = false;

      const proxy = await startExperimentProxy({ session: { request: async (route, body) => {
        const payload = JSON.parse(body);
        if (route === '/responses/input_tokens') return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
        const input = JSON.parse(payload.input[0].content[0].text);
        let output;
        if (payload.text.format.name === 'cairn_select') {
          // The scripted model sees only its query and visible map labels, not a target ID oracle.
          const refs = input.maps.flatMap(page => page.items.filter(item => item.label?.split(/\s+/u).includes(input.query))
            .map(item => ({ namespaceIndex: page.namespaceIndex, ...(item.type === 'unfiled' ? item.ref : {
              memoryId: item.ref.childId, revision: item.ref.childRevision }) })));
          output = { refs: refs.slice(0, input.maxRefs) };
        } else if (payload.text.format.name === 'cairn_rank') {
          output = { refs: input.candidates.filter(item => item.receipts?.some(receipt =>
            receipt.excerpt.split(/\s+/u).includes(input.query))).slice(0, input.limit).map(item => ({
            namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision })) };
        } else assert.fail('unexpected model method');
        return Response.json({ object: 'response', model: payload.model, status: 'completed', error: null,
          incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
          usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } });
      } } });
      t.after(() => proxy.close());
      const preload = `const nativeFetch=globalThis.fetch;globalThis.fetch=(url,options)=>{
        const target=new URL(url);if(target.origin!=='https://api.openai.com'||target.search||target.hash||
        !['/v1/responses','/v1/responses/input_tokens'].includes(target.pathname))throw new Error('test_route_denied');
        return nativeFetch(${JSON.stringify(proxy.url)}+target.pathname,options);};`;
      const env = { OPENAI_API_KEY: proxy.token, NODE_NO_WARNINGS: '1',
        NODE_OPTIONS: `--import=data:text/javascript;base64,${Buffer.from(preload).toString('base64')}` };
      const executable = join(installed, 'bin/cairn-memory.mjs');
      const flags = ['--db', path, '--owner', owner];
      const check = spawnSync(process.execPath, [executable, '--check-config', ...flags, '--source-candidate-policy', policy],
        { encoding: 'utf8', timeout: 5000, env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' } });
      assert.equal(check.status, 0, check.stderr);
      assert.equal(JSON.parse(check.stdout).sourceCandidatePolicy, policy);
      assert.equal(JSON.parse(check.stdout).databaseOpened, false);
      const start = async (ownerId = owner, enabled = true) => {
        const client = new Client({ name: 'synthetic-keyset-installed', version: '1.0.0' });
        t.after(() => client.close());
        await client.connect(new StdioClientTransport({ command: process.execPath,
          args: [executable, '--db', path, '--owner', ownerId,
            ...(enabled ? ['--source-candidate-policy', policy] : [])], env, stderr: 'ignore' }));
        return client;
      };
      const call = async (client, name, args) => {
        const response = await client.callTool({ name, arguments: args });
        const result = JSON.parse(response.content[0].text);
        assert.equal(Boolean(response.isError), !result.ok);
        assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
        return result;
      };
      const plain = await start(owner, false);
      assert.equal((await plain.listTools()).tools.length, 5);
      assert.equal(unwrap(await call(plain, 'recall_memory', { query, contextMode: 'source-evidence', limit: 1 }))
        .memories.some(item => item.memory.id === target.memory.id), false);
      await plain.close();
      const cold = await start();
      assert.equal((await cold.listTools()).tools.length, 5);
      const body = unwrap(await call(cold, 'recall_memory', { query, limit: 1 }));
      assert.equal(body.memories.some(item => item.memory.id === target.memory.id), false);
      for (const contextMode of ['source-evidence', 'rationale-evidence']) {
        const found = unwrap(await call(cold, 'recall_memory', { query, contextMode, limit: 1 }));
        assert.equal(found.memories[0]?.memory.id, target.memory.id);
        assert.equal(found.memories[0]?.receipts[0]?.excerpt, target.source);
        assert.equal(found.coverage, 'budget_exhausted');
      }
      const detail = unwrap(await call(cold, 'inspect_memory', { memoryId: target.memory.id }));
      assert.equal(detail.receipts[0].excerpt, target.source);
      const foreignClient = await start(foreign);
      assert.equal((await call(foreignClient, 'inspect_memory', { memoryId: target.memory.id })).error.code,
        'memory_not_found');
      assert.equal(unwrap(await call(foreignClient, 'recall_memory', { query, contextMode: 'source-evidence' }))
        .memories.length, 0);
      await foreignClient.close();
      const revised = `revisedmarker${query.slice('sourcemarker'.length)} corrected source`;
      const corrected = unwrap(await call(cold, 'correct_memory', { memoryId: target.memory.id,
        expectedRevision: target.memory.revision, content: revised, kind: 'fact' })).memory;
      assert.equal(corrected.revision, target.memory.revision + 1);
      await cold.close();
      const restarted = await start();
      assert.equal(unwrap(await call(restarted, 'recall_memory', { query, contextMode: 'source-evidence' }))
        .memories.some(item => item.memory.id === target.memory.id), false);
      const revisedQuery = revised.split(' ')[0];
      const newResult = unwrap(await call(restarted, 'recall_memory', { query: revisedQuery,
        contextMode: 'source-evidence', limit: 1 }));
      assert.equal(newResult.memories[0]?.memory.id, target.memory.id);
      assert.equal(newResult.memories[0]?.memory.revision, corrected.revision);
      assert.equal(newResult.memories[0]?.receipts[0]?.excerpt, revised);
      unwrap(await call(restarted, 'forget_memory', { memoryId: target.memory.id,
        expectedRevision: corrected.revision }));
      await restarted.close();
      const final = await start();
      for (const stale of [query, revisedQuery]) {
        assert.equal(unwrap(await call(final, 'recall_memory', { query: stale,
          contextMode: 'source-evidence', limit: 1 })).memories.length, 0);
      }
      assert.equal(existsSync(path), true);
    } finally { if (coreOpen) core.close(); }
  });
