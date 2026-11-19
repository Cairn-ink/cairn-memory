import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createRawLineageStorage } from '../raw-lineage-storage.mjs';
import { installedContentLayout } from '../content-safety-schema.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { openMemoryCore } from '../index.mjs';
import { eventTimeSafetyFixture, ns, ok } from '../testing/receipt-event-time-fixture.mjs';

const source = label => ({ client: 'synthetic', sessionId: 'session-' + label, eventId: 'event-' + label,
  role: 'user', excerpt: 'Synthetic ' + label });
const unionSQL = "event_id IN (SELECT json_extract(value,'$[2]')";
const failure = code => Object.assign(Error(code), { code });

async function setup(t) {
  const fixture = eventTimeSafetyFixture(t, 33);
  await fixture.migrate();
  const db = fixture.connect();
  t.after(() => db.close());
  return { db, fixture };
}

function addMemory(db, id) {
  db.prepare(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,deleted,created_at,updated_at)
    VALUES(?,?,?,?,?,'Synthetic','fact','explicit',1,1,0,'time','time')`).run(id, ns.ownerId, ns.scope, ns.projectId, id);
}

function addReceipt(db, parent, receipt, { id = receipt.eventId, time = 'time', bad = false } = {}) {
  const key = bad ? 'invalid-' + receipt.eventId : createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
  db.prepare(`INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
    VALUES(CAST(? AS TEXT),?,?,?,?,?,?,?,CAST(? AS TEXT))`).run(id, parent, key, receipt.client, receipt.sessionId,
    receipt.eventId, receipt.role, receipt.excerpt, time);
}

function exactFilter(storage, batch) {
  return batch.flatMap((receipt, index) => {
    try { storage.assertReceipts(ns, [receipt]); return [index]; }
    catch (error) { if (error?.code === 'source_excluded') return []; throw error; }
  });
}

function observe(t, db, batch, { exact = false, beforeRead } = {}) {
  installedContentLayout(db);
  const storage = createRawLineageStorage(db), prepare = db.prepare.bind(db);
  const trace = [];
  const hook = t.mock.method(db, 'prepare', sql => {
    const statement = prepare(sql);
    for (const method of ['all', 'get', 'iterate']) {
      const execute = statement[method].bind(statement);
      statement[method] = (...args) => {
        const entry = { sql, method, args, inTransaction: db.isTransaction };
        trace.push(entry);
        beforeRead?.(entry);
        return execute(...args);
      };
    }
    return statement;
  });
  db.exec('BEGIN IMMEDIATE');
  try {
    let allowed, caught, threw = false;
    try { allowed = exact ? exactFilter(storage, batch) : storage.filter(ns, batch); }
    catch (error) { threw = true; caught = error; }
    return { allowed, caught, threw, trace, inTransaction: db.isTransaction };
  } finally {
    hook.mock.restore();
    if (db.isTransaction) db.exec('ROLLBACK');
  }
}

const firstPages = trace => trace.filter(({ sql, args }) => sql.startsWith('SELECT id,revision,deleted,updated_at') &&
  args.length === 5 && args[3] === 0);
const receiptPages = trace => trace.filter(({ sql }) => sql.includes('ORDER BY created_at,id LIMIT 5'));

for (const [label, cursor] of [
  ['invalid UTF-8 id', { id: Buffer.from('7a80', 'hex') }],
  ['NUL id', { id: Buffer.from('7a0078', 'hex') }],
  ['empty id', { id: '' }],
  ['empty timestamp', { time: '' }],
]) test(`capture filter preserves stored cursor bytes for ${label}`, async t => {
  const { db } = await setup(t);
  addMemory(db, 'parent');
  const receipts = Array.from({ length: 5 }, (_, index) => source(index));
  for (const [index, receipt] of receipts.entries()) {
    const key = index === 3 ? cursor : {};
    const id = key.id ?? (index === 4 ? 'z\uE000' : 'a' + index);
    let time = 'time';
    if (cursor.time === '' && index < 4) time = '';
    if (cursor.id === '' && index < 3) time = 'a';
    if (cursor.id === '' && index === 4) time = 'v';
    addReceipt(db, 'parent', receipt, { id, time, bad: index === 4 });
  }
  const batch = [...receipts, receipts[0], receipts[4]];
  const baseline = observe(t, db, batch, { exact: true });
  const current = observe(t, db, batch);
  assert.equal(current.threw, false);
  assert.deepEqual(baseline.allowed, [0, 1, 2, 3, 5]);
  assert.deepEqual(current.allowed, baseline.allowed);
  const [page, seek] = receiptPages(current.trace);
  assert.match(page.sql, /event_id IN/);
  assert.match(seek.sql, /\(created_at,id\)>\(CAST\(\? AS TEXT\),CAST\(\? AS TEXT\)\)/);
  for (const [index, value] of [[3, cursor.time], [4, cursor.id]]) {
    if (value === '') assert.equal(seek.args[index], value);
    else if (value !== undefined) assert.deepEqual(Buffer.from(seek.args[index]), value);
  }
  assert.equal(firstPages(current.trace).length, 1);
});

test('UTF-16 storage and ineligible source tuples retain unfiltered receipt SQL', async t => {
  const { db } = await setup(t);
  const utf16 = new DatabaseSync(':memory:');
  t.after(() => utf16.close());
  utf16.exec("PRAGMA encoding='UTF-16le'");
  const schema = db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all();
  const quote = name => '"' + name.replaceAll('"', '""') + '"';
  for (const { type, name, sql } of schema) {
    if (type !== 'table') continue;
    utf16.exec(sql);
    const rows = db.prepare(`SELECT * FROM ${quote(name)}`).all();
    for (const row of rows) {
      const keys = Object.keys(row);
      utf16.prepare(`INSERT INTO ${quote(name)} (${keys.map(quote)}) VALUES(${keys.map(() => '?')})`).run(...Object.values(row));
    }
  }
  for (const { type, sql } of schema) if (type !== 'table') utf16.exec(sql);
  utf16.exec('PRAGMA user_version=53; PRAGMA application_id=' + db.prepare('PRAGMA application_id').get().application_id);
  assert.equal(utf16.prepare('PRAGMA encoding').get().encoding, 'UTF-16le');

  for (const connection of [db, utf16]) {
    addMemory(connection, 'parent');
    const regular = source('regular'), denied = source('denied'), odd = { ...source('odd'), excerpt: 'Synthetic\uFFFD' };
    addReceipt(connection, 'parent', regular);
    addReceipt(connection, 'parent', denied, { bad: true });
    addReceipt(connection, 'parent', odd, { bad: true });
    const batch = [regular, odd, denied, { ...source('nul'), excerpt: 'a\0b' }, { ...source('surrogate'), excerpt: '\uD800' }];
    const baseline = observe(t, connection, batch, { exact: true });
    const current = observe(t, connection, batch);
    assert.equal(current.threw, false);
    assert.deepEqual(baseline.allowed, [0, 3, 4]);
    assert.deepEqual(current.allowed, baseline.allowed);
    assert.equal(firstPages(current.trace).length, 4, 'one union and three original per-source walks');
    const pages = receiptPages(current.trace);
    assert.equal(pages.length, 4);
    assert.equal(pages.filter(({ sql }) => sql.includes(unionSQL)).length, connection === db ? 1 : 0);
    assert.equal(pages.filter(({ sql }) => !sql.includes('receipt_created_at_bytes')).length, connection === db ? 3 : 4);
  }
});

test('the union keeps stored NUL tuples for the native decoder', async t => {
  const { db } = await setup(t);
  addMemory(db, 'parent');
  const stored = source('stored'), safe = source('safe');
  addReceipt(db, 'parent', stored, { bad: true });
  db.prepare('UPDATE receipts SET event_id=CAST(? AS TEXT) WHERE id=?')
    .run(Buffer.from(stored.eventId + '\0suffix'), stored.eventId);
  const decoded = db.prepare('SELECT event_id FROM receipts WHERE id=?').get(stored.eventId).event_id;
  assert.ok(decoded === stored.eventId || decoded === stored.eventId + '\0suffix');
  const batch = [stored, safe];
  const expected = observe(t, db, batch, { exact: true });
  const actual = observe(t, db, batch);
  assert.deepEqual(expected.allowed, decoded === stored.eventId ? [1] : [0, 1]);
  assert.deepEqual(actual.allowed, expected.allowed);
  assert.equal(firstPages(actual.trace).length, 1);
});

test('scope refusal avoids enumeration and first Raw refusal precedes later validation', async t => {
  const { db, fixture } = await setup(t);
  const core = openMemoryCore({ path: fixture.path, raw: true });
  t.after(() => core.close());
  const first = { ...source('first'), client: 'claude-code' }, later = source('later');
  ok(core.fenceSession({ namespace: ns, client: first.client, sessionId: first.sessionId }));
  addMemory(db, 'parent');
  addReceipt(db, 'parent', later);
  const laterFault = failure('revision_conflict');
  const beforeRead = ({ sql, args }) => {
    if (sql.includes('FROM content_suppressions INDEXED BY content_suppression_target') && args.includes('parent')) throw laterFault;
  };
  assert.equal(observe(t, db, [later], { beforeRead }).caught, laterFault);
  const expected = observe(t, db, [first, later], { exact: true });
  const current = observe(t, db, [first, later], { beforeRead });
  assert.equal(expected.caught?.code, 'conversation_deleted');
  assert.equal(current.caught?.code, expected.caught.code);
  assert.equal(firstPages(current.trace).length, 1);
  assert.equal(current.trace.filter(({ sql }) => sql.includes('SELECT 1 FROM raw_session_fences')).length,
    expected.trace.filter(({ sql }) => sql.includes('SELECT 1 FROM raw_session_fences')).length);
  assert.equal(current.trace.filter(({ sql }) => sql.includes('FROM content_suppressions INDEXED BY content_suppression_target')).length,
    expected.trace.filter(({ sql }) => sql.includes('FROM content_suppressions INDEXED BY content_suppression_target')).length);
  const ineligibleFirst = observe(t, db, [{ ...first, excerpt: '\uFFFD' }, later, source('third')], { beforeRead });
  assert.equal(ineligibleFirst.caught?.code, 'conversation_deleted');
  assert.ok(ineligibleFirst.trace.every(({ sql }) => !sql.includes(unionSQL)));
  db.exec('BEGIN IMMEDIATE');
  try {
    writeContentSuppressionInside(db, { namespace: ns, kind: 'namespace', matchMode: 'namespace',
      reason: 'purge', actionId: 'synthetic-scope' });
    db.exec('COMMIT');
  } finally { if (db.isTransaction) db.exec('ROLLBACK'); }
  const scoped = observe(t, db, [first, later]);
  assert.deepEqual(scoped.allowed, []);
  assert.equal(firstPages(scoped.trace).length, 0);
});

for (const kind of ['live I/O', 'auto-rollback', 'deadline', 'validator']) test(`capture filter fault boundary: ${kind}`, async t => {
  const { db } = await setup(t);
  const denied = source('denied'), safe = source('safe');
  db.exec('CREATE TEMP TABLE rollback_witness(id INTEGER PRIMARY KEY); INSERT INTO rollback_witness VALUES(1)');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (let index = 0; index < 129; index++) addMemory(db, 'memory-' + String(index).padStart(3, '0'));
    addReceipt(db, 'memory-000', denied);
    addReceipt(db, 'memory-001', safe);
    writeContentSuppressionInside(db, { namespace: ns, kind: 'memory', key: 'memory-000',
      reason: 'purge', actionId: 'synthetic-memory-purge' });
    db.exec('COMMIT');
  } finally { if (db.isTransaction) db.exec('ROLLBACK'); }
  const batch = [denied, safe];
  const baseline = observe(t, db, batch, { exact: true });
  assert.deepEqual(baseline.allowed, [1]);
  let injected, faultEntry, sawUnion = false;
  const run = observe(t, db, batch, { beforeRead(entry) {
    const { sql } = entry;
    if (sql.includes(unionSQL)) sawUnion = true;
    if (injected || !sawUnion) return;
    if (kind === 'validator') {
      if (!sql.includes('SELECT 1 FROM raw_session_fences')) return;
      injected = failure('revision_conflict');
    } else {
      if (!sql.startsWith('SELECT id,revision,deleted,updated_at') || !sql.includes('AND updated_at=')) return;
      if (kind === 'auto-rollback') {
        try { db.exec('INSERT OR ROLLBACK INTO rollback_witness VALUES(1)'); }
        catch (error) { injected = error; }
        assert.ok(injected);
        assert.equal(db.isTransaction, false);
      } else injected = failure(kind === 'deadline' ? 'read_timeout' : 'ERR_SQLITE_ERROR');
    }
    faultEntry = entry;
    throw injected;
  } });
  assert.ok(injected, 'the injected boundary was reached');
  const walks = firstPages(run.trace);
  if (kind === 'live I/O') {
    assert.deepEqual(run.allowed, baseline.allowed);
    assert.equal(walks.length, 3);
    assert.ok(run.trace.every(entry => entry.inTransaction));
    const deniedValidation = ({ sql, args }) =>
      sql.includes('FROM content_suppressions INDEXED BY content_suppression_target') && args.includes('memory-000');
    const faultIndex = run.trace.indexOf(faultEntry);
    assert.equal(run.trace.slice(0, faultIndex).some(deniedValidation), false, 'partial walk cannot validate retained rows');
    assert.equal(run.trace.slice(faultIndex + 1).some(deniedValidation), true, 'exact replay validates the first receipt');
  } else {
    assert.equal(run.threw, true);
    assert.equal(run.caught, injected);
    assert.equal(walks.length, 1);
    assert.equal(run.inTransaction, kind !== 'auto-rollback');
  }
});
