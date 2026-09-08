import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';

// Synthetic adapters exercise control and evidence contracts, not model quality.
const namespace = { ownerId: 'capture-tests', scope: 'personal', projectId: null };
const input = (patch = {}) => ({ namespace: { ...namespace }, client: 'synthetic',
  eventId: 'capture-event', sessionId: 'session',
  messages: [{ id: 'message-0', role: 'user', content: 'Prefer concise examples.' }], ...patch });
const item = (patch = {}) => ({ content: 'Prefer concise examples.', kind: 'preference',
  confidence: 0.7, sourceIndices: [0], ...patch });
const placement = ({ input }) => ({ items: input.memories.map((m) => ({ memoryId: m.id,
  parentIds: [], newL1: { title: 'Examples', parentL2Ids: [] } })) });
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const error = (r, code) => assert.deepEqual(r, { ok: false, error: { code, retryable: false } });
const digest = (v) => createHash('sha256').update(JSON.stringify(['cairn.capture.v1',
  [v.namespace.ownerId, v.namespace.scope, v.namespace.projectId], v.client, v.eventId,
  v.sessionId, v.messages.map((m) => [m.id, m.role, m.content])])).digest('hex');
const key = (v) => ({ namespace: v.namespace, client: v.client, eventId: v.eventId, payloadDigest: digest(v) });
const get = (core, id) => ok(core.get({ namespace, memoryId: id }));
function fixture(t, options = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-capture-')), 'memory.sqlite');
  const calls = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract: async () => ({ items: [item()] }), classify: placement, ...options };
  for (const method of ['extract', 'classify']) {
    const adapter = model[method];
    if (typeof adapter === 'function') model[method] = async (request) => {
      calls.push({ method, ...structuredClone({ system: request.system, input: request.input,
        maxOutputTokens: request.maxOutputTokens }), signal: request.signal });
      return adapter(request);
    };
  }
  const core = openMemoryCore({ path, model });
  const db = new DatabaseSync(path);
  t.after(() => { core.close(); db.close(); });
  return { core, db, model, calls, path };
}
function second(t, path, model) {
  const core = openMemoryCore({ path, ...(model ? { model } : {}) });
  t.after(() => core.close());
  return core;
}
const counts = (db) => ['memories', 'receipts', 'admission_claims'].map((table) =>
  db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n);

test('C01: capture commits inferred evidence and returns actual filing revisions', async (t) => {
  const { core, db, calls } = fixture(t);
  const result = ok(await core.capture(input()));
  assert.equal(result.duplicate, false);
  assert.deepEqual(Object.keys(result).sort(), ['admission', 'classification', 'duplicate']);
  assert.deepEqual(Object.keys(result.admission).sort(), ['indexRevision', 'memories', 'suppressedCount']);
  assert.equal(result.admission.memories.length, 1);
  const admitted = result.admission.memories[0];
  const detail = get(core, admitted.id);
  assert.equal(detail.memory.origin, 'agent-inferred');
  assert.equal(detail.memory.confidence, 0.7);
  assert.equal(detail.memory.content, item().content);
  assert.equal(detail.memory.filing.status, 'filed');
  assert.deepEqual(detail.receipts.map(({ client, sessionId, eventId, role, excerpt }) =>
    ({ client, sessionId, eventId, role, excerpt })), [{ client: 'synthetic', sessionId: 'session',
    eventId: 'message-0', role: 'user', excerpt: input().messages[0].content }]);
  assert.ok(detail.memory.revision > admitted.revision);
  assert.deepEqual(result.classification, { status: 'applied',
    memoryRevisions: [{ memoryId: admitted.id, revision: detail.memory.revision }],
    indexRevision: ok(core.map({ namespace })).indexRevision });
  assert.deepEqual(calls.map((c) => c.method), ['extract', 'classify']);
  assert.deepEqual(calls[0].input, { messages: [{ index: 0, role: 'user', content: input().messages[0].content }] });
  assert.equal(calls[1].input.memories[0].id, admitted.id);
  assert.equal(calls[1].input.memories[0].revision, admitted.revision);
  assert.equal(calls[0].maxOutputTokens, 1024);
  assert.ok(calls[0].signal instanceof AbortSignal);
  assert.match(calls[0].system, /untrusted/i);
  assert.equal(db.prepare('SELECT payload_digest FROM admission_claims').get().payload_digest, digest(input()));
});

