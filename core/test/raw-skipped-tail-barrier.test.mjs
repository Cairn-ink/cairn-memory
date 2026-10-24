import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { rawFixture, rawNamespace as ns, localPlainPort, splitRaw, rawRequest } from '../testing/raw-fixtures.mjs';

const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const denied = (result, code) => { assert.equal(result.ok, false); assert.equal(result.error.code, code); };
const reasons = ['quota_reached', 'notice_required', 'raw_disabled'];
const receiptKeys = { raw_parts: ['conversation_id', 'message_id', 'part_index'], raw_events: ['owner_id', 'scope', 'project_id', 'client', 'event_id'] };
const receipts = db => Object.fromEntries(Object.entries(receiptKeys).map(([table, keys]) =>
  [table, db.prepare(`SELECT * FROM ${table} ORDER BY ${keys.join(',')}`).all().map(row => ({ ...row }))]));

for (const client of ['claude-code', 'codex']) for (const reason of reasons) {
  test(`B2a-01/04 ${client} ${reason}: public pause closes skipped tail without changing receipts`, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'raw-skipped-barrier-' }), path = join(workspace.path, 'store.sqlite');
    let core, calls = 0;
    workspace.defer(() => core?.close());
    const reopen = (eligible = false) => {
      core?.close();
      core = openMemoryCore({ path, model: { contextWindow: 8192, countTokens: () => 1, extract: () => { calls++; return { items: [] }; } },
        rawConversations: { mode: !eligible && reason === 'raw_disabled' ? 'off' : 'raw-v1', port: localPlainPort(),
          capBytes: !eligible && reason === 'quota_reached' ? 1 : 100000,
          readPolicy: () => ({ generation: eligible ? 'eligible' : 'initial', reason: !eligible && reason === 'notice_required' ? reason : null }) } });
    };
    reopen();
    const db = new DatabaseSync(path); workspace.defer(() => db.close());
    const parts = splitRaw('Synthetic skipped text.'.repeat(500)), first = rawRequest(parts[0], { client });
    const skipped = ok(await core.captureRaw(first));
    assert.equal(skipped.raw.parts[0].reason, reason); assert.equal(calls, 1);
    const initial = receipts(db), initialUsage = ok(core.getRawUsage({ ownerId: ns.ownerId }));
    const revision = db.prepare('SELECT revision FROM raw_conversations').get().revision;
    reopen(true);
    const fresh = rawRequest(splitRaw('fresh', { id: 'fresh', ordinal: 2 })[0], { client });
    denied(await core.captureRaw(fresh), 'raw_part_out_of_order');
    const paused = ok(core.setCapturePaused({ namespace: ns, expectedGeneration: 'initial', paused: true }));
    assert.equal(db.prepare('SELECT reason FROM raw_messages').get().reason, 'capture_barrier');
    assert.equal(db.prepare('SELECT revision FROM raw_conversations').get().revision, revision + 1);
    assert.deepEqual(receipts(db), initial);
    assert.deepEqual(ok(core.getRawUsage({ ownerId: ns.ownerId })), { ...initialUsage, capBytes: 100000, remainingBytes: 100000, atCap: false,
      revision: reason === 'quota_reached' ? initialUsage.revision + 1 : initialUsage.revision });
    ok(core.setCapturePaused({ namespace: ns, expectedGeneration: paused.generation, paused: false }));
    reopen(true);
    denied(await core.captureRaw(first), 'capture_evidence_closed');
    const saved = ok(await core.captureRaw(fresh)); assert.equal(saved.raw.parts[0].saved, true); assert.equal(calls, 2);
    for (const part of parts.slice(1)) {
      const late = ok(await core.captureRaw(rawRequest(part, { client })));
      assert.deepEqual(late.raw.parts, [{ messageId: part.id, index: part.part.index, saved: false, reason: 'capture_barrier' }]);
      assert.equal(calls, 2);
    }
    const view = ok(await core.getConversation({ namespace: ns, conversationId: skipped.raw.conversationId }));
    assert.ok(view.messages[0].parts.every(part => part.text === null));
    assert.equal(view.messages[0].parts[0].reason, reason);
    assert.equal(view.messages[1].parts[0].text, 'fresh');
    assert.equal(ok(core.getRawUsage({ ownerId: ns.ownerId })).savedBytes, 5);
    assert.equal(ok(core.getRawUsage({ ownerId: ns.ownerId })).reservedBytes, 0);
    for (const [table, rows] of Object.entries(initial)) {
      const current = receipts(db)[table];
      for (const row of rows) assert.deepEqual(current.find(value => receiptKeys[table].every(key => value[key] === row[key])), row);
    }
  });
}

