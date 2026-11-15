import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore, openMemoryStore } from '../index.mjs';
import { migrateReceiptEventTime } from '../content-safety-migration.mjs';
import { copySqliteFixture, quiescence } from '../testing/content-safety-s2h-fixture.mjs';
import { lineageHost } from '../testing/card-lineage-fixture.mjs';
import { options as episodeOptions } from '../testing/episode-helpers.mjs';
import { interpretation } from '../testing/episode-capture-helpers.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const ns = { ownerId: 'synthetic', scope: 'personal', projectId: null };
const source = { client: 'synthetic', sessionId: 'session', eventId: 'source', role: 'user', excerpt: 'Use diagrams.' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const config = { maxTokens: 2000, maxChars: 8000, groups: { background: true },
  backgroundBudget: { maxTokens: 2000, maxChars: 8000 } };
const support = id => ({ ...source, sessionId: 'synthetic-independent-session', eventId: id,
  excerpt: 'Synthetic independent support ' + id });
const forbidden = (value, strings) => {
  const whole = JSON.stringify(value);
  for (const text of strings) assert.equal(whole.includes(text), false, 'whole result excludes ' + text);
};
function port() {
  const model = { ...rationaleModel(), items: [], countTokens: () => 1,
    classify: ({ input }) => ({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }),
    select: ({ input }) => ({ refs: input.maps.flatMap(page => page.items.flatMap(item => {
      const ref = item.type === 'unfiled' ? item.ref : item.type === 'ref' && item.ref.childType === 'memory'
        ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
      return ref ? [{ namespaceIndex: page.namespaceIndex, ...ref }] : [];
    })) }),
    interpretEpisode: request => ({ ...interpretation(request), nextStep: {
      ...interpretation(request).gist, value: 'Synthetic independent next action' } }),
  };
  model.extract = () => ({ items: model.items });
  return model;
}

// Build the production family through its public opener, seed one Episode,
// close all handles, and only then migrate event time. Never enable Card lineage.
async function fixture(t, layout) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-01T00:00:00.000Z') });
  const ws = createTestWorkspace(t, { prefix: 'shared-session-' }), path = join(ws.path, 'store.sqlite');
  const model = port(), host = lineageHost();
  const initial = openMemoryCore({ path, model, ...episodeOptions, ...(layout === 18 ? {} : {
    privateCards: { ...host.options, currentDependencies: { version: 'card-current-dependencies-v1' } },
    methodPackages: { version: 'method-packages-local-v1', storage: 'local-plain-v1', authority: host.options.authority },
  }) });
  let seed;
  try {
    seed = ok(await initial.capture({ namespace: ns, client: 'synthetic', sessionId: 'synthetic-fixture-session',
      eventId: 'synthetic-fixture-episode', episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' },
      messages: [{ id: 'synthetic-fixture-message', role: 'user', content: 'Synthetic independent Episode support',
        occurredAt: '2026-01-01T00:00:00.000Z' }] })).episode.id;
  } finally { initial.close(); }
  if (layout === 53) {
    const db = new DatabaseSync(path);
    const storeId = db.prepare('SELECT store_id FROM store_metadata').get().store_id;
    db.close();
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
  const core = openMemoryCore({ path, model }); ws.defer(() => core.close());
  return { core, model, db, path, ws, seed, tick: () => t.mock.timers.tick(1) };
}
function admit(f, content, kind, receipts = [support(content)]) {
  f.tick();
  return { ...ok(f.core.admit({ namespace: ns, memory: { content, kind }, receipts })).memory, content, kind };
}
// The dispatch's admitOrganized is the public claim/finish facade pair;
// there is no method with that name on openMemoryCore.
function admitOrganized(f) {
  const key = { namespace: ns, client: 'synthetic', eventId: 'organized', payloadDigest: 'a'.repeat(64) };
  const claim = ok(f.core.claimAdmission({ ...key, leaseMs: 125000 }));
  return claim.duplicate ? { memories: claim.memoryIds.map(id => ok(f.core.get({ namespace: ns, memoryId: id })).memory) }
    : ok(f.core.finishAdmission({ ...key, token: claim.token,
    items: [{ content: 'Organized fact', kind: 'fact', confidence: .9, receipts: [source] }] }));
}
function forget(f, memory) {
  ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
}
function short(f, content, kind, address = source) {
  address = Object.fromEntries(['client', 'sessionId', 'eventId', 'role', 'excerpt'].map(key => [key, address[key]]));
  const memory = admit(f, content, kind, [address]);
  const receiptIds = ok(f.core.get({ namespace: ns, memoryId: memory.id })).receipts.map(receipt => receipt.id);
  const donorContent = 'Synthetic forgotten donor ' + content;
  const donor = admit(f, donorContent, 'fact', [address]);
  forget(f, donor);
  return { memory, receiptIds, denied: [content, donorContent, address.excerpt,
    JSON.stringify(address.sessionId), JSON.stringify(address.eventId), ...receiptIds] };
}
const read = (f, input = config) => f.core.sessionStartContext({ namespace: ns, ...input });

// Read the SAME production store through the actual pre-line engine, never a
// replacement runtime, evidence reader or assembler. Archive only into the
// owned test workspace and check both subprocess exit codes explicitly.
async function baseCore(f) {
  const root = join(f.ws.path, 'base'); mkdirSync(root);
  const archive = spawnSync('git', ['archive', 'b5146a53', 'core', 'plugins/cairn-memory/lib'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), maxBuffer: 128 * 1024 * 1024,
  });
  assert.equal(archive.status, 0, String(archive.stderr)); assert.equal(archive.signal, null);
  const unpack = spawnSync('tar', ['-xf', '-', '-C', root], { input: archive.stdout });
  assert.equal(unpack.status, 0, String(unpack.stderr)); assert.equal(unpack.signal, null);
  const base = await import(pathToFileURL(join(root, 'core/index.mjs')).href);
  const core = base.openMemoryCore({ path: f.path, model: port() });
  f.ws.defer(() => core.close());
  return core;
}
function survivors(value, group, ids) {
  return value.groups[group]?.items.filter(item => !ids.includes(item.memory?.id ?? item.episodeId)) ?? [];
}

