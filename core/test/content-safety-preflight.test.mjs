import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { preflightContentSafetyV1 } from '../content-safety-preflight.mjs';
import { contentSafetyObservations } from '../content-safety-observations.mjs';
import { classifyCardBodySafetyV1 } from '../content-safety-classifier.mjs';
import { readTransaction } from '../database.mjs';
import { sourceFixture, savedSource, anchor, resolve, draft, ns as rawNs } from '../testing/raw-source-fixtures.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { fixture, ns, ok, receipt, refusal, independentFiles } from './content-safety-preflight-fixture.mjs';

function observations(f) {
  return readTransaction(f.db, () => contentSafetyObservations(f.db, { scanRows: 250000, scanBytes: 128 * 1024 * 1024 }, () => {}));
}
function classify(f, id) {
  const value = observations(f).observations.find(row => row.body.identity.key === id);
  assert.ok(value); return classifyCardBodySafetyV1(value);
}
for (const version of [23, 33]) {
  test(`physical ${version}: drafts, authoredInput, tombstones and owner union reconcile`, async t => {
    const f = fixture(t, version), other = { ...ns, ownerId: 'synthetic-other-owner' };
    f.draft(); f.draft(other);
    const first = f.admit(), live = f.admit();
    const card = f.draft(ns, [first, live], true), erasedDraft = f.draft(ns, [first]);
    ok(f.core.forget({ namespace: ns, memoryId: first.id, expectedRevision: first.revision }));
    assert.equal(classify(f, card.id).status, 'known-suppressed');
    assert.ok(!observations(f).observations.some(row => row.body.identity.key === erasedDraft.id));
    const deleted = f.draft(ns, undefined, true);
    ok(f.call('deleteKnowledgeCard', { namespace: ns, cardId: deleted.id, expectedRevision: deleted.revision, actionId: 'delete' }));
    f.close(); const before = independentFiles(f.path);
    const result = await preflightContentSafetyV1({ path: f.path });
    assert.deepEqual(result, { enumerated: 3, complete: 0, unknown: 2, knownSuppressed: 1,
      owners: { complete: 0, unknown: 2, knownSuppressed: 1 }, ownersAffected: 2,
      knownSuppressedScope: 'single-producer-v1', mode: 'first-install', schemaBase: version, unchangedFiles: true });
    assert.equal(result.complete + result.unknown + result.knownSuppressed, result.enumerated);
    assert.deepEqual(independentFiles(f.path), before);
  });
  test(`physical ${version}: superseded intact Memory is unknown; ordinary correction lacks old fingerprint proof`, t => {
    const f = fixture(t, version), memory = f.admit(), card = f.draft(ns, [memory], true);
    ok(f.core.supersede({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
      replacement: { content: 'Synthetic replacement context.', kind: 'context' }, receipts: [receipt('replacement')] }));
    assert.equal(classify(f, card.id).status, 'unknown');
    const second = f.admit(), secondCard = f.draft(ns, [second], true);
    ok(f.core.correct({ namespace: ns, memoryId: second.id, expectedRevision: second.revision,
      content: 'Synthetic corrected content.', kind: 'context', receipt: receipt('correction') }));
    assert.equal(classify(f, secondCard.id).status, 'unknown'); // Frozen requirement/code conflict, not guessed suppression.
  });
  test(`physical ${version}: note deletion is purge; hard deletion without cause is unknown`, t => {
    const f = fixture(t, version), card = f.draft(ns, undefined, true);
    const source = ok(f.call('getCard', { namespace: ns, cardId: card.id })).card.bindings[0].source;
    ok(f.call('deleteSourceNote', { namespace: ns, sourceId: source.sourceId, expectedRevision: source.revision, actionId: 'remove-note' }));
    assert.deepEqual(classify(f, card.id), { status: 'known-suppressed', reasons: ['purge'] });
    const missing = f.draft(ns, undefined, true);
    const note = ok(f.call('getCard', { namespace: ns, cardId: missing.id })).card.bindings[0].source;
    f.db.exec('PRAGMA foreign_keys=OFF'); f.db.prepare('DELETE FROM card_notes WHERE id=?').run(note.sourceId);
    assert.equal(classify(f, missing.id).status, 'unknown');
  });
  test(`physical ${version}: removed bindings retain authenticated Memory and note associations`, t => {
    const f = fixture(t, version), memory = f.admit(), card = f.draft(ns, [memory], true);
    ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    f.db.prepare('DELETE FROM card_memory_bindings WHERE card_id=?').run(card.id);
    assert.equal(classify(f, card.id).status, 'known-suppressed');
    const noteCard = f.draft(ns, undefined, true);
    const source = ok(f.call('getCard', { namespace: ns, cardId: noteCard.id })).card.bindings[0].source;
    ok(f.call('deleteSourceNote', { namespace: ns, sourceId: source.sourceId, expectedRevision: source.revision, actionId: 'purge-note' }));
    f.db.prepare('DELETE FROM card_bindings WHERE card_id=?').run(noteCard.id);
    assert.ok(classify(f, noteCard.id).reasons.includes('purge'));
  });
}

