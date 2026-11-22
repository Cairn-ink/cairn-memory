import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SAFETY_SCHEMA_VERSIONS, resolveContentLayout } from '../../core/content-safety-layout.mjs';
import { installedContentLayout } from '../../core/content-safety-schema.mjs';
import { writeContentSuppressionInside } from '../../core/content-suppression-storage.mjs';
import { transaction } from '../../core/database.mjs';
import { createEpisodeReadProjection, rangeInput, rangeQuery } from '../../core/episode-reads.mjs';
import { openMemoryCore } from '../../core/index.mjs';
import { createMemoryRuntime } from '../../core/runtime.mjs';
import { contextQuery } from '../../core/session-context.mjs';
import { costFamilyFixture } from '../../core/testing/content-safety-cost-families.mjs';
import { batch, digest, draft, ns, ok, register } from '../../core/testing/episode-helpers.mjs';
import { createTestWorkspace } from './workspace.mjs';

const repo = new URL('../../', import.meta.url);
const receivedAt = '2026-06-01T00:00:00.000Z';
const range = { namespace: ns, since: '2026-01-01T00:00:00.000Z', until: '2026-12-31T00:00:00.000Z', timeBasis: 'receipt' };
const context = { namespace: ns, groups: { nextSteps: true, procedural: false } };
const boundary = [ns.ownerId, ns.scope, ns.projectId];
const getInput = episodeId => ({ namespace: ns, episodeId });
const getQuery = id => ({
  sql: 'SELECT * FROM session_episodes WHERE owner_id=? AND scope=? AND project_id=? AND id=? AND deleted=0',
  params: [...boundary, id]
});
const listQuery = (input = range, after) => rangeQuery(ns, 'listEpisodes', rangeInput(input, 'listEpisodes'), after);
const sqlite = process.versions.sqlite;
assert.equal(sqlite, '3.53.4', 'run qualification with SQLite 3.53.4');

const workspace = createTestWorkspace(null, { prefix: 'episode-proof-base-' });
const runGit = (...args) => execFileSync('git', args, { cwd: repo, maxBuffer: 128 * 1024 * 1024 });
const base = async name => import(pathToFileURL(join(workspace.path, 'core', name)).href);
let baseReads, baseLayout, baseCore;

function publish(f, name) {
  const input = { ...batch(name, 'Synthetic 中文 evidence for ' + name, name), client: 'codex' };
  const registered = register(f, input);
  const { commit, writer } = draft(f, registered, input);
  f.runtime.commitEpisodeDraft(ns, commit);
  f.runtime.releaseEpisodeWriter(ns, { episodeId: registered.episodeId, token: writer.token });
  f.db.prepare(`UPDATE session_episodes SET first_received_at=?,
    record=json_set(record,'$.eventStart',?,'$.eventEnd',?) WHERE id=?`)
    .run(receivedAt, receivedAt, receivedAt, registered.episodeId);
  return registered.episodeId;
}

const normalizeError = error => ({ code: error.code ?? error.name, ...(error.errcode === undefined ? {} : { errcode: error.errcode }) });
function outcome(fn) {
  try { return { value: fn() }; }
  catch (error) { return { error: normalizeError(error) }; }
}
const bytesEqual = (actual, expected, name) => assert.ok(
  Buffer.from(JSON.stringify(actual)).equals(Buffer.from(JSON.stringify(expected))), name);

function project(f, create, query, expectedEpoch) {
  const result = create({ db: f.db, epoch: () => 1 })(ns, query, expectedEpoch);
  const rows = result.query ? f.db.prepare(result.query.sql).all(...result.query.params) : [];
  return { epoch: result.epoch, budget: result.budget, rows };
}

