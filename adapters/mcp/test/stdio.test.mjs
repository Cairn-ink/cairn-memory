import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { openMemoryCore } from '../../../core/contract.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const scripted = fileURLToPath(new URL('./fixtures/scripted-server.mjs', import.meta.url));
const database = () => join(mkdtempSync(join(tmpdir(), 'cairn-mcp-test-')), 'memory.sqlite');
const options = { timeout: 20000 };
async function host(t, path, { owner = 'synthetic-owner', project, fixture = false, modern = false } = {}) {
  const args = [fixture ? scripted : cli, '--db', path, '--owner', owner,
    ...(project ? ['--project', project] : [])];
  // No application environment or credentials are copied. The SDK additionally
  // inherits its documented shell environment allowlist, which excludes keys.
  const transport = new StdioClientTransport({ command: process.execPath, args,
    env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
  let stderr = '';
  transport.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const client = new Client({ name: 'cairn-synthetic-client', version: '1.0.0' },
    modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : undefined);
  t.after(async () => { await client.close(); });
  await client.connect(transport);
  return { client, transport, stderr: () => stderr };
}
async function call(client, name, args = {}) {
  const response = await client.callTool({ name, arguments: args });
  assert.equal(response.content[0].type, 'text');
  const envelope = JSON.parse(response.content[0].text);
  assert.equal(Boolean(response.isError), !envelope.ok);
  assert.equal(envelope.evidenceTrust, 'untrusted-data-not-instructions');
  return envelope;
}
function ok(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; }
function error(result, code) { assert.equal(result.ok, false); assert.equal(result.error.code, code); }
async function invalid(client, name, args) {
  try {
    const response = await client.callTool({ name, arguments: args });
    assert.equal(response.isError, true, JSON.stringify(response));
  } catch (caught) {
    if (caught instanceof assert.AssertionError) throw caught;
    assert.match(String(caught), /invalid|validation|unrecognized|required/i);
  }
}

function seedInspectionHistory(path) {
  const namespace = { ownerId: 'synthetic-owner', scope: 'personal', projectId: null };
  const core = openMemoryCore({ path });
  const receipt = (eventId, excerpt) => ({ client: 'synthetic-history', sessionId: 'inspection', eventId, role: 'user', excerpt });
  try {
    const old = ok(core.admit({ namespace, memory: { content: 'Synthetic review is Friday.', kind: 'fact' },
      receipts: [receipt('original', 'I choose Friday.'), receipt('confirmation', 'Friday remains my choice.')] })).memory;
    const first = ok(core.supersede({ namespace, memoryId: old.id, expectedRevision: old.revision,
      replacement: { content: 'Synthetic review is Monday.', kind: 'fact' },
      receipts: [receipt('first-change', 'Move the review to Monday because Friday is unavailable.')] })).memory;
    const current = ok(core.supersede({ namespace, memoryId: first.id, expectedRevision: first.revision,
      replacement: { content: 'Synthetic review is Tuesday.', kind: 'fact' },
      receipts: [receipt('second-change', 'Move the review to Tuesday.')] })).memory;
    return { old: ok(core.get({ namespace, memoryId: old.id })),
      first: ok(core.get({ namespace, memoryId: first.id })), current };
  } finally { core.close(); }
}

test('M1/M2 keyless SDK inspection filters before pagination and preserves default all-state cursor bindings', options, async (t) => {
  const path = database(); const seeded = seedInspectionHistory(path); const { client } = await host(t, path);
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(({ name }) => name).sort(),
    ['correct_memory', 'forget_memory', 'inspect_memory', 'recall_memory', 'remember_memory']);
  const schema = tools.find(({ name }) => name === 'inspect_memory').inputSchema;
  assert.ok(schema.properties.states);
  assert.equal(schema.additionalProperties, false);
  const base = ok(await call(client, 'inspect_memory', { limit: 1 }));
  for (const states of [['active', 'historical'], ['historical', 'active']]) {
    assert.deepEqual(ok(await call(client, 'inspect_memory', { limit: 1, states })), base);
    assert.deepEqual(ok(await call(client, 'inspect_memory', { limit: 1, states, cursor: base.nextCursor })),
      ok(await call(client, 'inspect_memory', { limit: 1, cursor: base.nextCursor })));
  }
  const seen = []; let cursor;
  do {
    const page = ok(await call(client, 'inspect_memory', { states: ['historical'], limit: 1, ...(cursor ? { cursor } : {}) }));
    assert.equal(page.memories.length, 1); assert.equal(page.memories[0].state, 'historical');
    assert.equal(Object.hasOwn(page.memories[0], 'content'), false);
    seen.push(page.memories[0].id); cursor = page.nextCursor; assert.ok(seen.length <= 2);
  } while (cursor);
  assert.deepEqual(seen.sort(), [seeded.old.memory.id, seeded.first.memory.id].sort());
  assert.deepEqual(ok(await call(client, 'inspect_memory', { states: ['active'] })).memories.map(({ id }) => id), [seeded.current.id]);
  error(await call(client, 'recall_memory', { query: 'What is the review day?' }), 'model_not_configured');
});

test('M1 invalid states and mixed ID/filter inspection reject without changing retained evidence', options, async (t) => {
  const path = database(); const seeded = seedInspectionHistory(path); const { client } = await host(t, path);
  const before = ok(await call(client, 'inspect_memory'));
  for (const states of [null, [], 'historical', ['deleted'], ['active', 'active'], ['historical', 'historical'],
    ['active', 'historical', 'active'], [null], [1], ['ACTIVE']]) await invalid(client, 'inspect_memory', { states });
  for (const states of [['active'], ['historical'], ['active', 'historical']]) {
    error(await call(client, 'inspect_memory', { memoryId: seeded.old.memory.id, states }), 'invalid_input');
  }
  await invalid(client, 'inspect_memory', { states: ['historical'], namespace: { ownerId: 'foreign' } });
  error(await call(client, 'inspect_memory', { states: ['historical'], receiptLimit: 1 }), 'invalid_input');
  assert.deepEqual(ok(await call(client, 'inspect_memory')), before);
  assert.deepEqual(ok(await call(client, 'inspect_memory', { memoryId: seeded.old.memory.id })), seeded.old);
});

test('M2 filtered SDK cursors reject cross-filter, default and foreign namespace reuse', options, async (t) => {
  const path = database(); const seeded = seedInspectionHistory(path); const { client } = await host(t, path);
  const cursor = ok(await call(client, 'inspect_memory', { states: ['historical'], limit: 1 })).nextCursor;
  assert.ok(cursor);
  for (const patch of [{}, { states: ['active'] }, { states: ['active', 'historical'] }]) {
    error(await call(client, 'inspect_memory', { limit: 1, cursor, ...patch }), 'invalid_cursor');
  }
  for (const binding of [{ owner: 'foreign-owner' }, { project: 'foreign-project' }]) {
    const foreign = await host(t, path, binding);
    assert.deepEqual(ok(await call(foreign.client, 'inspect_memory', { states: ['historical'] })).memories, []);
    error(await call(foreign.client, 'inspect_memory', { states: ['historical'], limit: 1, cursor }), 'invalid_cursor');
    error(await call(foreign.client, 'inspect_memory', { memoryId: seeded.old.memory.id }), 'memory_not_found');
    await foreign.client.close();
  }
});

for (const action of ['correct', 'forget']) {
  test(`M4 cold keyless inspection preserves historical receipts after ${action} of the successor`, options, async (t) => {
    const path = database(); const seeded = seedInspectionHistory(path); const first = await host(t, path);
    const inspected = ok(await call(first.client, 'inspect_memory', { memoryId: seeded.first.memory.id }));
    assert.deepEqual(inspected, seeded.first);
    const originalSources = []; let receiptCursor;
    do {
      const page = ok(await call(first.client, 'inspect_memory', { memoryId: seeded.old.memory.id, receiptLimit: 1,
        ...(receiptCursor ? { receiptCursor } : {}) }));
      originalSources.push(...page.receipts); receiptCursor = page.nextReceiptCursor;
    } while (receiptCursor);
    assert.deepEqual(originalSources, seeded.old.receipts);
    if (action === 'correct') ok(await call(first.client, 'correct_memory', { memoryId: seeded.current.id,
      expectedRevision: seeded.current.revision, content: 'Corrected successor, not the original change reason.' }));
    else ok(await call(first.client, 'forget_memory', { memoryId: seeded.current.id, expectedRevision: seeded.current.revision }));
    await first.client.close();
    const cold = await host(t, path);
    const retained = ok(await call(cold.client, 'inspect_memory', { memoryId: seeded.first.memory.id }));
    assert.equal(retained.memory.state, 'historical'); assert.deepEqual(retained.receipts, seeded.first.receipts);
    assert.equal(retained.supersession.evidenceAvailable, false); assert.deepEqual(retained.supersession.receiptIds, []);
    if (action === 'forget') assert.equal(retained.supersession.replacement, null);
    else {
      assert.equal(retained.supersession.replacement.memoryId, seeded.current.id);
      assert.equal(retained.supersession.replacement.revision, seeded.current.revision);
      assert.ok(retained.supersession.replacement.currentRevision > seeded.current.revision);
    }
    assert.ok(!JSON.stringify(retained).includes('Corrected successor'));
    const listed = ok(await call(cold.client, 'inspect_memory', { states: ['historical'] }));
    assert.deepEqual(listed.memories.map(({ id }) => id).sort(), [seeded.old.memory.id, seeded.first.memory.id].sort());
    assert.deepEqual(ok(await call(cold.client, 'inspect_memory', { memoryId: seeded.old.memory.id })).receipts, seeded.old.receipts);
  });
}

test('real stdio lists strict tools and persists revisions, receipts and forgetting across restart', options, async (t) => {
  const path = database();
  const first = await host(t, path);
  const tools = (await first.client.listTools()).tools;
  assert.deepEqual(tools.map((tool) => tool.name).sort(),
    ['correct_memory', 'forget_memory', 'inspect_memory', 'recall_memory', 'remember_memory']);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    for (const field of ['owner', 'ownerId', 'namespace', 'path', 'readSet']) {
      assert.equal(Object.hasOwn(tool.inputSchema.properties, field), false);
    }
  }
  const content = 'Harbor deploys Tuesdays.';
  const saved = ok(await call(first.client, 'remember_memory', { content, kind: 'fact' })).memory;
  assert.equal(saved.revision, 1);
  const detail = ok(await call(first.client, 'inspect_memory', { memoryId: saved.id }));
  assert.equal(detail.memory.content, content);
  assert.equal(detail.receipts[0].excerpt, content);
  assert.equal(detail.receipts[0].role, 'user');
  assert.equal(detail.receipts[0].client, 'cairn-local-mcp');
  await first.client.close();
  const second = await host(t, path);
  assert.equal(ok(await call(second.client, 'inspect_memory', { memoryId: saved.id })).memory.content, content);
  await invalid(second.client, 'correct_memory', { memoryId: saved.id, content: 'Thursday' });
  await invalid(second.client, 'forget_memory', { memoryId: saved.id });
  const replacement = 'Harbor deploys Thursdays.';
  const corrected = ok(await call(second.client, 'correct_memory', {
    memoryId: saved.id, expectedRevision: 1, content: replacement,
  })).memory;
  assert.equal(corrected.revision, 2);
  error(await call(second.client, 'correct_memory', {
    memoryId: saved.id, expectedRevision: 1, content: 'Stale update',
  }), 'revision_conflict');
  error(await call(second.client, 'forget_memory', { memoryId: saved.id, expectedRevision: 1 }), 'revision_conflict');
  const current = ok(await call(second.client, 'inspect_memory', { memoryId: saved.id }));
  assert.equal(current.memory.content, replacement);
  assert.ok(current.receipts.some((receipt) => receipt.excerpt === replacement));
  assert.equal(ok(await call(second.client, 'forget_memory', { memoryId: saved.id, expectedRevision: 2 })).forgotten, true);
  error(await call(second.client, 'inspect_memory', { memoryId: saved.id }), 'memory_not_found');
  await second.client.close();
  const third = await host(t, path);
  assert.deepEqual(ok(await call(third.client, 'inspect_memory')).memories, []);
});