test('physical 18: populated Memory-only store succeeds with zero bodies', async t => {
  const f = fixture(t, 18), memory = f.admit();
  ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  f.close(); const before = independentFiles(f.path);
  assert.deepEqual(await preflightContentSafetyV1({ path: f.path }), { enumerated: 0, complete: 0, unknown: 0, knownSuppressed: 0,
    owners: { complete: 0, unknown: 0, knownSuppressed: 0 }, ownersAffected: 0, knownSuppressedScope: 'single-producer-v1', mode: 'first-install', schemaBase: 18, unchangedFiles: true });
  assert.deepEqual(independentFiles(f.path), before);
});

for (const mode of ['DELETE', 'WAL']) test(`zero writes in checkpointed ${mode} mode; one read-only snapshot`, async t => {
  const f = fixture(t); f.draft(); f.close();
  const writer = new DatabaseSync(f.path); writer.exec(`PRAGMA journal_mode=${mode}`); writer.close();
  const before = independentFiles(f.path), exec = DatabaseSync.prototype.exec, seen = [];
  DatabaseSync.prototype.exec = function(sql) {
    seen.push(sql);
    assert.ok(!/CREATE|INSERT|UPDATE|DELETE|checkpoint|journal_mode/i.test(sql), sql);
    return exec.call(this, sql);
  };
  let result;
  try { result = await preflightContentSafetyV1({ path: f.path }); } finally { DatabaseSync.prototype.exec = exec; }
  assert.equal(result.enumerated, 1); assert.equal(result.unchangedFiles, true);
  assert.equal(seen.filter(sql => sql === 'BEGIN').length, 1);
  assert.equal(seen.filter(sql => sql === 'COMMIT').length, 1);
  assert.ok(seen.includes('PRAGMA query_only=ON'));
  assert.deepEqual(independentFiles(f.path), before);
});

for (const variant of ['unknown-version', 'future-34', 'content_suppressions', 'card_body_provenance', 'missing-evidence']) {
  test(`unsupported/partial provider refuses: ${variant}`, async t => {
    const f = fixture(t); f.draft();
    if (variant === 'unknown-version') f.db.exec('PRAGMA user_version=99');
    else if (variant === 'future-34') f.db.exec('PRAGMA user_version=34');
    else if (variant === 'missing-evidence') f.db.exec('DROP TABLE card_effects');
    else f.db.exec(`CREATE TABLE ${variant}(id TEXT)`);
    f.close(); const before = independentFiles(f.path);
    assert.deepEqual(await preflightContentSafetyV1({ path: f.path }), refusal);
    assert.deepEqual(independentFiles(f.path), before);
  });
}
for (const budget of [{ scanRows: 1 }, { scanBytes: 1 }, { deadlineMs: 1 }, { fileBytes: 1 }]) {
  test(`budget exhaustion refuses without partial data: ${Object.keys(budget)[0]}`, async t => {
    const f = fixture(t); f.draft(); f.close();
    const before = independentFiles(f.path);
    assert.deepEqual(await preflightContentSafetyV1({ path: f.path, budget }), refusal);
    assert.deepEqual(independentFiles(f.path), before);
  });
}