test('C02: source selection and adapter mutation cannot rewrite trusted receipts', async (t) => {
  const v = input({ messages: Array.from({ length: 4 }, (_, i) => ({ id: `source-${i}`,
    role: i % 2 ? 'assistant' : 'user', content: `Synthetic message ${i}.` })) });
  const { core } = fixture(t, { extract: ({ input: evidence }) => {
    evidence.messages[0].content = 'Fabricated evidence';
    evidence.messages[1].role = 'user';
    v.messages[0].id = 'caller-mutated';
    return { items: [item({ sourceIndices: [3, 2, 1, 0] })] };
  } });
  const result = ok(await core.capture(v));
  const receipts = get(core, result.admission.memories[0].id).receipts;
  assert.deepEqual(receipts.map((r) => [r.eventId, r.role, r.excerpt]).sort(), [
    ['source-0', 'user', 'Synthetic message 0.'], ['source-1', 'assistant', 'Synthetic message 1.'],
    ['source-2', 'user', 'Synthetic message 2.'], ['source-3', 'assistant', 'Synthetic message 3.']]);
});

test('C03: zero extraction and fully suppressed extraction finish with replayable empty outcomes', async (t) => {
  for (const suppressed of [false, true]) {
    const { core, calls } = fixture(t, { extract: () => ({ items: suppressed ? [item()] : [] }) });
    if (suppressed) {
      const admitted = ok(core.admit({ namespace, memory: { content: item().content, kind: 'fact' },
        receipts: [{ client: 'test', sessionId: 's', eventId: 'e', role: 'user', excerpt: 'Synthetic evidence.' }] }));
      ok(core.forget({ namespace, memoryId: admitted.memory.id, expectedRevision: admitted.memory.revision }));
    }
    const result = ok(await core.capture(input()));
    assert.deepEqual(result.admission.memories, []);
    assert.equal(result.admission.suppressedCount, Number(suppressed));
    assert.deepEqual(result.classification, { status: 'skipped', reason: 'empty' });
    assert.deepEqual(ok(await core.capture(input())), { duplicate: true, memoryIds: [], suppressedCount: Number(suppressed) });
    assert.deepEqual(calls.map((c) => c.method), ['extract']);
  }
});

test('C04–C06: whole extraction rejects forged authority and malformed or oversized members', async (t) => {
  const badItems = [
    ...[[], [0, 0], [-1], [1], [0.5], ['0'], [null], [NaN], [Infinity], Array(1),
      [0, 1, 2, 3, 4]].map((sourceIndices) => item({ sourceIndices })),
    ...['receipts', 'namespace', 'origin', 'id', 'conflicts'].map((field) => item({ [field]: 'forged' })),
    ...[undefined, NaN, Infinity, -0.1, 1.1, '0.7'].map((confidence) => item({ confidence })),
    item({ kind: 'invented' }), item({ content: 'x'.repeat(601) }), item({ content: ' ' }),
  ];
  const outputs = badItems.map((bad) => ({ items: [item(), bad] })).concat([
    { items: Array(1) }, { items: Array(6).fill(item()) }, { items: [], namespace: 'forged' },
    { items: [item()], receipts: [] }, null, {},
  ]);
  for (const output of outputs) {
    const { core, db, calls } = fixture(t, { extract: () => output });
    error(await core.capture(input()), 'invalid_model_output');
    assert.equal(counts(db)[0], 0);
    assert.equal(counts(db)[1], 0);
    assert.equal(calls.length, 1);
    assert.equal(typeof ok(core.claimAdmission({ ...key(input()), leaseMs: 125000 })).token, 'string');
  }
});

