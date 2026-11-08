import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, linkSync, chmodSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { upgradeLayoutBase } from '../layout-base-upgrade.mjs';
import { openDatabase } from '../database.mjs';
import { openMemoryCore } from '../index.mjs';
import { migrateReceiptEventTime } from '../content-safety-migration.mjs';
import { resolveContentLayout, assertContentFeatures, contentSafetyPin } from '../content-safety-layout.mjs';
import { safetyFixture, copySqliteFixture, readSqliteFixture, quiescence, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { ns, options as episodeOptions, digest } from '../testing/episode-helpers.mjs';
import { model, input as episodeInput, interpretation } from '../testing/episode-capture-helpers.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';

const fullOptions = Object.freeze({ privateCards: true, rawConversations: true, rawCapture: true,
  rawLineage: true, rawDeletion: true, rawSources: true, localControls: true, methodPackages: true,
  assets: true, roleProfiles: true, currentDependencies: true });
const other = { ...ns, ownerId: 'synthetic-other' };
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const hash = value => createHash('sha256').update(value).digest('hex');
const fileHash = path => hash(readSqliteFixture(path));
const schema = db => db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name,tbl_name,sql').all();
function rows(db, tables) {
  return Object.fromEntries(tables.map(name => {
    const query = db.prepare(`SELECT * FROM ${quote(name)}`); query.setReadBigInts(true);
    return [name, query.all().map(row => JSON.stringify(row, (_, v) =>
      typeof v === 'bigint' ? ['integer', String(v)] : v instanceof Uint8Array ? ['blob', Buffer.from(v).toString('hex')] : v)).sort()];
  }));
}
function inspect(path, work) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return work(db); } finally { db.close(); }
}
const version = path => inspect(path, db => db.prepare('PRAGMA user_version').get().user_version);
const request = f => ({ path: f.path, backupPath: f.backupPath,
  expected: { storeId: f.storeId, fromBase: 18, toBase: 33 }, quiescence });

async function fixture(t) {
  const f = safetyFixture(t);
  const port = model({ interpretEpisode(request) {
    const result = interpretation(request);
    return { ...result, nextStep: { ...result.gist, value: 'Review synthetic evidence' } };
  } });
  const core = openMemoryCore({ path: f.path, model: port, ...episodeOptions });
  const memories = [];
  try {
    for (const namespace of [ns, other]) {
      memories.push(ok(core.admit({ namespace, memory: { content: 'Synthetic offline preference', kind: 'preference' },
        receipts: [receipt('first', 'Synthetic offline preference'), receipt('second', 'Synthetic offline preference')] })).memory);
      ok(await core.capture(episodeInput(1, 'synthetic-episode', { namespace })));
      const paused = ok(core.setCapturePaused({ namespace, expectedGeneration: 'initial', paused: true }));
      ok(core.setCapturePaused({ namespace, expectedGeneration: paused.generation, paused: false }));
    }
  } finally { core.close(); }
  inspect(f.path, db => {
    assert.equal(db.prepare('SELECT count(DISTINCT owner_id) n FROM memories').get().n, 2);
    for (const table of ['memories', 'receipts', 'session_episodes', 'episode_controls'])
      assert.ok(db.prepare(`SELECT count(*) n FROM ${table}`).get().n >= 2, table);
  });
  copySqliteFixture(f.path, f.backupPath);
  return { ...f, memories };
}

