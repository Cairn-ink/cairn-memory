import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { migrateReceiptEventTime } from '../content-safety-migration.mjs';
import { receiptDenialTokens } from '../content-safety.mjs';
import { copySqliteFixture, quiescence } from '../testing/content-safety-s2h-fixture.mjs';
import { lineageHost } from '../testing/card-lineage-fixture.mjs';
import { options as episodeOptions } from '../testing/episode-helpers.mjs';
import { interpretation } from '../testing/episode-capture-helpers.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

// Standalone synthetic fixtures: no archived engine, git command or other test module.
const ns = { ownerId: 'synthetic', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const support = id => ({ client: 'synthetic', sessionId: 'synthetic-session-' + id,
  eventId: 'synthetic-event-' + id, role: 'user', excerpt: 'Synthetic support ' + id });
const kindFor = group => group === 'procedural' ? 'instruction' : 'fact';
const absent = (result, needles) => {
  const whole = JSON.stringify(result);
  for (const needle of needles) assert.equal(whole.includes(needle), false, 'whole result excludes ' + needle);
};
const failure = (result, needles) => {
  assert.deepEqual(result, { ok: false, error: { code: 'storage_error', retryable: false } });
  absent(result, needles);
};
const read = (f, group) => f.core.sessionStartContext({ namespace: ns,
  groups: { nextSteps: false, procedural: group === 'procedural', ...(group === 'background' ? { background: true } : {}) },
  maxTokens: 2000, maxChars: 8000,
  ...(group === 'background' ? { backgroundBudget: { maxTokens: 2000, maxChars: 8000 } } : {}) });

async function fixture(t, layout) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-01T00:00:00.000Z') });
  const ws = createTestWorkspace(t, { prefix: 'shared-session-integrity-' });
  const path = join(ws.path, 'store.sqlite'), host = lineageHost();
  const model = { ...rationaleModel(), extract: () => ({ items: [] }),
    interpretEpisode: interpretation, countTokens: () => 1 };
  // Match the production opener/seed/event-time migration; Card lineage stays off.
  const initial = openMemoryCore({ path, model, ...episodeOptions, ...(layout === 18 ? {} : {
    privateCards: { ...host.options, currentDependencies: { version: 'card-current-dependencies-v1' } },
    methodPackages: { version: 'method-packages-local-v1', storage: 'local-plain-v1', authority: host.options.authority },
  }) });
  try {
    ok(await initial.capture({ namespace: ns, client: 'synthetic', sessionId: 'synthetic-fixture-session',
      eventId: 'synthetic-fixture-episode', episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' },
      messages: [{ id: 'synthetic-fixture-message', role: 'user', content: 'Synthetic fixture Episode support',
        occurredAt: '2026-01-01T00:00:00.000Z' }] }));
  } finally { initial.close(); }
  if (layout === 53) {
    const inspect = new DatabaseSync(path);
    let storeId;
    try { storeId = inspect.prepare('SELECT store_id FROM store_metadata').get().store_id; }
    finally { inspect.close(); }
    const backupPath = join(ws.path, 'offline.sqlite');
    copySqliteFixture(path, backupPath);
    await migrateReceiptEventTime({ path, backupPath, expected: { storeId, base: 33 }, quiescence });
  }
  const db = new DatabaseSync(path); ws.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, layout);
  if (layout === 53) {
    const control = db.prepare('SELECT * FROM content_safety_control').get();
    assert.equal(control.receipt_event_time, 1);
    assert.equal(control.card_lineage_revision, 0);
  }
  const core = openMemoryCore({ path, model, decisionReview: 'required-v1' }); ws.defer(() => core.close());
  return { core, model, db, tick: () => t.mock.timers.tick(1) };
}
function admit(f, content, kind, receipts = [support(content)]) {
  f.tick();
  return { ...ok(f.core.admit({ namespace: ns, memory: { content, kind }, receipts })).memory, content };
}
const rows = (f, memory) => f.db.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY created_at,id').all(memory.id);
const markers = f => f.db.prepare("SELECT fingerprint FROM suppressed WHERE fingerprint GLOB 'rs1:*' ORDER BY fingerprint").all();
function corrupt(f, receipt) {
  const needle = 'Synthetic corrupted excerpt needle';
  assert.equal(f.db.prepare('UPDATE receipts SET excerpt=? WHERE id=?').run(needle, receipt.id).changes, 1);
  const stored = f.db.prepare('SELECT * FROM receipts WHERE id=?').get(receipt.id);
  assert.deepEqual(stored, { ...receipt, excerpt: needle }, 'only the excerpt changes; its receipt key stays stale');
  return [needle, receipt.excerpt, receipt.id, receipt.client, receipt.session_id, receipt.event_id];
}
function withhold(f, operation, receipt) {
  const content = 'Synthetic retired sibling needle';
  let donor;
  if (operation === 'reject') {
    const key = { namespace: ns, client: 'synthetic', eventId: 'synthetic-rejected-admission', payloadDigest: 'a'.repeat(64) };
    const claim = ok(f.core.claimAdmission({ ...key, leaseMs: 125000 }));
    donor = ok(f.core.finishAdmission({ ...key, token: claim.token,
      items: [{ content, kind: 'decision', confidence: .9, receipts: [receipt] }] })).memories[0];
    assert.equal(f.db.prepare('SELECT review_state FROM memories WHERE id=?').get(donor.id).review_state, 'awaiting');
  } else donor = admit(f, content, 'decision', [receipt]);
  const stored = rows(f, donor)[0];
  const input = { namespace: ns, memoryId: donor.id, expectedRevision: donor.revision };
  if (operation === 'same-address correction') ok(f.core.correct({ ...input,
    content: 'Synthetic replacement sibling', kind: 'decision',
    receipt: { ...receipt, excerpt: 'Synthetic replacement support' } }));
  else ok(f.core[operation]({ ...input, ...(operation === 'reject' ? { actionId: 'synthetic-rejection' } : {}) }));
  const expected = receiptDenialTokens([stored]);
  assert.deepEqual(markers(f).map(row => row.fingerprint).sort(),
    (operation === 'same-address correction' ? expected.slice(0, 1) : expected).sort());
  return [content, donor.id, stored.id, receipt.excerpt, receipt.sessionId, receipt.eventId];
}

