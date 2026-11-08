import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, linkSync, chmodSync, symlinkSync, renameSync } from 'node:fs';
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
import { openRawCaptureCore } from '../raw-capture.mjs';
import { createRawSourceRoots } from '../raw-source-roots.mjs';
import { fixture as rawFixture, ns as rawNs, request as rawRequest, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import { consumer, empty, episodeInput as legacyEpisodeInput, internal, legacyKeep, opposite, runtimeFor } from '../testing/raw-deletion-review-fixtures.mjs';

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

async function fixture(t, variant = 'empty') {
  const f = safetyFixture(t);
  const port = model({ ...(variant === 'empty' ? {} : { extract: rationaleModel().extract }), interpretEpisode(request) {
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
  let linked;
  if (variant === 'legacy-support') {
    linked = inspect(f.path, db => db.prepare("SELECT m.* FROM memories m JOIN episode_memory_links l ON l.memory_id=m.id WHERE m.owner_id=? LIMIT 1").get(ns.ownerId));
    assert.ok(linked);
    const core = openMemoryCore({ path: f.path, model: rationaleModel() });
    try {
      assert.equal(ok(core.admit({ namespace: ns, memory: { content: linked.content, kind: linked.kind },
        receipts: [receipt('legacy-support', 'Synthetic independent retained support')] })).memory.id, linked.id);
    } finally { core.close(); }
  }
  copySqliteFixture(f.path, f.backupPath);
  return { ...f, memories, linked };
}

test('T1 explicit upgrade matches the full opener schema, version steps and every table', async t => {
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
    version: db.prepare('PRAGMA user_version').get(), app: db.prepare('PRAGMA application_id').get(), rows: rows(db, db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(r => r.name)) }));
  assert.deepEqual(snapshot(f.path), snapshot(a));
  assert.deepEqual(inspect(f.path, db => rows(db, tables)), before);
  const newTables = Object.keys(snapshot(f.path).rows).filter(name => !tables.includes(name));
  assert.equal(newTables.length, 67);
  for (const path of [f.path, a]) {
    const allRows = snapshot(path).rows;
    for (const name of newTables) assert.deepEqual(allRows[name], [], name);
  }
  // Prove that the exact same comparator sees a valid seed in a new table.
  const db = new DatabaseSync(a);
  try { db.exec("INSERT INTO raw_owner_usage(owner_id,cap_bytes) VALUES('synthetic-seed',1000)"); }
  finally { db.close(); }
  assert.throws(() => assert.deepEqual(snapshot(f.path), snapshot(a)), assert.AssertionError);
  t.diagnostic(`Compared ${tables.length} legacy tables and ${newTables.length} empty new tables on both paths; injected seed detected.`);
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

// Rules name the method and DTO path that creates each value. Preexisting
// identities, source fields and signed cursors remain byte-for-byte comparable.
// Both branches copy the same cursor secret, so no signature exclusion is needed.
function normalizer() {
  const identities = new Map();
  const generated = value => {
    assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    if (!identities.has(value)) identities.set(value, `generated-${identities.size + 1}`);
    return identities.get(value);
  };
  const clock = value => {
    assert.equal(new Date(value).toISOString(), value); return 'generated-time';
  };
  return transcript => {
    if (!Array.isArray(transcript)) return structuredClone(transcript);
    return transcript.map(step => {
      const copy = structuredClone(step), { method } = copy, value = copy.result.value;
      if (!value) return copy;
      const memory = (dto, clocks = false) => {
        dto.id = generated(dto.id);
        if (clocks) for (const field of ['createdAt', 'updatedAt']) dto[field] = clock(dto[field]);
      };
      if (method === 'admit') memory(value.memory);
      if (method === 'correct') memory(value.memory, true);
      if (method === 'finishAdmission') value.memories.forEach(dto => memory(dto));
      if (method === 'capture') {
        value.admission.memories.forEach(dto => memory(dto));
        for (const ref of value.classification.memoryRevisions) {
          assert.ok(identities.has(ref.memoryId)); ref.memoryId = identities.get(ref.memoryId);
        }
      }
      if (method === 'inspectAdmission' && value.members) for (const member of value.members)
        if (member.memoryId && identities.has(member.memoryId)) member.memoryId = identities.get(member.memoryId);
      if (['setCapturePaused', 'setProjectCapture'].includes(method)) value.generation = generated(value.generation);
      if (method === 'claimAdmission') value.token = generated(value.token);
      // A later get returns that same changed clock; the original get stays exact.
      if (method === 'getEpisode' && value.episode.nextStep?.status === 'closed')
        value.episode.updatedAt = clock(value.episode.updatedAt);
      return copy;
    });
  };
}

async function hostSequence(path, f) {
  const model = rationaleModel();
  const core = openMemoryCore({ path, model }), results = [];
  const call = async (method, input, expectedCode) => {
    // A host opens a separate episode-mode request core for these two setters.
    const requestCore = method === 'setCapturePaused' || method === 'setProjectCapture'
      ? openMemoryCore({ path, model, captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1', sessionEpisodes: { mode: 'episode-v1' } }) : null;
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
    assert.match(detail.nextReceiptCursor, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
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

for (const variant of ['empty', 'linked', 'legacy-support']) test(`T5 ${variant}: host request facades are invariant between safety base 18 and upgraded safety base 33`, async t => {
  const f = await fixture(t, variant), a = join(f.workspace.path, 'base18.sqlite'); copySqliteFixture(f.path, a);
  await migrateReceiptEventTime({ path: a, backupPath: f.backupPath, expected: { storeId: f.storeId, base: 18 }, quiescence });
  await upgradeLayoutBase(request(f)); copySqliteFixture(f.path, f.backupPath);
  await migrateReceiptEventTime({ path: f.path, backupPath: f.backupPath, expected: { storeId: f.storeId, base: 33 }, quiescence });
  const leftRaw = await hostSequence(a, f), rightRaw = await hostSequence(f.path, f);
  assert.equal(leftRaw.length, 32); assert.equal(rightRaw.length, 32);
  const left = normalizer()(leftRaw), right = normalizer()(rightRaw);
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


// Replacing the pathname at the dynamic-import yield must be caught after BEGIN.
test('T2 inode replacement after the initial guards refuses both coherent copies', async t => {
  const f = await fixture(t), retired = f.path + '.retired', replacement = f.path + '.replacement';
  copySqliteFixture(f.path, replacement);
  const before = fileHash(f.path), backup = fileHash(f.backupPath);
  const pending = upgradeLayoutBase(request(f));
  renameSync(f.path, retired); renameSync(replacement, f.path);
  await assert.rejects(pending, { code: 'unsupported_database' });
  for (const path of [f.path, retired]) {
    assert.equal(version(path), 18); assert.equal(fileHash(path), before);
  }
  assert.equal(fileHash(f.backupPath), backup);
});

test('T3 failure after the final installer and before COMMIT preserves exact bytes', async t => {
  const f = await fixture(t), before = fileHash(f.path), backup = fileHash(f.backupPath);
  const prepare = DatabaseSync.prototype.prepare; let injected = false;
  DatabaseSync.prototype.prepare = function(sql) {
    if (sql === 'PRAGMA integrity_check' &&
        prepare.call(this, 'PRAGMA user_version').get().user_version === 33 &&
        prepare.call(this, 'PRAGMA database_list').get().file === f.path) {
      assert.ok(prepare.call(this, "SELECT 1 FROM sqlite_schema WHERE name='card_current_dependencies'").get());
      injected = true; throw Error('synthetic-final-integrity-failure');
    }
    return prepare.call(this, sql);
  };
  try { await assert.rejects(upgradeLayoutBase(request(f)), { code: 'unsupported_database' }); }
  finally { DatabaseSync.prototype.prepare = prepare; }
  assert.equal(injected, true); assert.equal(version(f.path), 18);
  assert.equal(fileHash(f.path), before); assert.equal(fileHash(f.backupPath), backup);
});

test('T5 normalization preserves preexisting IDs, source content, source clocks and unvalidated signatures', async t => {
  const a = '11111111-1111-1111-1111-111111111111', b = '22222222-2222-2222-2222-222222222222';
  const body = Buffer.from('{"revision":1}').toString('base64url');
  const pairs = [
    [{ memory: { id: a, content: 'Synthetic same content' } }, { memory: { id: b, content: 'Synthetic same content' } }],
    [{ content: 'ref ' + a }, { content: 'ref ' + b }],
    [{ occurredAt: '2020-01-01T00:00:00.000Z' }, { occurredAt: '2021-01-01T00:00:00.000Z' }],
    [{ nextReceiptCursor: body + '.valid' }, { nextReceiptCursor: body + '.invalid' }],
  ];
  for (const [index, [left, right]] of pairs.entries()) await t.test(
    ['preexisting identity', 'UUID in user content', 'source timestamp', 'cursor signature'][index], () => {
      assert.notDeepEqual(normalizer()(left), normalizer()(right));
      const transcript = value => [{ method: 'get', result: { ok: true, value } }];
      assert.notDeepEqual(normalizer()(transcript(left)), normalizer()(transcript(right)));
    });
});

async function physicalFixture(t, physical) {
  const f = await fixture(t, 'legacy-support');
  if (physical === 53) { await upgradeLayoutBase(request(f)); copySqliteFixture(f.path, f.backupPath); }
  if (physical !== 18) await migrateReceiptEventTime({ path: f.path, backupPath: f.backupPath,
    expected: { storeId: f.storeId, base: physical === 53 ? 33 : 18 }, quiescence });
  assert.equal(version(f.path), physical); return f;
}

for (const physical of [18, 51, 53]) test(`legacy episode deletion at ${physical} forgets linked Memory with unrecorded support`, async t => {
  const f = await physicalFixture(t, physical), core = openMemoryCore({ path: f.path, model: rationaleModel() });
  try {
    const episode = ok(core.listEpisodes({ namespace: ns, since: '1901-02-01T00:00:00.000Z', until: '1901-03-01T00:00:00.000Z' })).items[0];
    assert.deepEqual(ok(core.forgetEpisode({ namespace: ns, episodeId: episode.id, expectedRevision: episode.revision })), { forgotten: true });
    assert.equal(core.get({ namespace: ns, memoryId: f.linked.id }).error?.code, 'memory_not_found');
    assert.equal(core.getEpisode({ namespace: ns, episodeId: episode.id }).error?.code, 'episode_not_found');
    assert.equal(ok(core.list({ namespace: ns })).memories.some(item => item.id === f.linked.id), false);
    for (const result of [core.map({ namespace: ns }), core.sessionStartContext({ namespace: ns })])
      assert.equal(JSON.stringify(ok(result)).includes(f.linked.content), false);
    assert.equal(JSON.stringify(ok(await core.recall({ readSet: [ns], query: f.linked.content }))).includes(f.linked.content), false);
    if (physical === 53) {
      const raw = openMemoryCore({ path: f.path, rawConversations: { mode: 'off',
        readPolicy: () => ({ generation: 'synthetic', reason: null }) } });
      try {
        assert.deepEqual(ok(raw.listRawConversations({ namespace: ns, client: 'codex' })).conversations, []);
        const view = ok(await raw.getConversation({ namespace: ns, conversationId: episode.id }));
        assert.equal(view.conversation, null); assert.deepEqual(view.messages, []);
      } finally { raw.close(); }
    }
    inspect(f.path, db => {
      assert.equal(db.prepare('SELECT deleted FROM memories WHERE id=?').get(f.linked.id).deleted, 1);
      assert.ok(db.prepare('SELECT 1 FROM suppressed WHERE fingerprint=? AND owner_id=?').get(f.linked.fingerprint, ns.ownerId));
      assert.equal(db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(f.linked.id).n, 0);
      if (physical !== 18) assert.ok(db.prepare("SELECT 1 FROM content_suppressions WHERE kind='memory' AND stable_key=?").get(f.linked.id));
      if (physical === 53) for (const table of ['raw_conversations','raw_messages','raw_parts'])
        assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
    });
  } finally { core.close(); }
});

for (const origin of ['independent', 'unknown']) test(`recorded ${origin} support at 53 has conservative deletion behavior`, async t => {
  const f = await physicalFixture(t, 53);
  // Exercise the post-upgrade public admission, then optionally mark its recorded origin unknown.
  const core = openMemoryCore({ path: f.path, model: rationaleModel() });
  try {
    ok(core.admit({ namespace: ns, memory: { content: f.linked.content, kind: f.linked.kind }, receipts: [receipt('recorded-support')] }));
    const db = f.connect();
    try {
      const r = db.prepare("SELECT id FROM receipts WHERE memory_id=? AND event_id='recorded-support'").get(f.linked.id);
      assert.equal(db.prepare('SELECT kind FROM raw_receipt_origins WHERE receipt_id=?').get(r.id).kind, 'independent');
      if (origin === 'unknown') db.prepare("UPDATE raw_receipt_origins SET kind='unknown' WHERE receipt_id=?").run(r.id);
    } finally { db.close(); }
    const episode = ok(core.listEpisodes({ namespace: ns, since: '1901-02-01T00:00:00.000Z', until: '1901-03-01T00:00:00.000Z' })).items[0];
    ok(core.forgetEpisode({ namespace: ns, episodeId: episode.id, expectedRevision: episode.revision }));
    if (origin === 'independent') {
      const retained = ok(core.get({ namespace: ns, memoryId: f.linked.id }));
      assert.equal(retained.receipts.length, 1); assert.equal(retained.receipts[0].eventId, 'recorded-support');
    } else assert.equal(core.get({ namespace: ns, memoryId: f.linked.id }).error?.code, 'memory_not_found');
  } finally { core.close(); }
});

for (const client of ['claude-code', 'codex']) test(`unresolved legacy keep is exempt while ordinary unknown support is forgotten: ${client}`, async t => {
  const f = rawFixture(t, { kind: 'episode', model: { extract: empty } });
  const origins = [];
  for (const session of ['A', 'D']) origins.push(ok(await f.core.capture(legacyEpisodeInput(client, session))).episode.id);
  const sourceIds = origins.map(id => f.db.prepare('SELECT id FROM episode_sources WHERE episode_id=?').get(id).id);
  const runtime = runtimeFor(f), inherited = consumer(f, runtime, { client: opposite(client), sourceIds });
  const kept = await legacyKeep(f, runtime, inherited.id), keptId = kept.admission.memories[0].id;
  const core = openRawCaptureCore({ path: f.path, model: { ...f.model, extract: empty } }, {
    mode: 'raw-v1', deletion: true, port: localPlainPort(), readPolicy: () => ({ generation: 'synthetic', reason: null }) });
  f.workspace.defer(() => core.close());
  const authority = createRawSourceRoots(f.db).receipt(internal,
    f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(keptId));
  assert.equal(authority.legacyKeep, true); assert.equal(authority.unknown, true);
  const origin = ok(core.getEpisode({ namespace: rawNs, episodeId: origins[0] })).episode;
  assert.equal(core.forgetEpisode({ namespace: rawNs, episodeId: origin.id, expectedRevision: origin.revision }).error?.code,
    'raw_lineage_unavailable');
  const saved = ok(await core.captureRaw(rawRequest(splitRaw('Synthetic unrelated retained source.', { id: 'unrelated-message' })[0],
    { namespace: rawNs, client, sessionId: 'unrelated', eventId: 'raw-unrelated' })));
  const memory = ok(core.get({ namespace: rawNs, memoryId: keptId })).memory;
  // Memory exclusion retains the same unresolved-keep refusal while Raw exists.
  assert.equal(core.forget({ namespace: rawNs, memoryId: keptId, expectedRevision: memory.revision }).error?.code,
    'raw_lineage_unavailable');
  const key = { namespace: rawNs, client: 'synthetic', eventId: 'ordinary-claim', payloadDigest: digest('ordinary-claim') };
  const claim = ok(core.claimAdmission({ ...key, leaseMs: 1000 }));
  const admitted = ok(await core.finishAdmission({ ...key, token: claim.token, items: [{ content: 'Synthetic ordinary unknown fact',
    kind: 'fact', confidence: .8, receipts: [receipt('ordinary-unknown')] }] }));
  const ordinary = f.db.prepare('SELECT * FROM memories WHERE id=?').get(admitted.memories[0].id);
  const ordinaryReceipt = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(ordinary.id);
  assert.equal(f.db.prepare('SELECT kind FROM raw_receipt_origins WHERE receipt_id=?').get(ordinaryReceipt.id).kind, 'unknown');
  assert.equal(createRawSourceRoots(f.db).receipt(internal, ordinaryReceipt).legacyKeep, undefined);
  const deletion = { namespace: rawNs, conversationId: saved.raw.conversationId,
    expectedRevision: ok(await core.getConversation({ namespace: rawNs, conversationId: saved.raw.conversationId })).conversation.revision };
  assert.equal(ok(core.previewDeleteConversation(deletion)).forgottenMemories, 1);
  assert.equal(ok(core.deleteConversation({ ...deletion, actionId: 'ordinary-delete' })).forgottenMemories, 1);
  assert.equal(core.get({ namespace: rawNs, memoryId: ordinary.id }).error?.code, 'memory_not_found');
  assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(ordinary.id).deleted, 1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(ordinary.id).n, 0);
  assert.ok(f.db.prepare('SELECT 1 FROM suppressed WHERE fingerprint=? AND owner_id=?').get(ordinary.fingerprint, rawNs.ownerId));
  ok(core.get({ namespace: rawNs, memoryId: keptId }));
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(keptId).n, 1);
  // Selecting a different receipt of this Memory must retain the old remaining-keep guard too.
  const second = ok(await core.captureRaw(rawRequest(splitRaw('Synthetic second unrelated source.', { id: 'second-message' })[0],
    { namespace: rawNs, client, sessionId: 'second-unrelated', eventId: 'raw-second' })));
  assert.equal(ok(core.admit({ namespace: rawNs, memory: { content: memory.content, kind: memory.kind },
    receipts: [{ client, sessionId: 'second-unrelated', eventId: 'second-message', role: 'user',
      excerpt: 'Synthetic second unrelated source.' }] })).memory.id, keptId);
  const secondKey = { namespace: rawNs, conversationId: second.raw.conversationId,
    expectedRevision: ok(await core.getConversation({ namespace: rawNs, conversationId: second.raw.conversationId })).conversation.revision };
  assert.equal(core.previewDeleteConversation(secondKey).error?.code, 'raw_lineage_unavailable');
  assert.equal(core.deleteConversation({ ...secondKey, actionId: 'legacy-remaining' }).error?.code, 'raw_lineage_unavailable');
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(keptId).n, 2);
});

test('host admissions at 53 without Raw record ordinary receipts as unknown and explicit receipts as independent', async t => {
  const f = await physicalFixture(t, 53), core = openMemoryCore({ path: f.path, model: rationaleModel() });
  try {
    const key = { namespace: ns, client: 'synthetic', eventId: 'origin-claim', payloadDigest: digest('origin-claim') };
    const claim = ok(core.claimAdmission({ ...key, leaseMs: 1000 }));
    ok(await core.finishAdmission({ ...key, token: claim.token, items: [{ content: 'Synthetic ordinary admitted fact', kind: 'fact',
      confidence: .8, receipts: [receipt('ordinary-origin')] }] }));
    ok(core.admit({ namespace: ns, memory: { content: 'Synthetic explicit admitted fact', kind: 'fact' }, receipts: [receipt('explicit-origin')] }));
    inspect(f.path, db => {
      assert.equal(db.prepare('SELECT count(*) n FROM raw_conversations').get().n, 0);
      assert.deepEqual(db.prepare("SELECT r.event_id,o.kind FROM receipts r JOIN raw_receipt_origins o ON o.receipt_id=r.id WHERE r.event_id IN ('ordinary-origin','explicit-origin') ORDER BY r.event_id").all().map(r => [r.event_id,r.kind]),
        [['explicit-origin','independent'],['ordinary-origin','unknown']]);
    });
  } finally { core.close(); }
});