test('T1 explicit upgrade matches the full opener schema, version steps and every legacy row', async t => {
  const f = await fixture(t), a = join(f.workspace.path, 'implicit.sqlite');
  copySqliteFixture(f.path, a);
  const tables = inspect(f.path, db => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(r => r.name));
  const before = inspect(f.path, db => rows(db, tables));
  const exec = DatabaseSync.prototype.exec, traces = [[], []];
  let branch = 0;
  DatabaseSync.prototype.exec = function(sql) {
    for (const match of sql.matchAll(/PRAGMA user_version\s*=\s*(\d+)/g)) traces[branch].push(Number(match[1]));
    return exec.call(this, sql);
  };
  let result;
  try {
    openDatabase(a, fullOptions).close(); branch = 1;
    result = await upgradeLayoutBase(request(f));
  } finally { DatabaseSync.prototype.exec = exec; }
  assert.deepEqual(traces[1], traces[0]);
  assert.deepEqual(traces[1], [23,24,25,26,27,28,29,29,30,31,32,33]);
  const snapshot = path => inspect(path, db => ({ schema: schema(db),
    version: db.prepare('PRAGMA user_version').get(), app: db.prepare('PRAGMA application_id').get(), rows: rows(db, tables) }));
  assert.deepEqual(snapshot(f.path), snapshot(a));
  assert.deepEqual(snapshot(f.path).rows, before);
  assert.equal(version(f.path), 33);
  assert.deepEqual(result, { storeId: f.storeId, fromBase: 18, toBase: 33,
    counts: Object.fromEntries(tables.map(name => [name, before[name].length])) });
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.counts));
  assert.equal(version(f.backupPath), 18);
});

test('T2 refusals preserve source and backup bytes and expose only closed codes', async t => {
  const seed = await fixture(t);
  const cases = [
    ...Object.keys(quiescence).flatMap(flag => [false, undefined].map(value => [
      `${flag}:${value}`, 'invalid_input', async (f, input) => {
        input.quiescence = { ...quiescence };
        if (value === undefined) delete input.quiescence[flag]; else input.quiescence[flag] = value;
      },
    ])),
    ['same inode', 'invalid_input', async (f, input) => {
      input.backupPath = join(f.workspace.path, 'hardlink.sqlite'); linkSync(f.path, input.backupPath);
    }],
    ['backup inventory mismatch', 'unsupported_database', async f => {
      const db = new DatabaseSync(f.path); try { db.exec("INSERT INTO suppressed VALUES('synthetic','personal','','synthetic')"); } finally { db.close(); }
    }],
    ['WAL', 'unsafe_database_file', async f => {
      const db = new DatabaseSync(f.path); db.exec('PRAGMA journal_mode=WAL'); db.close();
      copySqliteFixture(f.path, f.backupPath);
    }],
    ['wrong identity', 'unsupported_database', async (f, input) => { input.expected.storeId = 'synthetic-wrong'; }],
    ['fromBase', 'invalid_input', async (f, input) => { input.expected.fromBase = 23; }],
    ['toBase', 'invalid_input', async (f, input) => { input.expected.toBase = 32; }],
    ['already 33', 'unsupported_database', async f => { openDatabase(f.path, fullOptions).close(); copySqliteFixture(f.path, f.backupPath); }],
    ['safety 51', 'unsupported_database', async f => {
      await migrateReceiptEventTime({ path: f.path, backupPath: f.backupPath, expected: { storeId: f.storeId, base: 18 }, quiescence });
      copySqliteFixture(f.path, f.backupPath);
    }],
    ['missing path', 'unsupported_database', async (f, input) => { input.path = join(f.workspace.path, 'missing.sqlite'); }],
    ['unknown key', 'invalid_input', async (f, input) => { input.extra = true; }],
    ['nested unknown key', 'invalid_input', async (f, input) => { input.expected.extra = true; }],
    ['quiescence unknown key', 'invalid_input', async (f, input) => { input.quiescence = { ...quiescence, extra: true }; }],
    ['input accessor', 'invalid_input', async (f, input) => { Object.defineProperty(input, 'path', { get() { throw Error('accessor evaluated'); } }); }],
    ['nested accessor', 'invalid_input', async (f, input) => { Object.defineProperty(input.expected, 'storeId', { get() { throw Error('accessor evaluated'); } }); }],
    ['symbol key', 'invalid_input', async (f, input) => { input[Symbol('synthetic')] = true; }],
    ['source permissions', 'unsafe_database_file', async f => { chmodSync(f.path, 0o644); }],
    ['source symlink', 'unsafe_database_file', async (f, input) => {
      const path = join(f.workspace.path, 'link.sqlite'); symlinkSync(f.path, path); input.path = path;
    }],
    ['companion', 'unsafe_database_file', async f => { copySqliteFixture(f.backupPath, f.path + '-journal'); }],
  ];
  for (const [name, code, prepare] of cases) await t.test(name, async t => {
    const f = safetyFixture(t); copySqliteFixture(seed.path, f.path); copySqliteFixture(seed.path, f.backupPath); f.storeId = seed.storeId;
    const input = request(f); await prepare(f, input);
    const before = fileHash(f.path), backup = fileHash(f.backupPath);
    await assert.rejects(() => upgradeLayoutBase(input), error => {
      assert.equal(error.code, code); assert.equal(error.message, code); return true;
    });
    assert.equal(fileHash(f.path), before); assert.equal(fileHash(f.backupPath), backup);
    if (name === 'missing path') assert.equal(existsSync(input.path), false);
  });
  for (const nested of [false, true]) await t.test(`proxy ${nested ? 'nested' : 'root'}`, async () => {
    let reflected = false;
    const trap = { get() { reflected = true; throw Error('proxy evaluated'); }, ownKeys() { reflected = true; throw Error('proxy evaluated'); } };
    const input = request(seed);
    if (nested) input.expected = new Proxy(input.expected, trap);
    const before = fileHash(seed.path);
    await assert.rejects(() => upgradeLayoutBase(nested ? input : new Proxy(input, trap)), { code: 'invalid_input' });
    assert.equal(reflected, false); assert.equal(fileHash(seed.path), before);
  });
});