for (const layout of [53, 18, 33]) for (const group of ['procedural', 'background'])
test(`unmarked corrupt ${group} receipt fails the whole session with the base code, layout ${layout}`, async t => {
  const f = await fixture(t, layout), address = support('unmarked-private-needle');
  const memory = admit(f, 'Synthetic corrupt Memory needle', kindFor(group), [address]);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM memory_qualifications WHERE memory_id=?').get(memory.id).n, 0);
  assert.deepEqual(markers(f), []);
  assert.deepEqual(ok(read(f, group)).groups[group].items.map(item => item.memory.id), [memory.id]);
  const needles = corrupt(f, rows(f, memory)[0]);
  assert.deepEqual(markers(f), [], 'corruption needs no suppression marker');
  // 5aff2691: ok/empty/complete. Tag: source_unavailable. Base and fix: storage_error.
  failure(read(f, group), [memory.id, memory.content, ...needles]);
});

for (const layout of [53, 18, 33]) for (const group of ['procedural', 'background'])
for (const markedCorruption of [false, true])
test(`marker omission plus ${markedCorruption ? 'marked' : 'unmarked'} corrupt ${group} receipt fails, layout ${layout}`, async t => {
  const f = await fixture(t, layout), shared = support('withheld-private-needle');
  const other = markedCorruption ? { ...shared, excerpt: 'Synthetic alternate withheld support' } : support('corrupt-private-needle');
  const memory = admit(f, 'Synthetic mixed integrity Memory needle', kindFor(group), [shared, other]);
  const before = rows(f, memory), denied = withhold(f, 'forget', shared);
  const survivor = admit(f, 'Synthetic intact companion', kindFor(group));
  assert.deepEqual(rows(f, memory), before, 'withholding leaves both receipt rows intact');
  assert.deepEqual(ok(read(f, group)).groups[group].items.map(item => item.memory.id), [survivor.id]);
  const needles = corrupt(f, before.find(row => row.excerpt === other.excerpt));
  // Even corruption inside the marker-hidden set must win. 5aff2691 hides it;
  // the tag refuses with source_unavailable; the base and fix use storage_error.
  failure(read(f, group), [memory.id, memory.content, ...denied, ...needles]);
});

for (const layout of [53, 18, 33]) for (const group of ['procedural', 'background'])
for (const operation of ['forget', 'same-address correction', 'reject'])
test(`intact ${group} rows behind ${operation} markers stay absent beside a survivor, layout ${layout}`, async t => {
  const f = await fixture(t, layout), shared = support('legitimate-withheld-needle');
  const memory = admit(f, 'Synthetic legitimately withheld Memory needle', kindFor(group), [shared]);
  const original = rows(f, memory), denied = withhold(f, operation, shared);
  const survivor = admit(f, 'Synthetic retained independent Memory', kindFor(group));
  const expected = ok(f.core.get({ namespace: ns, memoryId: survivor.id }));
  assert.deepEqual(rows(f, memory), original, 'marker state does not corrupt the stored receipt');
  const needles = [memory.id, memory.content, ...original.map(row => row.id), ...denied];
  f.model.countTokens = text => { absent(text, needles); return 1; };
  const result = read(f, group), value = ok(result);
  const delivered = value.groups[group];
  assert.deepEqual({ ...delivered, items: delivered.items.map(item => item.memory.id) }, {
    enabled: true, returned: 1, complete: true, budget_exhausted: false, status: 'complete', items: [survivor.id],
  });
  assert.equal(delivered.items[0].memory.content, survivor.content);
  assert.deepEqual(delivered.items[0].receipts, expected.receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt })));
  assert.equal(Object.hasOwn(value, 'backgroundOmitted'), false);
  absent(result, needles);
  assert.deepEqual(read(f, group), result, 'both snapshots and repeated reads make the same decision');
  // Sanity: 5aff2691 and fix succeed; tag refuses with source_unavailable.
});

for (const layout of [53, 18, 33]) for (const group of ['procedural', 'background'])
test(`corrupt thirteenth ${group} candidate stays outside source reads, layout ${layout}`, async t => {
  const f = await fixture(t, layout), kind = kindFor(group);
  const outside = admit(f, 'Synthetic unexamined Memory needle', kind);
  for (let i = 0; i < 12; i++) admit(f, 'Synthetic bounded survivor ' + i, kind);
  const selected = f.db.prepare('SELECT id FROM memories WHERE kind=? AND deleted=0 ORDER BY updated_at DESC,id').all(kind);
  assert.equal(selected.length, 13); assert.equal(selected[12].id, outside.id);
  const before = read(f, group), prior = ok(before).groups[group];
  assert.equal(prior.returned, 6);
  assert.equal(prior.complete, false);
  assert.equal(prior.budget_exhausted, true);
  assert.equal(prior.status, 'budget_exhausted');
  const needles = corrupt(f, rows(f, outside)[0]);
  const result = read(f, group);
  assert.deepEqual(result, before, 'tag, previous fix and current fix share the twelve-row source-read bound');
  absent(result, [outside.id, outside.content, ...needles.filter(needle => needle !== 'synthetic')]);
});
