import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { migrateReceiptEventTime } from '../content-safety-migration.mjs';
import { copySqliteFixture, quiescence } from '../testing/content-safety-s2h-fixture.mjs';
import { lineageHost } from '../testing/card-lineage-fixture.mjs';
import { options as episodeOptions } from '../testing/episode-helpers.mjs';
import { interpretation } from '../testing/episode-capture-helpers.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

// Self-contained cases use only current production APIs and synthetic fixtures.
// This file does not inspect git history.
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
const deny = (f, ...needles) => { for (const needle of needles) f.tokenizer.needles.add(needle); };
function read(f, group, core = f.core, referenceTexts = null, limits = {}) {
  const record = { texts: [], needles: [...f.tokenizer.needles], referenceTexts };
  f.tokenizer.reads.push(record);
  assert.equal(f.tokenizer.active, null);
  f.tokenizer.active = record;
  try {
    return core.sessionStartContext({ namespace: ns,
      groups: { nextSteps: false, procedural: group === 'procedural', ...(group === 'background' ? { background: true } : {}) },
      maxTokens: 2000, maxChars: 8000,
      ...(group === 'background' ? { backgroundBudget: { maxTokens: 2000, maxChars: 8000 } } : {}), ...limits });
  } finally { f.tokenizer.active = null; }
}

async function fixture(t, layout) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-01T00:00:00.000Z') });
  const ws = createTestWorkspace(t, { prefix: 'shared-session-parity-' });
  const path = join(ws.path, 'store.sqlite'), host = lineageHost();
  const tokenizer = { reads: [], active: null, needles: new Set(), onCount: null };
  const model = { ...rationaleModel(), items: [], extract: () => ({ items: model.items }),
    interpretEpisode: interpretation, countTokens: text => { tokenizer.active?.texts.push(text); tokenizer.onCount?.(text); return 1; } };
  // Scan every recorded input outside the engine's callback error mapping.
  t.after(() => {
    for (const { texts, needles, referenceTexts } of tokenizer.reads) for (const text of texts) {
      for (const needle of needles) assert.equal(text.includes(needle), false, 'tokenizer input excludes a withheld needle');
      if (referenceTexts) assert.equal(referenceTexts.includes(text), true, 'every legacy window input equals a stable first-snapshot input');
    }
  });
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
  return { core, model, tokenizer, db, path, ws, tick: () => t.mock.timers.tick(1) };
}

function admit(f, content, kind, receipts = [support(content)], procedural) {
  f.tick();
  return { ...ok(f.core.admit({ namespace: ns, memory: { content, kind }, receipts,
    ...(procedural ? { procedural } : {}) })).memory, content };
}
const rows = (f, memory) => f.db.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY created_at,id').all(memory.id);
const projected = receipts => receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt }));
const get = (f, memory) => ok(f.core.get({ namespace: ns, memoryId: memory.id, receiptLimit: 50,
  includeQualification: true }));
function parity(f, item, memory) {
  assert.ok(item, 'session delivers the Memory');
  const expected = get(f, memory), { namespace, receiptCount, filing, ...metadata } = expected.memory;
  assert.equal(expected.exhausted, true);
  assert.deepEqual(item.memory, { ...metadata, filingStatus: filing.status }, 'all session-shaped metadata equals get');
  assert.deepEqual(item.receipts, projected(expected.receipts), 'receipt ids, roles, excerpts and order equal get');
  assert.equal(Object.hasOwn(item, 'receiptCount'), false);
  assert.equal(Object.hasOwn(item, 'receiptsOmitted'), false);
  assert.equal(Object.hasOwn(item, 'qualification'), false);
  assert.equal(item.semanticSupport, 'unassessed');
  return expected;
}
function withhold(f, memory, operation, address) {
  const old = rows(f, memory), input = { namespace: ns, memoryId: memory.id, expectedRevision: memory.revision };
  if (operation === 'same-address correction') ok(f.core.correct({ ...input,
    content: 'Synthetic replacement outside source groups', kind: 'decision',
    receipt: { ...address, excerpt: 'Synthetic replacement source' } }));
  else ok(f.core[operation]({ ...input, ...(operation === 'reject' ? { actionId: 'synthetic-reject' } : {}) }));
  return [memory.content, memory.id, ...old.flatMap(row => [row.id, row.receipt_key, row.excerpt, row.session_id, row.event_id])];
}