function compare(f, name, { query = getQuery(f.id), expectedEpoch, calls = [], verify } = {}) {
  const [expected, actual] = transaction(f.db, () => [
    outcome(() => project(f, baseReads.createEpisodeReadProjection, query, expectedEpoch)),
    outcome(() => project(f, createEpisodeReadProjection, query, expectedEpoch))
  ], undefined, { deferred: true });
  bytesEqual(actual, expected, `layout ${f.physical} ${name} projected rows and errors`);
  verify?.(actual);
  const publicResults = {};
  for (const [label, call] of calls) {
    const expectedResult = outcome(() => call(f.baseCore));
    const actualResult = outcome(() => call(f.core));
    bytesEqual(actualResult, expectedResult, `layout ${f.physical} ${name} ${label}`);
    publicResults[label] = actualResult.error?.code ?? actualResult.value?.error?.code ?? 'ok';
  }
  const { rows = [] } = actual.value ?? {};
  const markers = rows[0] ? { incomplete: rows[0].episode_read_incomplete, overflow: rows[0].episode_read_overflow,
    stats: rows[0].episode_read_stats === undefined ? undefined : JSON.parse(rows[0].episode_read_stats) } : {};
  console.log(JSON.stringify({ layout: f.physical, case: name, rows: rows.length, error: actual.error ?? null, ...markers, public: publicResults }));
  return actual.value;
}

function assertShape(result, { rows, sources, memories, receipts, ancestryInput, ancestry, roots, maps, overflow = 0, incomplete = 0 }) {
  assert.ifError(result.error);
  const first = result.value.rows[0];
  assert.ok(first);
  const stats = JSON.parse(first.episode_read_stats);
  for (const [name, expected] of Object.entries({ rows, sources, memories, receipts, ancestryInput, ancestry, roots, maps })) {
    if (expected !== undefined) assert.equal(stats[name], expected, name);
  }
  assert.equal(first.episode_read_incomplete, incomplete);
  assert.equal(first.episode_read_overflow, overflow);
  if (overflow) assert.ok(result.value.rows.every(row => row.episode_read_proof === '[]'));
}

const getCall = id => ['getEpisode', core => core.getEpisode(getInput(id))];
const listCall = input => ['listEpisodes', core => core.listEpisodes(input)];
const nextCall = ['nextSteps', core => core.sessionStartContext(context)];
const assertCode = code => result => assert.equal(result.error?.code, code);

function sourceFor(f, id = f.id) {
  return f.db.prepare(`SELECT s.*,e.client,e.session_key FROM episode_sources s
    JOIN session_episodes e ON e.id=s.origin_episode_id WHERE s.episode_id=? ORDER BY s.id LIMIT 1`).get(id);
}

