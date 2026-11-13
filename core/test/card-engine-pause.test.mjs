import { DatabaseSync, StatementSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { createEpisodeStorage } from '../episode-storage.mjs';
import { createEngineCardStorage } from '../engine-card-storage.mjs';
import { createEngineCardMaintenance } from '../engine-card-maintenance.mjs';
import { observeStatements } from './fixtures/no-provider-statement-observer.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { control } from '../testing/context-semantic-pause-fixture.mjs';
import { engineCardFixture, scriptedConsolidator, ns, ok } from '../testing/engine-card-fixture.mjs';

for (const disabled of [false, true]) test(`Card maintenance skips ${disabled ? 'disabled' : 'paused'} namespace before selection`, async t => {
  const f = engineCardFixture(t); f.seed(8);
  control(f.db, ns, disabled ? { enabled: 0 } : { paused: 1 });
  let selections = 0;
  const all = StatementSync.prototype.all;
  const spy = t.mock.method(StatementSync.prototype, 'all', function(...args) {
    if (/^SELECT \* FROM memories WHERE/u.test(this.sourceSQL)) selections++;
    return Reflect.apply(all, this, args);
  });
  const pass = ok(await f.pass());
  spy.mock.restore();
  t.diagnostic(JSON.stringify({ sends: f.model.calls.length, state: pass.state }));
  assert.equal(f.model.calls.length, 0, 'stored Memory text must not reach consolidate');
  assert.equal(pass.state, 'paused');
  assert.equal(pass.reason, 'namespace_paused');
  assert.equal(selections, 0, 'pause decision precedes cluster selection');
  const allowed = { ...ns, projectId: 'allowed' };
  seedNamespace(f, allowed);
  const next = ok(await f.core.maintainCards({ namespace: allowed, budget: { maxMs: 5000 } }));
  assert.equal(next.built.length, 1, JSON.stringify(next));
  assert.equal(f.model.calls.length, 1, 'next allowed namespace still sends');
});

function seedNamespace(f, namespace) {
  for (let i = 0; i < 8; i++) f.add(`Allowed milestone ${i} records synthetic evidence marker${i}.`, i * 9, i % 6, namespace);
}
function storageFor(f) {
  return createEngineCardStorage({ db: f.db, ready() {}, upgrade: true,
    identity: f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
}

for (const injection of ['last freshness validation', 'first token count'])
for (const disabled of [false, true]) test(`Card transport refuses ${disabled ? 'disable' : 'pause'} after cluster selection (${injection})`, async t => {
  const f = engineCardFixture(t); f.seed(8);
  let selected = false, claimed = false, validations = 0;
  const storage = storageFor(f), claim = storage.claim, validate = storage.validate;
  const inject = () => {
    selected = true;
    createEpisodeStorage({ db: f.db, options: { mode: 'episode-v1' }, advanceEpoch() {} })
      .setControl(ns, { expectedGeneration: 'initial', ...(disabled ? { enabled: false } : { paused: true }) }, disabled);
  };
  storage.claim = (...args) => {
    const attempt = claim(...args);
    claimed = Boolean(attempt);
    return attempt;
  };
  storage.validate = (...args) => {
    const value = validate(...args);
    // callModel validates once around counting and again in the dispatch
    // microtask. Inject after that final canonical read has closed.
    if (claimed && ++validations === 2 && injection === 'last freshness validation') inject();
    return value;
  };
  if (injection === 'first token count') {
    const countTokens = f.model.countTokens;
    f.model.countTokens = text => {
      // Eight Memories need no pressure estimate: this first count sizes the
      // selected cluster's request, before its claim or freshness validation.
      if (!selected) { assert.equal(claimed, false); inject(); }
      return countTokens(text);
    };
  }
  const pass = await createEngineCardMaintenance({ storage, model: f.model })
    .maintain({ namespace: ns, budget: { maxMs: 5000 } });
  assert.equal(selected, true);
  assert.equal(validations, 2, 'injection is followed by the final pre-dispatch validation');
  assert.equal(f.model.calls.length, 0);
  assert.equal(pass.state, 'paused', JSON.stringify(pass));
  assert.equal(pass.reason, 'namespace_paused');
});

for (const disabled of [false, true]) test(`Card ${disabled ? 'disable' : 'pause'} after claim does not consume an attempt`, async t => {
  const f = engineCardFixture(t); f.seed(8);
  const storage = storageFor(f), claim = storage.claim;
  const controls = createEpisodeStorage({ db: f.db, options: { mode: 'episode-v1' }, advanceEpoch() {} });
  let generation = 'initial';
  const setFlag = value => { generation = controls.setControl(ns, { expectedGeneration: generation,
    ...(disabled ? { enabled: !value } : { paused: value }) }, disabled).generation; };
  let claimed = false;
  storage.claim = (...args) => {
    const attempt = claim(...args);
    if (attempt && !claimed) {
      claimed = true;
      setFlag(true);
    }
    return attempt;
  };
  const pass = () => createEngineCardMaintenance({ storage, model: f.model })
    .maintain({ namespace: ns, budget: { maxMs: 5000 } });
  const paused = await pass();
  assert.equal(claimed, true);
  assert.equal(paused.state, 'paused');
  assert.equal(f.model.calls.length, 0);
  const reserved = f.db.prepare("SELECT method FROM card_operations WHERE method IN ('consolidateAttempt','consolidateOutcome')").all();
  setFlag(false);
  const resumed = await pass();
  assert.equal(resumed.built.length, 1, JSON.stringify(resumed));
  assert.equal(f.model.calls.length, 1, 'resume sends exactly once for the same sources');
  assert.deepEqual(reserved, [], 'guard refusal leaves no attempt or outcome');
  const attempt = f.db.prepare("SELECT result FROM card_operations WHERE method='consolidateAttempt'").get();
  assert.equal(JSON.parse(attempt.result).attemptNumber, 1);
  assert.deepEqual(f.db.prepare("SELECT result FROM card_operations WHERE method='consolidateOutcome'").all()
    .map(row => JSON.parse(row.result).outcome), ['succeeded']);
});

test('a genuine Card model refusal remains terminal for the same sources', async t => {
  const model = scriptedConsolidator(() => { throw Error('Synthetic refusal'); });
  const f = engineCardFixture(t, { model }); f.seed(8);
  const storage = storageFor(f);
  let clock = Date.now();
  const pass = () => createEngineCardMaintenance({ storage, model, now: () => clock })
    .maintain({ namespace: ns, budget: { maxMs: 5000 } });
  assert.equal((await pass()).state, 'refused');
  const outcomes = f.db.prepare("SELECT result FROM card_operations WHERE method='consolidateOutcome'").all();
  assert.deepEqual(outcomes.map(row => JSON.parse(row.result).outcome), ['terminal']);
  clock += 3600000;
  assert.equal((await pass()).built.length, 0);
  assert.equal(model.calls.length, 1);
  assert.deepEqual(f.db.prepare("SELECT result FROM card_operations WHERE method='consolidateOutcome'").all(), outcomes);
});

for (const disabled of [false, true]) test(`Card transport sees second-process WAL ${disabled ? 'disable' : 'pause'} committed inside last validation snapshot`, async t => {
  const f = engineCardFixture(t); f.seed(8); f.db.exec('PRAGMA journal_mode=WAL');
  const connections = new WeakMap(), prepare = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, 'prepare', function(sql) {
    const statement = Reflect.apply(prepare, this, [sql]); connections.set(statement, this); return statement;
  });
  let claimed = false, armed = false, observed = false, canonical;
  let snapshots = 0, validationCalls = 0, validatedSnapshot = 0;
  const order = [], exec = DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
    const value = Reflect.apply(exec, this, [sql]);
    if (armed && this === canonical && /^BEGIN\b/u.test(sql)) order.push(`snapshot:${++snapshots}`);
    return value;
  });
  const run = StatementSync.prototype.run;
  t.mock.method(StatementSync.prototype, 'run', function(...args) {
    const value = Reflect.apply(run, this, args);
    if (this.sourceSQL === 'INSERT INTO card_operations VALUES(?,?,?,?,?,?,?,?,?)' && args[4] === 'consolidateAttempt') {
      claimed = true; canonical = connections.get(this);
    }
    return value;
  });
  const countTokens = f.model.countTokens;
  f.model.countTokens = text => { if (claimed) armed = true; return countTokens(text); };
  const get = StatementSync.prototype.get;
  t.mock.method(StatementSync.prototype, 'get', function(...args) {
    const db = connections.get(this);
    // This probe is the first operation of the beforeDispatch pause guard,
    // before it can open its own fresh control-decision snapshot.
    if (armed && db === canonical && this.sourceSQL === 'PRAGMA data_version') {
      order.push('beforeDispatch'); armed = false;
    }
    const value = Reflect.apply(get, this, args);
    if (!armed || db !== canonical || !/^SELECT revision FROM memories WHERE/u.test(this.sourceSQL)) return value;
    if (validatedSnapshot !== snapshots) {
      validatedSnapshot = snapshots;
      order.push(`validate:${++validationCalls}`);
    }
    // The legacy boundary validates once after counting and once in the
    // dispatch microtask. Arm only on that final validation's first source.
    if (observed || validationCalls !== 2) return value;
    observed = true;
    order.push(`hook:${validationCalls}`);
    assert.equal(db.isTransaction, true, 'last source validation snapshot is open');
    const readControl = () => db.prepare('SELECT paused,enabled FROM episode_controls WHERE owner_id=? AND scope=? AND project_id=?')
      .get(ns.ownerId, ns.scope, ns.projectId);
    const before = readControl();
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { DatabaseSync } from 'node:sqlite';
      const [path, namespace, disabled] = process.argv.slice(1), ns = JSON.parse(namespace);
      const db = new DatabaseSync(path);
      db.exec('PRAGMA busy_timeout=5000');
      db.prepare('INSERT INTO episode_controls(owner_id,scope,project_id,generation,paused,enabled) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET paused=excluded.paused,enabled=excluded.enabled')
        .run(ns.ownerId,ns.scope,ns.projectId,'synthetic',disabled === 'true' ? 0 : 1,disabled === 'true' ? 0 : 1);
      console.log(JSON.stringify({pid:process.pid,...db.prepare('SELECT paused,enabled FROM episode_controls').get()})); db.close();
    `, f.path, JSON.stringify(ns), String(disabled)], { encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 0, child.stderr);
    const acknowledgement = JSON.parse(child.stdout);
    assert.notEqual(acknowledgement.pid, process.pid);
    assert.equal(disabled ? acknowledgement.enabled : acknowledgement.paused, disabled ? 0 : 1);
    assert.deepEqual(readControl(), before, 'open WAL snapshot retains the old control decision');
    t.diagnostic(JSON.stringify({ childExit: child.status, differentPid: true, snapshotOpen: db.isTransaction, staleControl: true }));
    return value;
  });
  const pass = ok(await f.pass());
  t.diagnostic(JSON.stringify({ order, validationCalls }));
  assert.equal(observed, true, 'writer committed at the last validation seam');
  const hook = order.findIndex(event => event.startsWith('hook:')), guard = order.indexOf('beforeDispatch');
  assert.ok(guard > hook, 'hook precedes the dispatch guard');
  assert.deepEqual(order.slice(hook + 1, guard).filter(event => event.startsWith('snapshot:')), [],
    'no canonical snapshot opens between the WAL hook and beforeDispatch');
  assert.equal(validationCalls, 2, 'both legacy-boundary pre-dispatch validations observed');
  assert.deepEqual(order, ['snapshot:1', 'validate:1', 'snapshot:2', 'validate:2', 'hook:2', 'beforeDispatch']);
  assert.equal(f.model.calls.length, 0);
  assert.equal(pass.state, 'paused', JSON.stringify(pass));
  assert.equal(pass.reason, 'namespace_paused');
});

for (const model of [undefined, {}]) test(`Card maintenance without consolidate (${model ? 'other model' : 'no model'}) performs no pause SQL`, async t => {
  const f = engineCardFixture(t); f.seed(8);
  const storage = storageFor(f), buffer = new SharedArrayBuffer(24), counts = new Int32Array(buffer);
  const restore = observeStatements(buffer); t.after(restore);
  Atomics.store(counts, 0, 1);
  let pass;
  try { pass = await createEngineCardMaintenance({ storage, model }).maintain({ namespace: ns }); }
  finally { Atomics.store(counts, 0, 0); }
  assert.equal(pass.state, 'model_not_configured');
  assert.equal(counts[2], 0, 'zero episode_controls reads on real connection');
  assert.equal(counts[3], 0, 'zero data_version probes on real connection');
  t.diagnostic(JSON.stringify({ statements: counts[1], controlReads: counts[2], probes: counts[3] }));
});

test('Card pass reuses one control decision and probes again at dispatch', async t => {
  const f = engineCardFixture(t); f.seed(8);
  const buffer = new SharedArrayBuffer(24), counts = new Int32Array(buffer);
  const restore = observeStatements(buffer); t.after(restore);
  Atomics.store(counts, 0, 1);
  let pass;
  try { pass = ok(await f.pass()); } finally { Atomics.store(counts, 0, 0); }
  assert.equal(pass.built.length, 1, JSON.stringify(pass));
  assert.equal(counts[2], 1, 'stable namespace decision reused');
  assert.equal(counts[3], 2, 'selection and final transport each probe');
});

test('Card pause decision refuses an already open read transaction', async t => {
  const f = engineCardFixture(t); f.seed(8);
  const storage = storageFor(f);
  f.db.exec('BEGIN');
  try {
    assert.throws(() => storage.pauseGuard(ns, Infinity)(), { code: 'storage_error' });
    assert.equal(f.model.calls.length, 0);
  } finally { f.db.exec('ROLLBACK'); }
});
