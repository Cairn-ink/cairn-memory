import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { openMemoryCore } from '../index.mjs';
import { upgradeLayoutBase } from '../layout-base-upgrade.mjs';
import { migrateReceiptEventTime } from '../content-safety-migration.mjs';
import { createRawSourceRoots } from '../raw-source-roots.mjs';
import { RAW_CLIENTS } from '../raw-input.mjs';
import { safetyFixture, copySqliteFixture, quiescence, ok, ns } from '../testing/content-safety-s2h-fixture.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { batch } from '../testing/episode-helpers.mjs';
import { parse } from '../../tools/testing/vendor/acorn/acorn.mjs';
import { DatabaseSync } from 'node:sqlite';
import { config, ns as keepNamespace, request, splitRaw } from '../testing/raw-capture-fixtures.mjs';
import { consumer, empty, episodeInput, legacyKeep } from '../testing/raw-deletion-review-fixtures.mjs';
import { interpretation } from '../testing/episode-capture-helpers.mjs';

const start = Date.parse('2020-01-01T00:00:00.000Z');
const content = 'Synthetic saved preference.';
const savedReceipt = (client, sessionId) => ({ client, sessionId, eventId: 'saved-message', role: 'user', excerpt: content });

async function fixture(t, { client = RAW_CLIENTS[0], sameSession = false, episodes = false, correctBody = false } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const f = safetyFixture(t), receipt = savedReceipt(client, sameSession ? 'target' : 'earlier');
  const old = openMemoryCore({ path: f.path });
  let memory;
  try { memory = ok(old.admit({ namespace: ns, memory: { content, kind: 'context' }, receipts: [receipt] })).memory; }
  finally { old.close(); }
  copySqliteFixture(f.path, f.backupPath);
  await upgradeLayoutBase({ path: f.path, backupPath: f.backupPath,
    expected: { storeId: f.storeId, fromBase: 18, toBase: 33 }, quiescence });
  copySqliteFixture(f.path, f.backupPath);
  await migrateReceiptEventTime({ path: f.path, backupPath: f.backupPath,
    expected: { storeId: f.storeId, base: 33 }, quiescence });
  const core = openMemoryCore({ path: f.path, raw: true, model: rationaleModel() });
  f.workspace.defer(() => core.close());
  const db = f.connect(); f.workspace.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 53);
  const original = db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(memory.id);
  assert.equal(db.prepare('SELECT count(*) n FROM raw_receipt_origins WHERE receipt_id=?').get(original.id).n, 0);
  assert.equal(original.created_at, new Date(start).toISOString());
  let body = content;
  if (correctBody) {
    t.mock.timers.setTime(start + 90_000);
    body = 'Synthetic corrected preference.';
    ok(core.correct({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
      content: body, kind: 'context', receipt: { client, sessionId: 'target', eventId: 'target-message', role: 'user', excerpt: body } }));
    assert.equal(db.prepare('SELECT count(*) n FROM receipts WHERE id=?').get(original.id).n, 0);
  }
  t.mock.timers.setTime(start + 120_000);
  const capture = ok(await core.capture({ namespace: ns, client, sessionId: 'target', eventId: 'target-event',
    messages: [{ id: 'target-message', role: 'user', content: body }] }));
  if (episodes) {
    // Exercise the existing unqualified episode admission seam after ordinary capture.
    const runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
    f.workspace.defer(() => runtime.close());
    const source = { ...batch('episode-event', content, 'target'), client };
    source.messages[0].id = source.view.messages[0].id = 'target-message';
    const registered = runtime.reserveEpisodeBatch(ns, source);
    const key = { namespace: ns, client, eventId: source.eventId, payloadDigest: source.payloadDigest };
    const claim = ok(core.claimAdmission({ ...key, leaseMs: 125_000 }));
    const admitted = ok(await core.finishAdmission({ ...key, token: claim.token, items: [{
      content, kind: 'context', confidence: .5,
      receipts: [{ client, sessionId: 'target', eventId: 'target-message', role: 'user', excerpt: content }] }] }));
    assert.equal(admitted.memories[0].id, memory.id);
    capture.episode = { id: registered.episodeId };
  }
  const receipts = db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(memory.id);
  assert.equal(receipts.length, correctBody ? 1 : 2);
  const rooted = receipts.find(row => row.id !== original.id);
  const roots = createRawSourceRoots(db);
  if (!correctBody) assert.equal(roots.receipt(ns, original).unknown, true);
  const authority = roots.receipt(ns, rooted);
  assert.equal(authority.roots.length, 1);
  const conversation = db.prepare('SELECT * FROM raw_conversations WHERE id=?').get(authority.roots[0].conversationId);
  assert.ok(conversation, 'default capture must record the source conversation');
  assert.equal(Date.parse(conversation.first_received_at), start + 120_000);
  const key = () => ({ namespace: ns, conversationId: conversation.id,
    expectedRevision: db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversation.id).revision });
  return { ...f, core, db, client, memory, original, rooted, capture, conversation, key };
}

