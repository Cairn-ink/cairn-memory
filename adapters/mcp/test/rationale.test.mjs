import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { parseConfiguration } from '../cli.mjs';

test('rationale configuration is explicit, requires v2 and fails before DB use', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-rationale-config-')), 'db');
  const args = ['--db', path, '--owner', 'synthetic'];
  assert.equal(parseConfiguration(args).captureRationale, undefined);
  for (const extra of [['--capture-rationale', 'source-bound-v1'], ['--capture-qualification', 'source-bound-v1', '--capture-rationale', 'source-bound-v1'],
    ['--capture-qualification', 'source-bound-v2', '--capture-rationale', 'other']]) assert.throws(() => parseConfiguration([...args, ...extra]));
  assert.equal(parseConfiguration([...args, '--capture-qualification', 'source-bound-v2', '--capture-rationale', 'source-bound-v1']).captureRationale, 'source-bound-v1');
  assert.equal(existsSync(path), false);
});

test('actual SDK stdio captures proposed rationale and recalls linked evidence without selecting challenge', { timeout: 30000 }, async t => {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-rationale-stdio-')), 'db');
  const client = new Client({ name: 'rationale-test', version: '1.0.0' }); t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/rationale-server.mjs', import.meta.url)), '--db', path, '--owner', 'synthetic',
      '--capture-qualification', 'source-bound-v2', '--capture-rationale', 'source-bound-v1'],
    env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' }, stderr: 'pipe' }));
  assert.equal((await client.listTools()).tools.length, 7);
  const call = async (name, args) => {
    const response = await client.callTool({ name, arguments: args }); const result = JSON.parse(response.content[0].text);
    assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions'); return result.value;
  };
  for (const [batchId, content] of [['one', 'I chose A because it supports offline work.'], ['two', 'I checked: A cannot work offline.']]) {
    const result = await call('capture_memory', { batchId, messages: [{ role: 'user', content }] }); assert.equal(result.rationale.status, 'reviewed');
  }
  const result = await call('recall_memory', { query: 'Why chose A?', contextMode: 'rationale-evidence' });
  assert.equal(result.memories.length, 1); const memory = result.memories[0];
  assert.equal(memory.rationale.status, 'reconfirmation-suggested'); assert.equal(memory.rationale.sources.length, 2);
  assert.deepEqual(await call('inspect_rationale', { memoryId: memory.memory.id, revision: memory.memory.revision }), memory.rationale);
});
