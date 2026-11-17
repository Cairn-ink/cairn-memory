import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore, openMemoryStore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { fingerprint } from '../validation.mjs';
import { eventTimeSafetyFixture } from '../testing/receipt-event-time-fixture.mjs';
import { safetyFixture, ns, ok } from '../testing/content-safety-s2h-fixture.mjs';

const original = 'The user prefers green tea in the morning';
const reworded = 'In the mornings the user likes to drink green tea';
const source = { client: 'synthetic-client', sessionId: 'synthetic-session', eventId: 'm1',
  role: 'user', excerpt: 'I drink green tea every morning.' };
const clean = { ...source, eventId: 'm2', excerpt: 'I collect ceramic mugs.' };
const denied = (result, code = 'source_excluded') => assert.deepEqual(result, {
  ok: false, error: { code, retryable: false },
});
const admit = (f, content = reworded, receipts = [source], extra = {}) => f.core.admit({
  namespace: ns, memory: { content, kind: 'fact' }, receipts, ...extra,
});
const snapshot = f => f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()
  .map(({ name }) => [name, f.db.prepare(`SELECT * FROM "${name}"`).all().map(row => JSON.stringify(row)).sort()]);
const unchangedRefusal = (f, work, code) => {
  const before = snapshot(f);
  denied(work(), code);
  assert.deepEqual(snapshot(f), before, 'the entire writer transaction rolls back');
};
const qualification = text => ({ version: 1,
  slot: { subject: 'user', property: 'collection', scope: null, applies: null },
  value: 'mugs', attribution: 'direct', commitment: 'adopted',
  anchors: [{ receiptIndex: 0, start: 0, end: text.length, text,
    fields: ['subject', 'property', 'value', 'attribution', 'commitment'] }],
});

async function fixture(t, shape, forget = true, options = {}) {
  const f = shape === 'hosted-53' ? eventTimeSafetyFixture(t, 33) : safetyFixture(t, 18);
  if (shape === 'hosted-53') await f.migrate();
  const core = openMemoryCore({ path: f.path, ...options, model: { contextWindow: 8192, countTokens: () => 1,
    extract: ({ input }) => ({ items: input.messages.map((message, index) => ({
      content: original, kind: 'fact', confidence: .9, sourceIndices: [index],
    })) }),
  } });
  f.workspace.defer(() => core.close());
  const db = f.connect(); f.workspace.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, shape === 'hosted-53' ? 53 : 18);
  const captured = ok(await core.capture({ namespace: ns, client: source.client, sessionId: source.sessionId,
    eventId: 'initial-event', messages: [{ id: source.eventId, role: source.role, content: source.excerpt }] }));
  const a = captured.admission.memories[0]; assert.ok(a);
  if (forget) ok(core.forget({ namespace: ns, memoryId: a.id, expectedRevision: a.revision }));
  return { ...f, core, db, a };
}

