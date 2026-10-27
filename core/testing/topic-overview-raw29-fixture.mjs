import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore, openMemoryReader } from '../index.mjs';
import { openDatabase } from '../database.mjs';
import { installPrivateCards, installCardMemorySources } from '../private-card-schema.mjs';
import { installPrivateEvidence } from '../private-evidence-schema.mjs';
import { installPrivateOrganization } from '../private-organization-schema.mjs';
import { installRawJournal, installRawCapture } from '../raw-schema.mjs';
import { installRawLineage } from '../raw-lineage-schema.mjs';
import { installRawDeletion } from '../raw-deletion-schema.mjs';
import { installRawSources } from '../raw-source-schema.mjs';
import { installLocalAuthority } from '../local-authority-schema.mjs';
import { rationaleModel } from './rationale-model.mjs';
import { localPlainPort, splitRaw } from './raw-fixtures.mjs';
import { cardHost } from './raw-source-fixtures.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

export { collectOverview } from './topic-overview-fixture.mjs';
export const namespace = { ownerId: 'raw-overview-owner', scope: 'personal', projectId: null };
export const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
// Each layout is physically installed, never a schema29 file labelled as legacy.
export function installOverviewLayout(path, version) {
  const steps = [[20, installPrivateCards], [21, installCardMemorySources], [22, installPrivateEvidence],
    [23, installPrivateOrganization], [24, installRawJournal], [25, installRawCapture],
    [26, installRawLineage], [27, installRawDeletion], [28, installRawSources], [29, installLocalAuthority]];
  assert.ok([18, ...steps.map(([value]) => value)].includes(version));
  const db = openDatabase(path);
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18);
    for (const [value, install] of steps) if (value <= version) {
      install(db); db.exec('PRAGMA user_version=' + value);
    }
    return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
  } finally { db.close(); }
}
// Hashing in a SQLite-free child preserves locks held by live fixture handles.
export function fileBytes(path) {
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import { existsSync, readFileSync } from 'node:fs';
    import { createHash } from 'node:crypto';
    const path = process.argv[1];
    console.log(JSON.stringify(Object.fromEntries(['', '-wal', '-shm'].map(suffix => [suffix,
      existsSync(path + suffix) ? createHash('sha256').update(readFileSync(path + suffix)).digest('hex') : null]))));
  `, path], { env: {}, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0);
  return JSON.parse(child.stdout);
}

export function rawOverviewFixture(t, { client = 'claude-code', matching = false } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'raw29-overview-' }), path = join(workspace.path, 'memory.sqlite');
  const host = cardHost(), base = rationaleModel(), state = { selected: 'a', calls: 0 };
  const kinds = { a: 'fact', b: 'decision', c: 'fact', unfiled: 'preference', later: 'context' };
  const model = { ...base, extract: () => ({ items: [{ content: 'MEMORY_BODY_SENTINEL ' + state.selected,
    kind: kinds[state.selected], confidence: .8, sourceIndices: [0] }] }) };
  for (const method of ['extract', 'qualifyCandidates', 'classify']) {
    const run = model[method]; model[method] = input => { state.calls++; return run(input); };
  }
  const core = openMemoryCore({ path, model, privateCards: host.options, captureQualification: 'source-bound-v2',
    ...(matching ? { captureQualifiedDuplicates: 'append-matching-evidence-v1' } : {}),
    rawConversations: { mode: 'raw-v1', port: localPlainPort(), capBytes: 1000000,
      readPolicy: () => ({ generation: 'synthetic-overview', reason: null }) } });
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path); workspace.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 29);
  const memory = id => ok(core.get({ namespace, memoryId: id })).memory;
  async function capture(name, sessionId = name) {
    state.selected = name;
    const text = 'RAW_BODY_SENTINEL RECEIPT_BODY_SENTINEL synthetic ' + sessionId;
    const input = { namespace, client, sessionId, eventId: 'event-' + sessionId,
      messages: splitRaw(text, { id: 'message-' + sessionId }) };
    const saved = ok(await core.captureRaw(input)), interpretation = ok(saved.interpretation);
    assert.equal(interpretation.admission.memories.length, 1);
    const id = interpretation.admission.memories[0].id;
    const receipts = ok(core.get({ namespace, memoryId: id })).receipts;
    assert.ok(receipts.length);
    assert.ok(receipts.some(receipt => db.prepare('SELECT 1 FROM raw_receipt_lineage WHERE receipt_id=? AND conversation_id=?')
      .get(receipt.id, saved.raw.conversationId)));
    return { id, conversationId: saved.raw.conversationId, input };
  }
  function place(items) {
    return ok(core.applyPlacement({ namespace,
      expectedIndexRevision: db.prepare("SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope='personal' AND project_id=''").get(namespace.ownerId).epoch,
      expectedMemoryRevisions: items.map(item => ({ memoryId: item.memoryId, revision: memory(item.memoryId).revision })), proposal: { items } }));
  }
  async function hierarchy() {
    const a = await capture('a'), b = await capture('b'), c = await capture('c'), unfiled = await capture('unfiled');
    const first = place([{ memoryId: a.id, parentIds: [], newL1: { title: 'Raw topic A', parentL2Ids: [], newL2Title: 'Raw root' } }]);
    const root = first.createdMocs.find(moc => moc.level === 'L2'), topicA = first.createdMocs.find(moc => moc.level === 'L1');
    const topicB = place([{ memoryId: b.id, parentIds: [], newL1: { title: 'Raw topic B', parentL2Ids: [root.id] } }]).createdMocs[0];
    place([{ memoryId: c.id, parentIds: [topicA.id, topicB.id] }]);
    return { a, b, c, unfiled, root, topicA, topicB };
  }
  async function remove(conversationId, actionId = 'delete-source') {
    const view = ok(await core.getConversation({ namespace, conversationId }));
    return ok(core.deleteConversation({ namespace, conversationId, expectedRevision: view.conversation.revision, actionId }));
  }
  function reader(location = path) {
    const value = openMemoryReader({ path: location, ownerId: namespace.ownerId }); workspace.defer(() => value.close()); return value;
  }
  function authoredSentinel() {
    return ok(host.call(core, 'createCardDraft', { namespace, actionId: 'explicit-card-draft', drafting: 'authored',
      input: { title: 'Separate authored Card', body: 'CARD_BODY_SENTINEL', authoredInput: { text: 'Synthetic submitted note.', occurredAt: null } } }));
  }
  return { workspace, path, db, core, state, capture, memory, place, hierarchy, remove, reader, authoredSentinel };
}
