import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { fingerprint } from '../validation.mjs';
import { eventTimeSafetyFixture } from '../testing/receipt-event-time-fixture.mjs';
import { safetyFixture, ns, ok } from '../testing/content-safety-s2h-fixture.mjs';
import { options, interpretation } from '../testing/episode-capture-helpers.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';

const source = { client: 'synthetic', sessionId: 'synthetic-1', eventId: 'm1',
  role: 'user', excerpt: 'Synthetic source text one.' };
const clean = { ...source, eventId: 'm2', excerpt: 'Synthetic source text two.' };
const denied = result => assert.deepEqual(result, { ok: false,
  error: { code: 'source_excluded', retryable: false } });
const receiptTokens = receipt => ['rs1:i:' + createHash('sha256').update(JSON.stringify(receipt)).digest('hex'),
  'rs1:a:' + createHash('sha256').update(JSON.stringify(['receipt-source-address-v1',
    receipt.client, receipt.sessionId, receipt.eventId, receipt.role])).digest('hex')];
const tokenSql = /json_each\(\?\).*CROSS JOIN suppressed s/s;

async function fixture(t, shape) {
  const f = shape === 'hosted-53' ? eventTimeSafetyFixture(t, 33) : safetyFixture(t, 18);
  if (shape === 'hosted-53') await f.migrate();
  const db = f.connect(); f.workspace.defer(() => db.close());
  const plan = { content: 'Synthetic fact one', seen: [], counter: null, extracting: null, interpreting: null };
  const model = { ...rationaleModel(), countTokens: () => { plan.counter?.(); return 1; },
    extract: ({ input }) => {
      plan.seen.push(structuredClone(input.messages)); plan.extracting?.();
      return { items: input.messages.map((message, index) => ({ content: message.content === source.excerpt
        ? plan.content : 'Synthetic independent fact', kind: 'fact', confidence: .9, sourceIndices: [index] })) };
    },
    interpretEpisode: request => { plan.interpreting?.(); return interpretation(request, plan.type ?? 'work'); },
  };
  const open = episode => {
    const core = openMemoryCore({ path: f.path, model, ...(episode ? options : {}) });
    f.workspace.defer(() => core.close()); return core;
  };
  const core = open(false), episode = open(true);
  const send = (mode, eventId, receipts = [source], namespace = ns, extra = {}) => (mode ? episode : core).capture({
    namespace, client: source.client, sessionId: source.sessionId, eventId,
    messages: receipts.map(r => ({ id: r.eventId, role: r.role, content: r.excerpt })),
    ...(mode ? { episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' } } : {}), ...extra,
  });
  const admit = (receipt, content = 'Synthetic reworded fact', namespace = ns, receiver = core) => receiver.admit({
    namespace, memory: { content, kind: 'fact' }, receipts: [receipt],
  });
  const forget = memory => ok(core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  const hash = () => 's1:' + createHmac('sha256', Buffer.from(db.prepare(
    'SELECT secret FROM episode_identity WHERE singleton=1').get().secret, 'hex'))
    .update(JSON.stringify(['episode-v1', ns.ownerId, ns.scope, ns.projectId, source.client, source.sessionId])).digest('hex');
  const seed = (receipt, namespace = ns, tokens = receiptTokens(receipt)) => {
    for (const token of tokens) db.prepare('INSERT OR IGNORE INTO suppressed VALUES(?,?,?,?)')
      .run(namespace.ownerId, namespace.scope, namespace.projectId || '', token);
  };
  return { ...f, db, plan, core, episode, model, send, admit, forget, hash, seed };
}

for (const shape of ['hosted-53', 'legacy-18']) {
  for (const from of [false, true]) test(`${shape}: cross-mode filter ${Number(from)} to ${Number(!from)} preserves an independent message`, async t => {
    const f = await fixture(t, shape);
    const first = ok(await f.send(from, 'batch-1')).admission.memories[0];
    f.forget(first); f.plan.content = 'Synthetic reworded fact'; f.plan.seen = [];
    const result = await f.send(!from, 'batch-2');
    const { indexRevision } = ok(f.core.map({ namespace: ns }));
    assert.deepEqual(ok(result).admission, { ...(!from ? { status: 'completed' } : {}),
      memories: [], suppressedCount: 1, indexRevision });
    assert.equal(f.plan.seen.length, 0, 'forgotten message never reaches extraction');
    const independent = ok(await f.send(!from, 'batch-3', [clean]));
    assert.equal(independent.admission.memories.length, 1);
    assert.equal(f.plan.seen.length, 1);
    if (f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='raw_conversations'").get())
      assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations').get().n, 0);
  });

  for (const tokenIndex of [0, 1]) test(`${shape}: pre-fix literal token ${tokenIndex} refuses Episode admission with registration alias`, async t => {
    const f = await fixture(t, shape);
    f.seed(source, ns, [receiptTokens(source)[tokenIndex]]);
    let result;
    // Real registration precedes interpretation; direct admission exercises the final gate
    // independently of the capture filter using only identity already known on this path.
    f.plan.interpreting = () => { result = f.admit({ ...source, sessionId: f.hash() }, undefined, ns, f.episode); };
    await f.send(true, 'batch-1', [clean]);
    assert.ok(result, 'real Episode registration and interpretation were reached'); denied(result);
  });

  for (const tokenIndex of [0, 1]) test(`${shape}: pre-fix hashed token ${tokenIndex} refuses ordinary admission`, async t => {
    const f = await fixture(t, shape), hashed = { ...source, sessionId: f.hash() };
    f.seed(hashed, ns, [receiptTokens(hashed)[tokenIndex]]);
    denied(f.admit(source)); ok(f.admit(clean));
  });

  for (const field of ['ownerId', 'scope', 'projectId']) test(`${shape}: other namespace ${field} token never refuses capture or admission`, async t => {
    const f = await fixture(t, shape);
    const other = field === 'scope' ? { ...ns, scope: 'personal', projectId: null } : { ...ns, [field]: 'synthetic-other' };
    f.seed(source, other); f.seed({ ...source, sessionId: f.hash() }, other);
    ok(f.admit(source)); assert.equal(ok(await f.send(false, 'batch-1')).admission.memories.length, 1);
    assert.equal(ok(await f.send(true, 'batch-2', [clean])).admission.memories.length, 1);
  });

  test(`${shape}: admission token lookup error refuses and rolls back`, async t => {
    const f = await fixture(t, shape), prepare = DatabaseSync.prototype.prepare;
    const before = f.db.prepare('SELECT count(*) n FROM memories').get().n;
    let injected = 0;
    DatabaseSync.prototype.prepare = function(sql) {
      if (tokenSql.test(sql)) { injected++; throw Object.assign(new Error('synthetic lookup failure'), { code: 'ERR_SQLITE_ERROR' }); }
      return Reflect.apply(prepare, this, [sql]);
    };
    let result;
    try { result = f.admit(source); } finally { DatabaseSync.prototype.prepare = prepare; }
    assert.equal(injected, 1); assert.equal(result.ok, false); assert.equal(result.error.code, 'storage_error');
    assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n, before);
    assert.equal(f.db.prepare('SELECT count(*) n FROM receipts').get().n, 0);
    ok(f.admit(clean));
  });

  test(`${shape}: forget between filter and extraction dispatch makes zero extract calls`, async t => {
    const f = await fixture(t, shape), first = ok(f.admit(source, 'Synthetic fact one')).memory;
    let counters = 0, forgotten = false;
    f.plan.counter = () => { if (++counters === 2) { f.forget(first); forgotten = true; } };
    const result = await f.send(false, 'batch-2');
    assert.equal(forgotten, true); assert.equal(f.plan.seen.length, 0, 'no forgotten text dispatch');
    assert.equal(result.ok, false);
    assert.equal(result.error.code, shape === 'legacy-18' ? 'source_excluded' : 'evidence_unavailable');
  });

  test(`${shape}: ordered capture after forget drops the source and admits a new message`, async t => {
    const f = await fixture(t, shape), first = ok(await f.send(false, 'batch-1')).admission.memories[0];
    f.forget(first); f.plan.content = 'Synthetic reworded fact'; f.plan.seen = [];
    const { indexRevision } = ok(f.core.map({ namespace: ns }));
    const empty = ok(await f.send(false, 'batch-2', [source], ns, { causal: { streamId: 'synthetic-stream', sequence: 1 } }));
    assert.deepEqual(empty.admission, { memories: [], suppressedCount: 1, indexRevision });
    assert.deepEqual(empty.reconciliation, { status: 'complete_no_change', reason: null, retiredCount: 0 });
    assert.equal(f.plan.seen.length, 0);
    const result = ok(await f.send(false, 'batch-3', [clean], ns, { causal: { streamId: 'synthetic-stream', sequence: 2 } }));
    assert.equal(result.admission.memories.length, 1);
  });

  test(`${shape}: procedural finish after forget refuses and rolls back`, async t => {
    const f = await fixture(t, shape), first = ok(f.admit(source, 'Synthetic fact one')).memory;
    f.forget(first);
    const runtime = createMemoryRuntime({ path: f.path }); f.workspace.defer(() => runtime.close());
    const key = { client: source.client, eventId: 'batch-2', payloadDigest: 'c'.repeat(64) };
    const { token } = runtime.claimAdmission(ns, { ...key, leaseMs: 125000 });
    const content = 'Synthetic instruction';
    assert.throws(() => runtime.finishCapturedAdmission(ns, { ...key, token, items: [{ content, kind: 'instruction',
      origin: 'agent-inferred', confidence: .9, fingerprint: fingerprint(content), conflictHints: [], receipts: [source],
      procedural: { anchors: [{ receiptIndex: 0, start: 0, end: source.excerpt.length }] },
    }] }), error => error.code === 'source_excluded');
    assert.equal(f.db.prepare('SELECT count(*) n FROM memories WHERE deleted=0').get().n, 0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM receipts').get().n, 0);
  });

  test(`${shape}: Episode keep after forget cannot dispatch the forgotten source`, async t => {
    const f = await fixture(t, shape); f.plan.type = 'quick-one-off-question';
    const first = ok(await f.send(true, 'batch-1'));
    const memory = ok(f.admit({ ...source, sessionId: f.hash() }, 'Synthetic fact one')).memory;
    f.forget(memory); f.plan.seen = []; f.plan.content = 'Synthetic reworded fact';
    const detail = ok(f.episode.getEpisode({ namespace: ns, episodeId: first.episode.id }));
    const result = await f.episode.keepEpisode({ namespace: ns, episodeId: first.episode.id,
      expectedRevision: detail.episode.revision, actionId: 'synthetic-keep' });
    const { indexRevision } = ok(f.core.map({ namespace: ns }));
    assert.deepEqual(ok(result).admission, { status: 'completed', memories: [], suppressedCount: 1, indexRevision });
    assert.equal(f.plan.seen.length, 0);
  });
}