test('T3 an error after installation starts rolls back schema, version and bytes', async t => {
  const f = await fixture(t), before = fileHash(f.path);
  const schemaBefore = inspect(f.path, db => hash(JSON.stringify(schema(db))));
  const exec = DatabaseSync.prototype.exec;
  let installed = false;
  DatabaseSync.prototype.exec = function(sql) {
    const result = exec.call(this, sql);
    if (sql.includes('CREATE TABLE raw_conversations')) {
      installed = true;
      assert.equal(this.prepare('PRAGMA user_version').get().user_version, 23);
      throw Error('synthetic-install-failure');
    }
    return result;
  };
  try { await assert.rejects(() => upgradeLayoutBase(request(f)), { code: 'unsupported_database' }); }
  finally { DatabaseSync.prototype.exec = exec; }
  assert.equal(installed, true); assert.equal(version(f.path), 18);
  assert.equal(inspect(f.path, db => hash(JSON.stringify(schema(db)))), schemaBefore);
  assert.equal(fileHash(f.path), before);
});

test('T4 explicit upgrade composes with event-time maintenance and existing-only Raw checks', async t => {
  const f = await fixture(t); await upgradeLayoutBase(request(f));
  copySqliteFixture(f.path, f.backupPath);
  const result = await migrateReceiptEventTime({ path: f.path, backupPath: f.backupPath,
    expected: { storeId: f.storeId, base: 33 }, quiescence });
  assert.equal(result.physical, 53); assert.equal(version(f.path), 53);
  const layout = resolveContentLayout(53);
  for (const feature of ['rawSources', 'rawLineage', 'rawDeletion']) assert.equal(layout[feature], true);
  assertContentFeatures(layout, { rawSources: true, rawLineage: true, rawDeletion: true });
  openDatabase(f.path, { existingStore: contentSafetyPin(layout, f.storeId), rawSources: true }).close();
});

// Preserve all result fields. Only generated identities/clocks (including signed
// cursor payloads) are normalized; error codes and semantic values stay exact.
function normalizer() {
  const entities = new Map(), generations = new Map();
  const identity = (value, key) => {
    const ids = key === 'generation' ? generations : entities;
    if (!ids.has(value)) ids.set(value, `generated-${key === 'generation' ? 'generation-' : ''}${ids.size + 1}`);
    return ids.get(value);
  };
  function normalize(value, key = '') {
    if (Array.isArray(value)) return value.map(item => normalize(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, k)]));
    if (typeof value !== 'string') return value;
    if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && !value.startsWith('1901-')) return 'generated-time';
    if (/Cursor$/.test(key)) {
      const payload = value.split('.')[0];
      return normalize(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    }
    return value.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, match => identity(match, key));
  }
  return normalize;
}

