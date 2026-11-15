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

// Independent public reads supply the survivor oracle. Do not sort receipts:
// their ids and excerpts must retain the order returned by get for this Memory.
const memoryItem = ({ memory, receipts }) => ({
  memory: { id: memory.id, content: memory.content, kind: memory.kind },
  receipts: receipts.map(({ id, excerpt }) => ({ id, excerpt })),
});
function assertGroups(f, value, expected) {
  assert.deepEqual(Object.keys(value.groups), Object.keys(expected), 'group order');
  for (const [name, { memoryIds, episodeIds, ...fields }] of Object.entries(expected)) {
    const { items, ...actualFields } = value.groups[name];
    assert.deepEqual(actualFields, fields, name + ' literal counts and completion');
    if (memoryIds) {
      const saved = memoryIds.map(memoryId => ok(f.core.get({ namespace: ns, memoryId })));
      for (const item of saved) assert.equal(item.exhausted, true, 'get returned the complete receipt list');
      assert.deepEqual(items.map(memoryItem), saved.map(memoryItem), name + ' ordered Memories and receipts from get');
    } else {
      const saved = episodeIds.map(episodeId => ok(f.core.getEpisode({ namespace: ns, episodeId })).episode);
      assert.deepEqual(items.map(({ episodeId, nextStep }) => ({ episodeId, nextStep })),
        saved.map(episode => ({ episodeId: episode.id, nextStep: episode.nextStep })), 'ordered Episode ids and steps from getEpisode');
      for (const episode of saved) {
        assert.equal(episode.nextStep.status, 'open');
        assert.equal(episode.nextStep.text, 'Synthetic independent next action');
      }
    }
  }
}

// Read the SAME production store through the actual pre-line engine, never a
// replacement runtime, evidence reader or assembler. Archive only into the
// owned test workspace and check both subprocess exit codes explicitly. Only
// the separately named parity cases may check availability or call baseCore.
const baseRevision = 'b5146a53';
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
function baseAvailable(t) {
  if (spawnSync('git', ['cat-file', '-e', baseRevision + '^{commit}'],
    { cwd: repositoryRoot, timeout: 30000 }).status !== 0) {
    t.skip('base revision unavailable');
    return false;
  }
  return true;
}
async function baseCore(f) {
  const root = join(f.ws.path, 'base'); mkdirSync(root);
  const archive = spawnSync('git', ['archive', baseRevision, 'core', 'plugins/cairn-memory/lib'], {
    cwd: repositoryRoot, timeout: 30000, maxBuffer: 128 * 1024 * 1024,
  });
  assert.equal(archive.status, 0, String(archive.stderr)); assert.equal(archive.signal, null);
  const unpack = spawnSync('tar', ['-xf', '-', '-C', root], { input: archive.stdout, timeout: 30000 });
  assert.equal(unpack.status, 0, String(unpack.stderr)); assert.equal(unpack.signal, null);
  const base = await import(pathToFileURL(join(root, 'core/index.mjs')).href);
  const core = base.openMemoryCore({ path: f.path, model: port() });
  f.ws.defer(() => core.close());
  return core;
}
function survivors(value, group, ids) {
  return value.groups[group]?.items.filter(item => !ids.includes(item.memory?.id ?? item.episodeId)) ?? [];
}

async function exactReproduction(t, layout) {
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
  return { f, captured, needles: ['Manual fact', 'Updated manual fact', 'Organized fact', 'Use diagrams.', '"session"', '"source"',
    manual.id, corrected.id, first.memories[0].id, captured.id, ...withheldIds] };
}

for (const layout of [53, 18, 33]) test(`exact organized/manual/correction/forget/capture reproduction, layout ${layout}`, async t => {
  const { f, needles } = await exactReproduction(t, layout);
  const result = read(f, { maxTokens: 1024, maxChars: 4096 }), value = ok(result);
  assertGroups(f, value, {
    nextSteps: { enabled: true, returned: 1, complete: true, budget_exhausted: false, status: 'complete', episodeIds: [f.seed] },
    procedural: { enabled: true, returned: 0, complete: true, budget_exhausted: false, status: 'complete', memoryIds: [] },
  });
  forbidden(result, needles);
});

async function alongsideSurvivors(t, layout, group, oversized) {
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
  return { f, denied, kept };
}