test('C06: input bounds and allowlists reject before creating a claim or calling a model', async (t) => {
  const { core, db, calls } = fixture(t);
  const message = input().messages[0];
  const invalid = [
    { messages: [] }, { messages: Array(1) }, { messages: Array.from({ length: 25 }, (_, i) => ({ ...message, id: `m-${i}` })) },
    { messages: [{ ...message, content: 'x'.repeat(4001) }] },
    { messages: Array.from({ length: 6 }, (_, i) => ({ ...message, id: `m-${i}`, content: 'x'.repeat(3500) })) },
    { messages: [message, message] }, { messages: [{ ...message, role: 'system' }] },
    { messages: [{ ...message, path: '/synthetic/path' }] }, { leaseMs: 1 }, { extra: true },
    { namespace: { ...namespace, extra: true } }, { messages: [{ ...message, content: '' }] },
  ];
  for (const patch of invalid) error(await core.capture(input(patch)), 'invalid_input');
  assert.deepEqual(counts(db), [0, 0, 0]);
  assert.equal(calls.length, 0);
});

test('C06: exact accepted limits retain all messages, five items and four sources', async (t) => {
  const { core, calls } = fixture(t, { extract: () => ({ items: Array.from({ length: 5 }, (_, i) =>
    item({ content: `${i}` + 'x'.repeat(599), sourceIndices: [0, 1, 2, 3] })) }) });
  const messages = Array.from({ length: 24 }, (_, i) => ({ id: `m-${i}`, role: 'user',
    content: 'x'.repeat(i < 4 ? 4000 : 200) }));
  assert.equal(messages.reduce((sum, m) => sum + m.content.length, 0), 20000);
  const result = ok(await core.capture(input({ messages })));
  assert.equal(calls[0].input.messages.length, 24);
  assert.equal(result.admission.memories.length, 5);
  for (const m of result.admission.memories) assert.equal(get(core, m.id).receipts.length, 4);
  const over = fixture(t, { extract: () => ({ items: [item({ sourceIndices: [0, 1, 2, 3, 4] })] }) });
  error(await over.core.capture(input({ messages })), 'invalid_model_output');
  assert.equal(counts(over.db)[0], 0);
});

test('C06: token counting and adapters run outside SQLite write transactions', async (t) => {
  let probe;
  let counters = 0;
  const assertWritable = () => { probe.exec('BEGIN IMMEDIATE'); probe.exec('ROLLBACK'); };
  const { core, path } = fixture(t, { countTokens: () => { counters++; assertWritable(); return 1; },
    extract: () => { assertWritable(); return { items: [item()] }; },
    classify: (request) => { assertWritable(); return placement(request); } });
  probe = new DatabaseSync(path);
  t.after(() => probe.close());
  assert.equal(ok(await core.capture(input())).classification.status, 'applied');
  assert.ok(counters >= 4);
});

test('C06/C10: bounded model errors abandon a fresh claim so a valid retry succeeds', async (t) => {
  for (const [options, code] of [
    [{ extract: undefined }, 'model_not_configured'],
    [{ countTokens: undefined }, 'token_count_unavailable'],
    [{ countTokens: () => NaN }, 'token_count_unavailable'],
    [{ contextWindow: 8191 }, 'context_budget_exceeded'],
    [{ countTokens: () => 6001 }, 'context_budget_exceeded'],
    [{ countTokens: (s) => s.includes('maxOutputTokens') ? 1 : 1025 }, 'invalid_model_output'],
    [{ extract: () => { throw new Error('synthetic adapter failure'); } }, 'extraction_failed'],
    [{ extract: () => { throw Object.assign(new Error(), { code: 'model_timeout' }); } }, 'model_timeout'],
    [{ extract: () => { throw Object.assign(new Error(), { name: 'AbortError' }); } }, 'model_cancelled'],
  ]) {
    const { core, db, path } = fixture(t, options);
    error(await core.capture(input()), code);
    assert.equal(counts(db)[0], 0);
    const retry = second(t, path, { contextWindow: 8192, countTokens: () => 1,
      extract: () => ({ items: [] }) });
    assert.deepEqual(ok(await retry.capture(input())).classification, { status: 'skipped', reason: 'empty' });
  }
});