test('retained canonical old fingerprint plus missing receipt proves correction suppression', async t => {
  let content = 'Synthetic earlier active context.';
  const model = { ...rationaleModel(), extract: () => ({ items: [{ content, kind: 'context', confidence: 0.8, sourceIndices: [0] }] }) };
  const f = fixture(t, 23, { model, decisionReview: 'required-v1' });
  const capture = sequence => ({ namespace: ns, client: 'scripted', sessionId: 's', eventId: 'event-' + sequence,
    messages: [{ id: 'event-' + sequence, role: 'user', content }], causal: { streamId: 'stream', sequence } });
  const first = ok(await f.core.capture(capture(1))).admission.memories[0];
  const card = f.draft(ns, [first], true);
  content = 'Synthetic replacement decision.';
  model.extract = () => ({ items: [{ content, kind: 'decision', confidence: 0.8, sourceIndices: [0] }] });
  model.reconcile = () => ({ transitions: [{ replacementIndex: 0, predecessorIndex: 0, evidenceIndices: [0], relation: 'supersedes', valueChange: 'changed', adoption: 'explicit' }] });
  ok(await f.core.capture(capture(2)));
  assert.equal(f.db.prepare('SELECT count(*) n FROM confirmation_supersessions').get().n, 1);
  ok(f.core.correct({ namespace: ns, memoryId: first.id, expectedRevision: first.revision,
    content: 'Synthetic in-place correction.', kind: 'context', receipt: receipt('corrected') }));
  assert.deepEqual(classify(f, card.id), { status: 'known-suppressed', reasons: ['correction_supersession'] });
});

for (const deletion of [false, true]) test(`physical 33: canonical Raw ${deletion ? 'deletion' : 'exclusion'} suppresses retained body`, async t => {
  const f = sourceFixture(t), migrated = (await import('../database.mjs')).openDatabase(f.path, { currentDependencies: true }); migrated.close();
  const source = await savedSource(f), refs = await resolve(f, [anchor(source)]), card = ok(draft(f, refs));
  ok(f.call('confirmCardDraft', { namespace: rawNs, cardId: card.id, expectedRevision: card.revision, actionId: 'confirm' }));
  if (deletion) {
    const revision = f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(source.conversationId).revision;
    ok(f.core.deleteConversation({ namespace: rawNs, conversationId: source.conversationId, expectedRevision: revision, actionId: 'delete-conversation' }));
  } else {
    const memory = ok(f.core.admit({ namespace: rawNs, memory: { content: 'Synthetic Raw interpretation.', kind: 'context' },
      receipts: [{ client: 'codex', sessionId: 'synthetic-session', eventId: source.messageId, role: 'user', excerpt: source.text }] })).memory;
    ok(f.core.correct({ namespace: rawNs, memoryId: memory.id, expectedRevision: memory.revision,
      content: 'Synthetic revised Raw interpretation.', kind: 'context', receipt: receipt('independent') }));
    assert.ok(f.db.prepare('SELECT count(*) n FROM raw_source_exclusions').get().n > 0);
  }
  assert.ok(classify(f, card.id).reasons.includes('purge'));
  const result = await preflightContentSafetyV1({ path: f.path });
  assert.equal(result.knownSuppressed, 1);
});

test('uncheckpointed WAL refuses without attempting recovery or changing its file family', async t => {
  const f = fixture(t); f.draft();
  f.db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
  f.draft();
  const before = independentFiles(f.path);
  assert.equal(before[1].present, true); assert.ok(Number(before[1].size) > 0);
  assert.deepEqual(await preflightContentSafetyV1({ path: f.path }), refusal);
  assert.deepEqual(independentFiles(f.path), before);
});

test('malformed stored UTF-8 refuses instead of hashing replacement characters', async t => {
  const f = fixture(t); f.draft();
  f.db.exec("UPDATE private_cards SET body=CAST(x'FF' AS TEXT)"); f.close();
  const before = independentFiles(f.path);
  assert.deepEqual(await preflightContentSafetyV1({ path: f.path }), refusal);
  assert.deepEqual(independentFiles(f.path), before);
});

for (const mutation of ['content', 'identity', 'presence']) test(`file-family ${mutation} change refuses the completed counts`, async t => {
  const f = fixture(t); f.draft(); f.close();
  const original = DatabaseSync.prototype.close; let changed = false;
  DatabaseSync.prototype.close = function() {
    const result = original.call(this);
    if (!changed) {
      changed = true;
      const source = `import {readFileSync,writeFileSync,renameSync} from 'node:fs';
        const [path,mutation]=process.argv.slice(1);
        if(mutation==='presence')writeFileSync(path+'-shm','synthetic');
        else if(mutation==='identity'){const bytes=readFileSync(path);renameSync(path,path+'.previous');writeFileSync(path,bytes);}
        else {const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(path);db.exec('PRAGMA user_version=99');db.close();}`;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', source, f.path, mutation],
        { encoding: 'utf8', env: { NODE_NO_WARNINGS: '1' }, timeout: 10000 });
      assert.equal(child.status, 0, child.stderr);
    }
    return result;
  };
  let result;
  try { result = await preflightContentSafetyV1({ path: f.path }); } finally { DatabaseSync.prototype.close = original; }
  assert.equal(changed, true); assert.deepEqual(result, refusal);
});
