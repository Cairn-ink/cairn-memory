import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createQualificationStorage } from '../claim-qualification-storage.mjs';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore, openMemoryStore } from '../index.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { setup as episodeSetup, input as episodeInput, interpretation } from '../testing/episode-capture-helpers.mjs';
import { ns as episodeNs } from '../testing/episode-helpers.mjs';

const ns = { ownerId: 'confirmation-test', scope: 'personal', projectId: null };
const content = 'I chose A for the synthetic project.';
const receipt = (eventId = 'confirmed') => ({ client: 'person', sessionId: 'review', eventId, role: 'user', excerpt: 'I confirm this decision.' });
const item = (patch = {}) => ({ content, kind: 'decision', confidence: 0.8, sourceIndices: [0], ...patch });
const ok = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const error = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.error.code, code); };
const captureInput = (eventId = 'one') => ({ namespace: ns, client: 'scripted', sessionId: 's', eventId,
  messages: [{ id: eventId, role: 'user', content }] });
function fixture(t, config = {}) {
  const ws = createTestWorkspace(t, { prefix: 'cf1-' });
  const path = join(ws.path, 'memory.sqlite');
  const calls = [];
  const model = { ...rationaleModel((method, request) => calls.push({ method, request })), extract: () => ({ items: [item()] }) };
  const core = openMemoryCore({ path, model, decisionReview: 'required-v1', ...config });
  ws.defer(() => core.close());
  const db = new DatabaseSync(path); ws.defer(() => db.close());
  return { core, db, model, calls, path, ws };
}
const queue = core => ok(core.list({ namespace: ns, reviewState: 'awaiting' })).memories;
const action = (memory, actionId = 'resolve') => ({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision, actionId });
const get = (core, id, review = false) => core.get({ namespace: ns, memoryId: id, ...(review ? { includeAwaiting: true } : {}) });
const range = () => { const now = new Date(); return { namespace: ns, since: new Date(+now - 86400000).toISOString(), until: new Date(+now + 86400000).toISOString() }; };

async function assertHidden(core, memory) {
  assert.deepEqual(ok(core.list({ namespace: ns })).memories, []);
  error(get(core, memory.id), 'memory_not_found');
  for (const timeBasis of ['receipt', 'revision']) assert.deepEqual(ok(core.listMemoriesByTime({ ...range(), timeBasis })).items, []);
  assert.deepEqual(ok(core.sessionStartContext({ namespace: ns })).groups.procedural.items, []);
  for (const purpose of ['recall', 'classification']) assert.deepEqual(ok(core.map({ namespace: ns, purpose })).items, []);
  for (const contextMode of [undefined, 'source-evidence', 'rationale-evidence']) {
    const options = contextMode ? { contextMode } : {};
    const fetched = ok(core.fetch({ namespace: ns, refs: [{ memoryId: memory.id, revision: memory.revision }], ...options }));
    assert.equal(JSON.stringify(fetched).includes(content), false);
    assert.equal(fetched.invalidRefs.length, 1);
    const recalled = ok(await core.recall({ readSet: [ns], query: 'I chose A', ...options }));
    assert.equal(JSON.stringify(recalled).includes(content), false);
  }
  error(core.getRationale({ namespace: ns, memoryId: memory.id, revision: memory.revision }), 'memory_not_found');
  for (const method of ['reviewRationale', 'reviewDecisionBasis']) error(await core[method]({ namespace: ns,
    refs: [{ memoryId: memory.id, revision: memory.revision }] }), 'memory_not_found');
  const snapshot = ok(core.sourceSnapshot({ readSet: [ns] }));
  assert.deepEqual(snapshot.memories, []);
  const mapped = ok(core.map({ namespace: ns }));
  error(await core.classifyPlacement({ namespace: ns, memoryIds: [memory.id],
    expectedMemoryRevisions: [{ memoryId: memory.id, revision: memory.revision }], mapRevision: mapped.indexRevision }), 'memory_not_found');
  error(core.applyPlacement({ namespace: ns, proposal: { items: [{ memoryId: memory.id, parentIds: [] }] },
    expectedMemoryRevisions: [{ memoryId: memory.id, revision: memory.revision }], expectedIndexRevision: mapped.indexRevision }), 'memory_not_found');
}

test('CF1 admission limitation and all ordinary readers, including option-off and legacy openers', async t => {
  const f = fixture(t);
  const captured = ok(await f.core.capture(captureInput()));
  const memory = queue(f.core)[0];
  assert.equal(memory.reviewState, 'awaiting'); assert.equal(memory.state, 'active'); assert.equal(memory.filing.status, 'unfiled');
  assert.equal(memory.origin, 'agent-inferred');
  assert.equal(captured.classification.status, 'skipped');
  assert.equal(ok(get(f.core, memory.id, true)).receipts[0].role, 'user'); // Direct text still lacks provenance classification.
  await assertHidden(f.core, memory);
  const inspection = ok(f.core.inspectAdmission({ namespace: ns, client: 'scripted', eventId: 'one', includeInitialClassification: true }));
  assert.deepEqual(inspection.members, [{ status: 'closed' }]);
  assert.equal(f.db.prepare('SELECT count(*) n FROM index_read_memories').get().n, 0);
  const off = openMemoryCore({ path: f.path, model: f.model }); f.ws.defer(() => off.close());
  await assertHidden(off, memory);
  error(off.list({ namespace: ns, reviewState: 'awaiting' }), 'invalid_input');
  error(get(off, memory.id, true), 'invalid_input');
  error(off.confirm({ ...action(memory), receipt: receipt() }), 'decision_review_required');
  const legacy = openMemoryStore({ path: f.path }); f.ws.defer(() => legacy.close());
  const scope = legacy.scope({ ownerId: ns.ownerId });
  assert.equal(scope.get(memory.id), null); assert.deepEqual(scope.list(), []); assert.deepEqual(scope.search('chose'), []);
});