for (const layout of [53, 18, 33]) for (const group of ['procedural', 'background']) for (const oversized of [false, true])
test(`short ${group} is absent alongside survivors and placeholder=${oversized}, layout ${layout}`, async t => {
  const { f, denied, kept } = await alongsideSurvivors(t, layout, group, oversized);
  const result = read(f), value = ok(result);
  const retained = { enabled: true, returned: 1, memoryIds: [kept.id], ...(oversized
    ? { complete: false, budget_exhausted: true, status: 'budget_exhausted' }
    : { complete: true, budget_exhausted: false, status: 'complete' }) };
  const empty = { enabled: true, returned: 0, complete: true, budget_exhausted: false, status: 'complete', memoryIds: [] };
  assertGroups(f, value, {
    nextSteps: { enabled: true, returned: 1, complete: true, budget_exhausted: false, status: 'complete', episodeIds: [f.seed] },
    procedural: group === 'procedural' ? retained : empty,
    background: group === 'background' ? retained : empty,
  });
  assert.deepEqual(read(f), result, 'same state yields byte-equivalent snapshot assembly');
  forbidden(result, [...denied.denied, denied.memory.id]);
  // The counter sees only attempted public envelopes and delivered background
  // items. Neither the private null nor the withheld payload consumes budget.
  f.model.countTokens = text => { forbidden(text, [denied.memory.id, source.excerpt]); return 1; };
  assert.deepEqual(read(f), result);
});

for (const layout of [53, 18, 33]) test(`base parity: exact organized/manual/correction/forget/capture reproduction, layout ${layout}`, async t => {
  if (!baseAvailable(t)) return;
  const { f, captured, needles } = await exactReproduction(t, layout);
  const input = { maxTokens: 1024, maxChars: 4096 };
  const result = read(f, input), value = ok(result);
  forbidden(result, needles);
  const base = await baseCore(f), expected = ok(base.sessionStartContext({ namespace: ns, ...input }));
  assert.deepEqual(value.groups.nextSteps, expected.groups.nextSteps);
  assert.deepEqual(value.groups.procedural.items, survivors(expected, 'procedural', [captured.id]));
});

for (const layout of [53, 18, 33]) for (const group of ['procedural', 'background']) for (const oversized of [false, true])
test(`base parity: short ${group} is absent alongside survivors and placeholder=${oversized}, layout ${layout}`, async t => {
  if (!baseAvailable(t)) return;
  const { f, denied } = await alongsideSurvivors(t, layout, group, oversized);
  const result = read(f), value = ok(result);
  forbidden(result, [...denied.denied, denied.memory.id]);
  const base = await baseCore(f), expected = ok(base.sessionStartContext({ namespace: ns, ...config }));
  assert.deepEqual(value.groups[group].items, survivors(expected, group, [denied.memory.id]));
  assert.deepEqual(value.groups.nextSteps, expected.groups.nextSteps);
});

for (const group of ['procedural', 'background']) for (const count of [1, 12, 13])
test(`every ${group} candidate is short, count ${count}`, async t => {
  const f = await fixture(t, 53), kind = group === 'procedural' ? 'instruction' : 'fact', denied = [];
  const beyondProbe = count === 13 ? admit(f, 'Synthetic survivor beyond the thirteen-row probe', kind) : null;
  for (let i = 0; i < count; i++) denied.push(short(f, 'Synthetic all withheld ' + i, kind,
    { ...source, sessionId: 'synthetic-denied-session-' + i, eventId: 'synthetic-denied-message-' + i }));
  const result = read(f), value = ok(result);
  assert.deepEqual(value.groups[group]?.items ?? [], []); assert.equal(value.groups[group]?.returned ?? 0, 0);
  const empty = { enabled: true, returned: 0, complete: true, budget_exhausted: false, status: 'complete', memoryIds: [] };
  assertGroups(f, value, {
    nextSteps: { enabled: true, returned: 1, complete: true, budget_exhausted: false, status: 'complete', episodeIds: [f.seed] },
    procedural: group === 'procedural' && count === 13
      ? { enabled: true, returned: 0, complete: false, budget_exhausted: true, status: 'budget_exhausted', memoryIds: [] } : empty,
    ...(group === 'background' && count === 13 ? {} : { background: empty }),
  });
  if (group === 'background' && count === 13) assert.equal(value.backgroundOmitted, true);
  if (beyondProbe) forbidden(result, [beyondProbe.id, beyondProbe.content]);
  for (const item of denied) forbidden(result, [...item.denied, item.memory.id]);
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
  const background = short(f, 'Synthetic short background beside step', 'fact');
  const result = read(f), value = ok(result);
  assert.deepEqual(value.groups.nextSteps.items.map(item => item.episodeId), [f.seed]);
  assertGroups(f, value, {
    nextSteps: { enabled: true, returned: 1, complete: true, budget_exhausted: false, status: 'complete', episodeIds: [f.seed] },
    procedural: { enabled: true, returned: 0, memoryIds: [], ...(oversized
      ? { complete: false, budget_exhausted: true, status: 'budget_exhausted' }
      : { complete: true, budget_exhausted: false, status: 'complete' }) },
    background: { enabled: true, returned: 0, complete: true, budget_exhausted: false, status: 'complete', memoryIds: [] },
  });
  forbidden(result, [...denied.denied, denied.memory.id, ...background.denied, background.memory.id,
    memory.id, captured.episode.id, saved.id, 'Synthetic Episode instruction']);
});

