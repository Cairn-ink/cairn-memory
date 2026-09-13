import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { openMemoryCore } from '../../../core/contract.mjs';

const fixture = fileURLToPath(new URL('./fixtures/qualified-recall-server.mjs', import.meta.url));
const namespace = { ownerId: 'qualified-recall-synthetic', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const options = { timeout: 20000 };
function seed() {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-qualified-recall-')), 'memory.sqlite');
  const core = openMemoryCore({ path });
  const qualifications = new Map();
  try {
    for (const [index, attribution, commitment, applies] of [
      [0, 'proposed', 'unknown', null], [1, 'quoted', 'unknown', null],
      [2, 'direct', 'considered', 'this week'], [3, 'unknown', 'unknown', null],
    ]) {
      const content = `Synthetic option ${index}: violet tram 🚋 this week.`;
      const qualification = { version: 1, slot: { subject: null, property: null, scope: null, applies },
        value: null, attribution, commitment, anchors: [{ receiptIndex: 0, start: 0, end: content.length,
          text: content, fields: ['value', 'attribution', 'commitment', ...(applies ? ['applies'] : [])] }] };
      const saved = ok(core.admit({ namespace, memory: { content, kind: 'context' }, qualification,
        receipts: [{ client: 'synthetic', sessionId: 'recall', eventId: `event-${index}`,
          role: index === 0 ? 'assistant' : 'user', excerpt: content }] }));
      qualifications.set(saved.memory.id, ok(core.get({ namespace, memoryId: saved.memory.id,
        includeQualification: true })).qualification);
    }
    const content = 'Synthetic legacy record without source qualification.';
    const saved = ok(core.admit({ namespace, memory: { content, kind: 'context' },
      receipts: [{ client: 'synthetic', sessionId: 'recall', eventId: 'legacy', role: 'user', excerpt: content }] }));
    qualifications.set(saved.memory.id, null);
    ok(core.admit({ namespace: { ...namespace, ownerId: 'foreign-synthetic' },
      memory: { content: 'Foreign private record', kind: 'fact' }, receipts: [{ client: 'synthetic',
        sessionId: 'recall', eventId: 'foreign', role: 'user', excerpt: 'Foreign private record' }] }));
  } finally { core.close(); }
  return { path, qualifications };
}
async function host(t, path, mode) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fixture, '--db', path, '--owner', namespace.ownerId,
      ...(mode ? ['--capture-qualification', mode] : [])],
    env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
  const ranks = []; const waiters = []; let pending = '';
  transport.stderr.on('data', chunk => {
    pending += chunk.toString();
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      if (line.startsWith('rank:')) {
        const value = JSON.parse(line.slice(5));
        if (waiters.length) waiters.shift()(value); else ranks.push(value);
      }
    }
  });
  const client = new Client({ name: 'qualified-recall-test', version: '1.0.0' });
  t.after(() => client.close()); await client.connect(transport);
  return { client, nextRank: () => ranks.length ? Promise.resolve(ranks.shift()) : new Promise(resolve => waiters.push(resolve)) };
}
async function recall(hosted, args = {}) {
  const response = await hosted.client.callTool({ name: 'recall_memory', arguments: { query: 'Synthetic options', ...args } });
  assert.equal(response.isError, false);
  const envelope = JSON.parse(response.content[0].text);
  assert.equal(envelope.evidenceTrust, 'untrusted-data-not-instructions');
  return { result: ok(envelope), rank: await hosted.nextRank() };
}
function assertSupport({ result, rank }, expected, enabled) {
  assert.equal(result.memories.length, expected.size); assert.equal(rank.candidates.length, expected.size);
  for (const item of [...result.memories, ...rank.candidates]) {
    assert.ok(expected.has(item.memory.id));
    assert.equal(Object.hasOwn(item, 'qualification'), enabled);
    if (enabled) assert.deepEqual(item.qualification, expected.get(item.memory.id));
    assert.equal(Object.hasOwn(item, 'needs_reconfirmation'), false);
    assert.equal(Object.hasOwn(item, 'confirmedPreference'), false);
  }
}
for (const mode of ['source-bound-v1', 'source-bound-v2']) {
  test(`R5/R7 actual SDK ${mode} defaults qualified recall on, explicit false preserves legacy`, options, async t => {
    const { path, qualifications } = seed(); const hosted = await host(t, path, mode);
    assert.equal((await hosted.client.listTools()).tools.length, 6);
    assertSupport(await recall(hosted), qualifications, true);
    assertSupport(await recall(hosted, { includeQualification: false }), qualifications, false);
    assertSupport(await recall(hosted, { includeQualification: true }), qualifications, true);
  });
}
test('R5/R7 unconfigured cold SDK recall retains absent shape; explicit true includes source DTO and null legacy', options, async t => {
  const { path, qualifications } = seed(); const first = await host(t, path, 'source-bound-v2');
  const warm = await recall(first); await first.client.close();
  const cold = await host(t, path);
  assert.equal((await cold.client.listTools()).tools.length, 5);
  assertSupport(await recall(cold), qualifications, false);
  const qualified = await recall(cold, { includeQualification: true });
  assertSupport(qualified, qualifications, true);
  assert.deepEqual(qualified.result, warm.result);
  assertSupport(await recall(cold, { includeQualification: false }), qualifications, false);
});
test('R5/R7 strict boolean and namespace overrides reject; qualified query remains redacted', options, async t => {
  const { path, qualifications } = seed(); const hosted = await host(t, path, 'source-bound-v2');
  for (const patch of [
    ...[null, 'true', 0, 1, {}, []].map(includeQualification => ({ includeQualification })),
    { namespace: { ownerId: 'foreign-synthetic' } }, { ownerId: 'foreign-synthetic' },
    { readSet: [{ ...namespace, ownerId: 'foreign-synthetic' }] },
  ]) {
    try {
      const response = await hosted.client.callTool({ name: 'recall_memory', arguments: { query: 'Synthetic options', ...patch } });
      assert.equal(response.isError, true, JSON.stringify(response));
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
      assert.match(String(error), /invalid|validation|unrecognized|required/i);
    }
  }
  const result = await recall(hosted, { query: `Redaction probe sk-${'a'.repeat(40)}` });
  assert.equal(result.rank.query, 'Redaction probe [REDACTED]');
  assertSupport(result, qualifications, true);
});