async function hostSequence(path, f) {
  const model = rationaleModel();
  const core = openMemoryCore({ path, model }), results = [];
  const call = async (method, input, expectedCode) => {
    // A host opens a separate episode-mode request core for these two setters.
    const requestCore = method === 'setCapturePaused' || method === 'setProjectCapture'
      ? openMemoryCore({ path, model, sessionEpisodes: { mode: 'episode-v1' } }) : null;
    let result;
    try { result = await (requestCore ?? core)[method](input); }
    finally { requestCore?.close(); }
    results.push({ method, result });
    if (expectedCode) assert.equal(result.error?.code, expectedCode, `${method}: ${JSON.stringify(result)}`);
    else ok(result);
    return result.value;
  };
  try {
    const memory = f.memories[0];
    await call('recall', { readSet: [ns], query: 'Synthetic offline preference' });
    await call('list', { namespace: ns });
    const detail = await call('get', { namespace: ns, memoryId: memory.id, receiptLimit: 1, includeAwaiting: false });
    assert.ok(detail.nextReceiptCursor);
    await call('get', { namespace: ns, memoryId: memory.id, receiptLimit: 1, receiptCursor: detail.nextReceiptCursor });
    await call('get', { namespace: ns, memoryId: memory.id, includeAwaiting: true }, 'invalid_input');
    await call('map', { namespace: ns });
    await call('confirm', { namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
      actionId: 'synthetic-confirm', receipt: receipt('confirm') }, 'decision_review_required');
    await call('reject', { namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
      actionId: 'synthetic-reject' }, 'decision_review_required');
    const episodes = await call('listEpisodes', { namespace: ns, since: '1901-02-01T00:00:00.000Z', until: '1901-03-01T00:00:00.000Z' });
    assert.equal(episodes.items.length, 1);
    const episodeId = episodes.items[0].id;
    const episode = await call('getEpisode', { namespace: ns, episodeId });
    await call('sessionStartContext', { namespace: ns });
    await call('closeEpisodeNextStep', { namespace: ns, episodeId, expectedRevision: episode.episode.revision,
      stepId: episode.episode.nextStep.id, actionId: 'synthetic-close', action: 'completed' });
    const control = await call('getCaptureControl', { namespace: ns });
    assert.equal(typeof core.getCaptureControlAsync, 'undefined');
    const paused = await call('setCapturePaused', { namespace: ns, expectedGeneration: control.generation, paused: true });
    const resumed = await call('setCapturePaused', { namespace: ns, expectedGeneration: paused.generation, paused: false });
    const stopped = await call('setProjectCapture', { namespace: ns, expectedGeneration: resumed.generation, enabled: false });
    await call('setProjectCapture', { namespace: ns, expectedGeneration: stopped.generation, enabled: true });
    const r = detail.receipts[0];
    await call('setProceduralMemory', { namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
      expectedTagRevision: 0, procedural: { anchors: [{ receiptId: r.id, digest: digest(r.excerpt), start: 0, end: 9 }] } });
    await call('listReviewTransitions', { namespace: ns }, 'decision_review_required');
    await call('listReviewConflicts', { namespace: ns }, 'decision_review_required');
    const admitted = await call('admit', { namespace: ns, memory: { content: 'Synthetic host admission', kind: 'fact' },
      receipts: [receipt('host-admit')] });
    const corrected = await call('correct', { namespace: ns, memoryId: admitted.memory.id, expectedRevision: admitted.memory.revision,
      content: 'Synthetic corrected admission', kind: 'fact', receipt: receipt('host-correct') });
    await call('forget', { namespace: ns, memoryId: admitted.memory.id, expectedRevision: corrected.memory.revision });
    const key = { namespace: ns, client: 'synthetic', eventId: 'host-claim', payloadDigest: digest('host-claim') };
    const claim = await call('claimAdmission', { ...key, leaseMs: 1000 });
    await call('inspectAdmission', { namespace: ns, client: key.client, eventId: key.eventId });
    await call('finishAdmission', { ...key, token: claim.token, items: [{ content: 'Synthetic claimed admission', kind: 'fact',
      confidence: 0.8, receipts: [receipt('host-claim')] }] });
    await call('inspectAdmission', { namespace: ns, client: key.client, eventId: key.eventId });
    await call('capture', { namespace: ns, client: 'synthetic', sessionId: 'host-capture', eventId: 'host-capture',
      messages: [{ id: 'host-message', role: 'user', content: 'Synthetic host captured fact.' }] });
    const latest = await call('getEpisode', { namespace: ns, episodeId });
    await call('forgetEpisode', { namespace: ns, episodeId, expectedRevision: latest.episode.revision });
    await call('getEpisode', { namespace: ns, episodeId }, 'episode_not_found');
    await call('get', { namespace: other, memoryId: f.memories[1].id });
    return results;
  } finally { core.close(); }
}