// One submitted message produces three Memories through capture, not repeated
// admit calls. A second message has its own capture and source address.
async function captured(f, group, operation) {
  const kind = kindFor(group), contents = ['Synthetic first sibling', 'Synthetic second sibling', 'Synthetic retired sibling'];
  f.model.items = contents.map((content, index) => ({ content,
    kind: index === 2 && operation === 'reject' ? 'decision' : kind, confidence: .9, sourceIndices: [0] }));
  f.tick();
  const result = ok(await f.core.capture({ namespace: ns, client: 'synthetic', sessionId: 'synthetic-shared-session',
    eventId: 'synthetic-shared-capture', messages: [{ id: 'synthetic-shared-message', role: 'user',
      content: 'Synthetic shared captured source needle' }] }));
  assert.equal(result.admission.memories.length, 3);
  const memories = result.admission.memories.map((memory, index) => ({ ...memory, content: contents[index] }));
  for (const memory of memories) assert.equal(ok(f.core.get({ namespace: ns, memoryId: memory.id,
    includeAwaiting: true })).memory.content, memory.content);
  f.model.items = [{ content: 'Synthetic independent captured Memory', kind, confidence: .8, sourceIndices: [0] }];
  f.tick();
  const independent = ok(await f.core.capture({ namespace: ns, client: 'synthetic', sessionId: 'synthetic-independent-session',
    eventId: 'synthetic-independent-capture', messages: [{ id: 'synthetic-independent-message', role: 'user',
      content: 'Synthetic independent captured source' }] })).admission.memories[0];
  return { memories, independent };
}

for (const layout of [53, 18, 33]) for (const group of ['procedural', 'background'])
for (const operation of ['forget', 'same-address correction', 'reject'])
for (const remainingCount of [1, 2])
test(`captured three siblings retain two without ${operation} sources and ${remainingCount} remaining receipts in ${group}, layout ${layout}`, async t => {
  const f = await fixture(t, layout), { memories: [first, second, retired], independent } = await captured(f, group, operation);
  const sharedRows = [first, second].flatMap(memory => rows(f, memory));
  // Pin exactly one independent receipt, and a nontrivial two-receipt order.
  const remaining = [support('remaining-first'), support('remaining-second')].slice(0, remainingCount);
  for (const receipt of remaining) admit(f, second.content, kindFor(group), [receipt]);
  const address = { client: 'synthetic', sessionId: 'synthetic-shared-session', eventId: 'synthetic-shared-message',
    role: 'user', excerpt: 'Synthetic shared captured source needle' };
  const needles = [...withhold(f, retired, operation, address),
    ...sharedRows.flatMap(row => [row.id, row.receipt_key, row.excerpt, row.session_id, row.event_id])];
  deny(f, ...needles);
  const result = read(f, group), value = ok(result), delivered = value.groups[group];
  assert.equal(delivered.returned, 3);
  assert.equal(delivered.status, 'complete');
  const byId = new Map(delivered.items.map(item => [item.memory.id, item]));
  const empty = parity(f, byId.get(first.id), first), kept = parity(f, byId.get(second.id), second);
  parity(f, byId.get(independent.id), independent);
  assert.deepEqual(empty.receipts, []);
  assert.equal(empty.memory.receiptCount, 1, 'get keeps the stored count for the empty delivery');
  assert.deepEqual(kept.receipts.map(receipt => receipt.excerpt), remaining.map(receipt => receipt.excerpt));
  assert.equal(kept.memory.receiptCount, 1 + remainingCount);
  assert.equal(byId.has(retired.id), false);
  absent(result, needles);
  assert.deepEqual(read(f, group), result, 'both snapshots and repeated reads deliver the same item');
});