for (const shape of ['hosted-53', 'legacy-18']) {
  test(`${shape}: exact suppression precedes forgotten-source refusal for reworded admission`, async t => {
    const f = await fixture(t, shape);
    unchangedRefusal(f, () => admit(f, original), 'memory_suppressed');
    unchangedRefusal(f, () => admit(f));
    assert.equal(f.db.prepare('SELECT count(*) n FROM memories WHERE deleted=0').get().n, 0);
  });

  for (const qualified of [false, true]) test(`${shape}: ${qualified ? 'qualified' : 'ordinary'} duplicate cannot attach a forgotten source`, async t => {
    const f = await fixture(t, shape);
    const content = 'The user collects ceramic mugs';
    const target = ok(admit(f, content, [clean], qualified ? { qualification: qualification(clean.excerpt) } : {}));
    assert.equal(ok(admit(f, content, [clean])).deduplicated, true, 'the base duplicate route is reachable');
    unchangedRefusal(f, () => admit(f, content));
    assert.equal(ok(f.core.get({ namespace: ns, memoryId: target.memory.id })).receipts.length, 1);
  });

  test(`${shape}: qualified duplicate policy also refuses at post-extraction admission`, async t => {
    const f = await fixture(t, shape);
    const content = 'The user collects ceramic mugs';
    const target = ok(admit(f, content, [clean], { qualification: qualification(clean.excerpt) })).memory;
    const runtime = createMemoryRuntime({ path: f.path }); f.workspace.defer(() => runtime.close());
    const finish = (eventId, receipt) => {
      const key = { client: source.client, eventId, payloadDigest: 'c'.repeat(64) };
      const { token } = runtime.claimAdmission(ns, { ...key, leaseMs: 125000 });
      return runtime.finishCapturedAdmission(ns, { ...key, token, items: [{ content, kind: 'fact',
        origin: 'agent-inferred', confidence: .9, fingerprint: fingerprint(content), conflictHints: [],
        receipts: [receipt], qualification: qualification(receipt.excerpt),
      }] }, undefined, 'append-matching-evidence-v1');
    };
    assert.equal(finish('qualified-clean', { ...clean, eventId: 'm3' }).memories[0].id, target.id,
      'the actual append policy accepts independent clean evidence');
    const before = snapshot(f);
    assert.throws(() => finish('qualified-forgotten', source), error => error.code === 'source_excluded');
    // Claim is a separate successful transaction; only completion rolls back.
    const after = snapshot(f);
    assert.deepEqual(after.filter(([name]) => name !== 'admission_claims'), before.filter(([name]) => name !== 'admission_claims'));
    assert.equal(f.db.prepare("SELECT state FROM admission_claims WHERE event_id='qualified-forgotten'").get().state, 'pending');
  });

  test(`${shape}: correction retains a re-cited source until the corrected memory is forgotten`, async t => {
    const f = await fixture(t, shape, false);
    const corrected = ok(f.core.correct({ namespace: ns, memoryId: f.a.id, expectedRevision: f.a.revision,
      content: 'The user usually drinks tea in the morning', kind: 'fact', receipt: source })).memory;
    assert.deepEqual(f.db.prepare("SELECT fingerprint FROM suppressed WHERE fingerprint LIKE 'rs1:%'").all(), [],
      'replacement receipt tokens are subtracted');
    ok(admit(f, 'The user drinks tea regularly'));
    ok(f.core.forget({ namespace: ns, memoryId: corrected.id, expectedRevision: corrected.revision }));
    unchangedRefusal(f, () => admit(f));
  });

  test(`${shape}: clean same-session tuple succeeds; mixed receipt lists refuse atomically in either order`, async t => {
    const f = await fixture(t, shape);
    ok(admit(f, 'The user collects mugs', [clean]));
    for (const receipts of [[source, clean], [clean, source]]) {
      unchangedRefusal(f, () => admit(f, 'The user drinks tea and collects mugs', receipts));
    }
  });

  test(`${shape}: manual claim and finish with an observed session refuse the forgotten source`, async t => {
    const f = await fixture(t, shape);
    const key = { namespace: ns, client: source.client, eventId: 'manual-event', payloadDigest: 'a'.repeat(64) };
    const { token } = ok(f.core.claimAdmission({ ...key, leaseMs: 125000 }));
    const item = { content: reworded, kind: 'fact', confidence: .9, receipts: [source] };
    unchangedRefusal(f, () => f.core.finishAdmission({ ...key, token, items: [
      { ...item, content: 'A clean batch item', receipts: [clean] }, item,
    ] }));
    const completed = ok(f.core.finishAdmission({ ...key, token, items: [{ ...item, content: original }] }));
    assert.equal(completed.suppressedCount, 1, 'base suppression skips this item without admitting receipts');
    assert.deepEqual(completed.memories, []);
  });

  test(`${shape}: correction and supersession refuse forgotten replacement sources after their base checks`, async t => {
    const f = await fixture(t, shape);
    const current = ok(admit(f, 'A clean current fact', [clean])).memory;
    const correction = { namespace: ns, memoryId: current.id, expectedRevision: current.revision,
      content: reworded, kind: 'fact', receipt: source };
    unchangedRefusal(f, () => f.core.correct({ ...correction, expectedRevision: current.revision + 1 }), 'revision_conflict');
    unchangedRefusal(f, () => f.core.correct(correction));
    const supersession = { namespace: ns, memoryId: current.id, expectedRevision: current.revision,
      replacement: { content: reworded, kind: 'fact' }, receipts: [source] };
    unchangedRefusal(f, () => f.core.supersede({ ...supersession, expectedRevision: current.revision + 1 }), 'revision_conflict');
    unchangedRefusal(f, () => f.core.supersede(supersession));
  });

  test(`${shape}: embedded admission also refuses a forgotten source`, async t => {
    const f = await fixture(t, shape);
    const store = openMemoryStore({ path: f.path }); f.workspace.defer(() => store.close());
    const before = snapshot(f);
    assert.throws(() => store.scope({ ownerId: ns.ownerId, projectId: ns.projectId }).remember({ content: reworded, kind: 'fact', origin: 'explicit',
      receipt: source }), error => error.code === 'source_excluded');
    assert.deepEqual(snapshot(f), before);
  });

  test(`${shape}: confirmation cannot attach a forgotten source after its revision checks`, async t => {
    const f = await fixture(t, shape, true, { decisionReview: 'required-v1' });
    const key = { namespace: ns, client: source.client, eventId: 'review-event', payloadDigest: 'b'.repeat(64) };
    const { token } = ok(f.core.claimAdmission({ ...key, leaseMs: 125000 }));
    const memory = ok(f.core.finishAdmission({ ...key, token, items: [{ content: 'The user chose a ceramic mug',
      kind: 'decision', confidence: .9, receipts: [clean] }] })).memories[0];
    const confirmation = { namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
      actionId: 'synthetic-confirmation', receipt: source };
    unchangedRefusal(f, () => f.core.confirm({ ...confirmation, expectedRevision: memory.revision + 1 }), 'revision_conflict');
    unchangedRefusal(f, () => f.core.confirm(confirmation));
  });

  test(`${shape}: receipt storage failure keeps precedence over the new token denial`, async t => {
    const f = await fixture(t, shape);
    f.db.exec("CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    unchangedRefusal(f, () => admit(f), 'storage_error');
  });

  for (const kind of ['i', 'a']) test(`${shape}: admission recognizes the durable ${kind} token independently`, async t => {
    const f = await fixture(t, shape);
    f.db.prepare("DELETE FROM suppressed WHERE fingerprint LIKE ?").run(`rs1:${kind === 'i' ? 'a' : 'i'}:%`);
    assert.equal(f.db.prepare('SELECT count(*) n FROM suppressed WHERE fingerprint LIKE ?').get(`rs1:${kind}:%`).n, 1);
    const receipt = kind === 'a' ? { ...source, excerpt: source.excerpt + ' Still true.' } : source;
    unchangedRefusal(f, () => admit(f, reworded, [receipt]));
  });
}