test('modern pinned discovery supports the same stdio memory tools as legacy initialization', options, async (t) => {
  const { client } = await host(t, database(), { modern: true });
  assert.equal(client.getProtocolEra(), 'modern');
  assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28');
  assert.equal((await client.listTools()).tools.length, 5);
  const saved = ok(await call(client, 'remember_memory', { content: 'Synthetic modern-protocol note' })).memory;
  assert.equal(ok(await call(client, 'inspect_memory', { memoryId: saved.id })).memory.revision, saved.revision);
});

test('all tools reject authority overrides, unknown fields and invalid bounds without mutation', options, async (t) => {
  const { client } = await host(t, database());
  const inputs = {
    remember_memory: { content: 'Synthetic note' },
    recall_memory: { query: 'Synthetic' },
    inspect_memory: {},
    correct_memory: { memoryId: 'synthetic', expectedRevision: 1, content: 'Replacement' },
    forget_memory: { memoryId: 'synthetic', expectedRevision: 1 },
  };
  for (const [name, args] of Object.entries(inputs)) {
    for (const extra of [{ namespace: { ownerId: 'foreign' } }, { ownerId: 'foreign' },
      { path: '/synthetic-do-not-open.sqlite' }, { readSet: [] }, { surprise: true }]) {
      await invalid(client, name, { ...args, ...extra });
    }
  }
  for (const content of ['', 'x'.repeat(601)]) await invalid(client, 'remember_memory', { content });
  await invalid(client, 'remember_memory', { content: 'Test', kind: 'invented-kind' });
  for (const expectedRevision of [0, -1, 1.5, '1']) {
    await invalid(client, 'forget_memory', { memoryId: 'synthetic', expectedRevision });
  }
  await invalid(client, 'recall_memory', { query: 'x'.repeat(4001) });
  await invalid(client, 'inspect_memory', { limit: 51 });
  error(await call(client, 'inspect_memory', { memoryId: 'synthetic', limit: 1 }), 'invalid_input');
  assert.deepEqual(ok(await call(client, 'inspect_memory')).memories, []);
});

