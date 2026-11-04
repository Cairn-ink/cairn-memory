import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { openMemoryStore } from '../index.mjs';
import { snapshot } from '../private-card-input.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const ns = { ownerId: 'synthetic-owner', scope: 'project', projectId: 'one' };
const other = { ...ns, projectId: 'two' };
const foreign = { ...ns, ownerId: 'foreign' };
function ok(value) { assert.equal(value.ok, true, JSON.stringify(value)); return value.value; }
function error(value, code) {
  assert.deepEqual(value, { ok: false, error: { code, retryable: code === 'storage_busy' } });
}
function host() {
  const tokens = new WeakMap(), grants = new WeakMap();
  const state = { generation: 1, enabled: true, hook: null, checks: 0, allowedClass: null, wrongScope: false };
  const authority = {
    authorize(request, token) {
      const expected = tokens.get(token);
      if (state.allowedClass && state.allowedClass !== request.actionClass) return null;
      if (!expected || !state.enabled || request.method !== expected.method ||
          JSON.stringify(snapshot(request.input)) !== JSON.stringify(snapshot(expected.input))) return null;
      if (JSON.stringify(request.namespace) !== JSON.stringify(ns) &&
          JSON.stringify(request.namespace) !== JSON.stringify(other)) return null;
      const grant = {};
      const { input, ...binding } = request;
      grants.set(grant, { ...binding, accessGeneration: state.generation });
      return grant;
    },
    isCurrent(grant) {
      state.checks++;
      state.hook?.(state.checks);
      const value = grants.get(grant);
      if (!state.enabled || !value) return null;
      return { ...value, ...(state.wrongScope ? { namespace: foreign } : {}), accessGeneration: state.generation };
    },
  };
  return { state, options: { version: 'private-cards-local-v1', source: 'submitted-note-v1',
    storage: 'local-plain-v1', disclosure: 'explicit-submitted-note-v1', authority },
  token(method, input) { const token = {}; tokens.set(token, { method, input: structuredClone(input) }); return token; } };
}
function fixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'private-cards-' });
  const path = join(workspace.path, 'memory.sqlite'), trusted = host();
  let core = openMemoryCore({ path, privateCards: trusted.options });
  workspace.defer(() => core.close());
  return { path, trusted, get core() { return core; },
    call(method, input) { return core[method](input, trusted.token(method, input)); },
    reopen(enabled = true) { core.close(); core = openMemoryCore({ path, ...(enabled ? { privateCards: trusted.options } : {}) }); return core; } };
}
const noteCall = (actionId = 'note', namespace = ns, text = '  Exact\n source 😀\t\n') => ({ namespace, actionId, text, occurredAt: null });
const draftCall = (actionId = 'draft', source, namespace = ns, body = 'Authored private body') => ({ namespace,
  actionId, drafting: 'authored', input: { title: 'Private title', body,
    ...(source ? { sources: [source] } : { authoredInput: { text: 'Explicit submitted note', occurredAt: null } }) } });

test('C01/C07 default stays v18, opt-in upgrades only synthetic store, disabled reopen preserves v23', t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'legacy.sqlite');
  let core = openMemoryCore({ path });
  assert.equal(core.createCardDraft, undefined); assert.equal(core.getPrivateCardCapabilities, undefined); core.close();
  let db = new DatabaseSync(path);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18);
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'card_%'").get().n, 0); db.close();
  const trusted = host(); core = openMemoryCore({ path, privateCards: trusted.options }); core.close();
  db = new DatabaseSync(path); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 23); db.close();
  core = openMemoryCore({ path }); assert.equal(core.submitSourceNote, undefined); core.close();
  const legacy = openMemoryStore({ path }); legacy.close();
  assert.throws(() => openMemoryCore({ path, privateCards: { ...trusted.options, storage: 'hosted-aes' } }), { code: 'source_unavailable' });
  db = new DatabaseSync(path); db.exec('PRAGMA user_version=19'); db.close();
  assert.throws(() => openMemoryCore({ path }), { code: 'unsupported_database' });
});