test('CF1 confirm keeps origin and evidence, publishes atomically, survives restart and later forgetting', async t => {
  const f = fixture(t); ok(await f.core.capture(captureInput())); const memory = queue(f.core)[0];
  const epoch = ok(f.core.map({ namespace: ns })).indexRevision;
  ok(f.core.rebuildIndex({ namespace: ns, expectedIndexRevision: epoch, limit: 500 }));
  assert.equal(f.db.prepare('SELECT count(*) n FROM index_memories').get().n, 0);
  const input = { ...action(memory), receipt: receipt() };
  error(f.core.confirm({ ...input, expectedRevision: memory.revision + 1 }), 'revision_conflict');
  error(f.core.confirm({ ...input, receipt: { ...receipt(), role: 'assistant' } }), 'invalid_input');
  const result = f.core.confirm(input); ok(result);
  const detail = ok(get(f.core, memory.id));
  assert.equal(detail.memory.origin, 'agent-inferred'); assert.equal(detail.memory.reviewState, 'confirmed');
  assert.equal(detail.memory.state, 'active'); assert.equal(detail.receipts.length, 2);
  assert.ok(detail.receipts.some(r => r.eventId === 'confirmed' && r.id === result.value.confirmationReceiptId));
  assert.equal(detail.memory.revision, memory.revision + 1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM index_memories').get().n, 1);
  assert.equal(ok(await f.core.recall({ readSet: [ns], query: 'I chose A' })).memories.length, 1);
  assert.deepEqual(f.core.confirm(input), result);
  error(f.core.reject(action(memory)), 'action_conflict');
  error(f.core.confirm({ ...input, receipt: receipt('changed') }), 'action_conflict');
  const reopened = openMemoryCore({ path: f.path, decisionReview: 'required-v1' }); f.ws.defer(() => reopened.close());
  assert.deepEqual(reopened.confirm(input), result);
  ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: detail.memory.revision }));
  assert.deepEqual(reopened.confirm(input), result);
  assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM confirmation_actions').all()).includes('I confirm'), false);
});

test('CF1 reject is revision checked, suppressed, content-free and replay safe', async t => {
  const f = fixture(t); ok(await f.core.capture(captureInput())); const memory = queue(f.core)[0];
  error(f.core.reject({ ...action(memory), expectedRevision: memory.revision + 1 }), 'revision_conflict');
  const result = f.core.reject(action(memory)); assert.equal(ok(result).forgotten, true);
  assert.deepEqual(f.core.reject(action(memory)), result);
  const reopened = openMemoryCore({ path: f.path, decisionReview: 'required-v1' }); f.ws.defer(() => reopened.close());
  assert.deepEqual(reopened.reject(action(memory)), result);
  error(reopened.reject({ ...action(memory), expectedRevision: memory.revision + 1 }), 'action_conflict');
  assert.equal(f.db.prepare('SELECT content FROM memories').get().content, null);
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts').get().n, 0);
  const recaptured = ok(await f.core.capture(captureInput('two')));
  assert.equal(recaptured.admission.suppressedCount, 1); assert.deepEqual(queue(f.core), []);
});

test('CF1 duplicates, mixed batches, explicit promotion and explicit remember stay explicit', async t => {
  const f = fixture(t); ok(await f.core.capture(captureInput())); const original = queue(f.core)[0];
  ok(await f.core.capture(captureInput('two'))); const duplicate = queue(f.core)[0];
  assert.equal(duplicate.id, original.id); assert.ok(duplicate.revision > original.revision);
  error(f.core.confirm({ ...action(original), receipt: receipt() }), 'revision_conflict');
  f.model.extract = () => ({ items: [item(), item({ content: 'Prefer synthetic fixtures.', kind: 'preference' }), item()] });
  const mixed = ok(await f.core.capture(captureInput('mixed')));
  assert.equal(mixed.admission.memories.length, 2); assert.equal(mixed.classification.status, 'applied');
  assert.equal(ok(f.core.list({ namespace: ns })).memories.length, 1);
  assert.ok(f.calls.filter(c => c.method === 'classify').every(c => c.request.input.memories.every(m => m.id !== original.id)));
  const promoted = ok(f.core.admit({ namespace: ns, memory: { content, kind: 'decision' }, receipts: [receipt('direct')] }));
  assert.equal(promoted.memory.id, original.id); assert.deepEqual(queue(f.core), []);
  const detail = ok(get(f.core, original.id)); assert.equal(detail.memory.origin, 'explicit'); assert.equal(detail.memory.reviewState, 'none');
  f.model.extract = () => ({ items: [item()] }); ok(await f.core.capture(captureInput('again')));
  assert.equal(ok(get(f.core, original.id)).memory.origin, 'explicit');
  const legacy = openMemoryStore({ path: f.path }); f.ws.defer(() => legacy.close());
  const remembered = legacy.scope({ ownerId: ns.ownerId }).remember({ content: 'Direct second choice.', kind: 'decision', origin: 'explicit', confidence: 1, receipt: receipt('remember') });
  assert.equal(remembered.origin, 'explicit'); assert.deepEqual(queue(f.core), []);
});

