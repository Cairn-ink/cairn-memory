import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildArtifact, command, packageName } from '../build.mjs';
import { deliverSourceEventAnswer } from '../../evaluation/live/source-event-answer-delivery.mjs';
import { SOURCE_ANSWER_MODEL, SOURCE_ANSWER_INSTRUCTION } from '../../evaluation/live/installed-source-answer-delivery.mjs';

const sdk = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(sdk.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(sdk.resolve('@modelcontextprotocol/client/stdio'));
const namespace = { ownerId: 'synthetic-installed-answer-events', scope: 'personal', projectId: null };
const question = 'Why did the team choose A?';
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const ref = memory => ({ memoryId: memory.id, revision: memory.revision });

test('EAC5 actual installed stdio result reaches one fake answer with six events and seven receipt bindings',
  { timeout: 60000 }, async t => {
    const archive = buildArtifact();
    const root = mkdtempSync(join(tmpdir(), 'cairn-installed-event-answer-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-event-answer',
      private: true, version: '0.0.0' }), { flag: 'wx' });
    command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      archive.artifactPath], root, archive.userconfig);
    const packageRoot = join(root, 'node_modules', packageName);
    const { openMemoryCore } = await import(pathToFileURL(join(packageRoot, 'core/index.mjs')).href);
    const path = join(root, 'fresh.sqlite');
    const model = { contextWindow: 8192, countTokens: () => 1,
      relate: () => ({ edges: [{ from: 0, to: 1, relation: 'supports-decision',
        fromReceipt: 0, toReceipt: 0 }] }) };
    const core = openMemoryCore({ path, model });
    const passages = [
      ['The team chose A because its export is auditable.', 'shared'],
      ['The team chose A because its export is auditable.', 'shared'],
      ['Original second.', 'e2'], ['Original third.', 'e3'], ['Original fourth.', 'e4'],
      ['Original fifth.', 'e5'], ['Original sixth.', 'e6'],
    ];
    const cards = passages.map(([excerpt, eventId], index) => {
      const saved = core.admit({ namespace,
        memory: { content: index === 0 ? 'Interpretation: team chose A.' : index === 1
          ? 'Interpretation: auditability was a reason.' : `Interpretation card ${index}.`, kind: 'context' },
        receipts: [{ client: 'synthetic', sessionId: 'session', eventId, role: 'user', excerpt }] });
      return ok(saved).memory;
    });
    ok(await core.reviewRationale({ namespace, refs: [ref(cards[1]), ref(cards[0])] }));
    const snapshot = current => ({ cards: cards.map(memory => ok(current.get({ namespace, memoryId: memory.id }))),
      graph: ok(current.fetch({ namespace, refs: [ref(cards[0])],
        contextMode: 'rationale-neighborhood-evidence' })) });
    const before = snapshot(core); core.close();
    const roots = [cards[0], ...cards.slice(2)].map(memory => memory.id);
    const fixture = join(packageRoot, 'source-event-answer-fixture.mjs');
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
    const client = new Client({ name: 'installed-event-answer-receiver', version: '1.0.0' });
    await client.connect(transport); t.after(() => client.close());
    const toolResult = await client.callTool({ name: 'recall_memory', arguments: { query: question,
      contextMode: 'rationale-neighborhood-evidence', sourceProjection: 'neighborhood-source-events-v1',
      rankingMode: 'source-evidence-first-v1', limit: 6 } });
    assert.equal(toolResult.isError, false);
    const envelope = JSON.parse(toolResult.content[0].text);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.value.sourceEvents.length, 6);
    const expected = before.cards.flatMap(item => item.receipts.map(receipt => ({
      role: receipt.role, excerpt: receipt.excerpt, memoryId: item.memory.id,
      revision: item.memory.revision, currentness: 'current', receiptId: receipt.id,
    }))).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    let calls = 0;
    const result = await deliverSourceEventAnswer({ question, toolResult,
      requestedContextMode: 'rationale-neighborhood-evidence',
      requestedSourceProjection: 'neighborhood-source-events-v1',
      requestedRankingMode: 'source-evidence-first-v1',
      complete: async body => {
        calls++;
        assert.equal(body.model, SOURCE_ANSWER_MODEL);
        assert.equal(body.messages[0].content, SOURCE_ANSWER_INSTRUCTION);
        const payload = JSON.parse(body.messages[1].content);
        assert.deepEqual(Object.keys(payload).sort(), ['question', 'sourceEvents']);
        assert.equal(payload.question, question);
        assert.deepEqual(payload.sourceEvents, envelope.value.sourceEvents);
        assert.equal(payload.sourceEvents.length, 6);
        const actual = payload.sourceEvents.flatMap(event => event.associations.map(association => ({
          role: event.role, excerpt: event.excerpt, ...association,
        }))).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        assert.deepEqual(actual, expected);
        assert.equal(payload.sourceEvents[0].associations.length, 2);
        assert.equal(JSON.stringify(body).includes('Interpretation:'), false);
        for (const forbidden of ['"eventId"', '"sessionId"', '"client"', '"namespace"',
          'supports-decision']) assert.equal(JSON.stringify(body).includes(forbidden), false);
        return { object: 'chat.completion', model: SOURCE_ANSWER_MODEL,
          choices: [{ finish_reason: 'stop', message: { role: 'assistant',
            content: 'Scripted answer, not a source-grounded quality judgment.' } }] };
      } });
    assert.equal(calls, 1); assert.equal(result.completionCalls, 1);
    assert.equal(result.status, 'generated-unassessed');
    await client.close();
    const reopened = openMemoryCore({ path, model: { countTokens: () => 1 } });
    try { assert.deepEqual(snapshot(reopened), before); }
    finally { reopened.close(); }
  });
