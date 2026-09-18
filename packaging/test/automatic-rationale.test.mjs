import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { buildArtifact, command, packageName } from '../build.mjs';
import { startExperimentProxy } from '../../evaluation/live/proxy.mjs';
import { rationaleModel } from '../../core/testing/rationale-model.mjs';

const sdk = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(sdk.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(sdk.resolve('@modelcontextprotocol/client/stdio'));

for (const directOnly of [false, true]) test(`installed adapter/core/MCP retains ${directOnly ? 'direct-only challenge' : 'support-chain'} rationale through cold replay`, { timeout: 60000 }, async t => {
  const artifact = buildArtifact(); const root = mkdtempSync(join(tmpdir(), 'cairn-installed-rationale-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-rationale', private: true, version: '0.0.0' }), { flag: 'wx' });
  command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath], root, artifact.userconfig);
  const packageRoot = join(root, 'node_modules', packageName); const path = join(root, 'memory.sqlite');
  const mock = rationaleModel(); const calls = []; let ranks = [];
  if (directOnly) mock.relate = ({ input: { memories } }) => {
    const root = memories.find(memory => memory.receipts.some(receipt =>
      receipt.excerpt.startsWith('I chose A because')));
    const later = memories.find(memory => memory.receipts.some(receipt =>
      receipt.excerpt.startsWith('I checked: A cannot work offline')));
    return { edges: root && later ? [{ from: later.index, to: root.index,
      relation: 'challenges-premise', fromReceipt: 0, toReceipt: 0 }] : [] };
  };
  const proxy = await startExperimentProxy({ session: { request: async (route, body) => {
    const payload = JSON.parse(body); calls.push({ route, method: payload.text.format.name });
    if (route.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    const method = payload.text.format.name.slice('cairn_'.length); assert.equal(typeof mock[method], 'function');
    const input = JSON.parse(payload.input[0].content[0].text);
    if (method === 'rank') ranks.push(input);
    const output = await mock[method]({ input });
    if (method === 'qualifyCandidates') {
      output.qualifications = Object.fromEntries(output.qualifications.map(item => ['item_' + item.itemIndex, item]));
    }
    return Response.json({ object: 'response', model: payload.model, status: 'completed', error: null, incomplete_details: null,
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
      usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
  } } });
  const config = join(root, 'transport.json');
  writeFileSync(config, JSON.stringify({ version: 1, packageRoot, proxyUrl: proxy.url }), { mode: 0o600, flag: 'wx' });
  let active; t.after(async () => { if (active) await active.close(); await proxy.close(); });
  const start = async key => {
    active = new Client({ name: 'installed-rationale-test', version: '1.0.0' });
    await active.connect(new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL('../../evaluation/live/cairn-launcher.mjs', import.meta.url)), '--db', path, '--owner', 'synthetic',
        '--capture-qualification', 'source-bound-v2', '--capture-rationale', 'source-bound-v1'],
      env: { CAIRN_LIVE_CONFIG: config, OPENAI_API_KEY: key, NODE_NO_WARNINGS: '1' }, stderr: 'pipe' }));
  };
  const call = async (name, args) => {
    const response = await active.callTool({ name, arguments: args }); const result = JSON.parse(response.content[0].text);
    assert.equal(result.ok, true, JSON.stringify(result)); return result.value;
  };
  const query = { query: 'Why chose A?', contextMode: 'rationale-evidence' };
  const recallTrace = since => {
    assert.deepEqual(calls.slice(since).map(({ method }) => method),
      ['cairn_select', 'cairn_select', 'cairn_rank', 'cairn_rank']);
    assert.ok(calls.slice(since).every(({ route }) =>
      ['/responses', '/responses/input_tokens'].some(suffix => route.endsWith(suffix))));
  };
  const retainedReceipts = rationale => rationale.sources.flatMap(source =>
    source.receipts.map(({ role, excerpt }) => ({ role, excerpt }))).sort((a, b) => a.excerpt.localeCompare(b.excerpt));
  await start(proxy.token); assert.equal((await active.listTools()).tools.length, 7);
  const batches = [['one', 'I chose A because it supports offline work.'], ['two', 'I checked: A cannot work offline.']]
    .map(([batchId, content]) => ({ batchId, messages: [{ role: 'user', content }] }));
  const first = await call('capture_memory', batches[0]);
  assert.equal(first.rationale.status, 'reviewed'); assert.equal(first.rationale.inserted, directOnly ? 0 : 1);
  const second = await call('capture_memory', batches[1]);
  assert.equal(second.rationale.status, 'reviewed'); assert.equal(second.rationale.inserted, 1);
  assert.equal(calls.length, 16);
  const recalled = await call('recall_memory', query);
  assert.equal(calls.length, 20); const rootMemory = recalled.memories[0];
  assert.equal(rootMemory.rationale.status, 'reconfirmation-suggested'); assert.equal(rootMemory.rationale.sources.length, 2);
  assert.deepEqual(retainedReceipts(rootMemory.rationale), batches.map(batch => ({ role: 'user', excerpt: batch.messages[0].content }))
    .sort((a, b) => a.excerpt.localeCompare(b.excerpt)));
  assert.equal(rootMemory.rationale.edges.length, directOnly ? 1 : 2);
  assert.equal(rootMemory.rationale.edges.filter(edge => edge.relation === 'challenges-premise').length, 1);
  assert.deepEqual(ranks[0].candidates[0].rationale, rootMemory.rationale);
  recallTrace(16);
  const ref = { memoryId: rootMemory.memory.id, revision: rootMemory.memory.revision };
  await active.close(); const beforeColdStart = calls.length; await start(proxy.token);
  assert.equal(calls.length, beforeColdStart);
  const coldStart = calls.length;
  const cold = await call('recall_memory', query);
  recallTrace(coldStart); assert.equal(calls.length, 24);
  assert.deepEqual(cold, recalled);
  assert.deepEqual(cold.memories[0].memory, rootMemory.memory);
  assert.deepEqual(retainedReceipts(cold.memories[0].rationale), retainedReceipts(rootMemory.rationale));
  assert.deepEqual(ranks[1].candidates[0].rationale, cold.memories[0].rationale);
  await active.close(); await start('');
  assert.deepEqual(await call('inspect_rationale', ref), rootMemory.rationale);
  const duplicate = await call('capture_memory', batches[1]); assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.rationale.reason, 'duplicate'); assert.equal(calls.length, 24);
  const challengeSource = rootMemory.rationale.sources.find(source => source.memory.id !== ref.memoryId);
  const challenge = challengeSource.memory;
  const challengeReceiptIds = new Set(challengeSource.receipts.map(receipt => receipt.id));
  const audit = await call('inspect_rationale', { memoryId: challenge.id, revision: challenge.revision, view: 'incident-proposals' });
  assert.equal(audit.edges.length, 1); assert.equal(audit.status, 'unassessed');
  assert.equal(audit.view, 'incident-proposals'); assert.equal(calls.length, 24);
  await call('forget_memory', { memoryId: challenge.id, expectedRevision: challenge.revision });
  assert.equal((await call('inspect_rationale', ref)).status, 'unassessed'); assert.equal(calls.length, 24);
  await active.close(); const beforeAfterForgetStart = calls.length; await start(proxy.token);
  assert.equal(calls.length, beforeAfterForgetStart);
  const afterForgetStart = calls.length;
  const afterForget = await call('recall_memory', query);
  recallTrace(afterForgetStart); assert.equal(calls.length, 28);
  assert.equal(afterForget.memories.length, 1);
  assert.deepEqual(afterForget.memories[0].memory, rootMemory.memory);
  assert.equal(afterForget.memories[0].rationale.status, 'unassessed');
  assert.deepEqual(afterForget.memories[0].rationale.edges, rootMemory.rationale.edges.filter(edge =>
    edge.from !== challenge.id && edge.to !== challenge.id &&
    !challengeReceiptIds.has(edge.fromReceipt) && !challengeReceiptIds.has(edge.toReceipt)));
  assert.ok(afterForget.memories[0].rationale.edges.every(edge => edge.relation !== 'challenges-premise'));
  assert.deepEqual(retainedReceipts(afterForget.memories[0].rationale),
    [{ role: 'user', excerpt: batches[0].messages[0].content }]);
  assert.equal(JSON.stringify(afterForget).includes(batches[1].messages[0].content), false);
  assert.equal(JSON.stringify(afterForget).includes(challenge.id), false);
  assert.equal(ranks[2].candidates.length, 1);
  assert.deepEqual(ranks[2].candidates[0].rationale, afterForget.memories[0].rationale);
});