function addReceipts(f, start, end, { matching = false, keyPrefix = 'synthetic-key-' } = {}) {
  const source = sourceFor(f);
  const add = f.db.prepare(`INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  transaction(f.db, () => {
    for (let index = start; index < end; index++) add.run(`synthetic-receipt-${index}`, f.memoryId, keyPrefix + index,
      source.client, source.session_key, matching ? source.message_id : 'unmatched', source.role, source.text, receivedAt);
  });
}

function cloneRecord(db, table, replacements) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  return db.prepare(`INSERT INTO ${table}(${columns.join(',')})
    SELECT ${columns.map(column => replacements.includes(column) ? '?' : column).join(',')} FROM ${table} WHERE id=?`);
}

function memoryAndReceiptBounds(f) {
  const get = [getCall(f.id)];
  addReceipts(f, 0, 4094, { matching: true });
  compare(f, 'proof row allowance at limit', { verify: result => assertShape(result, { rows: 4096, receipts: 4095 }), calls: get });
  addReceipts(f, 4094, 4095, { matching: true });
  compare(f, 'proof row overflow witness', { verify: result => assertShape(result, { rows: 4097, overflow: 1, receipts: 4096 }), calls: get });
  addReceipts(f, 4095, 4096);
  compare(f, 'receipt input overflow witness', { verify: result => assertShape(result, { receipts: 4097, incomplete: 1 }), calls: get });
  f.db.prepare("DELETE FROM receipts WHERE id LIKE 'synthetic-receipt-%'").run();
  const clone = cloneRecord(f.db, 'memories', ['id', 'fingerprint']);
  transaction(f.db, () => {
    for (let i = 0; i < 4095; i++) clone.run(`unmatched-memory-${i}`, `unmatched-fingerprint-${i}`, f.memoryId);
  });
  compare(f, 'memory input at limit', { verify: result => assertShape(result, { memories: 4096 }), calls: get });
  clone.run('unmatched-memory-witness', 'unmatched-fingerprint-witness', f.memoryId);
  compare(f, 'memory input overflow witness', { verify: result => assertShape(result, { memories: 4097, incomplete: 1 }), calls: get });
  f.db.prepare("DELETE FROM memories WHERE id LIKE 'unmatched-memory-%'").run();
}

function byteBounds(f) {
  const query = getQuery(f.id);
  const { budget, rows } = compare(f, 'byte accounting control', { query });
  const [{ receipts: [{ ancestry, ...parent }], raw, ...source }] = JSON.parse(rows[0].episode_read_proof);
  assert.deepEqual([ancestry, raw], [[], []]);
  const original = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(f.memoryId);
  const remove = f.db.prepare('DELETE FROM receipts WHERE memory_id=?');
  const add = f.db.prepare(`INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  let sample = 0;
  const replaceKey = key => transaction(f.db, () => {
    remove.run(f.memoryId);
    const id = ('byte-receipt-' + ++sample).padEnd(original.id.length, '-');
    add.run(id, f.memoryId, key, original.client, original.session_id, original.event_id,
      original.role, original.excerpt, original.created_at);
  });
  parent.receipt_key = '';
  const objects = [source, parent];
  const jsonCharge = objects.reduce((sum, payload) => sum + Buffer.byteLength(JSON.stringify(payload)) + 64, 0);
  const rawCharge = objects.flatMap(Object.values).reduce((sum, value) => sum + (value === null ? 0 : Buffer.byteLength(String(value))), 0);
  const remaining = budget.bytesRemaining - jsonCharge - Buffer.byteLength('界');
  const escaped = '界' + '\n'.repeat(Math.floor(remaining / 2)) + 'x'.repeat(remaining % 2);
  replaceKey(escaped);
  compare(f, 'UTF-8 JSON payload and 64-byte charge at budget', { query, verify: result => assertShape(result, { rows: 2 }) });
  if (f.physical === 53) timeProof(f, 'byte budget', query);
  replaceKey(escaped + 'x');
  compare(f, 'JSON payload charge over budget', { query, verify: result => assertShape(result, { rows: 2, overflow: 1 }), calls: [getCall(f.id)] });
  const rawRemaining = budget.bytesRemaining - rawCharge;
  const multibyte = '界'.repeat(Math.floor(rawRemaining / 3)) + 'x'.repeat(rawRemaining % 3);
  for (const [name, value] of [['raw BLOB bytes at budget', multibyte], ['raw BLOB bytes over budget', multibyte + 'x']]) {
    replaceKey(value);
    compare(f, name, { query, verify: result => assertShape(result, { rows: 2, overflow: 1 }), calls: [getCall(f.id)] });
  }
  replaceKey(original.receipt_key);
}

function sourceBounds(f) {
  const s = sourceFor(f);
  const add = f.db.prepare('INSERT INTO episode_sources VALUES(?,?,?,?,?,?,?,?,?,?)');
  const clone = cloneRecord(f.db, 'session_episodes', ['id', 'session_key']);
  const existing = f.db.prepare('SELECT id FROM session_episodes ORDER BY id').all().map(row => row.id);
  transaction(f.db, () => {
    for (let epi = 0; epi < 51; epi++) {
      const id = existing[epi] ?? `episode-clone-${epi}`;
      if (epi >= existing.length) clone.run(id, 's1:' + digest(id), f.id);
      for (let index = epi < existing.length ? 1 : 0; index < 16; index++) {
        add.run(`source-clone-${epi}-${index}`, id, f.id, s.event_id, 'unmatched-source', s.digest, s.role, s.text, 0, s.ordinal);
      }
    }
  });
  const input = { ...range, limit: 50 };
  const query = listQuery(input);
  compare(f, '51 episodes with 816 sources', { query, verify: result => {
    assertShape(result, { sources: 816 });
    assert.equal(result.value.rows.length, 51);
  }, calls: [listCall(input)] });
  if (f.physical === 53) timeProof(f, 'widest page', query);
  add.run('source-clone-witness', f.id, f.id, s.event_id, 'unmatched-source', s.digest, s.role, s.text, 0, s.ordinal);
  compare(f, '817-source fence witness', { query, verify: assertCode('episode_sources_unavailable'), calls: [listCall(input)] });
  transaction(f.db, () => {
    f.db.prepare("DELETE FROM episode_sources WHERE id LIKE 'source-clone-%'").run();
    f.db.prepare("DELETE FROM session_episodes WHERE id LIKE 'episode-clone-%'").run();
  });
}

function rawCases(f) {
  const s = sourceFor(f);
  const secret = f.db.prepare('SELECT secret FROM episode_identity').get().secret;
  const hmac = value => createHmac('sha256', Buffer.from(secret, 'hex')).update(JSON.stringify(value)).digest('hex');
  const hashed = 's1:' + hmac(['episode-v1', ...boundary, s.client, s.session_key]);
  const sourceKey = hmac(['raw-source-v1', s.role, s.text]);
  const raw = f.db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)');
  const message = f.db.prepare(`INSERT INTO raw_messages(conversation_id,message_id,ordinal,role,total_units,total_bytes,assembly_state,first_event_id)
    VALUES(?,?,1,?,5000,5000,'complete','synthetic-event')`);
  const map = f.db.prepare("INSERT INTO raw_source_maps VALUES(?,?,?,?,?,'exact')");
  raw.run('root-exact', ...boundary, s.client, s.session_key, receivedAt, receivedAt);
  raw.run('root-hashed', ...boundary, s.client, hashed, receivedAt, receivedAt);
  for (const id of ['root-exact', 'root-hashed']) message.run(id, s.message_id, s.role);
  const calls = [getCall(f.id), listCall(range), nextCall];
  compare(f, 'ambiguous Raw session aliases', { verify: result => assertShape(result, { roots: 2 }), calls });
  addReceipts(f, 0, 4094, { matching: true });
  compare(f, 'Raw roots use the remaining row allowance', {
    verify: result => assertShape(result, { rows: 4097, roots: 1, overflow: 1 }), calls: [getCall(f.id)]
  });
  f.db.prepare("DELETE FROM receipts WHERE id LIKE 'synthetic-receipt-%'").run();
  f.db.prepare("DELETE FROM raw_messages WHERE conversation_id='root-hashed'").run();
  f.db.prepare("DELETE FROM raw_conversations WHERE id='root-hashed'").run();
  f.db.prepare('INSERT INTO raw_session_fences VALUES(?,?,?,?,?)').run(...boundary, s.client, s.session_key);
  compare(f, 'fenced Raw source', { calls });
  f.db.prepare('DELETE FROM raw_session_fences').run();
  map.run('root-exact', s.message_id, 'another-source-key', 0, 1);
  compare(f, 'known Raw map without an exact match', { calls });
  map.run('root-exact', s.message_id, sourceKey, 2, 3);
  compare(f, 'known Raw map with an exact match', { verify: result => assertShape(result, { roots: 1, maps: 1 }), calls });
  f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run('root-exact', s.message_id, 2, 3);
  compare(f, 'excluded exact Raw map', { calls });
  f.db.prepare('DELETE FROM raw_source_maps').run();
  compare(f, 'excluded whole Raw message', { calls });
  f.db.prepare('DELETE FROM raw_source_exclusions').run();

  const receipt = f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(f.memoryId).id;
  const lineage = f.db.prepare("INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,'exact')");
  f.db.prepare("UPDATE raw_conversations SET session_key='ancestry-only' WHERE id='root-exact'").run();
  transaction(f.db, () => {
    for (let i = 0; i < 4094; i++) lineage.run(receipt, 'root-exact', s.message_id, i, i + 1);
  });
  compare(f, 'ancestry uses the remaining row allowance', { verify: result => assertShape(result, { rows: 4096, ancestry: 4094 }), calls });
  if (f.physical === 53) timeProof(f, 'row budget', getQuery(f.id));
  lineage.run(receipt, 'root-exact', s.message_id, 4094, 4095);
  compare(f, 'ancestry row overflow witness', { verify: result => assertShape(result, { rows: 4097, ancestry: 4095, overflow: 1 }), calls });
  for (const i of [4095, 4096]) lineage.run(receipt, 'root-exact', s.message_id, i, i + 1);
  compare(f, 'ancestry input overflow witness', {
    verify: result => assertShape(result, { rows: 4097, ancestryInput: 4097, ancestry: 4095, overflow: 1 }), calls
  });
  f.db.prepare('DELETE FROM raw_receipt_lineage').run();
  f.db.prepare("UPDATE raw_conversations SET session_key=? WHERE id='root-exact'").run(s.session_key);
  transaction(f.db, () => {
    for (let i = 0; i < 4093; i++) map.run('root-exact', s.message_id, sourceKey, i, i + 1);
  });
  compare(f, 'maps use the remaining row allowance', { verify: result => assertShape(result, { rows: 4096, roots: 1, maps: 4093 }), calls });
  map.run('root-exact', s.message_id, sourceKey, 4093, 4094);
  compare(f, 'map row overflow witness', { verify: result => assertShape(result, { rows: 4097, roots: 1, maps: 4094, overflow: 1 }), calls });
  f.db.prepare('DELETE FROM raw_source_maps').run();

  f.db.prepare('DELETE FROM episode_identity WHERE singleton=1').run();
  compare(f, 'missing Raw identity', { calls });
  transaction(f.db, () => writeContentSuppressionInside(f.db, { namespace: ns, kind: 'memory', key: f.memoryId,
    reason: 'user_forget', actionId: 'synthetic-source-denial' }));
  compare(f, 'receipt denial before missing identity', { calls });
  f.db.prepare('UPDATE episode_sources SET origin_episode_id=? WHERE episode_id=?').run(f.otherId, f.id);
  f.db.prepare('UPDATE session_episodes SET deleted=1 WHERE id=?').run(f.otherId);
  compare(f, 'origin denial before missing identity', { calls });
}

