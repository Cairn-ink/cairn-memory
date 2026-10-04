import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

// Exact submitted sources were frozen in the plan before implementation.
const sources = Object.freeze({
  decision: 'I chose A for my offline field notes.',
  premise: 'A supports offline work for my field notes.',
  challenge: 'I checked: A cannot work offline for my field notes.',
  backup: 'I keep a paper backup for my field notes.',
});
const correction = 'I rechecked: the offline limitation was a mistaken report.';
const query = { query: 'field notes', contextMode: 'rationale-evidence' };
const fixture = fileURLToPath(new URL('./fixtures/rationale-lifecycle-server.mjs', import.meta.url));
const ref = memory => ({ memoryId: memory.id, revision: memory.revision });
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const error = (result, code) => {
  assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code);
};
const methods = host => host.records.filter(record => record.kind === 'model').map(record => record.method);

function childEnvironment() {
  const env = { NODE_NO_WARNINGS: '1', NODE_DISABLE_COMPILE_CACHE: '1' };
  for (const name of ['TMPDIR', 'TMP', 'TEMP']) {
    const value = process.env[name];
    if (value === undefined) continue;
    assert.ok(isAbsolute(value) && !value.includes('\0'), `invalid ${name}`);
    assert.ok(lstatSync(value).isDirectory(), `invalid ${name}`);
    env[name] = value;
  }
  // The pinned SDK also supplies its safe default environment; the canonical
  // env-i invocation has no HOME, user environment or credentials to inherit.
  return env;
}
async function bounded(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), 5000);
    })]);
  } finally { clearTimeout(timer); }
}
async function start(workspace, path, enabled = true) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fixture, '--db', path, '--owner', 'synthetic-rationale-lifecycle',
      ...(enabled ? ['--capture-qualification', 'source-bound-v2', '--capture-rationale', 'source-bound-v1'] : [])],
    env: childEnvironment(), stderr: 'pipe' });
  const client = new Client({ name: 'synthetic-rationale-lifecycle', version: '1.0.0' });
  const records = [], errors = [];
  let pending = '', bytes = 0, finishClose, finishStderr, closed = false, completion;
  const actualClose = new Promise(resolve => { finishClose = resolve; });
  const stderrEnd = new Promise(resolve => { finishStderr = resolve; });
  transport.onclose = () => { closed = true; finishClose(); };
  transport.onerror = caught => { errors.push(caught); };
  transport.stderr.on('error', caught => { errors.push(caught); });
  transport.stderr.once('end', finishStderr);
  transport.stderr.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 262144) { errors.push(new Error('synthetic_trace_too_large')); return; }
    pending += chunk.toString();
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      try {
        assert.ok(line.startsWith('rationale-lifecycle:'), line);
        const record = JSON.parse(line.slice('rationale-lifecycle:'.length));
        assert.equal(record.sequence, records.length + 1);
        records.push(record);
      } catch (caught) { errors.push(caught); }
    }
  });
  const close = () => {
    completion ??= (async () => {
      await client.close(); await transport.close();
      await bounded(Promise.all([actualClose, stderrEnd]), 'stdio_close_not_observed');
      assert.equal(closed, true); assert.equal(pending, '');
      assert.deepEqual(errors, []);
      assert.equal(records.at(-1)?.kind, 'closed', 'real fixture/core closure');
    })();
    return completion;
  };
  workspace.defer(close); // Registered before connect can fail.
  await client.connect(transport);
  return { client, records, close };
}
async function call(host, name, args = {}) {
  const response = await host.client.callTool({ name, arguments: args });
  assert.equal(response.content.length, 1); assert.equal(response.content[0].type, 'text');
  const result = JSON.parse(response.content[0].text);
  assert.equal(Boolean(response.isError), !result.ok);
  assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
  return result;
}
const get = async (host, id) => ok(await call(host, 'inspect_memory', { memoryId: id, includeQualification: true }));
const graph = async (host, memory) => ok(await call(host, 'inspect_rationale', ref(memory)));
const receiptTexts = report => report.sources.flatMap(source => source.receipts.map(receipt => receipt.excerpt)).sort();
async function state(host, saved) {
  return { listed: ok(await call(host, 'inspect_memory', {})),
    decision: await get(host, saved.decision.memory.id),
    premise: await get(host, saved.premise.memory.id),
    backup: await get(host, saved.backup.memory.id), rationale: await graph(host, saved.decision.memory) };
}
function assertGraph(report, saved, challenged) {
  assert.equal(report.status, challenged ? 'reconfirmation-suggested' : 'unassessed');
  assert.equal(report.coverage, 'linked-evidence-only');
  assert.equal(report.sources.length, challenged ? 3 : 2);
  assert.deepEqual(receiptTexts(report), [sources.decision, sources.premise,
    ...(challenged ? [sources.challenge] : [])].sort());
  const expected = [[saved.premise.memory.id, saved.decision.memory.id, 'supports-decision'],
    ...(challenged ? [[saved.challenge.memory.id, saved.premise.memory.id, 'challenges-premise']] : [])];
  assert.deepEqual(report.edges.map(edge => [edge.from, edge.to, edge.relation]).sort(), expected.sort());
  for (const edge of report.edges) {
    assert.equal(edge.interpretationStatus, 'model-proposed');
    const from = Object.values(saved).find(detail => detail.memory.id === edge.from);
    const to = Object.values(saved).find(detail => detail.memory.id === edge.to);
    assert.equal(edge.fromReceipt, from.receipts[0].id);
    assert.equal(edge.toReceipt, to.receipts[0].id);
  }
}
function assertRecall(result, rank, saved, report) {
  assert.deepEqual(result.memories.map(item => item.memory.id), [saved.decision.memory.id, saved.backup.memory.id]);
  assert.equal(result.coverage, 'complete');
  for (const key of ['decision', 'backup']) {
    const item = result.memories.find(item => item.memory.id === saved[key].memory.id);
    const { id, revision, state } = saved[key].memory;
    assert.equal(state, 'active');
    assert.deepEqual(item.memory, { id, revision, currentness: 'current' });
    assert.deepEqual(item.receipts, saved[key].receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt })));
    assert.deepEqual(rank.input.candidates.find(candidate => candidate.memory.id === item.memory.id).rationale, item.rationale);
  }
  assert.deepEqual(result.memories[0].rationale, report);
}