test('C02 exact source formatting and opaque identity survive reopen, zero model calls', t => {
  const f = fixture(t), original = noteCall(), note = ok(f.call('submitSourceNote', original)).source;
  const draft = ok(f.call('createCardDraft', draftCall('draft', note)));
  assert.equal(draft.state, 'draft');
  let source = ok(f.call('getSource', { namespace: ns, source: note }));
  assert.equal(source.parts.map(part => part.text).join(''), original.text);
  assert.equal(source.parts[0].end, original.text.length);
  assert.equal(source.coverage.completeness, 'provided-note'); assert.equal(source.coverage.conversationCoverage, 'unknown');
  assert.equal(note.contentIdentity.length, 43);
  f.reopen();
  assert.deepEqual(ok(f.call('submitSourceNote', original)), { source: note });
  source = ok(f.call('getSource', { namespace: ns, source: note })); assert.equal(source.parts[0].text, original.text);
  const detail = ok(f.call('getCard', { namespace: ns, cardId: draft.id })).card;
  assert.equal(detail.support.applicability, 'unknown'); assert.equal(detail.bindings[0].attribution.status, 'unassessed');
  assert.equal(detail.bindings[0].role, 'required');
  assert.deepEqual(ok(f.call('inspectCardOperation', { namespace: ns, operationActionId: 'draft' })).operation.providerOutcome, 'not-started');
});