test('T5 host request facades are invariant between safety base 18 and upgraded safety base 33', async t => {
  const f = await fixture(t), a = join(f.workspace.path, 'base18.sqlite'); copySqliteFixture(f.path, a);
  await migrateReceiptEventTime({ path: a, backupPath: f.backupPath, expected: { storeId: f.storeId, base: 18 }, quiescence });
  await upgradeLayoutBase(request(f)); copySqliteFixture(f.path, f.backupPath);
  await migrateReceiptEventTime({ path: f.path, backupPath: f.backupPath, expected: { storeId: f.storeId, base: 33 }, quiescence });
  const left = normalizer()(await hostSequence(a, f)), right = normalizer()(await hostSequence(f.path, f));
  assert.equal(version(a), 51); assert.equal(version(f.path), 53);
  t.diagnostic('getCaptureControlAsync is absent from the openMemoryCore facade; all other requested methods were exercised.');
  const differences = right.flatMap((step, i) => isDeepStrictEqual(step, left[i]) ? [] : [{ step: i, method: step.method, base18: left[i].result, base33: step.result }]);
  for (const difference of differences) t.diagnostic(JSON.stringify(difference));
  assert.deepEqual(right, left);
});

test('T5b documented default-facade difference: capture setters succeed on Raw-capable layout 53 and require episode mode on 51', async t => {
  const f = await fixture(t), a = join(f.workspace.path, 'base18.sqlite'); copySqliteFixture(f.path, a);
  await migrateReceiptEventTime({ path: a, backupPath: f.backupPath, expected: { storeId: f.storeId, base: 18 }, quiescence });
  await upgradeLayoutBase(request(f)); copySqliteFixture(f.path, f.backupPath);
  await migrateReceiptEventTime({ path: f.path, backupPath: f.backupPath, expected: { storeId: f.storeId, base: 33 }, quiescence });
  for (const [path, physical] of [[a, 51], [f.path, 53]]) {
    assert.equal(version(path), physical);
    const core = openMemoryCore({ path, model: rationaleModel() });
    try {
      let control = ok(core.getCaptureControl({ namespace: ns }));
      for (const [method, flags] of [
        ['setCapturePaused', { paused: true }], ['setCapturePaused', { paused: false }],
        ['setProjectCapture', { enabled: false }], ['setProjectCapture', { enabled: true }],
      ]) {
        const result = await core[method]({ namespace: ns, expectedGeneration: control.generation, ...flags });
        if (physical === 51) assert.deepEqual(result, { ok: false, error: { code: 'episode_mode_required', retryable: false } });
        else {
          const next = ok(result);
          assert.notEqual(next.generation, control.generation);
          assert.deepEqual(next, { ...control, ...flags, generation: next.generation });
          control = next;
        }
      }
    } finally { core.close(); }
  }
});