function timeProof(f, shape, query) {
  const samples = 20;
  const results = transaction(f.db, () => {
    const versions = [['base', baseReads.createEpisodeReadProjection], ['branch', createEpisodeReadProjection]].map(([version, create]) => ({
      version, query: create({ db: f.db, epoch: () => 1 })(ns, query).query, prepare: [], step: []
    }));
    for (let iteration = 0; iteration < samples; iteration++) {
      for (const version of iteration % 2 ? [...versions].reverse() : versions) {
        const start = performance.now();
        const statement = f.db.prepare(version.query.sql);
        const prepared = performance.now();
        statement.all(...version.query.params);
        version.prepare.push(prepared - start);
        version.step.push(performance.now() - prepared);
      }
    }
    return versions;
  }, undefined, { deferred: true });
  const median = values => {
    values.sort((a, b) => a - b);
    const mid = values.length / 2;
    return (values[mid - 1] + values[mid]) / 2;
  };
  for (const { version, prepare, step } of results) {
    console.log(JSON.stringify({ layout: f.physical, cost: shape, version, samples, prepareMs: median(prepare), stepMs: median(step) }));
  }
}

try {
  const baseCommit = runGit('merge-base', 'HEAD', 'refs/remotes/origin/main').toString().trim();
  const archive = runGit('archive', '--format=tar', baseCommit);
  execFileSync('tar', ['-xf', '-', '-C', workspace.path], { input: archive });
  [baseReads, baseLayout, baseCore] = await Promise.all([
    base('episode-reads.mjs'), base('content-safety-schema.mjs'), base('index.mjs')
  ]);
  console.log(JSON.stringify({ baseCommit, node: process.version, sqlite }));
  for (const physical of SAFETY_SCHEMA_VERSIONS) {
    const layout = resolveContentLayout(physical);
    if (!layout.suppressionRevision) continue;
    const cleanups = [];
    const lifecycle = { after: close => cleanups.push(close) };
    try {
      const fixture = costFamilyFixture(lifecycle, layout.base, layout.attestedFeatures ? 'event-time' : 'safety');
      assert.equal((await fixture.migrate()).physical, physical);
      const db = fixture.connect();
      lifecycle.after(() => db.close());
      const runtime = createMemoryRuntime({ path: fixture.path, sessionEpisodes: { mode: 'episode-v1' } });
      lifecycle.after(() => runtime.close());
      const options = { path: fixture.path, model: { contextWindow: 8192, countTokens: () => 1 } };
      const core = openMemoryCore(options);
      lifecycle.after(() => core.close());
      const original = baseCore.openMemoryCore(options);
      lifecycle.after(() => original.close());
      installedContentLayout(db);
      baseLayout.installedContentLayout(db);
      const f = { physical, db, runtime, core, baseCore: original };
      f.id = publish(f, 'one');
      f.otherId = publish(f, 'two');
      publish(f, 'three');
      const s = sourceFor(f);
      f.memoryId = ok(core.admit({ namespace: ns, memory: { kind: 'fact', content: 'Synthetic source receipt' },
        receipts: [{ client: s.client, sessionId: s.session_key, eventId: s.message_id, role: s.role, excerpt: s.text }] })).memory.id;
      compare(f, 'getEpisode and inspect', { calls: [getCall(f.id)] });
      compare(f, 'missing Episode', { query: getQuery('absent-episode'), calls: [getCall('absent-episode')] });
      const list = { ...range, limit: 2, client: 'codex' };
      compare(f, 'multi-episode receipt page', { query: listQuery(list), calls: [listCall(list)], verify: result => assert.equal(result.value.rows.length, 3) });
      const page = ok(original.listEpisodes(list));
      assert.ok(page.nextCursor);
      compare(f, 'receipt cursor page', {
        query: listQuery(list, { time: receivedAt, id: page.items.at(-1).id }), calls: [listCall({ ...list, cursor: page.nextCursor })]
      });
      const event = { ...list, timeBasis: 'event' };
      compare(f, 'multi-episode event page', { query: listQuery(event), calls: [listCall(event)] });
      const eventPage = ok(original.listEpisodes(event));
      assert.ok(eventPage.nextCursor);
      compare(f, 'event cursor page', {
        query: listQuery(event, { time: receivedAt, id: eventPage.items.at(-1).id }), calls: [listCall({ ...event, cursor: eventPage.nextCursor })]
      });
      compare(f, 'nextSteps', { query: contextQuery(ns, 'nextSteps'), calls: [nextCall], verify: result => assert.equal(result.value.rows.length, 3) });
      compare(f, 'stale epoch wins before the proof', { expectedEpoch: -1, verify: result => {
        assert.ifError(result.error);
        assert.equal(result.value.budget, undefined);
        assert.equal(result.value.rows.length, 0);
      } });
      if (physical === 53) timeProof(f, 'typical', getQuery(f.id));
      db.prepare('UPDATE episode_sources SET ordinal=? WHERE episode_id=?').run(9007199254740992n, f.id);
      compare(f, 'oversized native evidence integer', { calls: [getCall(f.id), listCall(range), nextCall] });
      db.prepare('UPDATE episode_sources SET ordinal=? WHERE episode_id=?').run(s.ordinal, f.id);
      memoryAndReceiptBounds(f);
      byteBounds(f);
      sourceBounds(f);
      if (layout.rawLineage) rawCases(f);
    } finally {
      for (const close of cleanups.reverse()) await close();
    }
  }
} finally {
  await workspace.cleanup();
}