test('C07: digest uses fixed field order and binds every identity, message field and ordering', async (t) => {
  const { core, db } = fixture(t, { extract: () => ({ items: [] }) });
  const v = input({ messages: [...input().messages, { id: 'message-1', role: 'assistant', content: 'Second synthetic message.' }] });
  ok(await core.capture(v));
  const reordered = { messages: v.messages.map(({ id, role, content }) => ({ content, role, id })),
    sessionId: v.sessionId, eventId: v.eventId, client: v.client,
    namespace: { projectId: null, scope: 'personal', ownerId: namespace.ownerId } };
  assert.equal(ok(await core.capture(reordered)).duplicate, true);
  assert.equal(db.prepare('SELECT payload_digest FROM admission_claims').get().payload_digest, digest(v));
  const variants = [
    { namespace: { ...namespace, ownerId: 'other-owner' } },
    { namespace: { ...namespace, scope: 'project', projectId: 'project' } },
    { client: 'other-client' }, { eventId: 'other-event' }, { sessionId: 'other-session' },
    { messages: [...v.messages].reverse() },
    ...['id', 'role', 'content'].map((field) => ({ messages: [{ ...v.messages[0],
      [field]: field === 'role' ? 'assistant' : `changed-${field}` }, v.messages[1]] })),
  ];
  for (const patch of variants) {
    const changed = { ...v, ...patch };
    assert.notEqual(digest(changed), digest(v));
    const sameKey = changed.client === v.client && changed.eventId === v.eventId &&
      JSON.stringify(changed.namespace) === JSON.stringify(v.namespace);
    if (sameKey) error(await core.capture(changed), 'event_payload_conflict');
    else {
      ok(await core.capture(changed));
      assert.ok(db.prepare('SELECT 1 FROM admission_claims WHERE payload_digest = ?').get(digest(changed)));
    }
  }
});

test('C08: normalization and redaction precede hashing and receipt truncation preserves Unicode', async (t) => {
  const secret = 'sk-' + 'a'.repeat(48);
  const v = input({ messages: [{ id: 'message-0', role: 'user', content: `  Ａ token ${secret} stays secret.  ` },
    { id: 'long', role: 'assistant', content: 'z'.repeat(799) + '😀tail' }] });
  const { core, db, calls } = fixture(t, { extract: () => ({ items: [item({ sourceIndices: [0, 1] })] }) });
  const result = ok(await core.capture(v));
  const clean = calls[0].input.messages;
  assert.ok(!JSON.stringify(calls).includes(secret));
  assert.match(clean[0].content, /^A token /);
  assert.equal(clean[1].content, v.messages[1].content);
  const trusted = { ...v, messages: v.messages.map((m, i) => ({ ...m, content: clean[i].content })) };
  assert.equal(db.prepare('SELECT payload_digest FROM admission_claims').get().payload_digest, digest(trusted));
  const receipts = get(core, result.admission.memories[0].id).receipts;
  assert.equal(receipts.find((r) => r.eventId === 'long').excerpt, 'z'.repeat(799));
  const changed = structuredClone(v); changed.messages[1].content += ' changed past receipt boundary';
  error(await core.capture(changed), 'event_payload_conflict');
  const equivalent = structuredClone(v); equivalent.messages[0].content = equivalent.messages[0].content.replace('a'.repeat(48), 'b'.repeat(48));
  assert.equal(ok(await core.capture(equivalent)).duplicate, true);
});

test('C09: processing/completed claims work without model or counter and preserve stored outcomes', async (t) => {
  const { core, path } = fixture(t);
  const token = ok(core.claimAdmission({ ...key(input()), leaseMs: 125000 })).token;
  const bare = second(t, path);
  assert.deepEqual(ok(await bare.capture(input())), { processing: true });
  ok(core.finishAdmission({ ...key(input()), token, items: [] }));
  assert.deepEqual(ok(await bare.capture(input())), { duplicate: true, memoryIds: [], suppressedCount: 0 });
  const completed = ok(await core.capture(input({ eventId: 'nonempty' })));
  const id = completed.admission.memories[0].id;
  ok(core.forget({ namespace, memoryId: id, expectedRevision: get(core, id).memory.revision }));
  assert.deepEqual(ok(await bare.capture(input({ eventId: 'nonempty' }))),
    { duplicate: true, memoryIds: [id], suppressedCount: 0 });
});