test('shared SQLite isolates owners, projects and personal scope against get/correct/forget', options, async (t) => {
  const path = database();
  const owner = await host(t, path, { project: 'harbor' });
  const saved = ok(await call(owner.client, 'remember_memory', { content: 'Synthetic Harbor private note' })).memory;
  for (const binding of [{ owner: 'other-owner', project: 'harbor' }, { project: 'juniper' }, {}]) {
    const foreign = await host(t, path, binding);
    assert.deepEqual(ok(await call(foreign.client, 'inspect_memory')).memories, []);
    error(await call(foreign.client, 'inspect_memory', { memoryId: saved.id }), 'memory_not_found');
    error(await call(foreign.client, 'correct_memory', {
      memoryId: saved.id, expectedRevision: 1, content: 'Foreign update',
    }), 'memory_not_found');
    assert.equal(ok(await call(foreign.client, 'forget_memory', { memoryId: saved.id, expectedRevision: 1 })).forgotten, false);
    const intact = ok(await call(owner.client, 'inspect_memory', { memoryId: saved.id })).memory;
    assert.equal(intact.revision, 1);
    assert.equal(intact.content, 'Synthetic Harbor private note');
    await foreign.client.close();
  }
});

test('bounded inspect pagination returns every memory exactly once', options, async (t) => {
  const { client } = await host(t, database());
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push(ok(await call(client, 'remember_memory', { content: `Synthetic note ${i}` })).memory.id);
  const seen = [];
  let cursor;
  do {
    const page = ok(await call(client, 'inspect_memory', { limit: 1, ...(cursor ? { cursor } : {}) }));
    assert.equal(page.memories.length, 1);
    assert.equal(Object.hasOwn(page.memories[0], 'content'), false);
    seen.push(page.memories[0].id);
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(seen.sort(), ids.sort());
});

test('recall without an injected model fails explicitly', options, async (t) => {
  const { client } = await host(t, database());
  ok(await call(client, 'remember_memory', { content: 'Harbor deploys Friday.' }));
  const recalled = await call(client, 'recall_memory', { query: 'When does Harbor deploy?' });
  assert.equal(recalled.ok, false);
  assert.equal(recalled.error.code, 'model_not_configured');
});

test('receipt inspection can paginate every source and rejects mixed list/get controls', options, async (t) => {
  const { client } = await host(t, database());
  let saved;
  for (let i = 0; i < 3; i++) saved = ok(await call(client, 'remember_memory', { content: 'One synthetic assertion.' })).memory;
  const receiptIds = [];
  let receiptCursor;
  do {
    const detail = ok(await call(client, 'inspect_memory', { memoryId: saved.id, receiptLimit: 1,
      ...(receiptCursor ? { receiptCursor } : {}) }));
    assert.equal(detail.receipts.length, 1);
    receiptIds.push(detail.receipts[0].id);
    receiptCursor = detail.nextReceiptCursor;
  } while (receiptCursor);
  assert.equal(new Set(receiptIds).size, 3);
  error(await call(client, 'inspect_memory', { receiptLimit: 1 }), 'invalid_input');
  error(await call(client, 'inspect_memory', { memoryId: saved.id, cursor: 'synthetic' }), 'invalid_input');
});

test('scripted model over actual stdio returns current revisions and original receipts as untrusted evidence', options, async (t) => {
  const { client } = await host(t, database(), { fixture: true });
  const initial = 'Synthetic review happens Tuesday.';
  const saved = ok(await call(client, 'remember_memory', { content: initial })).memory;
  const first = ok(await call(client, 'recall_memory', { query: 'When is review?' }));
  assert.equal(first.memories.length, 1);
  assert.equal(first.memories[0].memory.id, saved.id);
  assert.equal(first.memories[0].memory.revision, saved.revision);
  assert.equal(first.memories[0].receipts[0].excerpt, initial);
  const replacement = 'Synthetic review happens Friday.';
  const corrected = ok(await call(client, 'correct_memory', {
    memoryId: saved.id, expectedRevision: saved.revision, content: replacement,
  })).memory;
  const second = ok(await call(client, 'recall_memory', { query: 'When is review now?' }));
  assert.equal(second.memories[0].memory.revision, corrected.revision);
  assert.equal(second.memories[0].memory.content, replacement);
  assert.ok(second.memories[0].receipts.some((receipt) => receipt.excerpt === replacement));
  const redacted = ok(await call(client, 'recall_memory', { query: 'Redaction probe sk-' + 'a'.repeat(40) }));
  assert.equal(redacted.memories[0].memory.id, saved.id);
  ok(await call(client, 'forget_memory', { memoryId: saved.id, expectedRevision: corrected.revision }));
  assert.deepEqual(ok(await call(client, 'recall_memory', { query: 'When is review?' })).memories, []);
});

test('explicit memory and correction redact synthetic secrets in content and receipts', options, async (t) => {
  const { client } = await host(t, database());
  const synthetic = 'sk-' + 'b'.repeat(40);
  const saved = ok(await call(client, 'remember_memory', { content: `Synthetic credential ${synthetic}` })).memory;
  const first = ok(await call(client, 'inspect_memory', { memoryId: saved.id }));
  assert.equal(first.memory.content, 'Synthetic credential [REDACTED]');
  assert.equal(first.receipts[0].excerpt, 'Synthetic credential [REDACTED]');
  assert.equal(JSON.stringify(first).includes(synthetic), false);
  const corrected = ok(await call(client, 'correct_memory', {
    memoryId: saved.id, expectedRevision: saved.revision, content: `Replacement credential ${synthetic}`,
  })).memory;
  const second = ok(await call(client, 'inspect_memory', { memoryId: corrected.id }));
  assert.equal(second.memory.content, 'Replacement credential [REDACTED]');
  assert.ok(second.receipts.some((receipt) => receipt.excerpt === 'Replacement credential [REDACTED]'));
  assert.equal(JSON.stringify(second).includes(synthetic), false);
});

function rawProcess(t, args) {
  const child = spawn(process.execPath, [cli, ...args], { env: { NODE_NO_WARNINGS: '1' }, stdio: 'pipe' });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.stdin.on('error', () => {});
  const closed = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr })));
  return { child, closed };
}

