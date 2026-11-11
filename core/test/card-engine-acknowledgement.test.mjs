import test from 'node:test';
import { createHook } from 'node:async_hooks';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { openMemoryCore as openContractCore } from '../contract.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { defaultRawOptions } from '../local-defaults.mjs';
import { withEngineCardDelivery } from '../private-card-input.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';
import { contentSafetyFacade } from '../content-safety-boundary.mjs';
import { transaction } from '../database.mjs';
import { createEngineCardStorage } from '../engine-card-storage.mjs';
import { createEngineCardMaintenance } from '../engine-card-maintenance.mjs';
import { contentSafetyInventory } from '../content-safety-migration.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { scriptedConsolidator } from '../testing/engine-card-fixture.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';

async function ready(t, migrated = true, namespace = ns, composition = {}) {
  const fixture = safetyFixture(t, composition.rawLayout ? 33 : 23);
  if (migrated) await fixture.migrate();
  const core = (composition.open ?? openMemoryCore)({ path: fixture.path, model: scriptedConsolidator(),
    ...composition.options,
    ...(composition.context ? { contextRead: { version: 'context-read-v1', authority: cardHost().options.authority } } : {}) });
  const db = fixture.connect();
  t.after(() => { core.close(); db.close(); });
  const memories = Array.from({ length: 8 }, (_, i) => {
    const content = `Orion synthetic milestone ${i}: shared implementation evidence marker${i}.`;
    const memory = ok(core.admit({ namespace, memory: { content, kind: 'fact' },
      receipts: [{ ...receipt(content), sessionId: 'synthetic-' + i }] })).memory;
    db.prepare('UPDATE memories SET created_at=? WHERE id=?')
      .run(new Date(Date.UTC(2026, 0, 1 + i * 10)).toISOString(), memory.id);
    return memory;
  });
  return { core, db, memories };
}

async function setup(t) {
  const { core, db, memories } = await ready(t);
  const result = ok(await core.maintainCards({ namespace: ns, budget: { maxMs: 5000 } }));
  assert.equal(result.built.length, 1, JSON.stringify(result));
  return { core, db, memories, acknowledgement: result.built[0] };
}

// Compare every key, including non-identity keys and nested source revisions.
// Shorthand properties deliberately need no textual census format extension.
function keyTree(value) {
  if (Array.isArray(value)) return value.map(keyTree);
  if (!value || typeof value !== 'object') return typeof value;
  return Object.fromEntries(Reflect.ownKeys(value).sort().map(key => [key, keyTree(value[key])]));
}

test('maintainCards built acknowledgement has exactly the generated Card and source revision shape', async t => {
  const { db, memories, acknowledgement } = await setup(t);
  const card = db.prepare("SELECT id,revision FROM private_cards WHERE state='confirmed'").get();
  const metadata = JSON.parse(db.prepare("SELECT result FROM card_operations WHERE method='consolidate'").get().result);
  const expected = { id: card.id, revision: card.revision, origin: 'engine',
    builtAt: acknowledgement.builtAt, clusterKey: acknowledgement.clusterKey,
    sourceRevisions: memories.map(memory => ({ memoryId: memory.id, revision: memory.revision }))
      .sort((a, b) => a.memoryId.localeCompare(b.memoryId)) };
  assert.match(card.id, /^engine-card\.[0-9a-f-]+$/u);
  assert.equal(Number.isFinite(Date.parse(expected.builtAt)), true);
  assert.equal(typeof expected.clusterKey, 'string');
  assert.deepEqual(keyTree(acknowledgement), keyTree(expected), 'full recursive acknowledgement key set');
  assert.deepEqual(acknowledgement, expected, 'canonical generated Card id, revision and every source revision');
  assert.deepEqual(metadata, expected, 'persisted acknowledgement matches delivered built row');
});

// Re-enter the same facade/native pre-COMMIT path with a real generated DTO.
// A changed sentinel proves that refusal precedes commit and delivery.
function deliver(db, acknowledgement, ledger = false) {
  const api = contentSafetyFacade({ maintainCards() {
    return transaction(db, () => {
      db.prepare("UPDATE memories SET updated_at=updated_at||'synthetic-uncommitted' WHERE id=?")
        .run(db.prepare('SELECT id FROM memories ORDER BY id LIMIT 1').get().id);
      if (ledger) {
        db.prepare("INSERT INTO card_operations SELECT owner_id,scope,project_id,'synthetic-replay',method,payload_binding,?, ?,created_at FROM card_operations WHERE method='consolidate'")
          .run(acknowledgement.id, JSON.stringify(acknowledgement));
      }
      return { ok: true, value: { built: ledger ? [] : [acknowledgement] } };
    });
  } }, { check() {}, failure: error => ({ ok: false, error: { code: error.code } }) });
  return api.maintainCards({ namespace: ns });
}

