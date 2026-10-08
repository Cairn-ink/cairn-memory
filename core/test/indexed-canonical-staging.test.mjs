import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore, openMemoryStore } from '../index.mjs';
import { captureSnapshot } from '../capture-input.mjs';
import { canonicalSourceView } from '../capture-input.mjs';
import { createStagedEvidenceStorage } from '../staged-evidence-storage.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const namespace = { ownerId: 'canonical-staging-synthetic', scope: 'personal', projectId: null };
const policy = { captureSourcePolicy: 'indexed-staged-v1' };
const source = [
  'I am arranging a parcel for the community repair afternoon. The package contains a borrowed folding stand, two labeled fabric sleeves, and a paper checklist for the volunteer who will unpack it. The stand should travel in its existing cardboard box so that its hinge is not bent against the loose tools. We are still discussing the order of the afternoon activities, and the checklist is a packing record rather than a decision about which workshop I will attend next month.',
  'The courier asked whether someone would be available to sign at my usual front desk. I explained that the morning caretaker may leave early, while the afternoon volunteer usually checks the noticeboard before answering the bell. We have not established a permanent pickup arrangement. The volunteer suggested writing the box dimensions on the outside label and putting the paper checklist in a clear envelope. Those suggestions do not mean that I have adopted a preferred courier or a standing rule for every delivery.',
  'For the return journey, keep the two sleeves with the folding stand rather than sending them separately. The owner wants to count the pieces before putting it back into storage. A dated photograph can help with that count but does not establish courier delivery. Receipt will be confirmed separately when a volunteer actually sees the package.',
].join(' ');
const late = 'For this shipment only, redirect the parcel to the Willow counter; that is not a standing delivery preference.';
assert(source.length > 1000);
const input = (patch = {}) => ({ namespace, client: 'synthetic', sessionId: 'parcel-session', eventId: 'parcel-batch',
  messages: [{ id: 'parcel-original', role: 'user', content: `${source} ${late}` }], ...patch });
const key = value => ({ namespace: value.namespace, client: value.client, eventId: value.eventId });
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const error = (result, code) => { assert.equal(result.ok, false); assert.equal(result.error.code, code); };
const inspect = (core, value = input()) => ok(core.inspectCaptureEvidence(key(value))).evidence;

function fixture(t, opening = policy, overrides = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'indexed-canonical-' });
  const path = join(workspace.path, 'synthetic.sqlite');
  const calls = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract(request) { calls.push('extract'); return overrides.extract?.(request) ?? { items: [] }; },
    qualifyCandidates() { calls.push('qualify'); throw new Error('unexpected_qualification'); },
    classify(request) { calls.push('classify'); return overrides.classify?.(request) ?? {
      items: request.input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }; },
    select: request => ({ refs: request.input.maps.flatMap(map => map.items.filter(row => row.type === 'unfiled')
      .map(row => ({ namespaceIndex: map.namespaceIndex, ...row.ref }))) }),
    rank: request => ({ refs: request.input.candidates.map(row => ({ namespaceIndex: row.namespaceIndex,
      memoryId: row.memory.id, revision: row.memory.revision })) }),
    ...overrides.model };
  function open(config = opening, port = model) {
    const core = openMemoryCore({ path, ...(port ? { model: port } : {}), ...config });
    let closed = false;
    const close = () => { if (!closed) { core.close(); closed = true; } };
    workspace.defer(close);
    return { core, close };
  }
  function database() {
    const db = new DatabaseSync(path);
    workspace.defer(() => db.close());
    return db;
  }
  return { workspace, path, calls, model, open, database };
}