test('CF1 awaiting mutation restrictions and review cursor visibility binding', async t => {
  const f = fixture(t); ok(await f.core.capture(captureInput())); const memory = queue(f.core)[0];
  const base = { namespace: ns, memoryId: memory.id, expectedRevision: memory.revision };
  error(f.core.correct({ ...base, content: 'Changed', kind: 'decision', receipt: receipt() }), 'memory_not_found');
  error(f.core.supersede({ ...base, replacement: { content: 'Replacement', kind: 'decision' }, receipts: [receipt()] }), 'memory_not_found');
  error(f.core.bindQualifiedClaim({ ...base, slotId: 'slot', singleClaim: true }), 'memory_not_found');
  ok(await f.core.capture(captureInput('more-evidence')));
  const page = ok(f.core.get({ namespace: ns, memoryId: memory.id, includeAwaiting: true, receiptLimit: 1 }));
  assert.ok(page.nextReceiptCursor);
  error(f.core.get({ namespace: ns, memoryId: memory.id, receiptLimit: 1, receiptCursor: page.nextReceiptCursor }), 'invalid_cursor');
  f.model.extract = () => ({ items: [item({ content: 'Second decision.' })] }); ok(await f.core.capture(captureInput('second')));
  const listing = ok(f.core.list({ namespace: ns, reviewState: 'awaiting', limit: 1 })); assert.ok(listing.nextCursor);
  error(f.core.list({ namespace: ns, limit: 1, cursor: listing.nextCursor }), 'invalid_cursor');
  assert.equal(ok(f.core.list({ namespace: ns, reviewState: 'awaiting', limit: 1, cursor: listing.nextCursor })).memories.length, 1);
});