test('fresh stdio labels explicitly superseded history, recalls only current and forgets without reactivation', options, async (t) => {
  // Seed via the trusted explicit core API, NOT automatic capture or an MCP
  // supersede tool. Subsequent consumer operations use real stdio processes.
  const path = database();
  const namespace = { ownerId: 'synthetic-owner', scope: 'personal', projectId: null };
  const core = openMemoryCore({ path });
  let changed;
  let originalReceipts;
  try {
    const receipt = (eventId, excerpt) => ({ client: 'synthetic-seed', sessionId: 'review', eventId, role: 'user', excerpt });
    const old = ok(core.admit({ namespace, memory: { content: 'Harbor review is Friday.', kind: 'fact' },
      receipts: [receipt('old', 'Harbor review is Friday.')] })).memory;
    originalReceipts = ok(core.get({ namespace, memoryId: old.id })).receipts;
    changed = ok(core.supersede({ namespace, memoryId: old.id, expectedRevision: old.revision,
      replacement: { content: 'Harbor review is Monday.', kind: 'fact' },
      receipts: [receipt('new', 'Move Harbor review from Friday to Monday.')] }));
  } finally { core.close(); }
  const first = await host(t, path, { fixture: true });
  const historical = ok(await call(first.client, 'inspect_memory', { memoryId: changed.previous.id }));
  assert.equal(historical.memory.state, 'historical');
  assert.deepEqual(historical.receipts, originalReceipts);
  assert.equal(historical.supersession.replacement.memoryId, changed.memory.id);
  assert.equal(historical.supersession.evidenceAvailable, true);
  const recalled = ok(await call(first.client, 'recall_memory', { query: 'When is Harbor review?' }));
  assert.deepEqual(recalled.memories.map(({ memory }) => memory.id), [changed.memory.id]);
  assert.equal(JSON.stringify(recalled.memories.map(({ memory }) => memory.content)).includes('Friday'), false);
  error(await call(first.client, 'correct_memory', { memoryId: changed.previous.id,
    expectedRevision: historical.memory.revision, content: 'Rewrite history' }), 'memory_historical');
  ok(await call(first.client, 'forget_memory', { memoryId: changed.memory.id, expectedRevision: changed.memory.revision }));
  await first.client.close();
  const second = await host(t, path, { fixture: true });
  assert.deepEqual(ok(await call(second.client, 'recall_memory', { query: 'When is Harbor review?' })).memories, []);
  const retained = ok(await call(second.client, 'inspect_memory', { memoryId: changed.previous.id }));
  assert.equal(retained.memory.state, 'historical');
  assert.equal(retained.supersession.replacement, null);
  assert.deepEqual(retained.supersession.receiptIds, []);
  assert.equal(retained.supersession.evidenceAvailable, false);
  ok(await call(second.client, 'forget_memory', { memoryId: changed.previous.id, expectedRevision: retained.memory.revision }));
  assert.deepEqual(ok(await call(second.client, 'inspect_memory')).memories, []);
});