for (const reason of reasons) test(`B2a-02/05 ${reason}: only an actual barrier repairs an incomplete policy skip`, async t => {
  const f = rawFixture(t, { capBytes: reason === 'quota_reached' ? 1 : 100000, mode: reason === 'raw_disabled' ? 'off' : 'raw-v1' });
  if (reason === 'notice_required') f.state.reason = reason;
  const first = await f.journal.register(rawRequest(splitRaw('abcdefghi', { size: 3 })[0]));
  f.state.reason = null; f.reopen({ mode: 'raw-v1', capBytes: 100000 });
  const before = receipts(f.db), usage = f.journal.getRawUsage({ ownerId: ns.ownerId });
  f.journal.setRawCaptureControl({ ownerId: ns.ownerId, client: 'claude-code', enabled: false, expectedRevision: 0 });
  f.journal.setRawCaptureControl({ ownerId: ns.ownerId, client: 'claude-code', enabled: true, expectedRevision: 1 });
  const fresh = rawRequest(splitRaw('fresh', { id: 'fresh', ordinal: 2 })[0]);
  await assert.rejects(f.journal.register(fresh), { code: 'raw_part_out_of_order' });
  assert.deepEqual(f.journal.closePending({ ownerId: ns.ownerId, namespace: ns, reason: 'capture_barrier' }), { closedMessages: 1, releasedBytes: 0 });
  const changed = f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(first.conversationId).revision;
  const epoch = f.db.prepare('SELECT epoch FROM namespace_epochs').get().epoch;
  assert.deepEqual(f.journal.closePending({ ownerId: ns.ownerId, namespace: ns, reason: 'capture_barrier' }), { closedMessages: 0, releasedBytes: 0 });
  assert.equal(f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(first.conversationId).revision, changed);
  assert.equal(f.db.prepare('SELECT epoch FROM namespace_epochs').get().epoch, epoch);
  assert.deepEqual(f.journal.getRawUsage({ ownerId: ns.ownerId }), usage);
  assert.deepEqual(receipts(f.db), before);
  assert.equal((await f.journal.register(fresh)).parts[0].saved, true);
});

test('B2a-02 complete skips and tool-off tails remain unchanged alongside one pending reservation', async t => {
  const f = rawFixture(t);
  const register = (text, sessionId, size = 3) => f.journal.register(rawRequest(splitRaw(text, { size })[0], { sessionId, eventId: sessionId }));
  await register('abcdefghi', 'tool-off');
  f.journal.setRawCaptureControl({ ownerId: ns.ownerId, client: 'claude-code', enabled: false, expectedRevision: 0 });
  f.journal.setRawCaptureControl({ ownerId: ns.ownerId, client: 'claude-code', enabled: true, expectedRevision: 1 });
  for (const reason of ['notice_required', 'raw_disabled', 'quota_reached']) {
    f.state.reason = reason === 'notice_required' ? reason : null;
    f.reopen({ mode: reason === 'raw_disabled' ? 'off' : 'raw-v1', capBytes: reason === 'quota_reached' ? 1 : 100000 });
    await register('xy', 'complete-' + reason);
  }
  f.state.reason = null; f.reopen({ mode: 'raw-v1', capBytes: 100000 });
  await register('xy', 'saved-complete');
  const pending = await register('abcdefghi', 'pending');
  const untouched = f.db.prepare('SELECT * FROM raw_messages WHERE conversation_id!=? ORDER BY conversation_id').all(pending.conversationId);
  const before = f.journal.getRawUsage({ ownerId: ns.ownerId });
  assert.deepEqual(f.journal.closePending({ ownerId: ns.ownerId, reason: 'capture_barrier' }), { closedMessages: 1, releasedBytes: 6 });
  assert.deepEqual(f.db.prepare('SELECT * FROM raw_messages WHERE conversation_id!=? ORDER BY conversation_id').all(pending.conversationId), untouched);
  assert.equal(f.journal.getRawUsage({ ownerId: ns.ownerId }).savedBytes, before.savedBytes);
  assert.equal(f.journal.getRawUsage({ ownerId: ns.ownerId }).reservedBytes, 0);
  const once = f.journal.getRawUsage({ ownerId: ns.ownerId });
  assert.deepEqual(f.journal.closePending({ ownerId: ns.ownerId, reason: 'capture_barrier' }), { closedMessages: 0, releasedBytes: 0 });
  assert.deepEqual(f.journal.getRawUsage({ ownerId: ns.ownerId }), once);
});