for (const outcome of ['confirm', 'reject', 'forget']) test(`CF1 episode links hide whole context until ${outcome}; conversation forgetting retains suppression`, async t => {
  const f = episodeSetup(t, { extract: () => ({ items: [item()] }), interpretEpisode: request => ({ ...interpretation(request),
    nextStep: { value: 'Continue synthetic work', anchors: [{ sourceIndex: 0, start: 0, end: 4 }] } }) }, { decisionReview: 'required-v1' });
  ok(await f.core.capture(episodeInput()));
  const memory = ok(f.core.list({ namespace: episodeNs, reviewState: 'awaiting' })).memories[0];
  const row = f.db.prepare('SELECT id,revision FROM session_episodes').get();
  const request = { namespace: episodeNs, since: '1901-02-01T00:00:00.000Z', until: '1901-02-10T00:00:00.000Z' };
  assert.equal(f.db.prepare('SELECT count(*) n FROM episode_memory_links').get().n, 1);
  assert.deepEqual(ok(f.core.listEpisodes(request)).items, []);
  error(f.core.getEpisode({ namespace: episodeNs, episodeId: row.id }), 'episode_not_found');
  assert.deepEqual(ok(f.core.sessionStartContext({ namespace: episodeNs })).groups.nextSteps.items, []);
  const off = openMemoryCore({ path: f.path, model: f.model }); f.ws.defer(() => off.close());
  assert.deepEqual(ok(off.listEpisodes(request)).items, []);
  error(off.getEpisode({ namespace: episodeNs, episodeId: row.id }), 'episode_not_found');
  if (outcome === 'forget') {
    ok(f.core.forgetEpisode({ namespace: episodeNs, episodeId: row.id, expectedRevision: row.revision }));
    assert.equal(f.db.prepare('SELECT deleted FROM memories').get().deleted, 1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM suppressed').get().n, 1);
  } else {
    ok(f.core[outcome]({ ...action(memory), namespace: episodeNs, ...(outcome === 'confirm' ? { receipt: receipt() } : {}) }));
    assert.equal(ok(f.core.listEpisodes(request)).items.length, 1);
    ok(f.core.getEpisode({ namespace: episodeNs, episodeId: row.id }));
    assert.equal(ok(off.listEpisodes(request)).items.length, 1);
    if (outcome === 'confirm') assert.equal(ok(f.core.sessionStartContext({ namespace: episodeNs })).groups.nextSteps.items.length, 1);
  }
});

for (const outcome of ['confirm', 'reject']) test(`CF1 ${outcome} failure rolls back all writes; competing openers cannot resolve twice`, async t => {
  const f = fixture(t); ok(await f.core.capture(captureInput())); const memory = queue(f.core)[0];
  const input = { ...action(memory), ...(outcome === 'confirm' ? { receipt: receipt() } : {}) };
  ok(f.core.rebuildIndex({ namespace: ns, expectedIndexRevision: ok(f.core.map({ namespace: ns })).indexRevision, limit: 500 }));
  const before = JSON.stringify(['memories', 'receipts', 'suppressed', 'namespace_epochs', 'confirmation_actions', 'index_memories']
    .map(table => f.db.prepare(`SELECT * FROM ${table}`).all()));
  f.db.exec("CREATE TRIGGER fail_confirmation BEFORE INSERT ON confirmation_actions BEGIN SELECT RAISE(ABORT,'injected'); END;");
  error(f.core[outcome](input), 'storage_error');
  const after = JSON.stringify(['memories', 'receipts', 'suppressed', 'namespace_epochs', 'confirmation_actions', 'index_memories']
    .map(table => f.db.prepare(`SELECT * FROM ${table}`).all()));
  assert.equal(after, before);
  f.db.exec('DROP TRIGGER fail_confirmation');
  const peer = openMemoryCore({ path: f.path, decisionReview: 'required-v1' }); f.ws.defer(() => peer.close());
  const result = f.core[outcome](input); ok(result); assert.deepEqual(peer[outcome](input), result);
  error(peer[outcome]({ ...input, actionId: 'competing-action' }), outcome === 'confirm' ? 'revision_conflict' : 'memory_not_found');
  error(peer[outcome]({ ...input, namespace: { ...ns, ownerId: 'other' } }), 'memory_not_found');
  assert.equal(f.db.prepare('SELECT count(*) n FROM confirmation_actions').get().n, 1);
});

test('CF1 confirmed duplicates never demote, explicit promotion inserts into published recall index', async t => {
  const f = fixture(t); ok(await f.core.capture(captureInput())); const memory = queue(f.core)[0];
  const source = ok(get(f.core, memory.id, true)).receipts[0];
  const { id, createdAt, ...sameReceipt } = source;
  error(f.core.confirm({ ...action(memory), receipt: sameReceipt }), 'invalid_input');
  assert.equal(queue(f.core)[0].revision, memory.revision);
  ok(f.core.confirm({ ...action(memory), receipt: receipt() }));
  ok(await f.core.capture(captureInput('duplicate')));
  assert.equal(ok(get(f.core, memory.id)).memory.reviewState, 'confirmed');
  f.model.extract = () => ({ items: [item({ content: 'Second decision.' })] }); ok(await f.core.capture(captureInput('second')));
  const second = queue(f.core)[0];
  ok(f.core.rebuildIndex({ namespace: ns, expectedIndexRevision: ok(f.core.map({ namespace: ns })).indexRevision, limit: 500 }));
  assert.equal(f.db.prepare('SELECT count(*) n FROM index_memories WHERE id=?').get(second.id).n, 0);
  ok(f.core.admit({ namespace: ns, memory: { content: 'Second decision.', kind: 'decision' }, receipts: [receipt()] }));
  assert.equal(f.db.prepare('SELECT count(*) n FROM index_memories WHERE id=?').get(second.id).n, 1);
});

test('CF1 review state is independent of historical/current and filing; no historical fetch or startup leak', async t => {
  const f = fixture(t); ok(await f.core.capture(captureInput())); const memory = queue(f.core)[0];
  // Exercise reader defenses for all orthogonal states, independently of admission defaults.
  f.db.prepare("UPDATE memories SET currentness='historical',filing_status='filed' WHERE id=?").run(memory.id);
  const waiting = queue(f.core)[0]; assert.equal(waiting.state, 'historical'); assert.equal(waiting.filing.status, 'filed');
  error(f.core.confirm({ ...action(memory), receipt: receipt() }), 'memory_historical');
  assert.deepEqual(ok(f.core.list({ namespace: ns, states: ['historical'] })).memories, []);
  const fetched = ok(f.core.fetch({ namespace: ns, refs: [{ memoryId: memory.id, revision: memory.revision }], view: 'historical' }));
  assert.equal(fetched.invalidRefs.length, 1);
  f.db.prepare("UPDATE memories SET currentness='current',kind='instruction' WHERE id=?").run(memory.id);
  assert.deepEqual(ok(f.core.sessionStartContext({ namespace: ns })).groups.procedural.items, []);
});

test('CF1 borrowed episode passages are hidden transitively and reappear after confirmation', async t => {
  const f = episodeSetup(t, { extract: () => ({ items: [item()] }) }, { decisionReview: 'required-v1' });
  ok(await f.core.capture(episodeInput(1, 'origin')));
  const waiting = ok(f.core.list({ namespace: episodeNs, reviewState: 'awaiting' })).memories[0];
  const origin = f.db.prepare('SELECT id FROM session_episodes').get().id;
  f.model.extract = () => ({ items: [] });
  ok(await f.core.capture(episodeInput(1, 'borrower')));
  const borrower = f.db.prepare('SELECT id FROM session_episodes WHERE id!=?').get(origin).id;
  // Same storage relation used by commitDraft when a retained source is borrowed.
  const source = f.db.prepare('SELECT * FROM episode_sources WHERE episode_id=? LIMIT 1').get(origin);
  const copy = { ...source, id: 'borrowed-source', episode_id: borrower };
  f.db.prepare(`INSERT INTO episode_sources(${Object.keys(copy).join(',')}) VALUES(${Object.keys(copy).map(() => '?').join(',')})`).run(...Object.values(copy));
  const request = { namespace: episodeNs, since: '1901-02-01T00:00:00.000Z', until: '1901-02-10T00:00:00.000Z' };
  assert.deepEqual(ok(f.core.listEpisodes(request)).items, []);
  error(f.core.getEpisode({ namespace: episodeNs, episodeId: borrower }), 'episode_not_found');
  ok(f.core.confirm({ ...action(waiting), namespace: episodeNs, receipt: receipt() }));
  assert.equal(ok(f.core.listEpisodes(request)).items.length, 2);
  ok(f.core.getEpisode({ namespace: episodeNs, episodeId: borrower }));
});

test('CF1 invalid option refuses before migration; trusted admission jobs use inferred capture semantics', t => {
  for (const decisionReview of [false, true, null, undefined, 'other']) assert.throws(() => openMemoryCore({ path: ':memory:', decisionReview }), { code: 'invalid_input' });
  const f = fixture(t);
  const key = { namespace: ns, client: 'trusted-job', eventId: 'manual', payloadDigest: 'a'.repeat(64) };
  const token = ok(f.core.claimAdmission({ ...key, leaseMs: 1000 })).token;
  ok(f.core.finishAdmission({ ...key, token, items: [{ content, kind: 'decision', confidence: 0.8, receipts: [receipt()] }] }));
  assert.equal(queue(f.core).length, 1);
});

test('CF1 ordered awaiting replacement preserves active lineage until confirmation', async t => {
  const f = fixture(t);
  f.model.extract = () => ({ items: [item({ content: 'Earlier active context.', kind: 'context' })] });
  const first = ok(await f.core.capture({ ...captureInput('first'), causal: { streamId: 'stream', sequence: 1 } }));
  const previous = first.admission.memories[0];
  f.model.extract = () => ({ items: [item()] });
  f.model.reconcile = () => ({ transitions: [{ replacementIndex: 0, predecessorIndex: 0, evidenceIndices: [0],
    relation: 'supersedes', valueChange: 'changed', adoption: 'explicit' }] });
  const next = ok(await f.core.capture({ ...captureInput('second'), causal: { streamId: 'stream', sequence: 2 } }));
  assert.equal(next.reconciliation.reason, 'confirmation_required');
  assert.equal(queue(f.core).length, 1);
  assert.equal(ok(get(f.core, previous.id)).memory.state, 'active');
  assert.equal(f.db.prepare('SELECT count(*) n FROM memory_supersessions').get().n, 0);
});

test('CF1 bounded source scans exclude awaiting with both source candidate policies', async t => {
  const f = fixture(t); ok(await f.core.capture(captureInput()));
  for (const sourceCandidatePolicy of [undefined, 'bounded-keyset-v1']) {
    const core = sourceCandidatePolicy ? openMemoryCore({ path: f.path, model: f.model, sourceCandidatePolicy }) : f.core;
    if (core !== f.core) f.ws.defer(() => core.close());
    const result = ok(await core.recall({ readSet: [ns], query: 'I chose A', contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' }));
    assert.deepEqual(result.memories, []);
  }
});

for (const outcome of ['confirm', 'reject']) test(`CF1 simultaneous process ${outcome} retries share one durable result`, async t => {
  const f = fixture(t); ok(await f.core.capture(captureInput())); const memory = queue(f.core)[0];
  const input = { ...action(memory), ...(outcome === 'confirm' ? { receipt: receipt() } : {}) };
  const script = `import {openMemoryCore} from ${JSON.stringify(new URL('../index.mjs', import.meta.url).href)};
    const core=openMemoryCore({path:process.argv[1],decisionReview:'required-v1'});
    try { process.stdout.write(JSON.stringify(core[process.argv[2]](JSON.parse(process.argv[3])))); } finally { core.close(); }`;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, f.path, outcome, JSON.stringify(input)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => errors += chunk);
    child.on('error', reject); child.on('close', code => {
      if (code !== 0) reject(Error(errors)); else { try { resolve(JSON.parse(output)); } catch (error) { reject(error); } }
    });
  });
  const [first, second] = await Promise.all([run(), run()]); ok(first); assert.deepEqual(second, first);
  assert.equal(f.db.prepare('SELECT count(*) n FROM confirmation_actions').get().n, 1);
  assert.equal(f.db.prepare('SELECT revision FROM memories').get().revision, memory.revision + 1);
});

for (const resolution of ['confirm', 'reject']) test(`CF1 held supersession survives restart and ${resolution} resolves only its own work`, async t => {
  const f = fixture(t);
  f.model.extract = () => ({ items: [item({ content: 'Earlier active context.', kind: 'context' })] });
  const first = ok(await f.core.capture({ ...captureInput('first'), causal: { streamId: 'stream', sequence: 1 } }));
  const previous = first.admission.memories[0];
  f.model.extract = () => ({ items: [item()] });
  f.model.reconcile = () => ({ transitions: [{ replacementIndex: 0, predecessorIndex: 0, evidenceIndices: [0],
    relation: 'supersedes', valueChange: 'changed', adoption: 'explicit' }] });
  const request = { ...captureInput('second'), causal: { streamId: 'stream', sequence: 2 } };
  const captured = ok(await f.core.capture(request));
  const memory = queue(f.core)[0];
  assert.equal(f.db.prepare('SELECT count(*) n FROM confirmation_supersessions').get().n, 1);
  const reopened = openMemoryCore({ path: f.path, decisionReview: 'required-v1' }); f.ws.defer(() => reopened.close());
  const input = { ...action(memory), ...(resolution === 'confirm' ? { receipt: receipt() } : {}) };
  // The action ledger, retirement, confirmation receipt and index change share rollback.
  f.db.exec("CREATE TRIGGER fail_confirmation BEFORE INSERT ON confirmation_actions BEGIN SELECT RAISE(ABORT,'injected'); END");
  error(reopened[resolution](input), 'storage_error');
  assert.equal(ok(get(f.core, previous.id)).memory.state, 'active');
  assert.equal(queue(f.core).length, 1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM confirmation_supersessions').get().n, 1);
  f.db.exec('DROP TRIGGER fail_confirmation');
  const result = reopened[resolution](input); ok(result); assert.deepEqual(reopened[resolution](input), result);
  assert.equal(ok(get(f.core, previous.id)).memory.state, resolution === 'confirm' ? 'historical' : 'active');
  assert.equal(f.db.prepare('SELECT count(*) n FROM memory_supersessions').get().n, resolution === 'confirm' ? 1 : 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM confirmation_supersessions').get().n, 0);
  assert.deepEqual(ok(await f.core.capture(request)).reconciliation, captured.reconciliation);
});

test('CF1 mixed retirement batch immediately applies the independent non-awaiting transition', async t => {
  const f = fixture(t);
  f.model.extract = () => ({ items: ['Earlier A', 'Earlier B'].map(content => item({ content, kind: 'context' })) });
  const first = ok(await f.core.capture({ ...captureInput('first'), causal: { streamId: 'stream', sequence: 1 } }));
  const previous = Object.fromEntries(first.admission.memories.map(m => [ok(get(f.core, m.id)).memory.content, m]));
  f.model.extract = () => ({ items: [item(), item({ content: 'Updated B', kind: 'context' })] });
  f.model.reconcile = request => ({ transitions: ['Earlier A', 'Earlier B'].map((content, replacementIndex) => ({
    replacementIndex, predecessorIndex: request.input.candidates.findIndex(c => c.content === content), evidenceIndices: [0],
    relation: 'supersedes', valueChange: 'changed', adoption: 'explicit' })) });
  const next = ok(await f.core.capture({ ...captureInput('second'), causal: { streamId: 'stream', sequence: 2 } }));
  assert.deepEqual(next.reconciliation, { status: 'unresolved', reason: 'confirmation_required', retiredCount: 1 });
  assert.equal(ok(get(f.core, previous['Earlier A'].id)).memory.state, 'active');
  assert.equal(ok(get(f.core, previous['Earlier B'].id)).memory.state, 'historical');
  ok(f.core.confirm({ ...action(queue(f.core)[0]), receipt: receipt() }));
  assert.equal(ok(get(f.core, previous['Earlier A'].id)).memory.state, 'historical');
  assert.equal(f.db.prepare('SELECT count(*) n FROM memory_supersessions').get().n, 2);
});

for (const resolution of ['confirm', 'reject']) test(`CF1 ${resolution} restores or drops durable conflict hints`, t => {
  const f = fixture(t);
  const target = ok(f.core.admit({ namespace: ns, memory: { content: 'Earlier direct context', kind: 'context' }, receipts: [receipt('target')] })).memory;
  const key = { namespace: ns, client: 'trusted', eventId: 'conflicting', payloadDigest: 'c'.repeat(64) };
  const token = ok(f.core.claimAdmission({ ...key, leaseMs: 1000 })).token;
  ok(f.core.finishAdmission({ ...key, token, items: [{ content, kind: 'decision', confidence: 0.8, receipts: [receipt('inferred')],
    conflictHints: [{ memoryId: target.id, expectedRevision: target.revision, relation: 'contradicts' }] }] }));
  const memory = queue(f.core)[0];
  assert.deepEqual(ok(get(f.core, target.id)).conflicts, []);
  assert.equal(f.db.prepare('SELECT count(*) n FROM confirmation_conflicts').get().n, 1);
  const reopened = openMemoryCore({ path: f.path, decisionReview: 'required-v1' }); f.ws.defer(() => reopened.close());
  ok(reopened[resolution]({ ...action(memory), ...(resolution === 'confirm' ? { receipt: receipt() } : {}) }));
  assert.equal(f.db.prepare('SELECT count(*) n FROM confirmation_conflicts').get().n, 0);
  const conflicts = ok(get(f.core, target.id)).conflicts;
  assert.equal(conflicts.length, resolution === 'confirm' ? 1 : 0);
  if (resolution === 'confirm') {
    assert.equal(conflicts[0].memoryId, memory.id);
    assert.equal(conflicts[0].revision, memory.revision + 1);
    assert.equal(ok(get(f.core, memory.id)).conflicts[0].memoryId, target.id);
  }
});

test('CF1 legacy store refuses the core-only decisionReview option', t => {
  const f = fixture(t);
  assert.throws(() => openMemoryStore({ path: f.path, decisionReview: 'required-v1' }), { code: 'invalid_input' });
});

test('CF1 typical synthetic session measures whole-episode and startup context loss', async t => {
  const turns = [
    ['user', 'Plan the synthetic release. Next, run the offline checks.'],
    ['assistant', 'We can compare storage and testing choices.'],
    ['user', 'I choose SQLite for the synthetic release.'],
    ['assistant', 'That gives us local transactions.'],
    ['user', 'I choose scripted models for the tests.'],
    ['assistant', 'The next step remains running the offline checks.'],
  ];
  const f = episodeSetup(t, { extract: () => ({ items: [
    item({ content: turns[2][1], sourceIndices: [2] }), item({ content: turns[4][1], sourceIndices: [4] }),
  ] }), interpretEpisode: request => ({ ...interpretation(request), nextStep: {
    value: 'Run the offline checks.', anchors: [{ sourceIndex: 0, start: 0, end: turns[0][1].length }],
  } }) }, { decisionReview: 'required-v1' });
  ok(await f.core.capture(episodeInput(1, 'typical-synthetic', { messages: turns.map(([role, content], i) => ({
    id: `turn-${i}`, role, content, occurredAt: `1901-02-03T04:0${i}:00.000Z`,
  })) })));
  const waiting = ok(f.core.list({ namespace: episodeNs, reviewState: 'awaiting' })).memories;
  assert.equal(waiting.length, 2);
  const episodeId = f.db.prepare('SELECT id FROM session_episodes').get().id;
  const request = { namespace: episodeNs, since: '1901-02-01T00:00:00.000Z', until: '1901-02-10T00:00:00.000Z' };
  const measure = () => {
    const context = ok(f.core.sessionStartContext({ namespace: episodeNs }));
    return { episodes: ok(f.core.listEpisodes(request)).items.length,
      nextSteps: context.groups.nextSteps.items.length, procedural: context.groups.procedural.items.length };
  };
  const before = measure();
  assert.deepEqual(before, { episodes: 0, nextSteps: 0, procedural: 0 });
  error(f.core.getEpisode({ namespace: episodeNs, episodeId }), 'episode_not_found');
  ok(f.core.confirm({ ...action(waiting[0], 'first'), namespace: episodeNs, receipt: receipt('first') }));
  assert.deepEqual(measure(), before); // One live awaiting link still hides all context.
  error(f.core.getEpisode({ namespace: episodeNs, episodeId }), 'episode_not_found');
  ok(f.core.confirm({ ...action(waiting[1], 'second'), namespace: episodeNs, receipt: receipt('second') }));
  const after = measure();
  assert.deepEqual(after, { episodes: 1, nextSteps: 1, procedural: 0 });
  const episode = ok(f.core.getEpisode({ namespace: episodeNs, episodeId }));
  assert.ok(JSON.stringify(episode).includes('Run the offline checks.'));
  t.diagnostic(JSON.stringify({ turns: 3, decisions: 2, before, after }));
});

for (const changed of ['predecessor', 'replacement']) test(`CF1 held ${changed}: edits invalidate while added receipts preserve retirement evidence`, async t => {
  const f = fixture(t);
  f.model.extract = () => ({ items: [item({ content: 'Earlier context', kind: 'context' })] });
  const previous = ok(await f.core.capture({ ...captureInput('first'), causal: { streamId: 'stream', sequence: 1 } })).admission.memories[0];
  f.model.extract = () => ({ items: [item()] });
  f.model.reconcile = () => ({ transitions: [{ replacementIndex: 0, predecessorIndex: 0, evidenceIndices: [0],
    relation: 'supersedes', valueChange: 'changed', adoption: 'explicit' }] });
  ok(await f.core.capture({ ...captureInput('second'), causal: { streamId: 'stream', sequence: 2 } }));
  if (changed === 'predecessor') ok(f.core.correct({ namespace: ns, memoryId: previous.id,
    expectedRevision: previous.revision, content: 'Updated direct context', kind: 'context', receipt: receipt('edit') }));
  else ok(await f.core.capture(captureInput('new-evidence')));
  ok(f.core.confirm({ ...action(queue(f.core)[0]), receipt: receipt() }));
  assert.equal(ok(get(f.core, previous.id)).memory.state, changed === 'predecessor' ? 'active' : 'historical');
  assert.equal(f.db.prepare('SELECT count(*) n FROM confirmation_supersessions').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM memory_supersessions').get().n, changed === 'predecessor' ? 0 : 1);
});

test('CF1 conflict insertion fails loudly for missing and historical sources', async t => {
  const { createConflictStorage } = await import('../conflict-storage.mjs');
  const f = fixture(t);
  const storage = createConflictStorage({ db: f.db, activeRow: () => undefined,
    rawRow: () => undefined, advanceEpoch: () => assert.fail('unexpected epoch write') });
  assert.throws(() => storage.insertBatch(ns, [{ memoryId: 'missing' }], 'inferred-hint'), { code: 'memory_not_found' });
  const historical = createConflictStorage({ db: f.db, activeRow: () => undefined,
    rawRow: () => ({ id: 'history', review_state: 'none', currentness: 'historical' }), advanceEpoch: () => assert.fail() });
  assert.throws(() => historical.insertBatch(ns, [{ memoryId: 'history' }], 'inferred-hint'), { code: 'memory_not_found' });
});

async function heldPair(core, model) {
  model.extract = () => ({ items: [item({ content: 'Earlier context', kind: 'context' })] });
  const previous = ok(await core.capture({ ...captureInput('first'), causal: { streamId: 'stream', sequence: 1 } })).admission.memories[0];
  model.extract = () => ({ items: [item()] });
  model.reconcile = () => ({ transitions: [{ replacementIndex: 0, predecessorIndex: 0, evidenceIndices: [0],
    relation: 'supersedes', valueChange: 'changed', adoption: 'explicit' }] });
  const result = ok(await core.capture({ ...captureInput('second'), causal: { streamId: 'stream', sequence: 2 } }));
  return { previous, result };
}

for (const route of ['admit', 'remember', 'recapture']) test(`CF1 ${route} resolves held lineage to the same history as option-off capture`, async t => {
  for (const enabled of [true, false]) {
    const f = fixture(t);
    const core = enabled ? f.core : openMemoryCore({ path: f.path, model: f.model });
    if (!enabled) f.ws.defer(() => core.close());
    const { previous, result } = await heldPair(core, f.model);
    assert.equal(result.reconciliation.reason, enabled ? 'confirmation_required' : null);
    if (route === 'admit') ok(core.admit({ namespace: ns, memory: { content, kind: 'decision' }, receipts: [receipt('promote')] }));
    if (route === 'remember') {
      const legacy = openMemoryStore({ path: f.path }); f.ws.defer(() => legacy.close());
      legacy.scope({ ownerId: ns.ownerId }).remember({ content, kind: 'decision', origin: 'explicit', confidence: 1, receipt: receipt('promote') });
    }
    if (route === 'recapture') {
      ok(await core.capture(captureInput('new-event')));
      if (enabled) ok(core.confirm({ ...action(queue(core)[0]), receipt: receipt() }));
    }
    assert.equal(ok(get(core, previous.id)).memory.state, 'historical');
    assert.equal(f.db.prepare('SELECT count(*) n FROM memory_supersessions').get().n, 1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM confirmation_supersessions').get().n, 0);
  }
});

test('CF1 option-off ordered recapture preserves held evidence for a review-enabled opener', async t => {
  const f = fixture(t); const { previous } = await heldPair(f.core, f.model);
  const before = f.db.prepare('SELECT receipt_ids FROM confirmation_supersessions').get().receipt_ids;
  const off = openMemoryCore({ path: f.path, model: f.model }); f.ws.defer(() => off.close());
  const recaptured = ok(await off.capture({ ...captureInput('third'), causal: { streamId: 'stream', sequence: 3 } }));
  assert.equal(recaptured.reconciliation.reason, 'confirmation_required');
  assert.equal(f.db.prepare('SELECT receipt_ids FROM confirmation_supersessions').get().receipt_ids, before);
  error(off.confirm({ ...action(queue(f.core)[0]), receipt: receipt() }), 'decision_review_required');
  ok(f.core.confirm({ ...action(queue(f.core)[0]), receipt: receipt() }));
  assert.equal(ok(get(f.core, previous.id)).memory.state, 'historical');
});

function heldHint(f) {
  const target = ok(f.core.admit({ namespace: ns, memory: { content: 'Target context', kind: 'context' }, receipts: [receipt('target')] })).memory;
  const key = { namespace: ns, client: 'trusted', eventId: 'hint', payloadDigest: 'b'.repeat(64) };
  const token = ok(f.core.claimAdmission({ ...key, leaseMs: 1000 })).token;
  ok(f.core.finishAdmission({ ...key, token, items: [{ content, kind: 'decision', confidence: 0.8, receipts: [receipt('inference')],
    conflictHints: [{ memoryId: target.id, expectedRevision: target.revision, relation: 'contradicts' }] }] }));
  return target;
}
function promote(f, route) {
  if (route === 'confirm') return ok(f.core.confirm({ ...action(queue(f.core)[0]), receipt: receipt() }));
  if (route === 'admit') return ok(f.core.admit({ namespace: ns, memory: { content, kind: 'decision' }, receipts: [receipt('promote')] }));
  const legacy = openMemoryStore({ path: f.path }); f.ws.defer(() => legacy.close());
  return legacy.scope({ ownerId: ns.ownerId }).remember({ content, kind: 'decision', origin: 'explicit', confidence: 1, receipt: receipt('promote') });
}
for (const route of ['confirm', 'admit', 'remember']) for (const full of [false, true]) test(`CF1 ${route} restores held hints or records overflow without blocking review (${full})`, async t => {
  const f = fixture(t); const target = heldHint(f);
  ok(await f.core.capture(captureInput('extra-receipt')));
  const memory = queue(f.core)[0];
  if (full) for (let i = 0; i < 5; i++) ok(f.core.admit({ namespace: ns,
    memory: { content: `Conflict ${i}`, kind: 'context' }, receipts: [receipt(`conflict-${i}`)],
    conflictHints: [{ memoryId: target.id, expectedRevision: target.revision, relation: 'contradicts' }] }));
  const result = promote(f, route);
  assert.deepEqual(result.reviewEffects.conflicts, [{ memoryId: target.id, status: full ? 'dropped' : 'restored', reason: full ? 'conflict_limit' : null }]);
  assert.equal(ok(get(f.core, memory.id)).memory.state, 'active');
  assert.equal(queue(f.core).length, 0);
  assert.equal(ok(get(f.core, target.id)).conflicts.length, full ? 5 : 1);
  if (full) assert.equal(f.db.prepare('SELECT drop_reason FROM confirmation_conflicts').get().drop_reason, 'conflict_limit');
});

function qualify(f, id) {
  const row = f.db.prepare('SELECT * FROM memories WHERE id=?').get(id);
  const sources = ok(get(f.core, id, true)).receipts.map(({ client, sessionId, eventId, role, excerpt }) => ({ client, sessionId, eventId, role, excerpt }));
  const text = sources[0].excerpt;
  createQualificationStorage({ db: f.db, receiptKey: r => createHash('sha256').update(JSON.stringify(r)).digest('hex') }).bind(row, {
    version: 1, slot: { subject: 'Synthetic project', property: 'choice', scope: 'work', applies: 'current release' },
    value: 'A', attribution: 'direct', commitment: 'adopted', anchors: [{ receiptIndex: 0, start: 0, end: text.length, text,
      fields: ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'] }],
  }, sources, false, row.content);
}
for (const route of ['confirm', 'admit']) test(`CF1 ${route} surfaces held qualification with actionable references`, async t => {
  const f = fixture(t); const { previous } = await heldPair(f.core, f.model);
  qualify(f, previous.id);
  const result = promote(f, route);
  const transition = result.reviewEffects.transitions[0];
  assert.equal(transition.status, 'unresolved'); assert.equal(transition.reason, 'qualified_transition_required');
  assert.equal(transition.previous.memoryId, previous.id);
  assert.equal(ok(get(f.core, transition.replacement.memoryId)).memory.revision, transition.replacement.revision);
  assert.equal(ok(get(f.core, previous.id)).memory.state, 'active');
  if (route === 'confirm') {
    const recorded = JSON.parse(f.db.prepare('SELECT result FROM confirmation_actions').get().result);
    assert.deepEqual(recorded.reviewEffects, result.reviewEffects);
  }
});

test('CF1 mixed qualification takes precedence while reporting the held part alongside it', async t => {
  const f = fixture(t);
  f.model.extract = () => ({ items: ['Earlier A', 'Earlier B'].map(content => item({ content, kind: 'context' })) });
  const first = ok(await f.core.capture({ ...captureInput('first'), causal: { streamId: 'stream', sequence: 1 } }));
  const b = first.admission.memories.find(m => ok(get(f.core, m.id)).memory.content === 'Earlier B');
  qualify(f, b.id);
  f.model.extract = () => ({ items: [item(), item({ content: 'Updated B', kind: 'context' })] });
  f.model.reconcile = request => ({ transitions: ['Earlier A', 'Earlier B'].map((content, replacementIndex) => ({
    replacementIndex, predecessorIndex: request.input.candidates.findIndex(c => c.content === content), evidenceIndices: [0],
    relation: 'supersedes', valueChange: 'changed', adoption: 'explicit' })) });
  const request = { ...captureInput('second'), causal: { streamId: 'stream', sequence: 2 } };
  const result = ok(await f.core.capture(request));
  assert.deepEqual(ok(await f.core.capture(request)).reconciliation, result.reconciliation);
  assert.deepEqual(result.reconciliation, { status: 'unresolved', reason: 'qualified_transition_required', retiredCount: 0,
    awaitingCount: 1 });
  assert.equal(f.db.prepare('SELECT count(*) n FROM confirmation_supersessions').get().n, 1);
});

test('CF1 missing held receipt evidence is reported and never retires the predecessor', async t => {
  const f = fixture(t); const { previous } = await heldPair(f.core, f.model);
  const [id] = JSON.parse(f.db.prepare('SELECT receipt_ids FROM confirmation_supersessions').get().receipt_ids);
  f.db.prepare('DELETE FROM receipt_causality WHERE receipt_id=?').run(id);
  f.db.prepare('DELETE FROM receipts WHERE id=?').run(id);
  const result = promote(f, 'confirm');
  assert.equal(result.reviewEffects.transitions[0].reason, 'stale_evidence');
  assert.equal(ok(get(f.core, previous.id)).memory.state, 'active');
  assert.equal(f.db.prepare('SELECT count(*) n FROM memory_supersessions').get().n, 0);
});

test('CF1 explicit promotion and its held retirement roll back together on failure', async t => {
  const f = fixture(t); const { previous } = await heldPair(f.core, f.model);
  f.db.exec("CREATE TRIGGER fail_retirement BEFORE INSERT ON memory_supersessions BEGIN SELECT RAISE(ABORT,'injected'); END");
  const input = { namespace: ns, memory: { content, kind: 'decision' }, receipts: [receipt('promote')] };
  error(f.core.admit(input), 'storage_error');
  assert.equal(queue(f.core).length, 1);
  assert.equal(ok(get(f.core, previous.id)).memory.state, 'active');
  assert.equal(f.db.prepare('SELECT count(*) n FROM confirmation_supersessions').get().n, 1);
  f.db.exec('DROP TRIGGER fail_retirement');
  ok(f.core.admit(input));
  assert.equal(ok(get(f.core, previous.id)).memory.state, 'historical');
});