function refused(db, acknowledgement, label, ledger = false) {
  const before = contentSafetyInventory(db);
  const result = deliver(db, acknowledgement, ledger);
  assert.equal(result.ok, false, label + ' must not be delivered');
  assert.equal(result.error.code, 'evidence_unavailable', label);
  assert.equal(contentSafetyInventory(db), before, label + ' rolls back all writes');
}

test('native acknowledgement guard resolves generated Card ids and validates every bound source revision before delivery', async t => {
  const { core, db, acknowledgement } = await setup(t);
  assert.equal(deliver(db, acknowledgement).ok, true, 'valid generated acknowledgement control');
  for (const ledger of [false, true]) {
    refused(db, { ...acknowledgement, id: 'engine-card.synthetic-missing' }, 'unresolved Card id', ledger);
    for (const index of acknowledgement.sourceRevisions.keys()) {
      const forged = structuredClone(acknowledgement);
      forged.sourceRevisions[index].memoryId = 'synthetic-missing-memory';
      refused(db, forged, 'unresolved source at position ' + index, ledger);
    }
  }
  const content = 'Synthetic independent revision validation control';
  const held = ok(core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts: [receipt(content)] })).memory;
  transaction(db, () => writeContentSuppressionInside(db, { namespace: ns, kind: 'memory', key: held.id,
    matchMode: 'version', sourceVersion: JSON.stringify(['memory-revision-v1', held.revision]),
    reason: 'privacy_erase', actionId: 'synthetic-revision-denial' }));
  db.prepare('UPDATE memories SET revision=revision+1 WHERE id=?').run(held.id);
  const current = structuredClone(acknowledgement);
  current.sourceRevisions[0] = { memoryId: held.id, revision: held.revision + 1 };
  assert.equal(deliver(db, current).ok, true, 'current revision is readable despite a fact for the older revision');
  // The Card and all its real sources remain readable. Only the substituted
  // bound revision is denied, so Card validation cannot mask a skipped walk.
  for (const ledger of [false, true]) for (const index of acknowledgement.sourceRevisions.keys()) {
    const forged = structuredClone(acknowledgement);
    forged.sourceRevisions[index] = { memoryId: held.id, revision: held.revision };
    refused(db, forged, 'suppressed source revision at position ' + index, ledger);
  }
  transaction(db, () => writeContentSuppressionInside(db, { namespace: ns, kind: 'card', key: acknowledgement.id,
    reason: 'privacy_erase', actionId: 'synthetic-card-denial' }));
  for (const ledger of [false, true]) refused(db, acknowledgement, 'suppressed generated Card', ledger);
});