function remove(f, retained) {
  const input = f.key(), preview = ok(f.core.previewDeleteConversation(input));
  assert.deepEqual([preview.forgottenMemories, preview.retainedMemories, preview.removedReceipts], retained ? [0, 1, 1] : [1, 0, 2]);
  const result = ok(f.core.deleteConversation({ ...input, actionId: 'delete-target' }));
  for (const field of ['forgottenMemories', 'retainedMemories', 'removedReceipts', 'invalidatedEpisodes'])
    assert.equal(result[field], preview[field]);
  assertState(f, retained);
}
function assertState(f, retained) {
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE id=?').get(f.rooted.id).n, 0);
  if (retained) {
    assert.equal(ok(f.core.get({ namespace: ns, memoryId: f.memory.id })).memory.content, content);
    assert.deepEqual(f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(f.memory.id), [f.original]);
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_receipt_origins WHERE receipt_id=?').get(f.original.id).n, 0);
  } else {
    assert.equal(f.core.get({ namespace: ns, memoryId: f.memory.id }).error?.code, 'memory_not_found');
    assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(f.memory.id).n, 0);
    assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(f.memory.id).deleted, 1);
    assert.ok(f.db.prepare('SELECT 1 FROM suppressed WHERE fingerprint=?').get(f.db.prepare('SELECT fingerprint FROM memories WHERE id=?').get(f.memory.id).fingerprint));
  }
}

for (const client of RAW_CLIENTS) test(`upgraded saved support predating default capture survives deletion for client ${RAW_CLIENTS.indexOf(client)}`, async t => {
  remove(await fixture(t, { client }), true);
});

test('correction replaces old receipts before deletion of the changed body', async t => {
  const f = await fixture(t, { correctBody: true });
  assert.equal(f.rooted.created_at, new Date(start + 90_000).toISOString());
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: f.memory.id })).memory.content, 'Synthetic corrected preference.');
  const input = f.key(), preview = ok(f.core.previewDeleteConversation(input));
  assert.deepEqual([preview.forgottenMemories, preview.retainedMemories, preview.removedReceipts], [1, 0, 1]);
  ok(f.core.deleteConversation({ ...input, actionId: 'delete-corrected' }));
  assertState(f, false);
});

function traceSql(t, run) {
  const statements = [], prepare = DatabaseSync.prototype.prepare;
  const spy = t.mock.method(DatabaseSync.prototype, 'prepare', function(sql) {
    const statement = prepare.call(this, sql);
    for (const method of ['get', 'all', 'iterate', 'run']) {
      const execute = statement[method];
      statement[method] = function(...args) {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return execute.apply(this, args);
      };
    }
    return statement;
  });
  try { run(); return statements; } finally { spy.mock.restore(); }
}
const clockLookups = statements => statements.filter(sql => sql.startsWith('SELECT first_received_at FROM raw_conversations'));