test('H1/H7 actual stdio preserves five default and seven explicit rationale tools', { timeout: 20000 }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-mcp-rationale-inventory-' });
  try {
    const base = ['correct_memory', 'forget_memory', 'inspect_memory', 'recall_memory', 'remember_memory'];
    for (const enabled of [false, true]) {
      const host = await start(workspace, join(workspace.path, `${enabled}.sqlite`), enabled);
      assert.deepEqual((await host.client.listTools()).tools.map(tool => tool.name).sort(),
        [...base, ...(enabled ? ['capture_memory', 'inspect_rationale'] : [])].sort());
      await host.close(); assert.deepEqual(methods(host), []);
    }
  } finally { await workspace.cleanup(); assert.equal(existsSync(workspace.path), false); }
});

for (const action of ['correct', 'forget']) test(`H2-H6 actual stdio three-source premise challenge survives cold recall, then ${action} invalidates it`,
  { timeout: 30000 }, async t => {
    const workspace = createTestWorkspace(t, { prefix: `cairn-mcp-rationale-${action}-` });
    const path = join(workspace.path, 'memory.sqlite');
    try {
      const warm = await start(workspace, path); const saved = {};
      for (const [batchId, content] of Object.entries(sources)) {
        const captured = ok(await call(warm, 'capture_memory', { batchId, messages: [{ role: 'user', content }] }));
        assert.equal(captured.admission.memories.length, 1); assert.equal(captured.classification.status, 'applied');
        assert.equal(captured.rationale.status, 'reviewed');
        saved[batchId] = await get(warm, captured.admission.memories[0].id);
        assert.equal(saved[batchId].memory.state, 'active'); assert.equal(saved[batchId].memory.content, content);
        assert.deepEqual(saved[batchId].receipts.map(({ role, excerpt }) => ({ role, excerpt })), [{ role: 'user', excerpt: content }]);
        assert.equal(saved[batchId].receipts[0].client, 'cairn-local-mcp');
        assert.equal(saved[batchId].receipts[0].sessionId, 'submitted-capture');
        assert.equal(saved[batchId].receipts[0].eventId, createHash('sha256')
          .update(JSON.stringify(['cairn.mcp.submitted-message.v1', batchId, 0])).digest('hex'));
      }
      assert.equal(saved.decision.qualification.commitment, 'adopted');
      const before = await graph(warm, saved.decision.memory); assertGraph(before, saved, true);
      const recalled = ok(await call(warm, 'recall_memory', query));
      await warm.close();
      assert.deepEqual(methods(warm), [...Array(4).fill(['extract', 'qualifyCandidates', 'classify', 'relate']).flat(), 'select', 'rank']);
      for (const record of warm.records.filter(record => record.method === 'relate')) {
        for (const memory of record.input.memories) {
          assert.deepEqual(Object.keys(memory).sort(), ['index', 'receipts']);
          for (const receipt of memory.receipts) assert.deepEqual(Object.keys(receipt).sort(), ['excerpt', 'index', 'role']);
        }
      }
      assertRecall(recalled, warm.records.find(record => record.method === 'rank'), saved, before);

      const cold = await start(workspace, path);
      assert.deepEqual(await graph(cold, saved.decision.memory), before);
      const coldRecalled = ok(await call(cold, 'recall_memory', query));
      assert.deepEqual(coldRecalled, recalled);
      const challenge = saved.challenge.memory;
      const snapshot = await state(cold, saved);
      assert.equal(snapshot.listed.exhausted, true);
      assert.deepEqual(snapshot.listed.memories.map(memory => memory.id).sort(), Object.values(saved).map(detail => detail.memory.id).sort());
      error(await call(cold, 'correct_memory', { memoryId: challenge.id, expectedRevision: challenge.revision + 1, content: correction }), 'revision_conflict');
      error(await call(cold, 'forget_memory', { memoryId: challenge.id, expectedRevision: challenge.revision + 1 }), 'revision_conflict');
      error(await call(cold, 'inspect_rationale', { memoryId: challenge.id, revision: challenge.revision + 1 }), 'revision_conflict');
      assert.deepEqual(await state(cold, saved), snapshot); assert.deepEqual(await get(cold, challenge.id), saved.challenge);

      if (action === 'correct') {
        const changed = ok(await call(cold, 'correct_memory', { memoryId: challenge.id, expectedRevision: challenge.revision, content: correction }));
        assert.equal(changed.memory.id, challenge.id); assert.equal(changed.memory.revision, challenge.revision + 1);
        const corrected = await get(cold, challenge.id);
        assert.equal(corrected.memory.content, correction); assert.equal(corrected.memory.origin, 'explicit');
        assert.deepEqual(corrected.receipts.map(({ role, excerpt }) => ({ role, excerpt })), [{ role: 'user', excerpt: correction }]);
        const after = await state(cold, saved);
        error(await call(cold, 'correct_memory', { memoryId: challenge.id, expectedRevision: challenge.revision, content: sources.challenge }), 'revision_conflict');
        error(await call(cold, 'forget_memory', { memoryId: challenge.id, expectedRevision: challenge.revision }), 'revision_conflict');
        error(await call(cold, 'inspect_rationale', ref(challenge)), 'revision_conflict');
        assert.deepEqual(await state(cold, saved), after); assert.deepEqual(await get(cold, challenge.id), corrected);
      } else {
        assert.equal(ok(await call(cold, 'forget_memory', { memoryId: challenge.id, expectedRevision: challenge.revision })).forgotten, true);
        const after = await state(cold, saved);
        error(await call(cold, 'inspect_rationale', ref(challenge)), 'memory_not_found');
        error(await call(cold, 'correct_memory', { memoryId: challenge.id, expectedRevision: challenge.revision, content: correction }), 'memory_not_found');
        assert.equal(ok(await call(cold, 'forget_memory', { memoryId: challenge.id, expectedRevision: challenge.revision })).forgotten, false);
        error(await call(cold, 'inspect_memory', { memoryId: challenge.id }), 'memory_not_found');
        assert.deepEqual(await state(cold, saved), after);
      }
      const after = await state(cold, saved); assertGraph(after.rationale, saved, false);
      assert.equal(after.listed.exhausted, true);
      assert.deepEqual(after.listed.memories.map(memory => memory.id).sort(), Object.entries(saved)
        .filter(([key]) => action === 'correct' || key !== 'challenge').map(([, detail]) => detail.memory.id).sort());
      for (const key of ['decision', 'premise', 'backup']) assert.deepEqual(after[key], saved[key]);
      await cold.close(); assert.deepEqual(methods(cold), ['select', 'rank']);
      assertRecall(coldRecalled, cold.records.find(record => record.method === 'rank'), saved, before);

      const final = await start(workspace, path);
      assert.deepEqual(await graph(final, saved.decision.memory), after.rationale);
      const finalRecall = ok(await call(final, 'recall_memory', query));
      for (const key of ['decision', 'premise', 'backup']) assert.deepEqual(await get(final, saved[key].memory.id), saved[key]);
      if (action === 'correct') {
        const corrected = await get(final, challenge.id);
        assert.equal(corrected.memory.content, correction);
        assert.deepEqual(corrected.receipts.map(receipt => receipt.excerpt), [correction]);
      } else error(await call(final, 'inspect_memory', { memoryId: challenge.id }), 'memory_not_found');
      await final.close(); assert.deepEqual(methods(final), ['select', 'rank']);
      const rank = final.records.find(record => record.method === 'rank');
      assertRecall(finalRecall, rank, saved, after.rationale);
      for (const payload of [finalRecall, rank.input]) {
        const text = JSON.stringify(payload);
        assert.equal(text.includes(challenge.id), false); assert.equal(text.includes(sources.challenge), false);
        for (const receipt of saved.challenge.receipts) assert.equal(text.includes(receipt.id), false);
      }
    } finally { await workspace.cleanup(); assert.equal(existsSync(workspace.path), false); }
  });