for (const layout of [53, 18, 33]) test(`exact organized/manual/correction/forget/capture reproduction, layout ${layout}`, async t => {
  const f = await fixture(t, layout);
  const first = admitOrganized(f), duplicate = admitOrganized(f);
  assert.deepEqual(duplicate.memories.map(memory => memory.id), first.memories.map(memory => memory.id));
  const store = openMemoryStore({ path: f.path }); f.ws.defer(() => store.close());
  const scope = store.scope({ ownerId: ns.ownerId });
  const manual = scope.remember({ content: 'Manual fact', kind: 'fact', receipt: source });
  ok(f.core.get({ namespace: ns, memoryId: manual.id }));
  const corrected = ok(f.core.correct({ namespace: ns, memoryId: manual.id, expectedRevision: manual.revision,
    content: 'Updated manual fact', kind: 'fact', receipt: source })).memory;
  const withheldIds = [first.memories[0], corrected].flatMap(memory =>
    ok(f.core.get({ namespace: ns, memoryId: memory.id })).receipts.map(receipt => receipt.id));
  forget(f, corrected);
  f.model.items = [{ content: 'Use diagrams.', kind: 'instruction', confidence: .9, sourceIndices: [0] }];
  const captured = ok(await f.core.capture({ namespace: ns, client: 'synthetic', eventId: 'capture', sessionId: 'session',
    messages: [{ id: 'source', role: 'user', content: 'Use diagrams.' }] })).admission.memories[0];
  withheldIds.push(...f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').all(captured.id).map(row => row.id));
  ok(await f.core.recall({ readSet: [ns], query: 'diagrams' }));
  ok(f.core.list({ namespace: ns })); ok(f.core.map({ namespace: ns, purpose: 'recall' }));
  assert.equal(ok(f.core.listEpisodes({ namespace: ns, since: '2025-01-01T00:00:00.000Z',
    until: '2025-12-31T00:00:00.000Z', timeBasis: 'receipt' })).items.length, 0);
  const episodes = ok(f.core.listEpisodes({ namespace: ns, since: '2026-01-01T00:00:00.000Z',
    until: '2026-12-31T23:59:59.999Z', timeBasis: 'event' }));
  assert.equal(episodes.items.length, 1); ok(f.core.getEpisode({ namespace: ns, episodeId: f.seed }));
  const result = read(f, { maxTokens: 1024, maxChars: 4096 }), value = ok(result);
  const base = await baseCore(f);
  const expected = ok(base.sessionStartContext({ namespace: ns, maxTokens: 1024, maxChars: 4096 }));
  assert.deepEqual(value.groups.nextSteps, expected.groups.nextSteps);
  assert.deepEqual(value.groups.procedural.items, survivors(expected, 'procedural', [captured.id]));
  assert.equal(value.groups.procedural.returned, 0); assert.equal(value.groups.procedural.complete, true);
  forbidden(result, ['Manual fact', 'Updated manual fact', 'Organized fact', 'Use diagrams.', '"session"', '"source"',
    manual.id, corrected.id, first.memories[0].id, captured.id, ...withheldIds]);
});

for (const layout of [53, 18, 33]) for (const group of ['procedural', 'background']) for (const oversized of [false, true])
test(`short ${group} is absent alongside survivors and placeholder=${oversized}, layout ${layout}`, async t => {
  const f = await fixture(t, layout), kind = group === 'procedural' ? 'instruction' : 'context';
  const denied = short(f, 'Synthetic withheld ' + group, kind);
  const kept = admit(f, 'Synthetic retained ' + group, kind);
  // Updated-at ordering is controlled through public mutations and the test
  // clock, not SQL. Make the too-large item OLDER than the surviving item.
  if (oversized) {
    const huge = admit(f, 'Synthetic oversized ' + group, kind);
    for (let i = 0; i < 100; i++) admit(f, 'Synthetic oversized ' + group, kind, [support('synthetic-many-' + i)]);
    f.tick();
    const refreshed = ok(f.core.correct({ namespace: ns, memoryId: kept.id, expectedRevision: kept.revision,
      content: kept.content, kind, receipt: support('synthetic-refreshed-' + group) })).memory;
    assert.equal(refreshed.id, kept.id); assert.ok(huge.id);
  }
  const base = await baseCore(f), expected = ok(base.sessionStartContext({ namespace: ns, ...config }));
  const result = read(f), value = ok(result);
  assert.deepEqual(value.groups[group].items, survivors(expected, group, [denied.memory.id]));
  assert.ok(value.groups[group].items.some(item => item.memory.id === kept.id));
  assert.equal(value.groups[group].returned, value.groups[group].items.length);
  assert.deepEqual(read(f), result, 'same state yields byte-equivalent snapshot assembly');
  assert.deepEqual(value.groups.nextSteps, expected.groups.nextSteps);
  if (oversized) assert.equal(value.groups[group].status, 'budget_exhausted');
  else assert.equal(value.groups[group].status, 'complete');
  forbidden(result, [...denied.denied, denied.memory.id]);
  // The counter sees only attempted public envelopes and delivered background
  // items. Neither the private null nor the withheld payload consumes budget.
  f.model.countTokens = text => { forbidden(text, [denied.memory.id, source.excerpt]); return 1; };
  assert.deepEqual(read(f), result);
});

for (const group of ['procedural', 'background']) for (const count of [1, 12, 13])
test(`every ${group} candidate is short, count ${count}`, async t => {
  const f = await fixture(t, 53), kind = group === 'procedural' ? 'instruction' : 'fact', denied = [];
  const beyondProbe = count === 13 ? admit(f, 'Synthetic survivor beyond the thirteen-row probe', kind) : null;
  for (let i = 0; i < count; i++) denied.push(short(f, 'Synthetic all withheld ' + i, kind,
    { ...source, sessionId: 'synthetic-denied-session-' + i, eventId: 'synthetic-denied-message-' + i }));
  const value = ok(read(f));
  assert.deepEqual(value.groups[group]?.items ?? [], []); assert.equal(value.groups[group]?.returned ?? 0, 0);
  if (count < 13) assert.equal(value.groups[group].status, 'complete');
  if (beyondProbe) forbidden(value, [beyondProbe.id, beyondProbe.content]);
  for (const item of denied) forbidden(value, [...item.denied, item.memory.id]);
});

for (const layout of [53, 18, 33]) for (const oversized of [false, true])
test(`next steps keep the independent step alongside short sources and placeholder=${oversized}, layout ${layout}`, async t => {
  const f = await fixture(t, layout);
  const episodic = openMemoryCore({ path: f.path, model: f.model, ...episodeOptions }); f.ws.defer(() => episodic.close());
  f.model.items = [{ content: 'Synthetic Episode instruction', kind: 'instruction', confidence: .9, sourceIndices: [0] }];
  const captured = ok(await episodic.capture({ namespace: ns, client: 'synthetic', sessionId: 'synthetic-shared-step',
    eventId: 'synthetic-shared-step', episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' },
    messages: [{ id: 'synthetic-step-message', role: 'user', content: 'Synthetic shared step excerpt' }] }));
  const memory = captured.admission.memories[0], saved = ok(f.core.get({ namespace: ns, memoryId: memory.id })).receipts[0];
  const denied = short(f, 'Synthetic unlinked step Memory', 'instruction', saved);
  if (oversized) {
    for (let i = 0; i < 101; i++) admit(f, 'Synthetic oversized beside step', 'instruction', [support('synthetic-step-many-' + i)]);
  }
  // A short background Memory must not abort an otherwise deliverable step.
  short(f, 'Synthetic short background beside step', 'fact');
  const value = ok(read(f));
  assert.deepEqual(value.groups.nextSteps.items.map(item => item.episodeId), [f.seed]);
  forbidden(value, [...denied.denied, memory.id, captured.episode.id, saved.id, 'Synthetic Episode instruction']);
});

for (const group of ['procedural', 'background']) test(`forget between snapshots still fails closed for ${group}`, async t => {
  // Legacy layout isolates the existing two-snapshot index-revision refusal
  // from S2h's earlier owner-suppression callback/delivery fence.
  const f = await fixture(t, 18), kind = group === 'procedural' ? 'instruction' : 'fact';
  short(f, 'Synthetic already short candidate', kind);
  const target = admit(f, 'Synthetic concurrent target', kind);
  const writer = openMemoryCore({ path: f.path }); f.ws.defer(() => writer.close());
  let changed = false;
  f.model.countTokens = text => {
    if (text && !changed) {
      changed = true;
      ok(writer.forget({ namespace: ns, memoryId: target.id, expectedRevision: target.revision }));
    }
    return 1;
  };
  const result = read(f);
  assert.equal(changed, true, 'forget ran after preparation and before the authoritative reread');
  assert.deepEqual(result, { ok: false, error: { code: 'index_revision_conflict', retryable: false } });
});

test('all next-step sources withheld leaves an empty group and a successful call', async t => {
  const f = await fixture(t, 53);
  const row = f.db.prepare(`SELECT e.client,e.session_key AS sessionId,s.message_id AS eventId,s.role,s.text AS excerpt
    FROM session_episodes e JOIN episode_sources s ON s.origin_episode_id=e.id WHERE s.episode_id=?`).get(f.seed);
  const denied = short(f, 'Synthetic short Memory at the only step address', 'instruction', row);
  const result = read(f), value = ok(result);
  assert.deepEqual(value.groups.nextSteps.items, []);
  assert.equal(value.groups.nextSteps.returned, 0); assert.equal(value.groups.nextSteps.status, 'complete');
  forbidden(result, [...denied.denied, f.seed, denied.memory.id]);
});

for (const group of ['procedural', 'background']) test(`six retained ${group} items plus a trailing short item remain complete`, async t => {
  const f = await fixture(t, 53), kind = group === 'procedural' ? 'instruction' : 'fact';
  const denied = short(f, 'Synthetic trailing short candidate', kind), kept = [];
  for (let i = 0; i < 6; i++) kept.unshift(admit(f, 'Synthetic retained cap item ' + i, kind).id);
  // Disable the other groups so the background combined ceiling and envelope
  // have room for all six whole items.
  const input = { ...config, groups: { nextSteps: false, procedural: group === 'procedural', background: group === 'background' } };
  if (group === 'procedural') delete input.backgroundBudget;
  const result = read(f, input), value = ok(result).groups[group];
  assert.deepEqual(value.items.map(item => item.memory.id), kept);
  assert.equal(value.returned, 6); assert.equal(value.status, 'complete');
  forbidden(result, [...denied.denied, denied.memory.id]);
});

test('a short tagged preference loses its anchors and all metadata', async t => {
  const f = await fixture(t, 53);
  const memory = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic withheld tagged preference', kind: 'preference' },
    receipts: [source], procedural: { anchors: [{ receiptIndex: 0, start: 0, end: source.excerpt.length }] } })).memory;
  const receiptIds = ok(f.core.get({ namespace: ns, memoryId: memory.id })).receipts.map(receipt => receipt.id);
  const target = admit(f, 'Synthetic preference donor', 'fact', [source]); forget(f, target);
  const result = read(f), value = ok(result);
  assert.deepEqual(value.groups.procedural.items, []); assert.equal(value.groups.procedural.returned, 0);
  forbidden(result, [memory.id, 'Synthetic withheld tagged preference', source.excerpt, ...receiptIds]);
});

test('the final comparison notices a short item becoming deliverable without an epoch change', async t => {
  const f = await fixture(t, 18), denied = short(f, 'Synthetic stable-identity short item', 'instruction');
  let changed = false;
  f.model.countTokens = text => {
    if (text && !changed) {
      changed = true;
      // Deliberate old-writer fixture: bypass the public forget epoch so only
      // the existing full-snapshot comparison can detect this transition.
      f.db.prepare("DELETE FROM suppressed WHERE fingerprint GLOB 'rs1:*'").run();
    }
    return 1;
  };
  const result = read(f);
  assert.equal(changed, true);
  assert.deepEqual(result, { ok: false, error: { code: 'revision_conflict', retryable: false } });
  forbidden(result, [denied.memory.id, source.excerpt]);
});