test('C02 authored input is atomic with draft, unsupported model/Raw paths retain nothing', t => {
  const f = fixture(t), db = new DatabaseSync(f.path); t.after(() => db.close());
  db.exec("CREATE TRIGGER fail_card BEFORE INSERT ON private_cards BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
  error(f.call('createCardDraft', draftCall()), 'storage_error');
  assert.equal(db.prepare('SELECT count(*) n FROM card_notes').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM card_operations').get().n, 0);
  db.exec('DROP TRIGGER fail_card');
  const input = draftCall(); error(f.call('createCardDraft', { ...input, drafting: 'model-assisted' }), 'source_unavailable');
  error(f.call('createCardDraft', { ...input, input: { sources: [{ type: 'raw' }], title: 'x', body: 'x' } }), 'source_unavailable');
  error(f.call('createCardDraft', { ...input, input: { memoryRefs: [], title: 'x', body: 'x' } }), 'invalid_input');
  assert.equal(db.prepare('SELECT count(*) n FROM card_notes').get().n, 0);
  const draft = ok(f.call('createCardDraft', input)); assert.equal(draft.revision, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM card_notes').get().n, 1);
});

test('C03 lifecycle CAS, action conflict, replay after edits/deletion and restart', t => {
  const f = fixture(t), create = draftCall(), draft = ok(f.call('createCardDraft', create));
  const source = ok(f.call('getCard', { namespace: ns, cardId: draft.id })).card.bindings[0].source;
  const edit = { namespace: ns, cardId: draft.id, expectedRevision: 1, actionId: 'edit', title: 'Revised', body: 'Revised body', bindings: [source] };
  assert.equal(ok(f.call('editCardDraft', edit)).revision, 2);
  error(f.call('confirmCardDraft', { namespace: ns, cardId: draft.id, expectedRevision: 1, actionId: 'stale' }), 'revision_conflict');
  const confirm = { namespace: ns, cardId: draft.id, expectedRevision: 2, actionId: 'confirm' };
  const confirmed = ok(f.call('confirmCardDraft', confirm)); assert.equal(confirmed.bodyRevision, 1);
  error(f.call('cancelCardDraft', { ...confirm, actionId: 'race' }), 'revision_conflict');
  const updated = ok(f.call('editKnowledgeCard', { ...edit, actionId: 'confirmed-edit', expectedRevision: 3, title: 'Final', applicability: 'unknown' }));
  assert.equal(updated.bodyRevision, 2);
  const deleted = ok(f.call('deleteKnowledgeCard', { ...confirm, expectedRevision: 4, actionId: 'delete' }));
  assert.equal(deleted.revision, 5);
  f.reopen();
  assert.deepEqual(ok(f.call('createCardDraft', create)), draft);
  assert.deepEqual(ok(f.call('confirmCardDraft', confirm)), confirmed);
  assert.equal(ok(f.call('getCard', { namespace: ns, cardId: draft.id })).card, null);
  error(f.call('createCardDraft', { ...create, input: { ...create.input, body: 'changed' } }), 'action_conflict');
  error(f.call('confirmCardDraft', { ...confirm, expectedRevision: 5, actionId: 'resurrect' }), 'card_state_conflict');
  error(f.call('deleteKnowledgeCard', { ...confirm, expectedRevision: 4, actionId: 'stale-delete' }), 'revision_conflict');
});

test('C04 forged, omitted, wrong-payload and revoked host grants cannot leak or retain', t => {
  const f = fixture(t), input = draftCall();
  error(f.core.createCardDraft(input), 'authority_required');
  error(f.core.createCardDraft(input, {}), 'authority_required');
  error(f.core.createCardDraft({ ...input, humanConfirmed: true }, {}), 'invalid_input');
  error(f.core.createCardDraft({ ...input, input: { ...input.input, body: 'forged' } }, f.trusted.token('createCardDraft', input)), 'authority_required');
  error(f.call('createCardDraft', draftCall('foreign', undefined, foreign)), 'authority_required');
  f.trusted.state.hook = count => { if (count === 2) f.trusted.state.generation++; };
  error(f.call('createCardDraft', input), 'scope_changed');
  f.trusted.state.hook = null;
  assert.equal(ok(f.call('getPrivateCardUsage', { namespace: ns })).submittedNoteBytes, 0);
  const draft = ok(f.call('createCardDraft', input));
  const detailInput = { namespace: ns, cardId: draft.id };
  error(f.core.getCard(detailInput, f.trusted.token('getCard', { ...detailInput, namespace: other })), 'authority_required');
  assert.equal(ok(f.call('getCard', { ...detailInput, namespace: other })).card, null);
  f.trusted.state.enabled = false;
  error(f.call('getCard', detailInput), 'authority_required');
});

test('C05 source deletion cancels drafts once, retains unsupported confirmed authored body and original refs', t => {
  const f = fixture(t), source = ok(f.call('submitSourceNote', noteCall())).source;
  const draftInput = draftCall('one', source), draft = ok(f.call('createCardDraft', draftInput));
  const confirmed = ok(f.call('createCardDraft', draftCall('two', source)));
  ok(f.call('confirmCardDraft', { namespace: ns, cardId: confirmed.id, expectedRevision: 1, actionId: 'confirm' }));
  const deletion = { namespace: ns, sourceId: source.sourceId, expectedRevision: 1, actionId: 'delete-note' };
  assert.equal(ok(f.call('deleteSourceNote', deletion)).effectCount, 3);
  f.reopen();
  assert.equal(ok(f.call('getCard', { namespace: ns, cardId: draft.id })).card, null);
  assert.equal(ok(f.call('getCard', { namespace: ns, cardId: confirmed.id })).card, null);
  const db = new DatabaseSync(f.path); t.after(() => db.close());
  const card = db.prepare('SELECT body,revision FROM private_cards WHERE id=?').get(confirmed.id);
  assert.equal(card.body, 'Authored private body'); assert.equal(card.revision, 3);
  assert.deepEqual(JSON.parse(db.prepare('SELECT source_ref FROM card_bindings WHERE card_id=?').get(confirmed.id).source_ref), source);
  error(f.call('getSource', { namespace: ns, source }), 'source_unavailable');
  assert.equal(ok(f.call('deleteSourceNote', deletion)).effectCount, 3);
  assert.deepEqual(ok(f.call('createCardDraft', draftInput)), draft);
  error(f.call('createCardDraft', draftCall('new-id', source)), 'source_unavailable');
  error(f.call('confirmCardDraft', { namespace: ns, cardId: draft.id, expectedRevision: 1, actionId: 'old-r' }), 'revision_conflict');
  error(f.call('confirmCardDraft', { namespace: ns, cardId: draft.id, expectedRevision: 2, actionId: 'current-r' }), 'card_state_conflict');
  assert.equal(ok(f.call('getPrivateCardUsage', { namespace: other })).submittedNoteBytes, 0);
});

test('C06 UTF16 boundaries, exact redaction, source pages, response ceiling and stale cursors', t => {
  const f = fixture(t), text = 'x'.repeat(3999) + '😀' + '\napi_key=synthetic-secret-123\n' + 'x'.repeat(4500);
  const source = ok(f.call('submitSourceNote', noteCall('large', ns, text))).source;
  let page = ok(f.call('getSource', { namespace: ns, source, limit: 1 }));
  assert.equal(page.parts[0].end, 3999); assert.equal(page.parts[0].text.length, 3999);
  const next = ok(f.call('getSource', { namespace: ns, source, limit: 1, cursor: page.nextCursor }));
  assert.equal(next.parts[0].start, 3999); assert.ok(next.parts[0].text.startsWith('😀'));
  assert.ok(next.parts[0].text.includes('[REDACTED]')); assert.ok(!JSON.stringify(next).includes('synthetic-secret-123'));
  for (const bad of ['\ud800', 'a\0b', 'x'.repeat(20001)]) error(f.call('submitSourceNote', noteCall('bad', ns, bad)), 'invalid_input');
  const draft = ok(f.call('createCardDraft', draftCall('draft', source)));
  error(f.call('getCard', { namespace: ns, cardId: draft.id, responseByteLimit: 10 }), 'context_item_too_large');
  error(f.call('getSource', { namespace: ns, source, limit: 1, cursor: page.nextCursor }), 'cursor_stale');
  ok(f.call('createCardDraft', draftCall('another', source)));
  page = ok(f.call('listCards', { namespace: ns, states: ['draft'], limit: 1 }));
  assert.ok(page.nextCursor); assert.ok(!JSON.stringify(page).includes('Authored private body'));
  assert.ok(!Object.hasOwn(page.cards[0], 'title')); assert.ok(!Object.hasOwn(page.cards[0], 'body'));
  const read = { namespace: ns, states: ['draft'], limit: 1, cursor: page.nextCursor };
  error(f.call('listCards', { ...read, limit: 2 }), 'invalid_cursor');
  ok(f.call('cancelCardDraft', { namespace: ns, cardId: draft.id, expectedRevision: 1, actionId: 'cancel' }));
  error(f.call('listCards', read), 'cursor_stale');
});

test('C06 same-owner cap is explicit across namespaces, quota rejection is atomic', t => {
  const f = fixture(t), db = new DatabaseSync(f.path); t.after(() => db.close());
  db.prepare('INSERT INTO card_note_usage VALUES(?,?)').run(ns.ownerId, 199_999_995);
  error(f.call('createCardDraft', draftCall()), 'quota_reached');
  assert.equal(db.prepare('SELECT count(*) n FROM card_notes').get().n, 0);
  const source = ok(f.call('submitSourceNote', noteCall('five', other, '12345'))).source;
  assert.equal(ok(f.call('getPrivateCardUsage', { namespace: ns })).submittedNoteBytes, 200_000_000);
  error(f.call('submitSourceNote', noteCall('one-more', ns, 'x')), 'quota_reached');
  ok(f.call('deleteSourceNote', { namespace: other, actionId: 'free', sourceId: source.sourceId, expectedRevision: 1 }));
  assert.equal(ok(f.call('getPrivateCardUsage', { namespace: ns })).submittedNoteBytes, 199_999_995);
});

test('C08 cancellation and deletion purge logical bodies/bindings; operations and effects contain no text', t => {
  const f = fixture(t), input = draftCall(), draft = ok(f.call('createCardDraft', input));
  ok(f.call('cancelCardDraft', { namespace: ns, cardId: draft.id, expectedRevision: 1, actionId: 'cancel' }));
  const db = new DatabaseSync(f.path); t.after(() => db.close());
  const row = db.prepare('SELECT * FROM private_cards WHERE id=?').get(draft.id);
  assert.equal(row.body, null); assert.equal(row.title, null); assert.equal(row.revision, 2);
  assert.equal(db.prepare('SELECT count(*) n FROM card_bindings').get().n, 0);
  const ledger = JSON.stringify(db.prepare('SELECT * FROM card_operations').all());
  assert.ok(!ledger.includes(input.input.body)); assert.ok(!ledger.includes(input.input.authoredInput.text));
  const effects = ok(f.call('listCardEffects', { namespace: ns, limit: 1 }));
  assert.equal(effects.effects.length, 1); assert.equal(effects.effects[0].entity.id, draft.id);
  assert.ok(!JSON.stringify(effects).includes('Private title'));
  f.reopen(); assert.deepEqual(ok(f.call('createCardDraft', input)), draft);
  assert.deepEqual(ok(f.call('listCardEffects', { namespace: ns, limit: 1 })), effects);
});

test('C09 capabilities advertise exact authored local subset and bounded common reads', t => {
  const f = fixture(t), capabilities = ok(f.core.getPrivateCardCapabilities());
  assert.equal(capabilities.version, 'private-cards-local-v1'); assert.equal(capabilities.raw, false);
  assert.equal(capabilities.currentEvidence, true); assert.equal(capabilities.modelAssisted, false);
  assert.equal(capabilities.evidenceReads.typedCardMoc, true);
  for (const name of ['cancelCardOperation', 'resolveSourceReferences']) assert.equal(f.core[name], undefined);
  for (const name of ['selectEvidence', 'fetchEvidence', 'revalidateEvidence']) assert.equal(typeof f.core[name], 'function');
  const usage = ok(f.call('getPrivateCardUsage', { namespace: ns }));
  assert.equal(usage.version, 'submitted-note-usage-v1'); assert.equal(usage.raw, 'not-implemented');
});

test('C04 strict snapshots reject accessors without executing caller code', t => {
  const f = fixture(t), input = draftCall(); let calls = 0;
  Object.defineProperty(input, 'actionId', { enumerable: true, get() { calls++; return 'bad'; } });
  error(f.core.createCardDraft(input, {}), 'invalid_input'); assert.equal(calls, 0);
});

test('C04 authoredInput needs explicit-user source retention authority, never draft-only authority', t => {
  const f = fixture(t), input = draftCall();
  f.trusted.state.allowedClass = 'draft';
  error(f.call('createCardDraft', input), 'authority_required');
  f.trusted.state.allowedClass = null;
  assert.equal(ok(f.call('getPrivateCardUsage', { namespace: ns })).submittedNoteBytes, 0);
  assert.equal(ok(f.call('listCards', { namespace: ns, states: ['draft'] })).cards.length, 0);
  f.trusted.state.allowedClass = 'explicit-user';
  assert.equal(ok(f.call('createCardDraft', input)).revision, 1);
});

test('C06 required source aggregate, 16-ref maximum and 128 live-dependent cap are atomic', t => {
  const f = fixture(t), source = ok(f.call('submitSourceNote', noteCall('shared'))).source;
  const creates = [];
  for (let i = 0; i < 128; i++) creates.push(ok(f.call('createCardDraft', draftCall(`fanout-${i}`, source))));
  error(f.call('createCardDraft', draftCall('over-fanout', source)), 'dependency_limit_reached');
  assert.equal(ok(f.call('inspectCardOperation', { namespace: ns, operationActionId: 'over-fanout' })).operation, null);
  const deletion = { namespace: ns, sourceId: source.sourceId, expectedRevision: 1, actionId: 'delete-shared' };
  assert.equal(ok(f.call('deleteSourceNote', deletion)).effectCount, 129);
  assert.equal(ok(f.call('deleteSourceNote', deletion)).effectCount, 129);
  assert.equal(ok(f.call('listCards', { namespace: ns, states: ['draft'] })).cards.length, 0);
  const a = ok(f.call('submitSourceNote', noteCall('large-a', ns, '界'.repeat(12000)))).source;
  const b = ok(f.call('submitSourceNote', noteCall('large-b', ns, '界'.repeat(12000)))).source;
  const draft = draftCall('aggregate', a); draft.input.sources.push(b);
  error(f.call('createCardDraft', draft), 'invalid_input');
  assert.equal(ok(f.call('inspectCardOperation', { namespace: ns, operationActionId: 'aggregate' })).operation, null);
  draft.input.sources = Array.from({ length: 17 }, () => a);
  error(f.call('createCardDraft', draft), 'invalid_input');
});

test('C07 unimplemented v19 and future schema versions refuse without migration', t => {
  const f = fixture(t), draft = ok(f.call('createCardDraft', draftCall()));
  f.core.close();
  const db = new DatabaseSync(f.path); t.after(() => db.close());
  for (const version of [19, 24, 999]) {
    db.exec(`PRAGMA user_version=${version}`);
    assert.throws(() => openMemoryCore({ path: f.path, privateCards: f.trusted.options }), { code: 'unsupported_database' });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, version);
    assert.equal(db.prepare('SELECT state FROM private_cards WHERE id=?').get(draft.id).state, 'draft');
  }
  db.exec('PRAGMA user_version=23');
});

const childSource = `
import { openMemoryCore } from ${JSON.stringify(new URL('../contract.mjs', import.meta.url).href)};
import { snapshot } from ${JSON.stringify(new URL('../private-card-input.mjs', import.meta.url).href)};
const [path,method,encoded]=process.argv.slice(1), input=JSON.parse(encoded), token={}, grants=new WeakMap();
const authority={authorize(request, supplied){
  if(supplied!==token || request.method!==method || JSON.stringify(snapshot(request.input))!==JSON.stringify(snapshot(input)))return null;
  const grant={};const {input:ignored,...binding}=request;grants.set(grant,{...binding,accessGeneration:1});return grant;
},isCurrent(grant){return grants.get(grant)??null;}};
const core=openMemoryCore({path,privateCards:{version:'private-cards-local-v1',source:'submitted-note-v1',storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',authority}});
process.stdout.write('ready\\n');
await new Promise(resolve=>process.stdin.once('data',resolve));
const result=core[method](input,token);core.close();process.stdout.write(JSON.stringify(result)+'\\n');
process.stdin.destroy();
`;
async function simultaneous(t, path, operations) {
  const children = [];
  async function cleanup() {
    children.forEach(entry => { if (entry.child.exitCode === null) entry.child.kill('SIGKILL'); });
    await Promise.allSettled(children.map(entry => entry.done));
  }
  t.after(cleanup);
  for (const [method, input] of operations) {
    const child = spawn(process.execPath, ['--input-type=module', '-e', childSource, path, method, JSON.stringify(input)],
      { stdio: ['pipe', 'pipe', 'pipe'], env: {} });
    let output = '', errors = '', ready, startupFailed;
    const started = new Promise((resolve, reject) => { ready = resolve; startupFailed = reject; });
    started.catch(() => {});
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('ready\n')) ready(); });
    child.stderr.on('data', chunk => { errors += chunk; });
    const done = new Promise((resolve, reject) => {
      child.on('error', error => { startupFailed(error); reject(error); });
      child.on('close', code => {
        if (code !== 0) {
          const error = new Error(`child exit ${code}: ${errors}`); startupFailed(error); reject(error); return;
        }
        try { resolve(JSON.parse(output.trim().split('\n').at(-1))); }
        catch (error) { startupFailed(error); reject(error); }
      });
    });
    done.catch(() => {});
    children.push({ child, started, done });
  }
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('synthetic_child_timeout')), 10_000); });
  try {
    return await Promise.race([deadline, (async () => {
      await Promise.all(children.map(entry => entry.started));
      children.forEach(entry => entry.child.stdin.end('start'));
      return Promise.all(children.map(entry => entry.done));
    })()]);
  } finally { clearTimeout(timer); await cleanup(); }
}

