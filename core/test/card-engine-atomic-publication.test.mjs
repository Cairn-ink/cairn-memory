import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { engineCardFixture, scriptedConsolidator, ns } from '../testing/engine-card-fixture.mjs';
import { createEngineCardStorage } from '../engine-card-storage.mjs';
import { createEngineCardMaintenance } from '../engine-card-maintenance.mjs';
import { clusterMemories, partitionCardClusters } from '../engine-card-clusters.mjs';
import { bindCommitConnection, bindCommitRuntime, createCommitDispatcher } from '../commit-dispatch.mjs';
import { control } from '../testing/context-semantic-pause-fixture.mjs';

const noop = () => {}, clock = Date.UTC(2026, 5, 1), timestamp = new Date(clock).toISOString();
const failure = code => Object.assign(Error('synthetic write refusal'), { code });
const storageFor = db => createEngineCardStorage({ db, upgrade: true, ready: noop,
  identity: db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
const pass = (storage, model) => createEngineCardMaintenance({ storage, model, now: () => clock })
  .maintain({ namespace: ns, budget: { maxMs: 5000 } });
function fixture(t) {
  const f = engineCardFixture(t); f.file(f.seed(18), 'Orion');
  const storage = storageFor(f.db), parts = partitionCardClusters(clusterMemories(storage.snapshot(ns, 512, noop).memories));
  const attempt = storage.claim(ns, parts[0], timestamp, noop); storage.release(ns, attempt);
  const oldMemory = parts[0].memories[0];
  const body = `2026-01-01: ${oldMemory.content} [${oldMemory.id}]`;
  const old = storage.commit(ns, parts[0], { body }, timestamp, noop);
  const model = scriptedConsolidator(({ input }) => ({
    currentState: [{ text: 'ok', memoryIds: [input.memories[0].id] }],
    timeline: [{ date: oldMemory.date, text: 'replaced', memoryIds: [oldMemory.id] }], contradictions: [],
  }));
  return { ...f, storage, parts, old, oldMemory, body, model };
}
function hosted(f, onAwait) {
  const host = createCommitDispatcher({ strict: true, onAwait });
  host.open(() => bindCommitConnection(f.db)); bindCommitRuntime(f.storage, f.db);
  return host;
}
function state(f) {
  const cards = f.storage.cards(ns);
  return { published: cards.some(card => card.clusterKey === f.parts[1].key && card.status === 'current'),
    retired: cards.find(card => card.id === f.old.id)?.status !== 'current' };
}
function assertAtomic(f) {
  const value = state(f);
  assert.notDeepEqual(value, { published: true, retired: false }, 'publication must never leave the obsolete current line deliverable');
}
function observeCommits(t, f) {
  const exec = f.db.exec;
  let split = false;
  const mock = t.mock.method(f.db, 'exec', function(sql) {
    const result = Reflect.apply(exec, this, [sql]);
    if (sql === 'COMMIT') {
      // Read rows directly here: Card delivery opens its own read transaction.
      const old = f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(f.old.id);
      const published = f.db.prepare("SELECT count(*) n FROM private_cards c JOIN card_operations o ON o.target_id=c.id WHERE o.method='consolidate' AND json_extract(o.result,'$.clusterKey')=? AND c.state='confirmed' AND c.revision=1").get(f.parts[1].key).n;
      if (published && old.revision === 1) split = true;
    }
    return result;
  });
  return { split: () => split, restore: () => mock.mock.restore() };
}

test('B1: a real pause after output validation rolls back the unit; resume publishes and retires together', async t => {
  const f = fixture(t), pauseDb = new DatabaseSync(f.path); t.after(() => pauseDb.close());
  let units = 0, injected = false, validated = false;
  const count = f.model.countTokens;
  f.model.countTokens = text => { if (text.startsWith('2026-')) validated = true; return count(text); };
  const host = hosted(f, ({ point }) => {
    if (point === 'attempt' && ++units === 3 && !injected) {
      assert.equal(validated, true, 'the output body was validated before the write unit');
      injected = true; control(pauseDb, ns, { paused: 1 });
    }
  });
  const before = f.db.prepare('SELECT * FROM private_cards ORDER BY id').all();
  const paused = await host.run(() => pass(f.storage, f.model));
  assert.equal(injected, true); assert.equal(paused.state, 'paused'); assert.equal(paused.reason, 'namespace_paused');
  assert.deepEqual(paused.built, []); assert.equal(paused.modelCalls, 1);
  assert.deepEqual(state(f), { published: false, retired: false });
  assert.deepEqual(f.db.prepare('SELECT * FROM private_cards ORDER BY id').all(), before);
  assert.equal(f.db.prepare("SELECT count(*) n FROM card_operations WHERE method='consolidateAttempt'").get().n, 0);
  control(pauseDb, ns);
  const observed = observeCommits(t, f);
  const resumed = await host.run(() => pass(f.storage, f.model)); observed.restore();
  assert.equal(resumed.modelCalls, 1); assert.equal(resumed.built.length, 1, JSON.stringify(resumed));
  assert.deepEqual(state(f), { published: true, retired: true });
  assert.equal(observed.split(), false, 'resume also has no committed publication-only state');
});

test('B2: refusal before the unit and failure during retirement both release the attempt and allow retry', async t => {
  for (const location of ['before write', 'retirement statement']) {
    const f = fixture(t), commit = f.storage.commit, run = StatementSync.prototype.run;
    let injected = false;
    f.storage.commit = (...args) => {
      if (!injected && location === 'before write') { injected = true; throw failure('storage_busy'); }
      return commit(...args);
    };
    const mock = t.mock.method(StatementSync.prototype, 'run', function(...args) {
      if (!injected && location === 'retirement statement' &&
          this.sourceSQL === 'UPDATE private_cards SET revision=revision+1,updated_at=? WHERE id=?' && args[1] === f.old.id) {
        injected = true; throw failure('consolidation_failed');
      }
      return Reflect.apply(run, this, args);
    });
    const host = hosted(f), before = f.db.prepare('SELECT * FROM private_cards ORDER BY id').all();
    const refused = await host.run(() => pass(f.storage, f.model)); mock.mock.restore();
    assert.equal(injected, true); assert.equal(refused.state, 'refused'); assert.deepEqual(refused.built, []);
    assert.equal(refused.reason, location === 'before write' ? 'storage_busy' : 'consolidation_failed');
    assert.deepEqual(state(f), { published: false, retired: false }, location);
    assert.deepEqual(f.db.prepare('SELECT * FROM private_cards ORDER BY id').all(), before);
    assert.equal(f.db.prepare("SELECT count(*) n FROM card_operations WHERE method IN ('consolidateAttempt','consolidateOutcome')").get().n, 0,
      'failed combined writes release the attempt rather than recording a terminal output');
    const next = await host.run(() => pass(f.storage, f.model));
    assert.equal(next.modelCalls, 1); assert.equal(next.built.length, 1, JSON.stringify(next));
    assert.deepEqual(state(f), { published: true, retired: true });
  }
});

test('B3: every dispatcher unit boundary preserves atomic publication and retirement', async t => {
  // These are all units for this unchanged-first-part/buildable-tail pass.
  // On the baseline, unit 3 publishes alone, unit 4 retires, unit 5 finishes.
  const boundaries = ['snapshot', 'claim', 'publication with retirements', 'finish'];
  for (const [index, name] of boundaries.entries()) for (const phase of ['attempt', 'return']) {
    const f = fixture(t); let unit = 0, injected = false;
    const host = hosted(f, ({ point }) => {
      if (point === 'attempt') unit++;
      if (!injected && unit === index + 1 && point === phase) { injected = true; throw failure('namespace_paused'); }
    });
    const result = await host.run(() => pass(f.storage, f.model));
    assert.equal(injected, true, `${name}: ${phase}`);
    assert.equal(result.state, 'paused', `${name}: ${phase}`);
    assertAtomic(f);
  }
});

test('retirement-only output applies all current-line retirements in one unit and leaves Timeline Cards alone', async t => {
  const f = fixture(t);
  const second = f.storage.commit(ns, { ...f.parts[0], key: 'moc:synthetic-second-current' }, { body: f.body }, timestamp, noop);
  const history = f.storage.commit(ns, { ...f.parts[0], key: 'moc:synthetic-timeline' }, { body: 'Timeline: ' + f.body }, timestamp, noop);
  const historyBefore = f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(history.id);
  const model = scriptedConsolidator(({ input }) => ({ currentState: [], contradictions: [],
    timeline: input.memories.filter(memory => f.parts[1].memories.some(own => own.id === memory.id) || memory.id === f.oldMemory.id)
      .map(memory => ({ text: 'replaced', date: memory.date, memoryIds: [memory.id] })) }));
  const run = StatementSync.prototype.run; let retirements = 0;
  const mock = t.mock.method(StatementSync.prototype, 'run', function(...args) {
    if (this.sourceSQL === 'UPDATE private_cards SET revision=revision+1,updated_at=? WHERE id=?' &&
        [f.old.id, second.id].includes(args[1]) && ++retirements === 2) throw failure('storage_busy');
    return Reflect.apply(run, this, args);
  });
  const host = hosted(f), result = await host.run(() => pass(f.storage, model)); mock.mock.restore();
  assert.equal(result.state, 'refused'); assert.equal(retirements, 2); assert.deepEqual(result.built, []);
  assert.ok([f.old.id, second.id].every(id => f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(id).revision === 1),
    'a failure in the second retirement also rolls back the first');
  const resumed = await host.run(() => pass(f.storage, model));
  assert.equal(resumed.modelCalls, 1); assert.deepEqual(resumed.built, []);
  assert.ok([f.old.id, second.id].every(id => f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(id).revision === 2));
  assert.deepEqual(f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(history.id), historyBefore);
});

test('B4: direct publication matches the baseline rows and result bytes with no intermediate committed split', async t => {
  const f = fixture(t);
  // A local SQLite copy retains identical source/store IDs. No Git checkout,
  // archived code or network is used by this reference orchestration.
  f.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const referencePath = join(f.workspace.path, 'publication-reference.sqlite'); copyFileSync(f.path, referencePath);
  const referenceDb = new DatabaseSync(referencePath); t.after(() => referenceDb.close());
  referenceDb.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  const reference = storageFor(referenceDb), referenceCommit = reference.commit;
  // a51d4e5e's effect order: publish, retire each selected Card, finish.
  // Calling the extended commit without its retirement arguments preserves
  // the original publication transaction; retire uses its original wrapper.
  reference.commit = (namespace, cluster, value, time, check, retirements = []) => {
    const card = value.body ? referenceCommit(namespace, cluster, value, time, check) : null;
    for (const id of retirements) reference.retire(namespace, id, time);
    return card;
  };
  let sequence = 0;
  const mock = t.mock.method(crypto, 'randomUUID', () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`);
  syncBuiltinESMExports();
  const observed = observeCommits(t, f);
  let actual, expected;
  t.mock.timers.enable({ apis: ['Date'], now: clock });
  try {
    actual = await pass(f.storage, f.model); sequence = 0;
    expected = await pass(reference, f.model);
  } finally { t.mock.timers.reset(); observed.restore(); mock.mock.restore(); syncBuiltinESMExports(); }
  const rows = db => ['private_cards', 'card_memory_bindings', 'card_operations', 'card_epochs', 'card_applicability_reviews']
    .map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  assert.equal(actual.built.length, 1); assert.deepEqual(state(f), { published: true, retired: true });
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), 'returned result is byte-identical to the baseline effect sequence');
  assert.equal(JSON.stringify(rows(f.db)), JSON.stringify(rows(referenceDb)), 'stored rows are byte-identical to the baseline effect sequence');
  assert.equal(observed.split(), false, 'the direct path also removes the intermediate committed split');
});
