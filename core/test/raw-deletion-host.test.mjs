import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { fixture, ns, request, splitRaw, localPlainPort, ok, usage, count } from '../testing/raw-capture-fixtures.mjs';

const extract = () => ({ items: [{ content: 'Synthetic authored support.', kind: 'fact', confidence: .8, sourceIndices: [0] }] });
const error = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code); };
async function source(f, client, sessionId = 'A') {
  const value = ok(await f.core.captureRaw(request(splitRaw('Synthetic retained source.')[0], { client, sessionId, eventId: sessionId })));
  return { id: value.raw.conversationId, memoryId: ok(value.interpretation).admission.memories[0]?.id };
}
const key = async (f, id, actionId = 'delete') => ({ namespace: ns, conversationId: id, actionId,
  expectedRevision: ok(await f.core.getConversation({ namespace: ns, conversationId: id })).conversation.revision });
function host() {
  const tokens = new WeakMap(), grants = new WeakMap();
  return { options: { version: 'private-cards-local-v1', source: 'submitted-note-v1', storage: 'local-plain-v1',
    disclosure: 'explicit-submitted-note-v1', authority: {
      authorize(request, token) {
        const expected = tokens.get(token);
        if (!expected || expected.method !== request.method || !isDeepStrictEqual(expected.input, request.input)) return null;
        const grant = {}, { input, ...binding } = request;
        grants.set(grant, { ...binding, accessGeneration: 1 }); return grant;
      },
      isCurrent: grant => grants.get(grant) ?? null,
    } },
    call(core, method, input) { const token = {}; tokens.set(token, { method, input: structuredClone(input) }); return core[method](input, token); } };
}
function child(f) {
  const processChild = spawn(process.execPath, [new URL('../testing/raw-deletion-child.mjs', import.meta.url).pathname, f.path], {
    env: {}, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '', settled = false;
  processChild.stderr.on('data', bytes => { stderr += bytes; });
  const exited = new Promise((resolve, reject) => {
    processChild.once('error', reject);
    processChild.once('exit', (code, signal) => { settled = true; resolve({ code, signal }); });
  });
  const ready = new Promise((resolve, reject) => {
    processChild.once('message', resolve);
    processChild.once('error', reject);
    processChild.once('exit', () => reject(Error('Child exited before ready: ' + stderr)));
  });
  f.workspace.defer(async () => { if (!settled) processChild.kill('SIGKILL'); await exited; });
  return { ready, async run(input) {
    const response = new Promise(resolve => processChild.once('message', resolve));
    processChild.send(input);
    const result = await response, status = await exited;
    assert.deepEqual(status, { code: 0, signal: null }, stderr); return result;
  } };
}
function snapshot(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}"`).all().map(row => JSON.stringify(row)).sort()]);
}

for (const client of ['claude-code', 'codex']) {
  for (const same of [true, false]) test(`P3b-06 ${client}: real child processes serialize ${same ? 'same' : 'different'} delete actions`, { timeout: 15000 }, async t => {
    const f = fixture(t, { deletion: true, model: { extract } }), original = await source(f, client);
    const input = await key(f, original.id), a = child(f), b = child(f);
    assert.deepEqual(await a.ready, { ready: true }); assert.deepEqual(await b.ready, { ready: true });
    const results = await Promise.all([a.run(input), b.run({ ...input, actionId: same ? input.actionId : 'other-action' })]);
    if (same) assert.deepEqual(ok(results[0]), ok(results[1]));
    else { assert.equal(results.filter(result => result.ok).length, 1); error(results.find(result => !result.ok), 'conversation_not_found'); }
    assert.equal(usage(f.core).savedBytes, 0); assert.equal(usage(f.core).reservedBytes, 0);
    assert.equal(count(f.db, 'raw_deletion_actions'), 1); assert.equal(count(f.db, 'raw_deletion_effects'), 2);
    assert.equal(count(f.db, 'raw_session_fences'), 1);
  });

  test(`P3b-04/05/11 ${client}: receipt-backed draft cancellation retains confirmed body and usage-abort rolls back all tables`, async t => {
    const trusted = host(), f = fixture(t, { deletion: true, model: { extract }, coreOptions: { privateCards: trusted.options } });
    const original = await source(f, client);
    const memory = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic authored support.', kind: 'fact' },
      receipts: [{ client: 'manual', sessionId: 'explicit', eventId: 'independent', role: 'user', excerpt: 'Synthetic independent receipt.' }] })).memory;
    const call = (method, input) => trusted.call(f.core, method, input);
    const draftInput = actionId => ({ namespace: ns, actionId, drafting: 'authored', input: {
      title: 'Synthetic title', body: 'Confirmed independently authored body.', sourcePolicy: 'retained-receipts-v1',
      memoryRefs: [{ type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }] } });
    const draft = ok(call('createCardDraft', draftInput('draft'))), confirmed = ok(call('createCardDraft', draftInput('confirmed')));
    ok(call('confirmCardDraft', { namespace: ns, cardId: confirmed.id, expectedRevision: confirmed.revision, actionId: 'confirm' }));
    const refs = ok(call('getCard', { namespace: ns, cardId: confirmed.id })).card.bindings.map(binding => binding.source);
    const input = await key(f, original.id);
    f.db.exec("CREATE TRIGGER fail_delete_usage AFTER UPDATE ON raw_owner_usage BEGIN SELECT RAISE(ABORT,'synthetic usage abort'); END;");
    const before = snapshot(f.db);
    error(f.core.deleteConversation(input), 'storage_error'); assert.deepEqual(snapshot(f.db), before);
    f.db.exec('DROP TRIGGER fail_delete_usage');
    assert.equal(ok(f.core.deleteConversation(input)).retainedMemories, 1);
    assert.equal(ok(f.core.get({ namespace: ns, memoryId: memory.id })).receipts.length, 1);
    assert.equal(ok(call('getCard', { namespace: ns, cardId: draft.id })).card, null);
    assert.equal(ok(call('getCard', { namespace: ns, cardId: confirmed.id })).card, null);
    const retained = f.db.prepare('SELECT body,state FROM private_cards WHERE id=?').get(confirmed.id);
    assert.equal(retained.body, 'Confirmed independently authored body.'); assert.equal(retained.state, 'confirmed');
    assert.deepEqual(f.db.prepare('SELECT source_ref FROM card_memory_bindings WHERE card_id=? ORDER BY position').all(confirmed.id).map(row => JSON.parse(row.source_ref)), refs);
    for (const ref of refs) error(call('getSource', { namespace: ns, source: ref }), 'source_unavailable');
    f.reopen(); assert.equal(ok(call('getCard', { namespace: ns, cardId: confirmed.id })).card, null);
    assert.equal(f.db.prepare('SELECT body FROM private_cards WHERE id=?').get(confirmed.id).body, retained.body);
  });

  test(`P3b-10 ${client}: finite outbox has immutable pagination and exact scoped cursors`, async t => {
    const f = fixture(t, { deletion: true, model: { extract } });
    for (const session of ['A', 'B']) {
      const original = await source(f, client, session); ok(f.core.deleteConversation(await key(f, original.id, session)));
    }
    const first = ok(f.core.listRawEffects({ namespace: ns, limit: 1 })), pageIds = [first.effects[0].effectId];
    assert.equal(first.coverage.status, 'budget_exhausted');
    const initialCount = count(f.db, 'raw_deletion_effects');
    const newer = await source(f, client, 'C'); ok(f.core.deleteConversation(await key(f, newer.id, 'C')));
    f.reopen(); let cursor = first.nextCursor;
    while (cursor) {
      const page = ok(f.core.listRawEffects({ namespace: ns, limit: 1, cursor }));
      assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, value: page })) <= 65536);
      pageIds.push(...page.effects.map(effect => effect.effectId)); cursor = page.nextCursor;
    }
    assert.equal(pageIds.length, initialCount); assert.equal(new Set(pageIds).size, initialCount);
    error(f.core.listRawEffects({ namespace: ns, limit: 2, cursor: first.nextCursor }), 'invalid_cursor');
    error(f.core.listRawEffects({ namespace: { ...ns, ownerId: 'other' }, limit: 1, cursor: first.nextCursor }), 'invalid_cursor');
    const effects = ok(f.core.listRawEffects({ namespace: ns })).effects;
    for (const effect of effects) {
      assert.deepEqual(Object.keys(effect).sort(), ['actionId','effectId','entity','kind','namespace','source']);
      assert.equal(effect.kind, 'withdraw_pending'); assert.deepEqual(effect.namespace, ns);
    }
    assert.equal(JSON.stringify(effects).includes('Synthetic retained source.'), false);
  });

  test(`P3b-08 ${client}: deletion during asynchronous Raw open cannot publish stale text`, async t => {
    const port = localPlainPort(), originalOpen = port.openRaw;
    let armed = false, input, f;
    port.openRaw = async value => {
      if (armed) { armed = false; ok(f.core.deleteConversation(input)); }
      await Promise.resolve(); return originalOpen(value);
    };
    f = fixture(t, { deletion: true, model: { extract }, port });
    const original = await source(f, client);
    input = await key(f, original.id); armed = true;
    error(await f.core.getConversation({ namespace: ns, conversationId: original.id }), 'revision_conflict');
    assert.equal(count(f.db, 'raw_parts'), 0); assert.equal(usage(f.core).savedBytes, 0);
  });
}
