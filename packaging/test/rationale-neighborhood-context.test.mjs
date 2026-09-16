import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { buildArtifact, command, packageName } from '../build.mjs';
import { startExperimentProxy } from '../../evaluation/live/proxy.mjs';

const sdk = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(sdk.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(sdk.resolve('@modelcontextprotocol/client/stdio'));
const namespace = { ownerId: 'synthetic-neighborhood-installed', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

test('RN5 installed MCP ranks and returns the selected old root neighborhood, then keyless cold reopen preserves graph',
  { timeout: 60000 }, async t => {
    const artifact = buildArtifact();
    const root = mkdtempSync(join(tmpdir(), 'cairn-installed-neighborhood-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-neighborhood', private: true,
      version: '0.0.0' }), { flag: 'wx' });
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      artifact.artifactPath], root, artifact.userconfig);
    const packageRoot = join(root, 'node_modules', packageName), path = join(root, 'memory.sqlite');
    for (const file of ['core/contract.mjs', 'core/rationale-storage.mjs', 'core/runtime.mjs',
      'adapters/mcp/server.mjs']) assert.equal(readFileSync(join(packageRoot, file), 'utf8'),
      readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'));
    const { openMemoryCore } = await import(pathToFileURL(join(packageRoot, 'core/index.mjs')).href);
    let edges = [];
    const core = openMemoryCore({ path, model: { contextWindow: 8192, countTokens: () => 1,
      relate: () => ({ edges }) } });
    const texts = [
      'The team chose A because its price was low.',
      'The team also chose A because it passed quality tests.',
      'New tests show A no longer passes the quality requirement.',
      'The team later chose B, explicitly using the earlier A price comparison as a reason.',
    ];
    const memories = texts.map((excerpt, index) => ok(core.admit({ namespace,
      memory: { content: excerpt, kind: 'decision' }, receipts: [{ client: 'synthetic', sessionId: 'synthetic',
        eventId: `event-${index}`, role: 'user', excerpt }] })).memory);
    const refs = memories.map(memory => ({ memoryId: memory.id, revision: memory.revision }));
    const link = async (from, to, relation) => {
      edges = [{ from: 0, to: 1, relation, fromReceipt: 0, toReceipt: 0 }];
      ok(await core.reviewRationale({ namespace, refs: [refs[from], refs[to]] }));
    };
    await link(1, 0, 'supports-decision');
    await link(2, 1, 'challenges-premise');
    await link(0, 3, 'supports-decision');
    const before = refs.map(ref => ok(core.getRationale({ namespace, ...ref, view: 'incident-proposals' })));
    const oldContext = ok(core.getRationale({ namespace, ...refs[0] }));
    assert.equal(oldContext.edges.length, 2);
    core.close();

    const rankInputs = []; let sends = 0;
    const proxy = await startExperimentProxy({ session: { request: async (route, body) => {
      sends++;
      if (route.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
      const payload = JSON.parse(body), input = JSON.parse(payload.input[0].content[0].text);
      let output;
      if (payload.text.format.name === 'cairn_select') {
        const visible = input.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled')
          .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref })));
        output = { refs: visible.filter(item => item.memoryId === memories[0].id) };
      } else if (payload.text.format.name === 'cairn_rank') {
        rankInputs.push({ input, instructions: payload.instructions });
        assert.equal(input.candidates.length, 1);
        output = { refs: input.candidates.map(item => ({ namespaceIndex: item.namespaceIndex,
          memoryId: item.memory.id, revision: item.memory.revision })) };
      } else assert.fail(`unexpected method ${payload.text.format.name}`);
      return Response.json({ object: 'response', model: payload.model, status: 'completed', error: null,
        incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
    } } });
    const config = join(root, 'transport.json');
    writeFileSync(config, JSON.stringify({ version: 1, packageRoot, proxyUrl: proxy.url }), { mode: 0o600, flag: 'wx' });
    let active;
    t.after(async () => { if (active) await active.close(); await proxy.close(); });
    const start = async token => {
      active = new Client({ name: 'installed-neighborhood-test', version: '1.0.0' });
      await active.connect(new StdioClientTransport({ command: process.execPath,
        args: [fileURLToPath(new URL('../../evaluation/live/cairn-launcher.mjs', import.meta.url)),
          '--db', path, '--owner', namespace.ownerId, '--capture-qualification', 'source-bound-v2',
          '--capture-rationale', 'source-bound-v1'],
        env: { CAIRN_LIVE_CONFIG: config, OPENAI_API_KEY: token, NODE_NO_WARNINGS: '1' }, stderr: 'pipe' }));
    };
    const call = async (name, args) => {
      const response = await active.callTool({ name, arguments: args });
      const result = JSON.parse(response.content[0].text);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
      return result.value;
    };
    await start(proxy.token);
    const query = 'Why choose A and what happened later?';
    const old = await call('recall_memory', { query, contextMode: 'rationale-evidence' });
    assert.equal(old.memories.length, 1); assert.equal(old.memories[0].memory.id, memories[0].id);
    assert.equal(old.memories[0].rationale.edges.length, 2);
    const expanded = await call('recall_memory', { query, contextMode: 'rationale-neighborhood-evidence' });
    assert.equal(expanded.memories.length, 1);
    const item = expanded.memories[0];
    assert.equal(item.memory.id, memories[0].id);
    assert.equal(item.rationale.coverage, 'bounded-root-neighborhood');
    assert.equal(item.rationale.status, 'unassessed');
    assert.equal(item.rationale.edges.length, 3);
    assert.ok(item.rationale.edges.every(edge => edge.interpretationStatus === 'model-proposed'));
    assert.ok(item.rationale.edges.some(edge => edge.from === memories[2].id && edge.to === memories[1].id));
    assert.ok(item.rationale.edges.some(edge => edge.from === memories[0].id && edge.to === memories[3].id));
    assert.deepEqual(new Set(item.rationale.sources.map(source => source.receipts[0].excerpt)), new Set(texts));
    assert.ok(item.rationale.sources.every(source => source.memory.revision === 1));
    assert.deepEqual(rankInputs.at(-1).input.candidates[0].rationale, item.rationale);
    assert.equal(rankInputs.at(-1).instructions,
      readFileSync(join(packageRoot, 'core/prompts/recall-rank-rationale-evidence.md'), 'utf8'));
    assert.equal(JSON.stringify(item).includes('synthetic-neighborhood-installed'), false);
    await active.close(); active = undefined;
    const beforeCold = sends;
    await start('');
    assert.deepEqual(await call('inspect_rationale', refs[0]), oldContext);
    for (const [index, ref] of refs.entries()) assert.deepEqual(await call('inspect_rationale',
      { ...ref, view: 'incident-proposals' }), before[index]);
    assert.equal(sends, beforeCold);
    await active.close(); active = undefined;
    const reopened = openMemoryCore({ path }); t.after(() => reopened.close());
    for (const [index, ref] of refs.entries()) assert.deepEqual(ok(reopened.getRationale({ namespace,
      ...ref, view: 'incident-proposals' })), before[index]);
  });