test('B2a-03 feature-off project control is atomic and exact across clients, owners and namespaces', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'raw-project-skipped-barrier-' }), path = join(workspace.path, 'store.sqlite');
  const project = { ...ns, scope: 'project', projectId: 'target' };
  const core = openMemoryCore({ path, model: { contextWindow: 8192, countTokens: () => 1, extract: () => ({ items: [] }) },
    rawConversations: { mode: 'raw-v1', port: localPlainPort(), capBytes: 100000,
      readPolicy: () => ({ generation: 'notice', reason: 'notice_required' }) } });
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path); workspace.defer(() => db.close());
  const targets = new Set();
  for (const namespace of [project, ns, { ...project, projectId: 'other' }, { ...project, ownerId: 'other-owner' }]) {
    for (const client of ['claude-code', 'codex']) {
      const result = ok(await core.captureRaw(rawRequest(splitRaw('abcdefghi', { size: 3 })[0], { namespace, client,
        eventId: 'skip-' + namespace.ownerId + '-' + namespace.scope + '-' + namespace.projectId + '-' + client })));
      if (namespace === project) targets.add(result.raw.conversationId);
    }
  }
  for (const client of ['claude-code', 'codex']) ok(await core.captureRaw(rawRequest(splitRaw('complete')[0], {
    namespace: project, client, sessionId: 'complete-session', eventId: 'complete-' + client,
  })));
  const writer = openMemoryCore({ path }); workspace.defer(() => writer.close());
  assert.equal(writer.captureRaw, undefined);
  const snapshot = () => Object.fromEntries(['raw_messages', 'raw_conversations', 'raw_parts', 'raw_events', 'raw_owner_usage', 'namespace_epochs', 'episode_controls']
    .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => ({ ...row }))]));
  const before = snapshot();
  denied(writer.setProjectCapture({ namespace: project, expectedGeneration: 'stale', enabled: false }), 'generation_conflict');
  assert.deepEqual(snapshot(), before);
  const stopped = ok(writer.setProjectCapture({ namespace: project, expectedGeneration: 'initial', enabled: false }));
  const after = snapshot();
  assert.deepEqual(after.raw_parts, before.raw_parts); assert.deepEqual(after.raw_events, before.raw_events);
  assert.deepEqual(after.raw_owner_usage, before.raw_owner_usage);
  for (const row of before.raw_messages) {
    const actual = after.raw_messages.find(value => value.conversation_id === row.conversation_id);
    assert.deepEqual(actual, targets.has(row.conversation_id) ? { ...row, reason: 'capture_barrier' } : row);
  }
  for (const row of before.raw_conversations) {
    const actual = after.raw_conversations.find(value => value.id === row.id);
    if (targets.has(row.id)) {
      assert.equal(actual.revision, row.revision + 1);
      assert.deepEqual({ ...actual, revision: row.revision, last_received_at: row.last_received_at }, row);
    } else assert.deepEqual(actual, row);
  }
  for (const row of before.namespace_epochs.filter(row => row.owner_id !== project.ownerId || row.scope !== project.scope || row.project_id !== project.projectId)) {
    assert.deepEqual(after.namespace_epochs.find(value => value.owner_id === row.owner_id && value.scope === row.scope && value.project_id === row.project_id), row);
  }
  denied(writer.setProjectCapture({ namespace: project, expectedGeneration: 'initial', enabled: true }), 'generation_conflict');
  assert.deepEqual(snapshot(), after);
  ok(writer.setProjectCapture({ namespace: project, expectedGeneration: stopped.generation, enabled: true }));
  for (const client of ['claude-code', 'codex']) {
    const next = ok(await core.captureRaw(rawRequest(splitRaw('fresh', { id: 'fresh', ordinal: 2 })[0], { namespace: project, client })));
    assert.equal(next.raw.parts[0].reason, 'notice_required');
  }
});