test('deletion without in-scope ordinary unknown receipts skips the target clock lookup', async t => {
  const f = await fixture(t, { correctBody: true });
  const outside = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic unrelated preference.', kind: 'context' },
    receipts: [savedReceipt(f.client, 'unrelated')] })).memory;
  const unknown = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(outside.id);
  f.db.prepare('DELETE FROM raw_receipt_origins WHERE receipt_id=?').run(unknown.id);
  assert.equal(createRawSourceRoots(f.db).receipt(ns, unknown).unknown, true);
  const input = f.key();
  const statements = traceSql(t, () => {
    ok(f.core.previewDeleteConversation(input));
    ok(f.core.deleteConversation({ ...input, actionId: 'delete-known-support' }));
  });
  assert.equal(clockLookups(statements).length, 0);
  assertState(f, false);
  ok(f.core.get({ namespace: ns, memoryId: outside.id }));
});

test('target clock lookup is shared by in-scope Memories and refreshed for each plan', async t => {
  const f = await fixture(t);
  const other = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic alternate preference.', kind: 'context' },
    receipts: [savedReceipt(f.client, 'earlier'), { ...savedReceipt(f.client, 'target'), eventId: 'target-message' }] })).memory;
  const unknown = f.db.prepare('SELECT * FROM receipts WHERE memory_id=? AND session_id=?').get(other.id, 'earlier');
  f.db.prepare('DELETE FROM raw_receipt_origins WHERE receipt_id=?').run(unknown.id);
  f.db.prepare('UPDATE receipts SET created_at=? WHERE id=?').run(new Date(start).toISOString(), unknown.id);
  assert.equal(createRawSourceRoots(f.db).receipt(ns, unknown).unknown, true);
  for (const [offset, forgotten, retained] of [[120_000, 0, 2], [30_000, 2, 0]]) {
    f.db.prepare('UPDATE raw_conversations SET first_received_at=? WHERE id=?').run(new Date(start + offset).toISOString(), f.conversation.id);
    const statements = traceSql(t, () => {
      const preview = ok(f.core.previewDeleteConversation(f.key()));
      assert.deepEqual([preview.forgottenMemories, preview.retainedMemories], [forgotten, retained]);
    });
    assert.equal(clockLookups(statements).length, 1);
  }
});

test('unanchored support from the same session stays dependent despite predating capture', async t => {
  remove(await fixture(t, { sameSession: true }), false);
});

for (const [label, offset] of [['after capture', 1], ['inside the clock margin', -30_000], ['at the clock margin', -60_000],
  ['just before the clock margin', -60_001]]) test(`other-session unknown support ${label}`, async t => {
  const f = await fixture(t);
  f.db.prepare('UPDATE receipts SET created_at=? WHERE id=?').run(new Date(start + 120_000 + offset).toISOString(), f.original.id);
  f.original = f.db.prepare('SELECT * FROM receipts WHERE id=?').get(f.original.id);
  remove(f, offset < -60_000);
});

for (const path of ['conversation', 'episode']) test(`dedupe links the saved id to the episode and retains old support through ${path} deletion`, async t => {
  const f = await fixture(t, { episodes: true });
  const link = f.db.prepare('SELECT * FROM episode_memory_links WHERE memory_id=?').get(f.memory.id);
  assert.ok(link, 'deduplicated Memory must link to the capturing episode');
  assert.equal(link.episode_id, f.capture.episode.id);
  assert.ok(JSON.parse(link.receipt_ids).includes(f.rooted.id));
  if (path === 'conversation') remove(f, true);
  else {
    const episode = ok(f.core.getEpisode({ namespace: ns, episodeId: link.episode_id })).episode;
    assert.deepEqual(ok(f.core.forgetEpisode({ namespace: ns, episodeId: link.episode_id, expectedRevision: episode.revision })), { forgotten: true });
    assertState(f, true);
  }
});

for (const deleted of [false, true]) test(`earlier episode receipt clock stays authoritative with deleted=${deleted}`, async t => {
  const f = await fixture(t, { episodes: true });
  f.db.prepare('UPDATE session_episodes SET first_received_at=?,deleted=? WHERE id=?')
    .run(new Date(start + 30_000).toISOString(), Number(deleted), f.capture.episode.id);
  remove(f, false);
});

