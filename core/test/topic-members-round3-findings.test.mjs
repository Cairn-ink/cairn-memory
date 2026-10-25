import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { openMemoryReader } from '../index.mjs';
import { createTopicOpening } from '../topic-members-opening.mjs';
import { createTopicSession } from '../topic-members-session.mjs';
import { createTopicMemberReader } from '../topic-members-reader.mjs';
import { createTopicTokens } from '../topic-snapshot.mjs';
import { membersInput } from '../topic-members-input.mjs';
import { memberFixture, namespace, smallHierarchy, ok } from '../testing/topic-members-fixture.mjs';
import { cloneSchema, withoutPrimary, baselineReader, faultWorkers } from '../testing/topic-members-round3-fixture.mjs';
const base = { namespace, selection: { type: 'unfiled' }, accessRevision: 'round3' };
const unsupported = { ok: false, error: { code: 'unsupported_database' } };
const primaryTables = ['memories','mocs','moc_title_sources','moc_edges','moc_memory_refs','namespace_epochs',
  'namespace_index_state','index_generations','index_memories','index_mocs','index_title_sources','index_memory_refs','index_edges'];
async function finish(reader, method, extra = {}) {
  let cursor;
  for (let attempt = 0; attempt < 4000; attempt++) {
    const input = { ...extra, ...(cursor ? { cursor } : {}) };
    const result = method === 'members' ? await reader.readTopicMembers({ ...base, ...input })
      : await reader.readTopicOverview({ namespace, snapshotVersion: 'topic-snapshot-v1', ...input });
    if (!result.ok || !result.value.nextCursor) return result;
    cursor = result.value.nextCursor;
  }
  assert.fail('opening must make bounded progress');
}
for (const mode of ['DELETE', 'WAL']) test(`spec P1 / standards P2: Primary-key identity validation was removed — nullable UNIQUE and NULL ID ${mode}`, async t => {
  const f = memberFixture(t, { mode }); f.admit('null-key');
  const path = cloneSchema(f, (sql, row) => row.name === 'memories' ? withoutPrimary(sql) : sql, true);
  const db = new DatabaseSync(path); try {
    db.exec(`PRAGMA journal_mode=${mode}`);
    assert.equal(db.prepare('SELECT id FROM memories').get().id, null);
    assert.equal(db.prepare("SELECT origin FROM pragma_index_list('memories') WHERE name='sqlite_autoindex_memories_1'").get().origin, 'u');
  } finally { db.close(); }
  for (const method of ['members','overview']) {
    const reader = f.reader(namespace, path);
    assert.deepEqual(await finish(reader, method, { workLimit: 16 }), unsupported, 'never certify a skipped NULL-ID Memory as an empty set');
  }
});
for (const table of primaryTables) test(`spec P1 / standards P2: Primary-key identity validation was removed — ${table} UNIQUE is not PRIMARY KEY`, async t => {
  const f = memberFixture(t);
  const path = cloneSchema(f, (sql, row) => row.name === table ? withoutPrimary(sql) : sql);
  assert.deepEqual(await finish(f.reader(namespace, path), 'members'), unsupported);
  assert.deepEqual(await finish(f.reader(namespace, path), 'overview'), unsupported);
});

test('spec P1 / standards P2: Primary-key identity validation was removed — BINARY UNIQUE must not mask a NOCASE primary key', async t => {
  const f = memberFixture(t); f.admit('masked-primary');
  const path = cloneSchema(f, (sql, row) => row.name === 'memories' ? sql.replace('id TEXT PRIMARY KEY', 'id TEXT UNIQUE')
    .replace(/\)\s*STRICT\s*$/, ', PRIMARY KEY(id COLLATE NOCASE)) STRICT') : sql);
  assert.deepEqual(await finish(f.reader(namespace, path), 'members'), unsupported);
  assert.deepEqual(await finish(f.reader(namespace, path), 'overview'), unsupported);
});

