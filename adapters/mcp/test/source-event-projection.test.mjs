import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { openMemoryCore } from '../../../core/index.mjs';

const fixture = fileURLToPath(new URL('./fixtures/source-event-server.mjs', import.meta.url));
const namespace = { ownerId: 'synthetic-source-event-mcp', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const ref = memory => ({ memoryId: memory.id, revision: memory.revision });

test('SEP7 stdio receives original event passages with exact receipt associations',
  { timeout: 30000 }, async t => {
    const path = join(mkdtempSync(join(tmpdir(), 'cairn-source-event-mcp-')), 'memory.sqlite');
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
    const transport = new StdioClientTransport({ command: process.execPath, args: [fixture],
      env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1', CAIRN_SYNTHETIC_DB: path,
        CAIRN_SYNTHETIC_ROOTS: JSON.stringify([cards[0], ...cards.slice(2)].map(memory => memory.id)) },
      stderr: 'pipe' });
    const client = new Client({ name: 'synthetic-source-event-receiver', version: '1.0.0' });
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