for (const group of ['procedural', 'background']) test(`forget between snapshots still fails closed for ${group}`, async t => {
  // Legacy layout isolates the existing two-snapshot index-revision refusal
  // from S2h's earlier owner-suppression callback/delivery fence.
  const f = await fixture(t, 18), kind = group === 'procedural' ? 'instruction' : 'fact';
  const denied = short(f, 'Synthetic already short candidate', kind);
  const target = admit(f, 'Synthetic concurrent target', kind);
  const before = read(f), value = ok(before);
  const empty = { enabled: true, returned: 0, complete: true, budget_exhausted: false, status: 'complete', memoryIds: [] };
  const retained = { enabled: true, returned: 1, complete: true, budget_exhausted: false, status: 'complete', memoryIds: [target.id] };
  assertGroups(f, value, {
    nextSteps: { enabled: true, returned: 1, complete: true, budget_exhausted: false, status: 'complete', episodeIds: [f.seed] },
    procedural: group === 'procedural' ? retained : empty,
    background: group === 'background' ? retained : empty,
  });
  forbidden(before, [...denied.denied, denied.memory.id]);
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
  forbidden(result, [...denied.denied, denied.memory.id, target.id, target.content]);
});

test('all next-step sources withheld leaves an empty group and a successful call', async t => {
  const f = await fixture(t, 53);
  const row = f.db.prepare(`SELECT e.client,e.session_key AS sessionId,s.message_id AS eventId,s.role,s.text AS excerpt
    FROM session_episodes e JOIN episode_sources s ON s.origin_episode_id=e.id WHERE s.episode_id=?`).get(f.seed);
  const denied = short(f, 'Synthetic short Memory at the only step address', 'instruction', row);
  const result = read(f), value = ok(result);
  assert.deepEqual(value.groups.nextSteps.items, []);
  assert.equal(value.groups.nextSteps.returned, 0); assert.equal(value.groups.nextSteps.status, 'complete');
  assertGroups(f, value, {
    nextSteps: { enabled: true, returned: 0, complete: true, budget_exhausted: false, status: 'complete', episodeIds: [] },
    procedural: { enabled: true, returned: 0, complete: true, budget_exhausted: false, status: 'complete', memoryIds: [] },
    background: { enabled: true, returned: 0, complete: true, budget_exhausted: false, status: 'complete', memoryIds: [] },
  });
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
  const result = read(f, input), value = ok(result);
  const retained = { enabled: true, returned: 6, complete: true, budget_exhausted: false, status: 'complete', memoryIds: kept };
  assertGroups(f, value, {
    nextSteps: { enabled: false, returned: 0, complete: true, budget_exhausted: false, status: 'disabled', episodeIds: [] },
    procedural: group === 'procedural' ? retained
      : { enabled: false, returned: 0, complete: true, budget_exhausted: false, status: 'disabled', memoryIds: [] },
    ...(group === 'background' ? { background: retained } : {}),
  });
  assert.deepEqual(value.groups[group].items.map(item => item.memory.id), kept);
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
  assertGroups(f, value, {
    nextSteps: { enabled: true, returned: 1, complete: true, budget_exhausted: false, status: 'complete', episodeIds: [f.seed] },
    procedural: { enabled: true, returned: 0, complete: true, budget_exhausted: false, status: 'complete', memoryIds: [] },
    background: { enabled: true, returned: 0, complete: true, budget_exhausted: false, status: 'complete', memoryIds: [] },
  });
  forbidden(result, [memory.id, 'Synthetic withheld tagged preference', source.excerpt, ...receiptIds]);
});

test('the final comparison notices a short item becoming deliverable without an epoch change', async t => {
  const f = await fixture(t, 18), denied = short(f, 'Synthetic stable-identity short item', 'instruction');
  const before = read(f), value = ok(before);
  assertGroups(f, value, {
    nextSteps: { enabled: true, returned: 1, complete: true, budget_exhausted: false, status: 'complete', episodeIds: [f.seed] },
    procedural: { enabled: true, returned: 0, complete: true, budget_exhausted: false, status: 'complete', memoryIds: [] },
    background: { enabled: true, returned: 0, complete: true, budget_exhausted: false, status: 'complete', memoryIds: [] },
  });
  forbidden(before, [...denied.denied, denied.memory.id]);
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