test('spec P1 / standards P2: Primary-key identity validation was removed — bounded attestation at workLimit 16', async t => {
  const f = memberFixture(t); f.admit('valid-primary');
  f.db.exec('BEGIN');
  for (let i = 0; i < 96; i++) f.db.exec(`ALTER TABLE memories ADD COLUMN round3_${i} TEXT DEFAULT 'PRIMARY KEY(fake)'`);
  for (let i = 0; i < 128; i++) f.db.exec(`CREATE INDEX round3_index_${i} ON memories(created_at)`);
  f.db.exec('COMMIT');
  let native = 0, fragments = 0;
  const db = new Proxy(f.db, { get(target, key) {
    if (key !== 'prepare') { const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; }
    return sql => {
      assert.ok(!/pragma_(?:table_info|index_list)\([^)]*\).*WHERE/i.test(sql), 'no hidden filtered metadata inventory');
      const statement = target.prepare(sql);
      return new Proxy(statement, { get(stmt, name) {
        if (name === 'get') return (...args) => {
          native++; const row = stmt.get(...args);
          if (row && Object.hasOwn(row, 'fragment')) {
            fragments++; assert.match(sql, /CAST\(sql AS BLOB\)/);
            assert.ok(row.fragment.length <= 256, 'read a bounded byte fragment without character-prefix scans');
          }
          return row;
        };
        if (name === 'columns') return () => { native++; return stmt.columns(); };
        if (name === 'iterate') return (...args) => {
          const iterator = stmt.iterate(...args);
          return { next() { native++; return iterator.next(); }, return: () => iterator.return() };
        };
        const value = Reflect.get(stmt, name, stmt); return typeof value === 'function' ? value.bind(stmt) : value;
      } });
    };
  } });
  const opening = createTopicOpening(db, 18); let state = opening.create();
  for (let step = 0; !state.done && step < 4000; step++) {
    native = 0; const reserved = opening.cost(state); opening.step(state);
    assert.ok(native <= reserved, JSON.stringify({ native, reserved, phase: state.phase }));
    assert.ok(Buffer.byteLength(JSON.stringify(state)) < 32768);
    state = structuredClone(state);
  }
  assert.equal(state.done, true); assert.ok(fragments >= 14, 'each consumed table must attest its declared primary key');
  const session = createTopicSession(f.path), uses = []; t.after(() => session.dispose());
  const engine = createTopicMemberReader({ ...session, tokens: createTopicTokens({ now: () => 100 }),
    now: () => 100, yieldQuantum: async () => {}, observe: value => uses.push(value.used) });
  let cursor, complete = false;
  for (let page = 0; page < 4000; page++) {
    uses.length = 0;
    const value = ok(await engine.read(membersInput({ ...base, workLimit: 16, ...(cursor ? { cursor } : {}) }, namespace.ownerId)));
    assert.ok(Math.max(...uses) <= 16); f.db.exec('BEGIN EXCLUSIVE; ROLLBACK');
    cursor = value.nextCursor; if (!cursor) { assert.equal(value.coverage.complete, true); complete = true; break; }
  }
  assert.equal(complete, true);
  t.diagnostic(JSON.stringify({ schemaFragments: fragments, workLimit: 16, finished: complete }));
});