test('fresh stdio observes ordered capture reconciliation and never resurrects corrected or forgotten history', options, async (t) => {
  // Seed through actual automatic capture with source ordering and scripted
  // semantic ports. No explicit supersede call is used; MCP has no supersede tool.
  const path = database();
  const namespace = { ownerId: 'synthetic-owner', scope: 'personal', projectId: null };
  const friday = 'Harbor review is Friday.';
  const monday = 'Harbor review is Monday.';
  const calls = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract: ({ input }) => {
      calls.push('extract');
      return { items: [{ content: input.messages[0].content.includes('Monday') ? monday : friday,
        kind: 'fact', confidence: 0.9, sourceIndices: [0] }] };
    },
    reconcile: ({ input }) => {
      calls.push('reconcile');
      assert.deepEqual(input.items.map((item) => item.content), [monday]);
      assert.deepEqual(input.candidates.map((candidate) => candidate.content), [friday]);
      return { transitions: [{ replacementIndex: 0, predecessorIndex: 0, evidenceIndices: [0],
        relation: 'supersedes', valueChange: 'changed', adoption: 'explicit' }] };
    },
    classify: ({ input }) => {
      calls.push('classify');
      return { items: input.memories.map(({ id }) => ({ memoryId: id, parentIds: [] })) };
    },
  };
  const core = openMemoryCore({ path, model });
  let previous;
  let replacement;
  try {
    const capture = (sequence, content) => core.capture({ namespace, client: 'synthetic-ordered-source',
      sessionId: 'harbor-review', eventId: `capture-${sequence}`,
      causal: { streamId: 'harbor-review-stream', sequence },
      messages: [{ id: `message-${sequence}`, role: 'user', content }] });
    const original = ok(await capture(1, friday));
    assert.deepEqual(original.reconciliation,
      { status: 'complete_no_change', reason: null, retiredCount: 0 });
    previous = original.admission.memories[0];
    const changed = ok(await capture(2, 'Confirmed update: Harbor review moves from Friday to Monday.'));
    assert.deepEqual(changed.reconciliation, { status: 'applied', reason: null, retiredCount: 1 });
    replacement = changed.admission.memories[0];
    assert.deepEqual(calls, ['extract', 'classify', 'extract', 'reconcile', 'classify']);
  } finally { core.close(); }

  const first = await host(t, path, { fixture: true });
  const historical = ok(await call(first.client, 'inspect_memory', { memoryId: previous.id }));
  assert.equal(historical.memory.state, 'historical');
  assert.equal(historical.memory.content, friday);
  assert.equal(historical.supersession.replacement.memoryId, replacement.id);
  assert.deepEqual(historical.receipts.map(({ excerpt }) => excerpt), [friday]);
  const current = ok(await call(first.client, 'inspect_memory', { memoryId: replacement.id }));
  assert.equal(current.memory.state, 'active');
  assert.equal(current.memory.origin, 'agent-inferred');
  assert.equal(current.memory.content, monday);
  const recalled = ok(await call(first.client, 'recall_memory', { query: 'When is Harbor review?' }));
  assert.deepEqual(recalled.memories.map(({ memory }) => memory.id), [replacement.id]);
  assert.deepEqual(recalled.memories.map(({ memory }) => memory.content), [monday]);

  const corrected = ok(await call(first.client, 'correct_memory', { memoryId: replacement.id,
    expectedRevision: current.memory.revision, content: 'Harbor review is Tuesday.' })).memory;
  const afterCorrection = ok(await call(first.client, 'recall_memory', { query: 'When is Harbor review now?' }));
  assert.deepEqual(afterCorrection.memories.map(({ memory }) => memory.id), [replacement.id]);
  assert.deepEqual(afterCorrection.memories.map(({ memory }) => memory.content), ['Harbor review is Tuesday.']);
  assert.equal(ok(await call(first.client, 'inspect_memory', { memoryId: previous.id })).memory.state, 'historical');
  ok(await call(first.client, 'forget_memory', { memoryId: replacement.id, expectedRevision: corrected.revision }));
  await first.client.close();

  const second = await host(t, path, { fixture: true });
  assert.deepEqual(ok(await call(second.client, 'recall_memory', { query: 'When is Harbor review?' })).memories, []);
  const retained = ok(await call(second.client, 'inspect_memory', { memoryId: previous.id }));
  assert.equal(retained.memory.state, 'historical');
  assert.equal(retained.supersession.replacement, null);
  assert.equal(retained.supersession.evidenceAvailable, false);
});

test('malformed CLI exits without stdout or reflecting sensitive argument text', options, async (t) => {
  const marker = 'SYNTHETIC-SECRET-DO-NOT-REFLECT';
  for (const args of [[], ['--unknown', marker], ['--db', marker],
    ['--db', marker, '--owner', 'synthetic', '--owner', marker]]) {
    const { child, closed } = rawProcess(t, args);
    child.stdin.end();
    const result = await closed;
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /cairn_mcp_start_failed/);
    assert.equal(result.stderr.includes(marker), false);
  }
});

test('oversized transport message closes the server without reflecting its payload', options, async (t) => {
  const { child, closed } = rawProcess(t, ['--db', database(), '--owner', 'synthetic']);
  const marker = 'SYNTHETIC-OVERSIZE-CANARY';
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'remember_memory', arguments: { content: marker + 'x'.repeat(70000) } } }) + '\n');
  // Keep stdin open: the transport itself must close on the size violation.
  const result = await closed;
  assert.equal(result.signal, null);
  assert.equal(result.stdout.includes(marker), false);
  assert.equal(result.stderr.includes(marker), false);
  assert.match(result.stderr, /cairn_mcp_transport_error/);
});