for (const layout of [53, 18, 33]) for (const kind of ['instruction', 'preference'])
for (const anchorOnRemaining of [false, true])
test(`short tagged ${kind} anchor ${anchorOnRemaining ? 'remaining' : 'withheld'} in procedural, layout ${layout}`, async t => {
  const f = await fixture(t, layout), shared = support('tag-shared'), other = support('tag-independent');
  const memory = admit(f, 'Synthetic tagged Memory', kind, [shared, other], {
    anchors: [{ receiptIndex: anchorOnRemaining ? 1 : 0, start: 0, end: (anchorOnRemaining ? other : shared).excerpt.length }],
  });
  const before = get(f, memory), hidden = rows(f, memory).find(row => row.excerpt === shared.excerpt);
  const donor = admit(f, 'Synthetic forgotten tag sibling', 'fact', [shared]);
  const needles = [...withhold(f, donor, 'forget', shared), hidden.id, hidden.receipt_key];
  if (kind === 'preference' && !anchorOnRemaining) needles.push(memory.id, memory.content);
  deny(f, ...needles);
  const result = read(f, 'procedural'), item = ok(result).groups.procedural.items[0];
  if (kind === 'preference' && !anchorOnRemaining) {
    assert.deepEqual(ok(result).groups.procedural.items, []);
    assert.equal(ok(result).groups.procedural.returned, 0);
    assert.equal(ok(result).groups.procedural.status, 'complete');
    absent(result, [...needles, memory.id, memory.content]);
    assert.deepEqual(read(f, 'procedural'), result, 'private absence is identical in both snapshots');
    return;
  }
  const expected = parity(f, item, memory);
  assert.equal(ok(result).groups.procedural.returned, 1, 'instructions remain eligible without a tag; preferences retain a delivered positive tag');
  if (anchorOnRemaining) {
    assert.deepEqual(item.procedural, before.procedural);
    assert.deepEqual(item.procedural, expected.procedural);
    // The surviving anchor still takes the existing span-validation path.
    const tag = f.db.prepare('SELECT anchors FROM procedural_tags WHERE memory_id=?').get(memory.id);
    const anchors = JSON.parse(tag.anchors); anchors[0].end = other.excerpt.length + 1;
    f.db.prepare('UPDATE procedural_tags SET anchors=? WHERE memory_id=?').run(JSON.stringify(anchors), memory.id);
    failure(read(f, 'procedural'), needles);
  } else {
    assert.equal(Object.hasOwn(item, 'procedural'), false);
    assert.equal(Object.hasOwn(expected, 'procedural'), false);
  }
  absent(result, needles);
});

for (const layout of [53, 18, 33]) for (const group of ['procedural', 'background'])
for (const marker of [false, true])
test(`stale excerpt ${marker ? 'with' : 'without'} marker refuses ${group}, layout ${layout}`, async t => {
  const f = await fixture(t, layout), shared = support('integrity-shared');
  const memory = admit(f, 'Synthetic corrupt Memory', kindFor(group), [shared]);
  const original = rows(f, memory)[0];
  const needles = [memory.id, memory.content, original.id, original.receipt_key, original.excerpt,
    'Synthetic changed excerpt without matching key'];
  if (marker) {
    const donor = admit(f, 'Synthetic integrity donor', 'decision', [shared]);
    needles.push(...withhold(f, donor, 'forget', shared));
  }
  assert.equal(f.db.prepare('UPDATE receipts SET excerpt=? WHERE id=?')
    .run('Synthetic changed excerpt without matching key', original.id).changes, 1);
  assert.equal(f.db.prepare('SELECT receipt_key FROM receipts WHERE id=?').get(original.id).receipt_key, original.receipt_key);
  deny(f, ...needles);
  failure(read(f, group), needles);
});