test('C11: expired owner cannot finish or abandon a successor while extraction is pending', async (t) => {
  let release;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const { core, db, path, calls } = fixture(t, { extract: () => new Promise((resolve) => {
    release = resolve; started();
  }) });
  const beforeClaim = Date.now();
  const pending = core.capture(input());
  await ready;
  const old = db.prepare('SELECT token, lease_expires_at FROM admission_claims').get();
  assert.ok(old.lease_expires_at >= beforeClaim + 125000);
  assert.ok(old.lease_expires_at <= Date.now() + 125000);
  db.exec('UPDATE admission_claims SET lease_expires_at = 0');
  const successor = second(t, path);
  const token = ok(successor.claimAdmission({ ...key(input()), leaseMs: 125000 })).token;
  assert.notEqual(token, old.token);
  release({ items: [item()] });
  error(await pending, 'stale_admission');
  assert.equal(db.prepare('SELECT token FROM admission_claims').get().token, token);
  assert.equal(counts(db)[0], 0);
  assert.deepEqual(calls.map((c) => c.method), ['extract']);
  ok(successor.finishAdmission({ ...key(input()), token, items: [] }));
});

test('C10: the extraction deadline aborts a stalled adapter and abandons its claim', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started;
  let signal;
  const ready = new Promise((resolve) => { started = resolve; });
  const { core, db } = fixture(t, { extract: (request) => {
    signal = request.signal; started(); return new Promise(() => {});
  } });
  const pending = core.capture(input());
  await ready;
  t.mock.timers.tick(29999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  error(await pending, 'model_timeout');
  assert.equal(signal.aborted, true);
  assert.equal(counts(db)[0], 0);
  assert.equal(typeof ok(core.claimAdmission({ ...key(input()), leaseMs: 125000 })).token, 'string');
});

test('C12: missing/failing classification preserves successful admission and replay does not retry', async (t) => {
  for (const [classify, code] of [[undefined, 'model_not_configured'],
    [() => { throw new Error('synthetic classifier failure'); }, 'classification_failed']]) {
    const { core, calls } = fixture(t, { classify });
    const result = ok(await core.capture(input()));
    assert.deepEqual(result.classification, { status: 'failed', error: { code, retryable: false } });
    const id = result.admission.memories[0].id;
    assert.equal(get(core, id).memory.filing.status, 'unfiled');
    const before = calls.length;
    assert.deepEqual(ok(await core.capture(input())), { duplicate: true, memoryIds: [id], suppressedCount: 0 });
    assert.equal(calls.length, before);
  }
});

test('C12: another connection can correct/forget during classification without stale filing or resurrection', async (t) => {
  for (const action of ['correct', 'forget']) {
    let other;
    let id;
    const { core, path } = fixture(t, { classify: (request) => {
      const m = request.input.memories[0]; id = m.id;
      if (action === 'forget') ok(other.forget({ namespace, memoryId: id, expectedRevision: m.revision }));
      else ok(other.correct({ namespace, memoryId: id, expectedRevision: m.revision,
        content: 'Replacement synthetic preference.', kind: 'preference', receipt: {
          client: 'other', sessionId: 's', eventId: 'correction', role: 'user', excerpt: 'Replacement evidence.' } }));
      return placement(request);
    } });
    other = second(t, path);
    const result = ok(await core.capture(input()));
    assert.equal(result.admission.memories[0].id, id);
    // Existing placement freshness checks the namespace epoch before memory revisions.
    assert.deepEqual(result.classification, { status: 'failed', error: { code: 'index_revision_conflict', retryable: false } });
    if (action === 'forget') assert.equal(core.get({ namespace, memoryId: id }).ok, false);
    else { assert.equal(get(core, id).memory.content, 'Replacement synthetic preference.');
      assert.equal(get(core, id).memory.filing.status, 'unfiled'); }
  }
});

test('C13: exact admission no-op preserves filing and skips classifier', async (t) => {
  const { core, calls } = fixture(t);
  const first = ok(await core.capture(input()));
  const id = first.admission.memories[0].id;
  const before = get(core, id);
  const map = ok(core.map({ namespace }));
  const result = ok(await core.capture(input({ eventId: 'new-capture-same-evidence' })));
  assert.deepEqual(result.classification, { status: 'skipped', reason: 'already_filed' });
  assert.deepEqual(result.admission.memories, [{ id, revision: before.memory.revision }]);
  assert.deepEqual(get(core, id), before);
  assert.deepEqual(ok(core.map({ namespace })), map);
  assert.deepEqual(calls.map((c) => c.method), ['extract', 'classify', 'extract']);
});