for (const denial of ['forget', 'suppress-source', 'suppress-card'])
  test(`maintenance delivery omits sources denied after Card commit: ${denial}`, async t => {
    const { core, db, memories } = await ready(t);
    const source = memories[0];
    const canonical = createEngineCardStorage({ db, ready() {},
      identity: db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
    let committed;
    const storage = { ...canonical, finish(...args) {
      canonical.finish(...args);
      const row = db.prepare("SELECT id,revision FROM private_cards WHERE state='confirmed'").get();
      assert.ok(row, 'Card commit completed before the delivery race');
      assert.equal(db.isTransaction, false);
      committed = row;
      if (denial === 'forget') ok(core.forget({ namespace: ns, memoryId: source.id, expectedRevision: source.revision }));
      else transaction(db, () => writeContentSuppressionInside(db, { namespace: ns,
        kind: denial === 'suppress-card' ? 'card' : 'memory',
        key: denial === 'suppress-card' ? row.id : source.id,
        reason: 'privacy_erase', actionId: 'synthetic-delivery-denial' }));
    } };
    const result = await createEngineCardMaintenance({ storage, model: scriptedConsolidator() })
      .maintain({ namespace: ns, budget: { maxMs: 5000 } });
    assert.ok(committed);
    const listed = result.built.flatMap(card => card.sourceRevisions ?? []);
    assert.equal(listed.some(ref => ref.memoryId === source.id), false, 'denied source id and its bound revision must not be delivered');
    assert.deepEqual(result.built, [], 'an ineligible Card has no delivered source list');
    assert.equal(result.state, 'refused');
    assert.equal(result.reason, 'source_unavailable');
    assert.equal(db.prepare("SELECT count(*) n FROM card_operations WHERE method='consolidate'").get().n, 1,
      'delivery filtering does not rewrite committed provenance');
  });

test('maintenance delivery checks every listed Memory revision independently of Card eligibility', async t => {
  const { core, db, acknowledgement } = await setup(t);
  const content = 'Synthetic independent delivery revision';
  const held = ok(core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts: [receipt(content)] })).memory;
  transaction(db, () => writeContentSuppressionInside(db, { namespace: ns, kind: 'memory', key: held.id,
    matchMode: 'version', sourceVersion: JSON.stringify(['memory-revision-v1', held.revision]),
    reason: 'privacy_erase', actionId: 'synthetic-delivery-version-denial' }));
  db.prepare('UPDATE memories SET revision=revision+1 WHERE id=?').run(held.id);
  const storage = createEngineCardStorage({ db, ready() {},
    identity: db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
  for (const index of acknowledgement.sourceRevisions.keys()) {
    const current = structuredClone(acknowledgement);
    current.sourceRevisions[index] = { memoryId: held.id, revision: held.revision + 1 };
    assert.deepEqual(storage.deliver(ns, [current]), [current], 'current bound revision remains eligible');
    const denied = structuredClone(current);
    denied.sourceRevisions[index].revision = held.revision;
    const delivered = storage.deliver(ns, [denied]);
    assert.equal(delivered.length, 1, 'the real Card remains eligible');
    assert.deepEqual(delivered[0].sourceRevisions, denied.sourceRevisions.filter((_, position) => position !== index),
      'only the denied bound source is omitted at every position');
  }
});


for (const migrated of [false, true]) test(`public maintenance delivery rechecks after the worker resolves and before the public continuation: ${migrated ? 'suppression' : 'legacy'}`, async t => {
  const personal = { ...ns, scope: 'personal', projectId: null };
  const control = await ready(t, migrated, personal);
  const eligible = ok(await control.core.maintainCards({ namespace: personal, budget: { maxMs: 5000 } }));
  assert.equal(eligible.built.length, 1, 'eligible personal sources survive the final namespace normalization');
  const { core, db, memories } = await ready(t, migrated), source = memories[0];
  let worker, forgotten, hookError, committed;
  const hook = createHook({
    init(id, type) {
      if (!worker && type === 'PROMISE' && /at Object\.maintain \(.*engine-card-maintenance\.mjs:/u.test(new Error().stack)) worker = id;
    },
    promiseResolve(id) {
      if (id !== worker) return;
      hook.disable();
      try {
        committed = db.prepare("SELECT id FROM private_cards WHERE state='confirmed' AND revision=1").get();
        forgotten = core.forget({ namespace: ns, memoryId: source.id, expectedRevision: source.revision });
      } catch (error) { hookError = error; }
    },
  });
  t.after(() => hook.disable());
  hook.enable();
  const result = await core.maintainCards({ namespace: ns, budget: { maxMs: 5000 } });
  hook.disable();
  assert.ifError(hookError); assert.ok(worker, 'hook identified the worker promise');
  assert.ok(committed, 'the worker committed and completed its own delivery check before resolving');
  assert.equal(ok(forgotten).forgotten, true, 'forget runs after the worker returns, before public delivery');
  const refs = result.value?.built?.flatMap(card => card.sourceRevisions) ?? [];
  assert.equal(refs.some(ref => ref.memoryId === source.id), false, 'neither the forgotten identity nor its bound revision is delivered');
  const value = ok(result);
  assert.deepEqual(value.built, []); assert.equal(value.state, 'refused'); assert.equal(value.reason, 'source_unavailable');
});


// Include every method-bearing composition, including the default local MCP
// profile and the internal compatibility entry. Re-exports use the same method.
const compositions = [
  { name: 'plain core' },
  { name: 'contract entry', open: openContractCore },
  { name: 'context reads', context: true },
  { name: 'default Raw', rawLayout: true, options: { raw: true } },
  { name: 'explicit Raw', rawLayout: true, options: { rawConversations: defaultRawOptions(), rawSearch: false } },
  { name: 'Raw compatibility', rawLayout: true, open: options => openRawCaptureCore(options, defaultRawOptions()) },
  { name: 'context and default Raw (local MCP)', context: true, rawLayout: true, options: { raw: true } },
  { name: 'context and explicit Raw', context: true, rawLayout: true, options: { rawConversations: defaultRawOptions(), rawSearch: false } },
  { name: 'Raw unsupported fallback', suppressionOnly: true, options: { raw: true } },
  { name: 'context and Raw unsupported fallback', suppressionOnly: true, context: true, options: { raw: true } },
];

// Identify the outer method's last synchronously registered promise reaction.
// This works for async/await and for the facade's then/catch chain: inject at
// the reaction's entry, after all inner workers/facades have settled, before
// the outer method resumes. Never inject at the public promise's resolution,
// which is already beyond the engine's synchronous delivery boundary.
function beforePublicContinuation(t, invoke, work) {
  const promises = [];
  let collecting = true, target, worker, workerReturned = false, ran = false, hookError;
  const hook = createHook({
    init(id, type, _trigger, resource) {
      if (type !== 'PROMISE') return;
      const stack = new Error().stack;
      if (!worker && /at Object\.maintain \(.*engine-card-maintenance\.mjs:/u.test(stack)) worker = id;
      if (!collecting) return;
      const frame = stack.split('\n').find(line =>
        /\/core\/[^/]+\.mjs:\d+:\d+\)/u.test(line));
      promises.push({ id, resource, frame: frame?.replace(/:\d+:\d+\)/u, ')') });
    },
    promiseResolve(id) { if (id === worker) workerReturned = true; },
    before(id) {
      if (id !== target) return;
      hook.disable(); ran = true;
      try { assert.equal(workerReturned, true, 'innermost worker has returned'); work(); } catch (error) { hookError = error; }
    },
  });
  t.after(() => hook.disable());
  hook.enable();
  const pending = invoke();
  collecting = false;
  const outer = promises.find(promise => promise.resource === pending);
  assert.ok(outer?.frame, 'identified the returned public promise');
  target = promises.filter(promise => promise.frame === outer.frame).at(-1).id;
  return { pending, check() { hook.disable(); assert.ifError(hookError); assert.equal(ran, true, 'last outer continuation ran'); } };
}

for (const migrated of [false, true]) for (const composition of compositions) {
  if (composition.suppressionOnly && !migrated) continue;
  test(`late forget at final public continuation: ${composition.name}, ${migrated ? 'suppression' : 'legacy'}`, async t => {
    const { core, db, memories } = await ready(t, migrated, ns, composition), source = memories[0];
    let committed;
    const race = beforePublicContinuation(t,
      () => core.maintainCards({ namespace: ns, budget: { maxMs: 5000 } }), () => {
        committed = db.prepare("SELECT id FROM private_cards WHERE state='confirmed' AND revision=1").get();
        assert.ok(committed, 'innermost worker returned a committed Card before the last public continuation');
        assert.equal(ok(core.forget({ namespace: ns, memoryId: source.id, expectedRevision: source.revision })).forgotten, true);
      });
    const result = await race.pending;
    race.check(); assert.ok(committed);
    const refs = result.value?.built?.flatMap(card => card.sourceRevisions) ?? [];
    assert.equal(refs.some(ref => ref.memoryId === source.id), false, 'forgotten id and its bound revision are absent');
    assert.equal(JSON.stringify(result).includes(source.id), false, 'no forgotten identity anywhere in the acknowledgement');
    const value = ok(result);
    assert.deepEqual(value.built, []); assert.equal(value.state, 'refused'); assert.equal(value.reason, 'source_unavailable');
  });
}


for (const layers of [1, 2, 3]) test(`projection throws at outer layer ${layers}: error result contains no partial acknowledgement`, async () => {
  let projections = 0;
  const engine = createEngineCardMaintenance({ model: scriptedConsolidator(), storage: {
    deliver(_namespace, built) {
      if (++projections === layers) {
        built.pop(); // Deliberately leave a partial acknowledgement before throwing.
        throw Error('synthetic projection refusal');
      }
      return built;
    },
  } });
  const failure = { ok: false, error: { code: 'storage_error', retryable: false } };
  let api = withEngineCardDelivery({ async maintainCards() {
    return { ok: true, value: { built: ['synthetic-card-a', 'synthetic-card-b'].map(id => ({ id,
      sourceRevisions: [{ memoryId: 'synthetic-source', revision: 1 }] })) } };
  } }, null, { project: (input, value) => engine.deliver(input.namespace, value), failure: () => structuredClone(failure) });
  for (let layer = 1; layer < layers; layer++) {
    const base = api;
    api = withEngineCardDelivery({ async maintainCards(input) {
      const result = await base.maintainCards(input);
      return result;
    } }, base);
  }
  const result = await api.maintainCards({ namespace: ns });
  assert.equal(projections, layers, 'every layer retained the very same engine projection');
  assert.deepEqual(result, failure, 'a throwing final projection returns only the error envelope');
  assert.equal(Object.hasOwn(result, 'value'), false);
  assert.equal(JSON.stringify(result).includes('synthetic-source'), false);
});