for (const clock of ['receipt', 'conversation', 'episode']) test(`invalid ${clock} clock keeps unknown support dependent`, async t => {
  const f = await fixture(t, { episodes: true });
  if (clock === 'receipt') f.db.prepare('UPDATE receipts SET created_at=? WHERE id=?').run('invalid', f.original.id);
  if (clock === 'conversation') f.db.prepare('UPDATE raw_conversations SET first_received_at=? WHERE id=?').run('invalid', f.conversation.id);
  if (clock === 'episode') f.db.prepare('UPDATE session_episodes SET first_received_at=? WHERE id=?').run('invalid', f.capture.episode.id);
  remove(f, false);
});

// Unknown template identifiers are potential Memory tables, so dynamic SQL
// cannot bypass the body-write invariant merely by interpolating its table.
function assertBodyWriters(sources) {
  const runtime = sources.get('runtime.mjs');
  const begin = runtime.indexOf('  function correct('), end = runtime.indexOf('  function forgetMutation(', begin);
  assert.ok(begin >= 0 && end > begin);
  const writes = [];
  const table = String.raw`(?:\w+\s*\.\s*)?(?:memories|__dynamic__)\b`;
  const assignments = sql => [...sql.matchAll(/\bcontent\s*=\s*([^,\n]+)/gi)]
    .filter(match => !/^NULL\s*$/i.test(match[1]));
  for (const [file, source] of sources) {
    function walk(node) {
      if (!node || typeof node.type !== 'string') return;
      let sql;
      if (node.type === 'Literal' && typeof node.value === 'string') sql = node.value;
      if (node.type === 'TemplateLiteral') sql = node.quasis.map(part => part.value.cooked ?? part.value.raw).join('__dynamic__');
      if (sql) {
        sql = sql.replace(/"(\w+)"|`(\w+)`|\[(\w+)\]/g, (_, a, b, c) => a ?? b ?? c);
        for (const update of sql.matchAll(new RegExp(String.raw`\bUPDATE\s+(?:OR\s+\w+\s+)?${table}(?:\s+(?:AS\s+)?\w+)?\s+SET\s+([\s\S]*?)(?=\bWHERE\b|;|$)`, 'gi'))) {
          for (const assignment of assignments(update[1])) {
            assert.ok(file === 'runtime.mjs' && node.start > begin && node.end < end,
              'body write outside correction: ' + file);
            writes.push(assignment[0]);
          }
        }
        for (const insert of sql.matchAll(new RegExp(String.raw`\bINSERT(?:\s+OR\s+\w+)?\s+INTO\s+${table}([\s\S]*?)(?=;|$)`, 'gi'))) {
          const update = insert[1].match(/\bDO\s+UPDATE\s+SET\s+([\s\S]*)/i);
          assert.ok(!update || assignments(update[1]).length === 0, 'body write by upsert: ' + file);
        }
        for (const replacement of sql.matchAll(new RegExp(String.raw`\b(?:REPLACE|INSERT\s+OR\s+REPLACE)\s+INTO\s+(${table})([\s\S]*?)(?=;|$)`, 'gi'))) {
          assert.ok(replacement[1].includes('__dynamic__') && !/\bcontent\b/i.test(replacement[2]),
            'body write by replacement: ' + file);
        }
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) for (const child of value) walk(child);
        else if (value && typeof value === 'object') walk(value);
      }
    }
    walk(parse(source, { ecmaVersion: 2025, sourceType: 'module' }));
  }
  assert.equal(writes.length, 1, 'recognize the existing content update');
  const correction = runtime.slice(begin, end);
  const deletion = correction.match(/db\.prepare\(["']DELETE FROM receipts WHERE memory_id = \?["']\)\.run\(id\);/);
  assert.ok(deletion, 'correction must delete every old receipt');
  const attachments = [...correction.matchAll(/\battach\(/g)];
  assert.equal(attachments.length, 1);
  assert.ok(attachments[0].index > deletion.index + deletion[0].length);
  assert.match(correction.slice(deletion.index + deletion[0].length), /for \(const \[index, receipt\] of value\.receipts\.entries\(\)\) attach\(id, receipt, now,/);
}

function bodySources() {
  const core = new URL('../', import.meta.url);
  return new Map(readdirSync(core).filter(name => name.endsWith('.mjs'))
    .map(file => [file, readFileSync(new URL(file, core), 'utf8')]));
}

test('only correction writes non-null Memory content and replaces all receipts before attachment', () => {
  assertBodyWriters(bodySources());
});

for (const [label, source] of [
  ['ordinary update', "db.prepare('UPDATE memories SET content = ? WHERE id = ?');"],
  ['quoted update', 'db.prepare(\'uPdAtE "memories" SET "content" = ? WHERE id = ?\');'],
  ['literal template update', 'db.prepare(`UPDATE memories SET content = ? WHERE id = ?`);'],
  ['upsert', "db.prepare('INSERT INTO memories(id,content) SELECT id,content FROM incoming ON CONFLICT(id) DO UPDATE SET content=excluded.content');"],
  ['interpolated table update', 'const table = "memories"; db.prepare(`UPDATE ${table} SET content = ? WHERE id = ?`);'],
  ['replace', "db.prepare('REPLACE INTO memories(id,content) VALUES(?,?)');"],
  ['insert or replace', 'db.prepare(\'INSERT OR REPLACE INTO "memories"(id,"content") VALUES(?,?)\');'],
]) test(`body-write guard rejects ${label}`, () => {
  const sources = bodySources(); sources.set('synthetic-writer.mjs', source);
  assert.throws(() => assertBodyWriters(sources), /body write.*synthetic-writer\.mjs/);
});


async function bodyAuthorFixture(t, { matched = false, corrected = false, episodeOnly = false, sharedCorrection = false, withEpisode = false } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const f = safetyFixture(t), client = RAW_CLIENTS[0];
  let core = openMemoryCore({ path: f.path, model: rationaleModel() });
  let body = 'Synthetic captured preference.';
  const capture = (sessionId, eventId, messageId) => core.capture({ namespace: ns, client, sessionId, eventId,
    messages: [{ id: messageId, role: 'user', content: body }] });
  let memory;
  try {
    ok(await capture('target', 'initial-capture', matched ? 'current-message' : 'initial-message'));
    const db = f.connect();
    try { memory = db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get(); }
    finally { db.close(); }
    if (corrected || sharedCorrection) {
      t.mock.timers.setTime(start + 20_000);
      body = 'Synthetic revised preference.';
      const receipt = { client, sessionId: sharedCorrection ? 'confirmation' : 'target', eventId: 'revision-message', role: 'user', excerpt: body };
      memory = ok(core.correct({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
        content: body, kind: 'context', receipt })).memory;
      if (sharedCorrection) ok(await capture('target', 'same-time-capture', 'same-time-message'));
    }
    t.mock.timers.setTime(start + 30_000);
    ok(await capture('confirmation', 'confirmation-capture', 'confirmation-message'));
  } finally { core.close(); }
  copySqliteFixture(f.path, f.backupPath);
  await upgradeLayoutBase({ path: f.path, backupPath: f.backupPath,
    expected: { storeId: f.storeId, fromBase: 18, toBase: 33 }, quiescence });
  copySqliteFixture(f.path, f.backupPath);
  await migrateReceiptEventTime({ path: f.path, backupPath: f.backupPath,
    expected: { storeId: f.storeId, base: 33 }, quiescence });
  core = openMemoryCore({ path: f.path, raw: true, model: rationaleModel() });
  f.workspace.defer(() => core.close());
  const db = f.connect(); f.workspace.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 53);
  t.mock.timers.setTime(start + 180_000);
  if (!episodeOnly) ok(await capture('target', 'current-capture', 'current-message'));
  let episodeId;
  if (withEpisode || episodeOnly) {
    const runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
    try {
      const input = { ...batch('current-episode', body, 'target'), client };
      input.messages[0].id = input.view.messages[0].id = 'current-message';
      episodeId = runtime.reserveEpisodeBatch(ns, input).episodeId;
      const key = { namespace: ns, client, eventId: input.eventId, payloadDigest: input.payloadDigest };
      const claim = ok(core.claimAdmission({ ...key, leaseMs: 125_000 }));
      const admission = ok(await core.finishAdmission({ ...key, token: claim.token, items: [{ content: body,
        kind: 'context', confidence: .5, receipts: [{ client, sessionId: 'target', eventId: 'current-message', role: 'user', excerpt: body }] }] }));
      assert.equal(admission.memories[0].id, memory.id);
    } finally { runtime.close(); }
  }
  const receipts = db.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY created_at').all(memory.id);
  assert.ok(receipts.some(row => row.session_id === 'confirmation' && Date.parse(row.created_at) === start + 30_000));
  const authorTime = start + (corrected || sharedCorrection ? 20_000 : 0);
  const authors = receipts.filter(row => Date.parse(row.created_at) === authorTime);
  assert.equal(authors.length, sharedCorrection ? 2 : 1);
  assert.ok(authors.some(row => row.session_id === 'target'));
  const roots = createRawSourceRoots(db);
  assert.ok(receipts.some(row => roots.receipt(ns, row).roots.length));
  if (!corrected && !sharedCorrection) assert.equal(roots.receipt(ns, authors[0]).unknown, !matched);
  const conversation = db.prepare('SELECT id,first_received_at FROM raw_conversations').get();
  assert.equal(Boolean(conversation), !episodeOnly);
  const episode = episodeId ? db.prepare('SELECT id,first_received_at FROM session_episodes WHERE id=?').get(episodeId) : null;
  assert.equal(Date.parse((conversation ?? episode).first_received_at), start + 180_000);
  assert.equal(ok(core.get({ namespace: ns, memoryId: memory.id })).memory.content, body);
  return { core, db, memory, conversation, episode };
}

function deleteAuthored(f, path) {
  if (path === 'conversation') {
    const key = { namespace: ns, conversationId: f.conversation.id,
      expectedRevision: f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(f.conversation.id).revision };
    const preview = ok(f.core.previewDeleteConversation(key));
    const result = ok(f.core.deleteConversation({ ...key, actionId: 'delete-authored' }));
    for (const field of ['forgottenMemories', 'retainedMemories', 'removedReceipts', 'invalidatedEpisodes'])
      assert.equal(result[field], preview[field]);
  } else ok(f.core.forgetEpisode({ namespace: ns, episodeId: f.episode.id,
    expectedRevision: f.db.prepare('SELECT revision FROM session_episodes WHERE id=?').get(f.episode.id).revision }));
  if (f.conversation) assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations WHERE id=?').get(f.conversation.id).n, 0);
  else assert.equal(f.db.prepare('SELECT deleted FROM session_episodes WHERE id=?').get(f.episode.id).deleted, 1);
  assert.equal(f.core.get({ namespace: ns, memoryId: f.memory.id }).error?.code, 'memory_not_found');
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(f.memory.id).n, 0);
  assert.deepEqual({ ...f.db.prepare('SELECT deleted,content FROM memories WHERE id=?').get(f.memory.id) }, { deleted: 1, content: null });
}

for (const [label, options] of [['unresolved original', {}], ['resolved original', { matched: true }],
  ['corrected original', { corrected: true }]]) for (const path of ['conversation', 'episode'])
  test(`body-author independence: ${label} through ${path} deletion`, async t => {
    deleteAuthored(await bodyAuthorFixture(t, { ...options, withEpisode: path === 'episode' }), path);
  });

test('body-author independence: original capture with an episode-only root', async t => {
  deleteAuthored(await bodyAuthorFixture(t, { episodeOnly: true }), 'episode');
});

test('all receipts tied at correction time must exclude the deleted author', async t => {
  deleteAuthored(await bodyAuthorFixture(t, { sharedCorrection: true }), 'conversation');
});

test('unparseable low-sorting receipt clock stays dependent', async t => {
  const f = await fixture(t);
  f.db.prepare('UPDATE receipts SET created_at=? WHERE id=?').run('0000-invalid', f.original.id);
  remove(f, false);
});

for (const path of ['conversation', 'episode']) test(`old finite other-root KEEP refuses through ${path} deletion`, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const f = safetyFixture(t), client = RAW_CLIENTS[0], namespace = keepNamespace;
  const model = { ...rationaleModel(), extract: empty, interpretEpisode: interpretation };
  let core = openMemoryCore({ path: f.path, model, ...config('episode') });
  let memoryId;
  const db = f.connect();
  try {
    const sources = [];
    for (const session of ['source-one', 'source-two']) {
      const episode = ok(await core.capture(episodeInput(client, session))).episode;
      sources.push(db.prepare('SELECT id FROM episode_sources WHERE episode_id=?').get(episode.id).id);
    }
    const runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
    try {
      const legacy = { ...f, core, db, model };
      const inherited = consumer(legacy, runtime, { client: RAW_CLIENTS[1], sourceIds: sources });
      memoryId = (await legacyKeep(legacy, runtime, inherited.id, content)).admission.memories[0].id;
    } finally { runtime.close(); }
    t.mock.timers.setTime(start + 30_000);
    assert.equal(ok(core.admit({ namespace, memory: { content, kind: 'context' },
      receipts: [{ client, sessionId: 'target', eventId: 'target-message', role: 'user', excerpt: content }] })).memory.id, memoryId);
  } finally { db.close(); core.close(); }
  copySqliteFixture(f.path, f.backupPath);
  await upgradeLayoutBase({ path: f.path, backupPath: f.backupPath,
    expected: { storeId: f.storeId, fromBase: 18, toBase: 33 }, quiescence });
  copySqliteFixture(f.path, f.backupPath);
  await migrateReceiptEventTime({ path: f.path, backupPath: f.backupPath,
    expected: { storeId: f.storeId, base: 33 }, quiescence });
  core = openMemoryCore({ path: f.path, model, raw: true, ...config('episode') });
  f.workspace.defer(() => core.close());
  const current = f.connect(); f.workspace.defer(() => current.close());
  assert.equal(current.prepare('PRAGMA user_version').get().user_version, 53);
  t.mock.timers.setTime(start + 180_000);
  const episode = ok(await core.capture(episodeInput(client, 'target'))).episode;
  const raw = ok(await core.captureRaw(request(splitRaw('Synthetic later source.', { id: 'target-message', ordinal: 2 })[0],
    { namespace, client, sessionId: 'target', eventId: 'later-raw' }, 'episode')));
  const roots = createRawSourceRoots(current), internal = { ...namespace, projectId: namespace.projectId || '' };
  const receipts = current.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY created_at').all(memoryId);
  const keep = roots.receipt(internal, receipts[0]);
  assert.equal(receipts[0].created_at, new Date(start).toISOString());
  assert.equal(keep.legacyKeep, true); assert.equal(keep.unknown, true);
  assert.equal(keep.possibleRoots.length, 2);
  const target = current.prepare('SELECT * FROM raw_conversations WHERE id=?').get(raw.raw.conversationId);
  assert.ok(keep.possibleRoots.every(root => root.sessionKey !== target.session_key));
  assert.equal(Date.parse(target.first_received_at), start + 180_000);
  const snapshot = () => current.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()
    .map(({ name }) => [name, current.prepare('SELECT * FROM "' + name + '"').all()]);
  const key = { namespace, conversationId: target.id, expectedRevision: target.revision };
  const before = snapshot();
  const preview = core.previewDeleteConversation(key);
  const result = path === 'conversation' ? core.deleteConversation({ ...key, actionId: 'delete-with-keep' }) :
    core.forgetEpisode({ namespace, episodeId: episode.id,
      expectedRevision: current.prepare('SELECT revision FROM session_episodes WHERE id=?').get(episode.id).revision });
  assert.deepEqual([preview.error?.code, result.error?.code], ['raw_lineage_unavailable', 'raw_lineage_unavailable']);
  assert.deepEqual(snapshot(), before);
});