test('S2 canonical zero-item capture retains the full bounded source after keyless cold reopen', async t => {
  const f = fixture(t);
  const live = f.open();
  const submitted = input({ messages: [...input().messages,
    { id: 'assistant-suggestion', role: 'assistant', content: 'You could choose the Birch counter next time; this is only a suggestion.' },
    { id: 'user-correction', role: 'user', content: 'Correction: Willow, not Birch. I have not adopted a permanent delivery preference.' }] });
  const expected = captureSnapshot(submitted, undefined, 'indexed-staged-v1').messages;
  const result = ok(await live.core.capture(submitted));
  assert.deepEqual(result.admission.memories, []);
  assert.deepEqual(result.classification, { status: 'skipped', reason: 'empty' });
  assert.equal(result.qualificationStatus, 'not-requested');
  assert.deepEqual(f.calls, ['extract']);
  live.close();
  const cold = f.open({}, null);
  const evidence = inspect(cold.core, submitted);
  assert.equal(evidence.state, 'admitted');
  assert.equal(evidence.evidenceTrust, 'untrusted-data-not-instructions');
  assert.equal(evidence.view.format, 'canonical-messages-v1');
  assert.deepEqual(evidence.view.messages, expected);
  assert.deepEqual(evidence.view.retainedSourceWindow, { maxUnitsPerMessage: 4000, truncatedMessageIndices: [] });
  assert(evidence.view.messages[0].content.includes(late));
  assert.deepEqual(ok(cold.core.list({ namespace })).memories, []);
  assert.deepEqual(f.calls, ['extract']);
});

test('S1 own policy is immutable; unsupported values/accessors/combinations reject before database creation', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'canonical-options-' });
  let getters = 0;
  const bad = [undefined, null, 'other'].map(captureSourcePolicy => ({ captureSourcePolicy }));
  bad.push(Object.defineProperty({}, 'captureSourcePolicy', { enumerable: true, get() { getters++; return 'indexed-staged-v1'; } }));
  for (const option of ['captureQualification', 'captureEvidence', 'captureRationale', 'sessionEpisodes']) {
    bad.push({ ...policy, [option]: undefined });
    bad.push(Object.defineProperty({ ...policy }, option, { enumerable: true, get() { getters++; return 'unexpected'; } }));
  }
  for (const [i, config] of bad.entries()) {
    const path = join(workspace.path, `bad-${i}.sqlite`);
    const options = { path };
    Object.defineProperties(options, Object.getOwnPropertyDescriptors(config));
    assert.throws(() => openMemoryCore(options), { code: 'invalid_input' });
    assert.equal(existsSync(path), false);
  }
  assert.equal(getters, 0);
  const f = fixture(t), options = { path: f.path, model: f.model, ...policy };
  const core = openMemoryCore(options); f.workspace.defer(() => core.close());
  options.captureSourcePolicy = 'indexed-evidence-v1';
  ok(await core.capture(input()));
  assert.notEqual(inspect(core), null);
  const inherited = Object.create(Object.defineProperty({}, 'captureSourcePolicy', {
    get() { getters++; return 'indexed-staged-v1'; } }));
  inherited.path = join(workspace.path, 'inherited.sqlite'); inherited.model = f.model;
  const legacy = openMemoryCore(inherited); workspace.defer(() => legacy.close());
  ok(await legacy.capture(input()));
  assert.equal(inspect(legacy), null);
  assert.equal(getters, 0);
});