test('C03/C06 real concurrent SQLite writers share atomic owner quota and one CAS winner', async t => {
  const f = fixture(t), db = new DatabaseSync(f.path); t.after(() => db.close());
  db.prepare('INSERT INTO card_note_usage VALUES(?,?)').run(ns.ownerId, 199_999_995);
  const results = await simultaneous(t, f.path, [
    ['submitSourceNote', noteCall('concurrent-one', ns, '12345')],
    ['submitSourceNote', noteCall('concurrent-two', other, '12345')],
  ]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.find(result => !result.ok).error.code, 'quota_reached');
  const saved = results.find(result => result.ok).value.source;
  ok(f.call('deleteSourceNote', { namespace: saved.namespace, sourceId: saved.sourceId, expectedRevision: 1, actionId: 'reset' }));
  // Restore synthetic accounting to permit the lifecycle half of this fixture.
  db.prepare('UPDATE card_note_usage SET byte_count=0 WHERE owner_id=?').run(ns.ownerId);
  const draft = ok(f.call('createCardDraft', draftCall()));
  const lifecycle = { namespace: ns, cardId: draft.id, expectedRevision: 1 };
  const race = await simultaneous(t, f.path, [
    ['confirmCardDraft', { ...lifecycle, actionId: 'race-confirm' }],
    ['cancelCardDraft', { ...lifecycle, actionId: 'race-cancel' }],
  ]);
  assert.equal(race.filter(result => result.ok).length, 1);
  assert.equal(race.find(result => !result.ok).error.code, 'revision_conflict');
});

