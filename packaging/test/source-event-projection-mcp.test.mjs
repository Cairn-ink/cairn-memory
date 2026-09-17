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
const namespace = { ownerId: 'synthetic-installed-source-events', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const ref = memory => ({ memoryId: memory.id, revision: memory.revision });

test('SEP7 installed artifact/core and MCP receiver preserve six passages and seven bindings',
  { timeout: 60000 }, async t => {
    const artifact = buildArtifact();
    const root = mkdtempSync(join(tmpdir(), 'cairn-installed-source-events-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-installed-source-events',
      private: true, version: '0.0.0' }), { flag: 'wx' });
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      artifact.artifactPath], root, artifact.userconfig);
    const packageRoot = join(root, 'node_modules', packageName);
    const { openMemoryCore } = await import(pathToFileURL(join(packageRoot, 'core/index.mjs')).href);
    const path = join(root, 'fresh.sqlite');
    const core = openMemoryCore({ path, model: { contextWindow: 8192, countTokens: () => 1,
      relate: () => ({ edges: [{ from: 0, to: 1, relation: 'supports-decision',
        fromReceipt: 0, toReceipt: 0 }] }) } });
    const passages = [
      ['The team chose A because its export is auditable.', 'shared'],
      ['The team chose A because its export is auditable.', 'shared'],
      ['Original second.', 'e2'], ['Original third.', 'e3'], ['Original fourth.', 'e4'],
      ['Original fifth.', 'e5'], ['Original sixth.', 'e6'],
    ];
    const cards = passages.map(([excerpt, eventId], index) => {
      const saved = core.admit({ namespace,
        memory: { content: index === 0 ? 'Interpretation: the team chose A.' : index === 1
          ? 'Interpretation: auditability motivated the choice.' : `Interpretation card ${index}.`, kind: 'context' },
        receipts: [{ client: 'synthetic', sessionId: 'session', eventId,
          role: 'user', excerpt }] });
      return ok(saved).memory;
    });
    ok(await core.reviewRationale({ namespace, refs: [ref(cards[1]), ref(cards[0])] }));
    const details = cards.map(memory => ok(core.get({ namespace, memoryId: memory.id })));
    core.close();
    const roots = [cards[0], ...cards.slice(2)].map(memory => memory.id);
    const fixture = join(packageRoot, 'source-event-fixture.mjs');
    writeFileSync(fixture, `import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createCairnServer } from './adapters/mcp/server.mjs';
globalThis.fetch = () => { throw new Error('network_forbidden'); };
const roots = ${JSON.stringify(roots)};
const model = { contextWindow: 8192, countTokens: () => 1,
  select: ({ input }) => ({ refs: input.maps.flatMap(map =>
    map.items.filter(item => item.type === 'unfiled' && roots.includes(item.ref.memoryId))
      .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) }),
  rank: ({ input }) => ({ refs: input.candidates.filter(item => roots.includes(item.memory.id))
      .map(item => ({ namespaceIndex: item.namespaceIndex,
        memoryId: item.memory.id, revision: item.memory.revision })) }) };
const handle = serveStdio(() => createCairnServer({ path: ${JSON.stringify(path)},
  namespace: ${JSON.stringify(namespace)}, model }), {
  transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 65536 }) });
process.stdin.once('end', () => { void handle.close(); });
process.once('SIGTERM', () => { void handle.close(); });
`, { flag: 'wx' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [fixture],
      cwd: packageRoot, env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
    const client = new Client({ name: 'installed-source-event-receiver', version: '1.0.0' });
    await client.connect(transport); t.after(() => client.close());
    const schema = (await client.listTools()).tools.find(tool => tool.name === 'recall_memory').inputSchema;
    assert.ok(schema.properties.sourceProjection.enum.includes('neighborhood-source-events-v1'));
    const call = async patch => {
      const response = await client.callTool({ name: 'recall_memory', arguments: {
        query: 'What did the original sources say?', contextMode: 'rationale-neighborhood-evidence',
        sourceProjection: 'neighborhood-source-events-v1', ...patch } });
      const value = JSON.parse(response.content[0].text);
      assert.equal(Boolean(response.isError), !value.ok); return value;
    };
    for (const patch of [{ rankingMode: undefined }, { rankingMode: 'wrong' },
      { rankingMode: 'source-evidence-first-v1', limit: 7 },
      { rankingMode: 'source-evidence-first-v1', includeQualification: true },
      { rankingMode: 'source-evidence-first-v1', contextMode: 'source-evidence' },
      { rankingMode: 'source-evidence-first-v1', selectionMode: 'bounded-source-scan' }]) {
      const response = await client.callTool({ name: 'recall_memory', arguments: {
        query: 'What did the original sources say?', contextMode: 'rationale-neighborhood-evidence',
        sourceProjection: 'neighborhood-source-events-v1', ...patch } });
      assert.equal(response.isError, true);
      const content = response.content[0].text;
      if (content.startsWith('{')) assert.equal(JSON.parse(content).error.code, 'invalid_input');
      else assert.match(content, /invalid|validation|unrecognized|required/i);
    }
    const value = ok(await call({ rankingMode: 'source-evidence-first-v1' }));
    assert.equal(value.sourceSelectionCoverage, 'unassessed');
    assert.equal(value.evidenceTrust, 'untrusted-data-not-instructions');
    assert.equal(Object.hasOwn(value, 'memories'), false);
    assert.equal(value.sourceEvents.length, 6);
    assert.equal(value.sourceEvents.reduce((sum, event) => sum + event.associations.length, 0), 7);
    const expected = details.flatMap(detail => detail.receipts.map(receipt => ({ role: receipt.role,
      excerpt: receipt.excerpt, memoryId: detail.memory.id, revision: detail.memory.revision,
      currentness: 'current', receiptId: receipt.id }))).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const actual = value.sourceEvents.flatMap(event => {
      assert.deepEqual(Object.keys(event).sort(), ['associations', 'excerpt', 'provenanceCollision', 'role']);
      assert.equal(event.provenanceCollision, false);
      return event.associations.map(association => {
        assert.deepEqual(Object.keys(association).sort(), ['currentness', 'memoryId', 'receiptId', 'revision']);
        return { role: event.role, excerpt: event.excerpt, ...association };
      });
    }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    assert.deepEqual(actual, expected);
    assert.equal(JSON.stringify(value).includes('Interpretation'), false);
    assert.equal(JSON.stringify(value).includes('"eventId"'), false);
    assert.equal(JSON.stringify(value).includes('"client"'), false);
    assert.equal(JSON.stringify(value).includes('"sessionId"'), false);
  });