for (const layout of [53, 18, 33]) for (const group of ['procedural', 'background'])
test(`sibling forget between snapshots refuses the whole ${group} call, layout ${layout}`, async t => {
  const f = await fixture(t, layout), shared = { ...support('window-shared'), client: 'synthetic-window-client' };
  const selected = admit(f, 'Synthetic selected window Memory', kindFor(group), [shared]);
  const donor = admit(f, 'Synthetic forgotten window donor', 'preference', [shared]);
  const needles = [selected.id, selected.content, ...rows(f, selected).flatMap(row => [row.id, row.receipt_key]),
    shared.client, shared.sessionId, shared.eventId, shared.excerpt];
  deny(f, donor.id, donor.content, ...rows(f, donor).map(row => row.id));
  ok(read(f, group));
  const referenceTexts = layout === 53 ? null : [...f.tokenizer.reads.at(-1).texts];
  if (layout === 53) deny(f, ...needles);
  const writer = openMemoryCore({ path: f.path }); f.ws.defer(() => writer.close());
  let changed = false;
  f.tokenizer.onCount = text => {
    if (text && !changed) {
      changed = true;
      ok(writer.forget({ namespace: ns, memoryId: donor.id, expectedRevision: donor.revision }));
    }
  };
  const result = read(f, group, f.core, referenceTexts);
  assert.equal(changed, true);
  assert.deepEqual(result, { ok: false, error: {
    code: layout === 53 ? 'evidence_unavailable' : 'index_revision_conflict', retryable: false,
  } });
  assert.deepEqual(get(f, selected).receipts, []);
  absent(result, needles);
});

for (const layout of [53, 18, 33]) for (const group of ['procedural', 'background'])
test(`short ${group} item consumes one of six slots and its delivery budget, layout ${layout}`, async t => {
  const f = await fixture(t, layout), kind = kindFor(group), older = [];
  for (let index = 0; index < 6; index++) older.unshift(admit(f, 'Synthetic budget candidate ' + index, kind));
  const shared = support('budget-shared'), memory = admit(f, 'Synthetic short budget Memory', kind, [shared]);
  const hidden = rows(f, memory)[0], donor = admit(f, 'Synthetic forgotten budget donor', 'decision', [shared]);
  const needles = [...withhold(f, donor, 'forget', shared), hidden.id, hidden.receipt_key];
  deny(f, ...needles);
  const result = read(f, group), value = ok(result), items = value.groups[group].items;
  assert.deepEqual(items.map(item => item.memory.id), [memory.id, ...older.slice(0, 5).map(item => item.id)]);
  assert.equal(value.groups[group].returned, 6);
  assert.equal(value.groups[group].status, 'budget_exhausted');
  parity(f, items[0], memory);
  absent(result, [...needles, older[5].id, older[5].content]);
  const texts = f.tokenizer.reads.at(-1).texts;
  assert.ok(texts.some(text => text.includes(memory.content)), 'the tokenizer charges for the delivered short Memory');
  assert.ok(texts.some(text => text === JSON.stringify(result)), 'the final envelope has its ordinary full budget charge');
  if (group === 'background') assert.ok(texts.includes(JSON.stringify(items)), 'background budget includes the short item');
  // The same store and item projection are charged identically on a repeat.
  assert.deepEqual(read(f, group), result);
  assert.deepEqual(f.tokenizer.reads.at(-1).texts, texts);
  const chars = JSON.stringify(result).length;
  assert.deepEqual(read(f, group, f.core, null, { maxChars: chars }), result, 'the full charged envelope fits exactly');
  assert.equal(ok(read(f, group, f.core, null, { maxChars: chars - 1 })).groups[group].returned, 5,
    'one less character rejects the sixth whole item, including the short item in the cost');
});