test('C04 final canonical source fence catches invalidation inside trusted callback before read/confirm', t => {
  const f = fixture(t), source = ok(f.call('submitSourceNote', noteCall())).source;
  const draft = ok(f.call('createCardDraft', draftCall('draft', source)));
  const finalCheck = f.trusted.state.checks + 2;
  f.trusted.state.hook = count => {
    if (count === finalCheck) {
      ok(f.call('deleteSourceNote', { namespace: ns, sourceId: source.sourceId, expectedRevision: 1, actionId: 'invalidate-at-fence' }));
    }
  };
  error(f.call('confirmCardDraft', { namespace: ns, cardId: draft.id, expectedRevision: 1, actionId: 'late-confirm' }), 'revision_conflict');
  f.trusted.state.hook = null;
  assert.equal(ok(f.call('getCard', { namespace: ns, cardId: draft.id })).card, null);
  assert.equal(ok(f.call('inspectCardOperation', { namespace: ns, operationActionId: 'late-confirm' })).operation, null);
  const nextSource = ok(f.call('submitSourceNote', noteCall('next-source'))).source;
  const finalReadCheck = f.trusted.state.checks + 2;
  f.trusted.state.hook = count => {
    if (count === finalReadCheck) ok(f.call('deleteSourceNote', { namespace: ns, sourceId: nextSource.sourceId,
      expectedRevision: 1, actionId: 'invalidate-at-read' }));
  };
  error(f.call('getSource', { namespace: ns, source: nextSource }), 'source_unavailable');
});

test('C04/C06 strict structural bounds and stale revision tokens refuse before retention', t => {
  const f = fixture(t), input = draftCall();
  error(f.core.createCardDraft({ ...input, unknown: Object.fromEntries(Array.from({ length: 4100 }, (_, i) => [`k${i}`, 0])) }, {}), 'invalid_input');
  error(f.core.createCardDraft({ ...input, unknown: ['x'.repeat(60000), 'y'.repeat(60000)] }, {}), 'invalid_input');
  const draft = ok(f.call('createCardDraft', input));
  const confirm = { namespace: ns, cardId: draft.id, expectedRevision: 1, actionId: 'confirm-token' };
  const token = f.trusted.token('confirmCardDraft', confirm);
  error(f.core.confirmCardDraft({ ...confirm, expectedRevision: 2 }, token), 'authority_required');
  // A host verifier returning the wrong exact scope cannot authorize the input.
  f.trusted.state.wrongScope = true;
  error(f.call('getCard', { namespace: ns, cardId: draft.id }), 'authority_required');
  f.trusted.state.wrongScope = false;
  assert.equal(ok(f.call('getPrivateCardUsage', { namespace: ns })).submittedNoteBytes, Buffer.byteLength(input.input.authoredInput.text));
});
