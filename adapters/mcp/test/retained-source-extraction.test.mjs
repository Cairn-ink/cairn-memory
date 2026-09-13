import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// Existing fixture runs actual core, adapter and SDK stdio with fake HTTP only.
const fixture = fileURLToPath(new URL('./fixtures/candidate-server.mjs', import.meta.url));
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const database = () => join(mkdtempSync(join(tmpdir(), 'cairn-retained-mcp-')), 'memory.sqlite');
const options = { timeout: 20000 };
async function host(t, path, { mode = 'source-bound-v2', keyless = false, forbid = false } = {}) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [keyless ? cli : fixture, '--db', path, '--owner', 'synthetic-retained-mcp',
      ...(mode ? ['--capture-qualification', mode] : [])],
    env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1', SYNTHETIC_FORBID_HTTP: forbid ? '1' : '0' }, stderr: 'pipe' });
  let stderr = ''; transport.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const client = new Client({ name: 'retained-source-test', version: '1.0.0' });
  t.after(() => client.close()); await client.connect(transport);
  return { client, http: () => (stderr.match(/synthetic_http:/g) ?? []).length };
}
async function call(client, name, args) {
  const response = await client.callTool({ name, arguments: args });
  const result = JSON.parse(response.content[0].text);
  assert.equal(Boolean(response.isError), !result.ok);
  assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions'); return result;
}
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const inspect = (client, memoryId) => call(client, 'inspect_memory', { memoryId, includeQualification: true });

test('P4/P7 SDK v2 reports exact retained window, preserves canonical receipts and keyless cold replay', options, async t => {
  const path = database(); const warm = await host(t, path);
  const input = { batchId: 'retained-window', messages: [
    { role: 'user', content: `${'a'.repeat(800)} OMITTED_TAIL_A` },
    { role: 'assistant', content: 'Short synthetic suggestion.' },
    { role: 'user', content: `${'b'.repeat(799)}🚋 OMITTED_TAIL_B` },
  ] };
  const expected = { maxUnitsPerMessage: 800, truncatedMessageIndices: [0, 2] };
  const captured = ok(await call(warm.client, 'capture_memory', input));
  assert.deepEqual(captured.retainedSourceWindow, expected);
  assert.equal(captured.admission.memories.length, 3);
  const details = [];
  for (const memory of captured.admission.memories) details.push(ok(await inspect(warm.client, memory.id)));
  assert.deepEqual(details.flatMap(detail => detail.receipts.map(receipt => receipt.excerpt)).sort(),
    ['a'.repeat(800), input.messages[1].content, 'b'.repeat(799)].sort());
  assert.equal(JSON.stringify(details).includes('OMITTED_TAIL'), false);
  await warm.client.close();
  const cold = await host(t, path, { forbid: true });
  const replay = ok(await call(cold.client, 'capture_memory', input));
  assert.equal(replay.duplicate, true); assert.deepEqual(replay.retainedSourceWindow, expected);
  const changed = structuredClone(input); changed.messages[0].content += ' CHANGED';
  const conflict = await call(cold.client, 'capture_memory', changed);
  assert.equal(conflict.error.code, 'event_payload_conflict');
  assert.equal(Object.hasOwn(conflict, 'retainedSourceWindow'), false);
  for (const detail of details) assert.deepEqual(ok(await inspect(cold.client, detail.memory.id)), detail);
  await cold.client.close(); assert.equal(cold.http(), 0);
  const keyless = await host(t, path, { keyless: true });
  const keylessReplay = ok(await call(keyless.client, 'capture_memory', input));
  assert.equal(keylessReplay.duplicate, true); assert.deepEqual(keylessReplay.retainedSourceWindow, expected);
});

test('P1/P4/P7 SDK v2 short window is empty; v1 capture and unconfigured remember omit new field', options, async t => {
  for (const mode of ['source-bound-v2', 'source-bound-v1', null]) {
    const hosted = await host(t, database(), { mode });
    const input = { batchId: 'short', messages: [{ role: 'user', content: 'Synthetic short preference.' }] };
    const result = ok(await call(hosted.client, mode ? 'capture_memory' : 'remember_memory',
      mode ? input : { content: input.messages[0].content }));
    assert.equal(Object.hasOwn(result, 'retainedSourceWindow'), mode === 'source-bound-v2');
    if (mode === 'source-bound-v2') assert.deepEqual(result.retainedSourceWindow,
      { maxUnitsPerMessage: 800, truncatedMessageIndices: [] });
    if (mode === 'source-bound-v1') {
      const duplicate = ok(await call(hosted.client, 'capture_memory', input));
      assert.equal(duplicate.duplicate, true); assert.equal(Object.hasOwn(duplicate, 'retainedSourceWindow'), false);
    }
    assert.equal((await hosted.client.listTools()).tools.length, mode ? 6 : 5);
    await hosted.client.close();
  }
});

test('P7 SDK rejects caller window and namespace overrides before HTTP or admission', options, async t => {
  const hosted = await host(t, database(), { forbid: true });
  const before = ok(await call(hosted.client, 'inspect_memory', {}));
  for (const patch of [{ retainedSourceWindow: { maxUnitsPerMessage: 4000, truncatedMessageIndices: [] } },
    { namespace: { ownerId: 'foreign' } }, { ownerId: 'foreign' }, { evidenceWindow: {} }]) {
    try {
      const result = await hosted.client.callTool({ name: 'capture_memory', arguments: {
        batchId: 'override', messages: [{ role: 'user', content: 'Synthetic override attempt.' }], ...patch } });
      assert.equal(result.isError, true);
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
      assert.match(String(error), /invalid|validation|unrecognized|required/i);
    }
  }
  assert.deepEqual(ok(await call(hosted.client, 'inspect_memory', {})), before);
  await hosted.client.close(); assert.equal(hosted.http(), 0);
});
