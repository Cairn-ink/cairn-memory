import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contentSafetyObservations } from '../content-safety-observations.mjs';
import { classifyCardBodySafetyV1 } from '../content-safety-classifier.mjs';
import { openDatabase, readTransaction } from '../database.mjs';
import { createRawSourceRoots } from '../raw-source-roots.mjs';
import { sourceFixture, savedSource, ns as rawNs } from '../testing/raw-source-fixtures.mjs';
import { fixture, ns, ok, receipt } from './content-safety-preflight-fixture.mjs';
import { installedImportClosure } from '../../packaging/test/fixtures/installed-import-closure.mjs';

function classify(f, id) {
  const snapshot = readTransaction(f.db, () => contentSafetyObservations(f.db, { scanRows: 250000, scanBytes: 128 * 1024 * 1024 }, () => {}));
  return classifyCardBodySafetyV1(snapshot.observations.find(row => row.body.identity.key === id));
}
function rawFixture(t) {
  const f = sourceFixture(t), upgrade = openDatabase(f.path, { currentDependencies: true }); upgrade.close();
  let serial = 0;
  f.admit = (content, receipts) => ok(f.core.admit({ namespace: rawNs, memory: { content, kind: 'context' }, receipts })).memory;
  f.card = memory => {
    const draft = ok(f.call('createCardDraft', { namespace: rawNs, actionId: 'draft-' + (++serial), drafting: 'authored', input: {
      title: 'Synthetic round two title', body: 'Synthetic round two body', sourcePolicy: 'retained-receipts-v1',
      memoryRefs: [{ type: 'memory', namespace: rawNs, memoryId: memory.id, revision: memory.revision }] } }));
    return ok(f.call('confirmCardDraft', { namespace: rawNs, cardId: draft.id, expectedRevision: draft.revision, actionId: 'confirm-' + (++serial) }));
  };
  f.remove = source => ok(f.core.deleteConversation({ namespace: rawNs, conversationId: source.conversationId,
    expectedRevision: f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(source.conversationId).revision,
    actionId: 'remove-' + (++serial) }));
  return f;
}
const rawReceipt = (source, sessionId) => ({ client: 'codex', sessionId, eventId: source.messageId, role: 'user', excerpt: source.text });

test('R2.1 genuine Memory revision effects recover removed bindings while caller effects cannot', t => {
  const f = fixture(t), memory = f.admit(), card = f.draft(ns, [memory], true);
  const unrelated = f.draft(ns, undefined, true), detail = ok(f.call('getCard', { namespace: ns, cardId: unrelated.id })).card;
  ok(f.call('editKnowledgeCard', { namespace: ns, cardId: unrelated.id, expectedRevision: detail.revision,
    actionId: `memory-revision-${memory.id}-${memory.revision + 1}`, title: detail.title, body: detail.body,
    applicability: 'unknown', bindings: detail.bindings.map(item => item.source) }));
  ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  assert.equal(classify(f, unrelated.id).status, 'unknown');
  f.db.prepare('DELETE FROM card_memory_bindings WHERE card_id=?').run(card.id);
  assert.equal(classify(f, card.id).status, 'known-suppressed');
});

test('R2.1 retained invalidation belongs to the body revision it actually affected', t => {
  const f = fixture(t), card = f.draft(ns, undefined, true);
  const source = ok(f.call('getCard', { namespace: ns, cardId: card.id })).card.bindings[0].source;
  ok(f.call('deleteSourceNote', { namespace: ns, sourceId: source.sourceId, expectedRevision: source.revision, actionId: 'delete-old-note' }));
  const fresh = f.draft(ns, undefined, true), current = f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(card.id);
  const bindings = f.db.prepare('SELECT source_ref FROM card_bindings WHERE card_id=? ORDER BY position').all(fresh.id)
    .map(item => JSON.parse(item.source_ref));
  ok(f.call('editKnowledgeCard', { namespace: ns, cardId: card.id, expectedRevision: current.revision, actionId: 'replace-body',
    title: 'Synthetic replacement body title', body: 'Synthetic replacement body bytes', applicability: 'unknown', bindings }));
  assert.equal(classify(f, card.id).status, 'unknown');
});

