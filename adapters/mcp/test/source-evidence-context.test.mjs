import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { openMemoryCore } from '../../../core/contract.mjs';

// Scripted ranker, actual core/SDK/stdio. Intentionally wrong interpretations
// test isolation, not semantic inference or downstream answer quality.
const fixture = fileURLToPath(new URL('./fixtures/qualified-recall-server.mjs', import.meta.url));
const namespace = { ownerId: 'source-evidence-synthetic', scope: 'personal', projectId: null };
const options = { timeout: 20000 };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
function seed() {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-source-evidence-')), 'memory.sqlite');
  const core = openMemoryCore({ path }); const details = [];
  try {
    const sources = [
      ['assistant', 'You could take the tram 🚋.'],
      ['user', 'Does that have space for luggage?'],
      ['user', 'Perhaps I prefer herbs; I am still unsure.'],
      ['user', 'Only today I will take a taxi. Usually I cycle.'],
      ['user', 'Priya says she likes renewal-date sorting. I have not decided.'],
    ];
    for (const [index, [role, excerpt]] of sources.entries()) {
      const saved = ok(core.admit({ namespace, memory: { content: `WRONG_CONFIRMED_INTERPRETATION_${index}`, kind: 'preference' },
        receipts: [{ client: 'synthetic-client', sessionId: 'synthetic-session', eventId: `event-${index}`, role, excerpt }],
        qualification: { version: 1, slot: { subject: null, property: null, scope: null, applies: null },
          value: null, attribution: 'direct', commitment: 'adopted',
          anchors: [{ receiptIndex: 0, start: 0, end: excerpt.length, text: excerpt, fields: ['attribution', 'commitment'] }] } }));
      details.push(ok(core.get({ namespace, memoryId: saved.memory.id, includeQualification: true })));
    }
  } finally { core.close(); }
  return { path, details };
}
async function host(t, path, mode) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fixture, '--db', path, '--owner', namespace.ownerId, ...(mode ? ['--capture-qualification', mode] : [])],
    env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
  let pending = ''; const ranks = [], waiting = [];
  transport.stderr.on('data', chunk => {
    pending += chunk.toString(); let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      if (line.startsWith('rank:')) {
        const rank = JSON.parse(line.slice(5));
        if (waiting.length) waiting.shift()(rank); else ranks.push(rank);
      }
    }
  });
  const client = new Client({ name: 'source-evidence-test', version: '1.0.0' });
  t.after(() => client.close()); await client.connect(transport);
  return { client, rank: () => ranks.length ? Promise.resolve(ranks.shift()) : new Promise(resolve => waiting.push(resolve)) };
}
async function call(client, name, args) {
  const response = await client.callTool({ name, arguments: args });
  const result = JSON.parse(response.content[0].text);
  assert.equal(Boolean(response.isError), !result.ok);
  assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions'); return result;
}
async function recall(hosted, patch = {}) {
  const result = ok(await call(hosted.client, 'recall_memory', { query: 'What do the sources say?', ...patch }));
  return { result, rank: await hosted.rank() };
}
function assertSources(actual, details) {
  const byId = new Map(details.map(detail => [detail.memory.id, detail]));
  assert.equal(actual.result.memories.length, details.length);
  assert.equal(actual.rank.candidates.length, details.length);
  for (const item of [...actual.result.memories, ...actual.rank.candidates]) {
    const detail = byId.get(item.memory.id); assert.ok(detail);
    assert.equal(detail.memory.state, 'active');
    const { namespaceIndex, ...dto } = item;
    assert.deepEqual(dto, { memory: { id: detail.memory.id, revision: detail.memory.revision,
      currentness: 'current' },
      receipts: detail.receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt })),
      receiptCount: detail.memory.receiptCount, interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' });
    if (namespaceIndex !== undefined) assert.equal(namespaceIndex, 0);
  }
  assert.equal(JSON.stringify(actual).includes('WRONG_CONFIRMED_INTERPRETATION'), false);
  // The question's missing antecedent is not silently inserted into its sources.
  const question = actual.result.memories.find(item => item.receipts[0].excerpt.startsWith('Does that'));
  assert.equal(question.receipts.length, 1);
}
for (const mode of [undefined, 'source-bound-v1', 'source-bound-v2']) {
  test(`S6 SDK source mode suppresses interpretation with configuration ${mode ?? 'absent'}`, options, async t => {
    const { path, details } = seed(); const hosted = await host(t, path, mode);
    assert.equal((await hosted.client.listTools()).tools.length, mode ? 6 : 5);
    assertSources(await recall(hosted, { contextMode: 'source-evidence' }), details);
    assertSources(await recall(hosted, { contextMode: 'source-evidence', includeQualification: false }), details);
    const scanned = await recall(hosted, { contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' });
    assertSources(scanned, details);
    assert.equal(scanned.result.selection.strategy, 'complete-map');
    assert.equal((await call(hosted.client, 'recall_memory', { query: 'sources', selectionMode: 'bounded-source-scan' })).error.code, 'invalid_input');
    const conflict = await call(hosted.client, 'recall_memory', { query: 'sources', contextMode: 'source-evidence', includeQualification: true });
    assert.equal(conflict.ok, false); assert.equal(conflict.error.code, 'invalid_input');
    const legacy = await recall(hosted);
    for (const item of legacy.result.memories) {
      assert.match(item.memory.content, /^WRONG_CONFIRMED_INTERPRETATION/);
      assert.equal(Object.hasOwn(item, 'qualification'), Boolean(mode));
    }
    for (const detail of details) assert.deepEqual(ok(await call(hosted.client, 'inspect_memory', {
      memoryId: detail.memory.id, includeQualification: true })), detail);
    await hosted.client.close();
    const cold = await host(t, path);
    assertSources(await recall(cold, { contextMode: 'source-evidence' }), details);
  });
}
test('S6 SDK source-mode enum and authority overrides are strict; query remains redacted', options, async t => {
  const { path, details } = seed(); const hosted = await host(t, path, 'source-bound-v2');
  for (const patch of [...[null, false, {}, [], 'sources', 'SOURCE-EVIDENCE'].map(contextMode => ({ contextMode })),
    { contextMode: 'source-evidence', sourceProjection: 'neighborhood-sources-v1' },
    { contextMode: 'rationale-neighborhood-evidence', sourceProjection: 'unknown' },
    { contextMode: 'rationale-neighborhood-evidence', sourceProjection: 'neighborhood-sources-v1', includeQualification: true },
    { contextMode: 'rationale-neighborhood-evidence', sourceProjection: 'neighborhood-sources-v1', selectionMode: 'bounded-source-scan' },
    { contextMode: 'source-evidence', namespace: { ownerId: 'foreign' } },
    { contextMode: 'source-evidence', ownerId: 'foreign' }]) {
    try {
      const response = await hosted.client.callTool({ name: 'recall_memory', arguments: { query: 'sources', ...patch } });
      assert.equal(response.isError, true);
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
      assert.match(String(error), /invalid|validation|unrecognized|required/i);
    }
  }
  const result = await recall(hosted, { contextMode: 'source-evidence', query: `Redaction probe sk-${'a'.repeat(40)}` });
  assert.equal(result.rank.query, 'Redaction probe [REDACTED]'); assertSources(result, details);
});