const errorClasses = [
  ['SQL error', { code: 'ERR_SQLITE_ERROR', errcode: 1 }],
  ['busy', { code: 'ERR_SQLITE_ERROR', errcode: 5 }],
  ['locked', { code: 'ERR_SQLITE_ERROR', errcode: 6 }],
  ['extended busy', { code: 'ERR_SQLITE_ERROR', errcode: 261 }],
  ['extended locked', { code: 'ERR_SQLITE_ERROR', errcode: 262 }],
  ...['invalid_input','invalid_cursor','cursor_stale','index_unavailable','unsafe_database_file','unsupported_database',
    'database_not_found','storage_busy','state_limit','context_item_too_large','store_closed','moc_not_found',
    'revision_conflict','invalid_ref','read_timeout','reader_failed'].map(code => [code, { code }]),
  ['unexpected', {}],
];
test('spec/standards P2: Legacy error classification is only partial — differential against main b2513501', async t => {
  const f = memberFixture(t), oldOpen = await baselineReader(f.workspace, message => t.diagnostic(message)), setFault = faultWorkers(t);
  let comparisons = 0;
  async function compare(label, path = f.path, input = { namespace }) {
    const options = { path, ownerId: namespace.ownerId }, old = oldOpen(options), current = openMemoryReader(options);
    try {
      const expected = await old.readTopicOverview(input), actual = await current.readTopicOverview(input);
      comparisons++;
      assert.equal(JSON.stringify(actual), JSON.stringify(expected), label);
    } finally { await old.close(); await current.close(); }
  }
  // Both reviewers' complete 44-case matrix, plus faults in opening/snapshot/
  // final validation and the extra legacy configuration queries we found.
  const differences = [];
  for (const phase of ['construction','scan','opening','snapshot','final fence','configuration','token']) {
    for (const [name, error] of errorClasses) {
      setFault({ phase, error });
      try { await compare(phase + ': ' + name); } catch (error) { differences.push(error.message); }
    }
  }
  t.diagnostic(JSON.stringify({ baseline: 'b2513501', faultComparisons: comparisons, faultDifferences: differences.length,
    differingCases: differences.map(message => message.split('\n')[0]) }));
  setFault(undefined);
  for (const [name, sql] of [
    ['missing title','ALTER TABLE mocs RENAME COLUMN title TO missing_title'],
    ['missing secondary','DROP INDEX index_memory_keyset'],
    ['reverse secondary','DROP INDEX index_memory_keyset; CREATE INDEX index_memory_keyset ON memories(owner_id,scope,project_id,id DESC)'],
    ['partial secondary','DROP INDEX index_memory_keyset; CREATE INDEX index_memory_keyset ON memories(owner_id,scope,project_id,id) WHERE deleted=0'],
    ['collated secondary','DROP INDEX index_memory_keyset; CREATE INDEX index_memory_keyset ON memories(owner_id,scope,project_id,id COLLATE NOCASE)'],
    ['wrong application','PRAGMA application_id=1'],
    ['old version','PRAGMA user_version=17'],
    ['future version','PRAGMA user_version=99'],
    ['unavailable index',"INSERT INTO namespace_index_state(owner_id,scope,project_id,active_generation) VALUES('member-owner','personal','',NULL)"],
  ]) {
    const g = memberFixture(t); g.db.exec(sql);
    try { await compare(name, g.path); } catch (error) { differences.push(error.message); }
  }
  await compare('missing file', join(f.workspace.path, 'absent.sqlite'));
  const link = join(f.workspace.path, 'link.sqlite'); symlinkSync(f.path, link); await compare('symlink', link);
  chmodSync(f.path, 0o644); try { await compare('unsafe mode'); } finally { chmodSync(f.path, 0o600); }
  f.db.exec('BEGIN EXCLUSIVE'); try { await compare('actual opening lock'); } finally { f.db.exec('ROLLBACK'); }
  await compare('invalid input', f.path, { namespace, unknown: true });
  await compare('invalid cursor', f.path, { namespace, cursor: 'bad' });
  await compare('lost cursor', f.path, { namespace, cursor: 'e1.' + 'a'.repeat(43) });
  setFault({ phase: 'worker exit' }); await compare('unexpected Worker exit'); setFault(undefined);
  await compare('complete empty success');
  smallHierarchy(f); await compare('complete nonempty success');
  f.db.prepare("UPDATE memories SET kind='unknown'").run(); await compare('unknown eligible kind');
  f.db.prepare("UPDATE memories SET kind='fact'").run();
  setFault({ phase: 'cursor bytes' });
  const pair = [oldOpen, openMemoryReader].map(open => open({ path: f.path, ownerId: namespace.ownerId }));
  try {
    let cursor, done = false;
    for (let page = 0; page < 100; page++) {
      const input = { namespace, workLimit: 16, nodeLimit: 1, ...(cursor ? { cursor } : {}) };
      const expected = await pair[0].readTopicOverview(input), actual = await pair[1].readTopicOverview(input); comparisons++;
      assert.equal(JSON.stringify(actual), JSON.stringify(expected), 'legacy cursor bytes, budgets and page boundaries');
      if (cursor) {
        const replay = await Promise.all(pair.map(reader => reader.readTopicOverview(input))); comparisons++;
        assert.equal(JSON.stringify(replay[0]), JSON.stringify(expected)); assert.equal(JSON.stringify(replay[1]), JSON.stringify(expected));
      }
      cursor = ok(expected).nextCursor;
      if (!cursor) { done = true; break; }
    }
    assert.equal(done, true);
  } finally { await Promise.all(pair.map(reader => reader.close())); }
  setFault(undefined);
  const options = { path: f.path, ownerId: namespace.ownerId };
  for (const open of [oldOpen, openMemoryReader]) {
    const reader = open(options); await reader.close();
    assert.equal(JSON.stringify(await reader.readTopicOverview({ namespace })), '{"ok":false,"error":{"code":"store_closed"}}');
  }
  comparisons++;
  t.diagnostic(JSON.stringify({ baseline: 'b2513501', comparisons, differences: differences.length }));
  assert.deepEqual(differences, [], 'every outcome must be byte-identical to main, including all reviewer cases');
});