test('R2.2 same Memory version retains ancestry after a presentation receipt is removed', async t => {
  const f = rawFixture(t), a = await savedSource(f, 'Synthetic raw A.', { sessionId: 'session-A' });
  const b = await savedSource(f, 'Synthetic raw B.', { sessionId: 'session-B' });
  const memory = f.admit('Synthetic joint interpretation.', [rawReceipt(a, 'session-A'), rawReceipt(b, 'session-B')]);
  const card = f.card(memory), aReceipt = f.db.prepare('SELECT receipt_id FROM raw_receipt_lineage WHERE conversation_id=?').get(a.conversationId).receipt_id;
  f.db.prepare('DELETE FROM card_memory_bindings WHERE card_id=? AND receipt_id=?').run(card.id, aReceipt);
  // Canonical fence without removing either receipt: independent of presentation selection.
  const key = createRawSourceRoots(f.db).hashSession(rawNs, 'codex', 'session-A');
  f.db.prepare('INSERT INTO raw_session_fences VALUES(?,?,?,?,?)').run(rawNs.ownerId, rawNs.scope, '', 'codex', key);
  assert.deepEqual(classify(f, card.id), { status: 'known-suppressed', reasons: ['purge'] });
});

for (const variant of ['independent-supersession', 'raw-revision-advance']) test(`R2.3 old Raw deletion cannot explain later missing receipt: ${variant}`, async t => {
  const f = rawFixture(t), a = await savedSource(f, 'Synthetic deleted A.', { sessionId: 'session-A' });
  const b = variant === 'raw-revision-advance' ? await savedSource(f, 'Synthetic surviving B.', { sessionId: 'session-B' }) : null;
  const support = b ? rawReceipt(b, 'session-B') : receipt('independent-B');
  let memory = f.admit('Synthetic mixed interpretation.', [rawReceipt(a, 'session-A'), support]);
  f.remove(a);
  memory = ok(f.core.get({ namespace: rawNs, memoryId: memory.id })).memory;
  const card = f.card(memory), bound = f.db.prepare('SELECT receipt_id FROM card_memory_bindings WHERE card_id=?').get(card.id).receipt_id;
  if (b) memory = f.admit(memory.content, [receipt('later-support')]);
  f.db.prepare('DELETE FROM receipts WHERE id=?').run(bound);
  if (!b) ok(f.core.supersede({ namespace: rawNs, memoryId: memory.id, expectedRevision: memory.revision,
    replacement: { content: 'Synthetic replacement interpretation.', kind: 'context' }, receipts: [receipt('replacement')] }));
  if (b) assert.ok(f.db.prepare('SELECT 1 FROM raw_conversations WHERE id=?').get(b.conversationId));
  assert.equal(classify(f, card.id).status, 'unknown');
});

test('R2.4 placement action ids are organization identities, never target Card bodies', t => {
  const f = fixture(t), a = f.draft(ns, undefined, true), c = f.draft(ns, undefined, true);
  const ref = { type: 'card', namespace: ns, cardId: a.id, revision: a.revision, bodyRevision: a.bodyRevision };
  const index = ok(f.call('mapEvidence', { namespace: ns, type: 'card' })).indexRevision;
  ok(f.call('applyCardPlacement', { namespace: ns, actionId: c.id, refs: [ref], expectedIndexRevision: index,
    proposal: { items: [{ cardId: a.id, parentIds: [], newL1: { title: 'Synthetic topic', parentL2Ids: [], newL2Title: 'Synthetic root' } }] } }));
  ok(f.call('deleteKnowledgeCard', { namespace: ns, cardId: a.id, expectedRevision: a.revision, actionId: 'delete-A' }));
  assert.equal(classify(f, c.id).status, 'unknown');
});

test('R2.5 independent session identities are hashed once, exactly like assertSession', async t => {
  const f = rawFixture(t), roots = createRawSourceRoots(f.db), session = 'independent-session';
  const memory = f.admit('Synthetic independent interpretation.', [{ ...receipt('independent-event'), client: 'codex', sessionId: session }]);
  const card = f.card(memory), alias = roots.hashSession(rawNs, 'codex', session);
  const unrelated = await savedSource(f, 'Synthetic unrelated source.', { sessionId: alias });
  f.remove(unrelated);
  assert.doesNotThrow(() => roots.assertSession(rawNs, 'codex', session));
  assert.equal(classify(f, card.id).status, 'unknown');
});

test('R2.6 file checker refuses in-process import and has only isolated child graph edges', () => {
  const entry = new URL('../content-safety-files-child.mjs', import.meta.url);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(entry.href)})`], { encoding: 'utf8', input: '{}', env: {} });
  assert.equal(child.status, 1); assert.match(child.stderr, /child_entry_required/); assert.equal(child.stdout, '');
  const root = fileURLToPath(new URL('../../', import.meta.url)), path = 'core/content-safety-files-child.mjs';
  const graph = installedImportClosure(root, ['adapters/mcp/cli.mjs']);
  assert.ok(graph.childEntries.includes(path)); assert.ok(!graph.eager.includes(path));
  const source = readFileSync(entry, 'utf8');
  assert.deepEqual([...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => match[1]).sort(), ['node:crypto', 'node:fs', 'node:url']);
  assert.equal(/import\s*\(/.test(source), false);
});