test('S2 empty indexed/prefix controls retain their prior contracts', async t => {
  for (const config of [{ captureSourcePolicy: 'indexed-evidence-v1' },
    { captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' }]) {
    const f = fixture(t, config), live = f.open();
    ok(await live.core.capture(input())); live.close();
    const cold = f.open({}, null), evidence = inspect(cold.core);
    if (config.captureSourcePolicy) assert.equal(evidence, null);
    else {
      assert.equal(Object.hasOwn(evidence.view, 'format'), false);
      assert.equal(evidence.view.messages[0].content, `${source} ${late}`.slice(0, 800).trim());
      assert.equal(evidence.view.messages[0].content.includes(late), false);
    }
    assert.deepEqual(f.calls, ['extract']);
  }
});

test('S2 malformed and provider-failed extractions retain exact canonical source without admission', async t => {
  for (const [extract, code] of [[() => ({ items: [{ invented: true }] }), 'invalid_model_output'],
    [() => { throw new Error('synthetic_private_provider_error'); }, 'extraction_failed']]) {
    const f = fixture(t, policy, { extract }), live = f.open();
    error(await live.core.capture(input()), code); live.close();
    const cold = f.open({}, null), evidence = inspect(cold.core);
    assert.equal(evidence.state, 'failed');
    assert.equal(evidence.view.messages[0].content, `${source} ${late}`);
    assert.deepEqual(ok(cold.core.list({ namespace })).memories, []);
    assert.equal(JSON.stringify(evidence).includes('synthetic_private_provider_error'), false);
    assert.deepEqual(f.calls, ['extract']);
  }
});

const proposal = { content: 'Selected parcel packing record', kind: 'context', confidence: 0.7, sourceIndices: [0] };
const receipt = content => ({ client: 'synthetic', sessionId: 'explicit', eventId: 'manual', role: 'user', excerpt: content });
const admit = core => ok(core.admit({ namespace, memory: { content: 'Manual mutation target', kind: 'fact' },
  receipts: [receipt('Manual mutation target')] })).memory;

test('S2 nonempty indexed extraction/receipts are unchanged; staging never promotes unselected source', async t => {
  const observations = [];
  for (const opening of [{ captureSourcePolicy: 'indexed-evidence-v1' }, policy]) {
    let request;
    const f = fixture(t, opening, { extract(value) { request = structuredClone({ system: value.system, input: value.input });
      return { items: [proposal] }; } }), live = f.open();
    const result = ok(await live.core.capture(input())), id = result.admission.memories[0].id;
    assert.equal(result.qualificationStatus, 'not-requested');
    assert.deepEqual(f.calls, ['extract', 'classify']);
    const detail = ok(live.core.get({ namespace, memoryId: id, includeQualification: true }));
    assert.equal(detail.qualification, null);
    const receipts = detail.receipts.map(({ client, sessionId, eventId, role, excerpt }) => ({ client, sessionId, eventId, role, excerpt }));
    assert.equal(receipts.length, 1); assert.equal(receipts[0].excerpt.includes(late), false);
    const view = inspect(live.core);
    if (opening === policy) assert(view.view.messages[0].content.includes(late));
    else assert.equal(view, null);
    for (const ordinary of [detail, ok(live.core.list({ namespace })), ok(live.core.map({ namespace })),
      ok(live.core.sourceSnapshot({ readSet: [namespace] })),
      ok(live.core.fetch({ namespace, contextMode: 'source-evidence', refs: [{ memoryId: id, revision: detail.memory.revision }] })),
      ok(await live.core.recall({ readSet: [namespace], query: 'Willow', contextMode: 'source-evidence' }))]) {
      assert.equal(JSON.stringify(ordinary).includes(late), false);
    }
    const db = f.database();
    for (const table of ['memory_qualifications', 'qualification_anchors', 'qualified_claim_bindings', 'capture_events']) {
      assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
    }
    const store = openMemoryStore({ path: f.path }); f.workspace.defer(() => store.close());
    assert.deepEqual(store.scope({ ownerId: namespace.ownerId }).search('Willow'), []);
    observations.push({ request, receipts, content: detail.memory.content, catalog: result.sourceWindowCatalog });
  }
  assert.deepEqual(observations[0], observations[1]);
});

test('S2 canonical normalization, redaction and source snapshot survive caller mutation and Unicode cold reopen', async t => {
  const submitted = input({ messages: [{ id: 'unicode-source', role: 'assistant',
    content: `  Café  🌿\n\t${source} api_key=synthetic_redaction_canary; tentative only.  ${late}  ` }] });
  const expected = captureSnapshot(submitted, undefined, 'indexed-staged-v1').messages;
  const f = fixture(t, policy, { extract() { submitted.messages[0].content = 'Caller replacement'; return { items: [] }; } }), live = f.open();
  ok(await live.core.capture(submitted)); live.close();
  const evidence = inspect(f.open({}, null).core, submitted);
  assert.deepEqual(evidence.view.messages, expected);
  assert.equal(evidence.view.messages[0].content.includes('synthetic_redaction_canary'), false);
  assert(evidence.view.messages[0].content.includes('🌿'));
  assert(evidence.view.messages[0].content.includes(late));
  evidence.view.messages[0].content = 'Detached inspection mutation';
  assert.deepEqual(inspect(f.open({}, null).core, submitted).view.messages, expected);
});

test('S1/S2 invalid input, unchanged catalog limits and context refusal precede admission/staging/generation', async t => {
  const f = fixture(t), live = f.open();
  for (const patch of [{ causal: undefined }, { causal: { streamId: 'stream', sequence: 1 } },
    { messages: [{ id: 'bad', role: 'user', content: '\ud800' }] },
    { messages: [{ id: 'large', role: 'user', content: 'x'.repeat(4001) }] },
    { messages: Array.from({ length: 6 }, (_, i) => ({ id: `large-${i}`, role: 'user', content: 'x'.repeat(4000) })) },
    { messages: Array.from({ length: 25 }, (_, i) => ({ id: `many-${i}`, role: 'user', content: 'Source' })) }]) {
    error(await live.core.capture(input(patch)), 'invalid_input');
  }
  let causalReads = 0; const accessor = input(); Object.defineProperty(accessor, 'causal', { get() { causalReads++; return undefined; } });
  error(await live.core.capture(accessor), 'invalid_input'); assert.equal(causalReads, 0);
  assert.deepEqual(f.calls, []); assert.equal(inspect(live.core), null);
  const db = f.database(); assert.equal(db.prepare('SELECT count(*) n FROM admission_claims').get().n, 0);
  const unfit = fixture(t, policy, { model: { countTokens: () => 10000 } }), unfitLive = unfit.open();
  error(await unfitLive.core.capture(input()), 'context_budget_exceeded');
  assert.deepEqual(unfit.calls, []); assert.equal(inspect(unfitLive.core), null);
  assert.equal(unfit.database().prepare('SELECT count(*) n FROM admission_claims').get().n, 0);
});

test('S3 strict storage validation rejects accessors, forged format/limits and mismatched persisted payloads', async t => {
  const f = fixture(t), live = f.open(), db = f.database();
  const storage = createStagedEvidenceStorage({ db });
  const valid = () => structuredClone(canonicalSourceView(captureSnapshot(input(), undefined, 'indexed-staged-v1')));
  let reads = 0;
  for (const mutate of [view => Object.defineProperty(view, 'messages', { get() { reads++; return []; } }),
    view => Object.defineProperty(view.messages, '0', { get() { reads++; return {}; } }),
    view => Object.defineProperty(view.messages[0], 'content', { get() { reads++; return ''; } }),
    view => { view.format = 'prefix-messages-v1'; }, view => { view.messages[0].content = '\ud800'; },
    view => { view.retainedSourceWindow.maxUnitsPerMessage = 800; },
    view => { view.retainedSourceWindow.truncatedMessageIndices = [0]; },
    view => { view.messages[0].content = 'x'.repeat(4001); },
    view => { view.messages = Array.from({ length: 6 }, (_, i) => ({ id: `m-${i}`, role: 'user', content: 'x'.repeat(4000) })); }]) {
    const view = valid(); mutate(view);
    assert.throws(() => storage.serializeView(view), error => ['invalid_input', 'invalid_text'].includes(error.code));
  }
  const custom = valid(); Object.defineProperty(custom.messages, 'map', { get() { reads++; throw new Error('array map accessor'); } });
  Object.defineProperty(custom.messages, 'constructor', { get() { reads++; throw new Error('array species accessor'); } });
  Object.defineProperty(custom.retainedSourceWindow.truncatedMessageIndices, 'some', { get() { reads++; throw new Error('array some accessor'); } });
  Object.defineProperty(custom.retainedSourceWindow.truncatedMessageIndices, Symbol.iterator, { get() { reads++; throw new Error('array iterator accessor'); } });
  assert.equal(JSON.parse(storage.serializeView(custom).payload).format, 'canonical-messages-v1');
  assert.equal(reads, 0);
  assert.throws(() => storage.serializeView(valid(), true), { code: 'invalid_input' });
  ok(await live.core.capture(input()));
  db.prepare("UPDATE staged_capture_evidence SET payload_format='prefix-messages-v1'").run();
  error(live.core.inspectCaptureEvidence(key(input())), 'storage_error');
  db.prepare("UPDATE staged_capture_evidence SET payload_format='canonical-messages-v1',payload_bytes=payload_bytes+1").run();
  error(live.core.inspectCaptureEvidence(key(input())), 'storage_error');
});

test('S2 source claim/format writes are atomic on storage failure', async t => {
  const f = fixture(t), live = f.open(), db = f.database();
  db.exec("CREATE TRIGGER synthetic_stage_failure BEFORE UPDATE OF payload_format ON staged_capture_evidence BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  error(await live.core.capture(input()), 'storage_error');
  for (const table of ['admission_claims', 'staged_capture_evidence', 'staged_capture_clocks', 'memories']) {
    assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  }
  assert.deepEqual(f.calls, []);
});

test('S4 duplicate replay does not renew expiry; policy changes conflict and clock rollback cannot restore expiry', async t => {
  const originalNow = Date.now; let now = originalNow(); Date.now = () => now;
  t.after(() => { Date.now = originalNow; });
  const f = fixture(t), live = f.open(); ok(await live.core.capture(input()));
  const before = inspect(live.core); live.close(); now += 1000;
  const cold = f.open(policy);
  assert.equal(ok(await cold.core.capture(input())).duplicate, true);
  assert.deepEqual(inspect(cold.core), before); assert.deepEqual(f.calls, ['extract']);
  const legacy = f.open({ captureSourcePolicy: 'indexed-evidence-v1' });
  error(await legacy.core.capture(input()), 'event_payload_conflict');
  now = Date.parse(before.expiresAt); assert.equal(inspect(cold.core).state, 'expired');
  now -= 10000; assert.equal(inspect(cold.core).view, null);
  error(await cold.core.capture(input()), 'capture_evidence_closed'); assert.deepEqual(f.calls, ['extract']);
});

test('S3 old indexed events cannot be retrospectively staged under a different policy digest', async t => {
  const f = fixture(t, { captureSourcePolicy: 'indexed-evidence-v1' }), live = f.open();
  ok(await live.core.capture(input()));
  const staged = f.open(policy); error(await staged.core.capture(input()), 'event_payload_conflict');
  assert.equal(inspect(staged.core), null); assert.deepEqual(f.calls, ['extract']);
  assert.notEqual(captureSnapshot(input(), undefined, 'indexed-evidence-v1').payloadDigest,
    captureSnapshot(input(), undefined, 'indexed-staged-v1').payloadDigest);
});

test('S1/S2 actual planner and extractor retain the same whole-message windows and output bounds', async t => {
  const planned = [];
  const messages = Array.from({ length: 30 }, (_, i) => ({ id: `planned-${i}`, role: i % 2 ? 'assistant' : 'user',
    content: `Distinct source ${i}: tentative workshop note.` }));
  for (const opening of [{ captureSourcePolicy: 'indexed-evidence-v1' }, policy]) {
    const f = fixture(t, opening), live = f.open();
    planned.push(ok(live.core.planCaptureBatches({ messages })));
    assert.deepEqual(f.calls, []);
    assert.equal(inspect(live.core), null);
  }
  assert.deepEqual(planned[0], planned[1]);
  assert.deepEqual(planned[1].batches.flat(), messages.map((_, i) => i));
  for (const items of [[...Array.from({ length: 6 }, () => proposal)],
    [{ ...proposal, sourceIndices: [0, 1, 2, 3, 4] }]]) {
    const f = fixture(t, policy, { extract: () => ({ items }) }), live = f.open();
    error(await live.core.capture(input({ messages: [{ id: 'five-windows', role: 'user', content: 'z'.repeat(4000) }] })), 'invalid_model_output');
    assert.equal(inspect(live.core).state, 'failed');
    assert.equal(f.database().prepare('SELECT count(*) n FROM memories').get().n, 0);
    assert.deepEqual(f.calls, ['extract']);
  }
});

test('S4 quotas reject before generation without evicting prior payloads; discard frees exact namespace capacity', async t => {
  const f = fixture(t), live = f.open();
  for (let i = 0; i < 64; i++) ok(await live.core.capture(input({ eventId: `quota-${i}` })));
  const overflow = input({ eventId: 'overflow' }); error(await live.core.capture(overflow), 'capture_evidence_capacity');
  assert.equal(inspect(live.core, overflow), null); assert.equal(f.calls.length, 64);
  assert(inspect(live.core, input({ eventId: 'quota-0' })).view.messages[0].content.includes(late));
  ok(live.core.discardCaptureEvidence(key(input({ eventId: 'quota-0' }))));
  ok(await live.core.capture(overflow)); assert.equal(f.calls.length, 65);
  const bytes = fixture(t), bytesLive = bytes.open();
  const messages = Array.from({ length: 5 }, (_, i) => ({ id: `unicode-${i}`, role: 'user', content: '界'.repeat(4000) }));
  let count = 0;
  while (true) {
    const value = input({ eventId: `bytes-${count}`, messages }), result = await bytesLive.core.capture(value);
    if (!result.ok) { error(result, 'capture_evidence_capacity'); assert.equal(inspect(bytesLive.core, value), null); break; }
    count++; assert(count <= 64);
  }
  const db = bytes.database(), usage = db.prepare('SELECT count(*) n,sum(payload_bytes) bytes FROM staged_capture_evidence WHERE payload IS NOT NULL').get();
  const payloadBytes = db.prepare('SELECT payload_bytes bytes FROM staged_capture_evidence LIMIT 1').get().bytes;
  assert.equal(usage.n, count); assert(usage.bytes <= 1024 * 1024); assert(usage.bytes + payloadBytes > 1024 * 1024);
  assert.equal(bytes.calls.length, count);
});

test('S4 event quota counts escaped UTF-8 payload bytes and refuses atomically without truncation', async t => {
  const messages = Array.from({ length: 24 }, (_, i) => ({ id: '界'.repeat(197) + String(i).padStart(2, '0'),
    role: 'user', content: '\u0001'.repeat(i === 23 ? 841 : 833) }));
  const submitted = input({ messages }), snapshot = captureSnapshot(submitted, undefined, 'indexed-staged-v1');
  const view = canonicalSourceView(snapshot);
  assert.equal(snapshot.messages.reduce((n, row) => n + row.content.length, 0), 20000);
  assert(Buffer.byteLength(JSON.stringify(view), 'utf8') > 128 * 1024);
  const f = fixture(t), live = f.open();
  error(await live.core.capture(submitted), 'capture_evidence_capacity');
  assert.deepEqual(f.calls, []); assert.equal(inspect(live.core, submitted), null);
  assert.equal(f.database().prepare('SELECT count(*) n FROM admission_claims').get().n, 0);
});

for (const action of ['discard', 'forget', 'correct']) test(`S5 pending ${action} fences late admission and preserves foreign namespaces`, async t => {
  let start, release;
  const ready = new Promise(resolve => { start = resolve; }), pending = new Promise(resolve => { release = resolve; });
  t.after(() => release({ items: [proposal] }));
  const f = fixture(t, policy, { extract() { start(); return pending; } }), live = f.open();
  const target = admit(live.core), foreign = { ...namespace, scope: 'project', projectId: 'foreign-project' };
  const other = f.open(policy, { ...f.model, extract: () => ({ items: [] }) });
  ok(await other.core.capture(input({ namespace: foreign })));
  const capture = live.core.capture(input()); await ready;
  const cold = f.open({}, null);
  assert.equal(inspect(cold.core, input({ namespace: foreign })).view.messages[0].content.includes(late), true);
  assert.equal(inspect(cold.core, input({ namespace: { ...namespace, ownerId: 'different-owner' } })), null);
  if (action === 'discard') ok(cold.core.discardCaptureEvidence(key(input())));
  else if (action === 'forget') ok(cold.core.forget({ namespace, memoryId: target.id, expectedRevision: target.revision }));
  else ok(cold.core.correct({ namespace, memoryId: target.id, expectedRevision: target.revision,
    content: 'Explicit corrected target', kind: 'fact', receipt: receipt('Explicit corrected target') }));
  release({ items: [proposal] }); error(await capture, 'capture_evidence_closed');
  assert.equal(inspect(cold.core).view, null);
  assert.equal(inspect(cold.core).state, action === 'discard' ? 'discarded' : 'forgotten');
  assert(inspect(cold.core, input({ namespace: foreign })).view.messages[0].content.includes(late));
  error(await live.core.capture(input()), 'capture_evidence_closed');
  assert.deepEqual(f.calls, ['extract']);
});
