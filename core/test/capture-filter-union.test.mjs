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
const unionSQL = 'CROSS JOIN json_each(?) source CROSS JOIN receipts';
const failure = code => Object.assign(Error(code), { code });
const sqliteFault = (message, errcode) => Object.assign(Error(message), { code: 'ERR_SQLITE_ERROR', errcode });

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
  const key = bad ? 'invalid-' + receipt.eventId + '-' + id : createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
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

function observe(t, db, batch, { exact = false, beforeRead, prepareSQL, lineage } = {}) {
  installedContentLayout(db);
  const storage = lineage ?? createRawLineageStorage(db), prepare = db.prepare.bind(db);
  const trace = [];
  const hook = t.mock.method(db, 'prepare', sql => {
    const statement = prepare(prepareSQL?.(sql) ?? sql);
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

function addOverflowReceipts(db) {
  const safe = source('safe'), denied = source('overflow');
  addMemory(db, 'safe-parent');
  addMemory(db, 'overflow-parent');
  addReceipt(db, 'safe-parent', safe);
  for (let index = 0; index < 4; index++) {
    const padding = source('padding-' + index);
    addReceipt(db, 'overflow-parent', padding, { time: 'early' });
    db.prepare('UPDATE receipts SET excerpt=CAST(? AS TEXT) WHERE id=?')
      .run(Buffer.from(padding.excerpt + '\0padding'), padding.eventId);
  }
  addReceipt(db, 'overflow-parent', denied, { bad: true });
  return [safe, denied];
}

const overflowSeek = ({ sql, args }) => sql.includes('AND (created_at,id)>') && args[2] === 'overflow-parent';
const safeValidation = ({ sql, args }) =>
  sql.includes('FROM content_suppressions INDEXED BY content_suppression_target') && args.includes('safe-parent');

for (const kind of ['SQLITE_ERROR', 'ERR_INVALID_ARG_TYPE']) test(`non-transient overflow seek propagates ${kind}`, async t => {
  const { db } = await setup(t);
  const batch = addOverflowReceipts(db);
  const malformed = db.prepare('SELECT json(?)');
  const errors = [];
  const result = observe(t, db, batch, { beforeRead(entry) {
    if (!overflowSeek(entry) || (kind === 'ERR_INVALID_ARG_TYPE' && errors.length)) return;
    try {
      if (kind === 'SQLITE_ERROR') malformed.get('{');
      else Buffer.from(1);
    } catch (error) {
      errors.push(error);
      throw error;
    }
  } });
  const validations = result.trace.filter(safeValidation).length;
  t.diagnostic(`overflow seeks: ${result.trace.filter(overflowSeek).length}, safe validations: ${validations}, original error: ${result.caught === errors[0]}`);
  assert.equal(errors[0]?.code, kind === 'SQLITE_ERROR' ? 'ERR_SQLITE_ERROR' : kind);
  if (kind === 'SQLITE_ERROR') assert.equal(errors[0].errcode, 1);
  assert.equal(result.inTransaction, true);
  assert.equal(result.threw, true);
  assert.equal(result.caught, errors[0]);
  assert.equal(validations, 1);
  assert.equal(result.trace.filter(overflowSeek).length, 1);
});

test('a third tuple read fault refuses the batch and retry reaches the Raw fence', async t => {
  const { db, fixture } = await setup(t);
  const core = openMemoryCore({ path: fixture.path, raw: true });
  t.after(() => core.close());
  const first = source('invalid'), fenced = { ...source('fenced'), client: 'claude-code' }, third = source('third');
  ok(core.fenceSession({ namespace: ns, client: fenced.client, sessionId: fenced.sessionId }));
  addMemory(db, 'first-parent');
  addMemory(db, 'third-parent');
  addReceipt(db, 'first-parent', first, { bad: true });
  addReceipt(db, 'third-parent', third);
  const batch = [first, fenced, third];
  const fault = failure('read_timeout');
  let faultActive = true, attempts = 0;
  db.function('inspect_receipt', eventId => {
    if (faultActive && eventId === third.eventId) {
      attempts++;
      throw fault;
    }
    return eventId;
  });
  const prepareSQL = sql => sql.includes('wanted.key AS wanted_entry')
    ? sql.replace('SELECT r.*,', 'SELECT inspect_receipt(r.event_id) AS inspected_event, r.*,') : sql;
  const baseline = observe(t, db, batch, { exact: true, prepareSQL });
  assert.equal(baseline.caught?.code, 'conversation_deleted');
  assert.equal(baseline.allowed, undefined);
  assert.equal(attempts, 0);
  const lineage = createRawLineageStorage(db);
  const faulted = observe(t, db, batch, { prepareSQL, lineage });
  assert.equal(attempts, 1);
  assert.ok(faulted.threw || faulted.allowed?.length === 0);
  if (faulted.threw) assert.equal(faulted.caught, fault);
  faultActive = false;
  const retry = observe(t, db, batch, { prepareSQL, lineage });
  assert.equal(retry.caught?.code, 'conversation_deleted');
  assert.equal(retry.allowed, undefined);
});

test('reusing deleted-range history keeps the fault-free allows', async t => {
  const { db } = await setup(t);
  const [safe, denied] = addOverflowReceipts(db);
  const batch = [safe, safe, denied];
  const baseline = observe(t, db, batch, { exact: true });
  assert.deepEqual(baseline.allowed, [0, 1]);
  const fault = failure('read_timeout');
  let deletedReads = 0;
  const beforeRead = ({ sql, args }) => {
    if (sql.startsWith('SELECT id,revision,deleted,updated_at') && args[3] === 1 && ++deletedReads === 2) throw fault;
  };
  assert.equal(observe(t, db, batch, { exact: true, beforeRead }).caught, fault);
  assert.equal(deletedReads, 2);
  deletedReads = 0;
  const result = observe(t, db, batch, { beforeRead });
  assert.equal(result.threw, false);
  assert.deepEqual(result.allowed, baseline.allowed);
  assert.equal(deletedReads, 1);
  assert.equal(result.trace.filter(overflowSeek).length, 1);
});

test('a transient overflow seek replays the exact pass once', async t => {
  const { db } = await setup(t);
  const batch = addOverflowReceipts(db);
  const baseline = observe(t, db, batch, { exact: true });
  assert.deepEqual(baseline.allowed, [0]);
  const busy = sqliteFault('synthetic SQLite busy recovery', 5 | (1 << 8));
  let attempts = 0;
  const result = observe(t, db, batch, { beforeRead(entry) {
    if (overflowSeek(entry) && ++attempts === 1) throw busy;
  } });
  assert.equal(result.threw, false);
  assert.deepEqual(result.allowed, baseline.allowed);
  assert.equal(result.inTransaction, true);
  assert.equal(attempts, 2);
  assert.equal(result.trace.filter(safeValidation).length, 2);
  assert.equal(result.trace.filter(({ sql }) => sql.includes(unionSQL)).length, 1);
});

for (const size of [1, 2]) for (const kind of ['no fault', 'live busy', 'timeout', 'read_timeout', 'auto-rollback']) {
  test(`page-one denial of ${size} receipt(s) avoids later Memory seek: ${kind}`, async t => {
    const { db } = await setup(t);
    const batch = Array.from({ length: size }, (_, index) => source('invalid-' + index));
    db.exec('CREATE TEMP TABLE rollback_witness(id INTEGER PRIMARY KEY); INSERT INTO rollback_witness VALUES(1)');
    db.exec('BEGIN IMMEDIATE');
    try {
      for (let index = 0; index < 129; index++) addMemory(db, 'memory-' + String(index).padStart(3, '0'));
      for (const receipt of batch) addReceipt(db, 'memory-000', receipt, { bad: true });
      db.exec('COMMIT');
    } finally { if (db.isTransaction) db.exec('ROLLBACK'); }
    let injected = false;
    const beforeRead = ({ sql }) => {
      if (injected || kind === 'no fault' || !sql.startsWith('SELECT id,revision,deleted,updated_at') || !sql.includes('AND updated_at=')) return;
      injected = true;
      if (kind === 'auto-rollback') db.exec('INSERT OR ROLLBACK INTO rollback_witness VALUES(1)');
      throw kind === 'live busy' ? sqliteFault('synthetic SQLite busy', 5) : failure(kind);
    };
    const baseline = observe(t, db, batch, { exact: true, beforeRead });
    const current = observe(t, db, batch, { beforeRead });
    const reads = trace => trace.filter(({ sql }) => sql.startsWith('SELECT id,revision,deleted,updated_at') ||
      sql.includes('ORDER BY created_at,id LIMIT 5')).length;
    const counts = [reads(baseline.trace), reads(current.trace)];
    t.diagnostic('MAIN and filter history reads: ' + counts.join(', '));
    for (const result of [baseline, current]) {
      assert.equal(result.caught, undefined);
      assert.equal(result.threw, false);
      assert.deepEqual(result.allowed, []);
      assert.equal(result.inTransaction, true);
    }
    assert.equal(injected, false);
    assert.deepEqual(counts, [size * 2, 2]);
  });
}

test('page-one denial avoids a receipt seek caused only by combining keys', async t => {
  const { db } = await setup(t);
  const first = source('first'), later = source('later');
  addMemory(db, 'parent');
  addReceipt(db, 'parent', first, { id: 'z', bad: true });
  for (let index = 0; index < 4; index++) addReceipt(db, 'parent', later, { id: 'a' + index, bad: true });
  const beforeRead = ({ sql }) => {
    if (sql.includes('AND (created_at,id)>')) throw failure('read_timeout');
  };
  for (const exact of [true, false]) {
    const result = observe(t, db, [first, later], { exact, beforeRead });
    assert.equal(result.caught, undefined);
    assert.deepEqual(result.allowed, []);
    assert.equal(result.inTransaction, true);
    assert.equal(receiptPages(result.trace).length, exact ? 2 : 1);
  }
});

for (const [label, cursor] of [
  ['invalid UTF-8 id', { id: Buffer.from('7a80', 'hex') }],
  ['NUL id', { id: Buffer.from('7a0078', 'hex') }],
  ['empty id', { id: '' }],
  ['empty timestamp', { time: '' }],
]) test(`capture filter preserves stored cursor bytes for ${label}`, async t => {
  const { db } = await setup(t);
  addMemory(db, 'parent');
  addMemory(db, 'safe-parent');
  const receipt = source('paged'), safe = source('safe');
  for (let index = 0; index < 5; index++) {
    const key = index === 3 ? cursor : {};
    const id = key.id ?? (index === 4 ? 'z\uE000' : 'a' + index);
    let time = 'time';
    if (cursor.time === '' && index < 4) time = '';
    if (cursor.id === '' && index < 3) time = 'a';
    if (cursor.id === '' && index === 4) time = 'v';
    const stored = index < 3 ? source('padding-' + index) : receipt;
    addReceipt(db, 'parent', stored, { id, time, bad: index === 4 });
    if (index < 3) db.prepare('UPDATE receipts SET excerpt=CAST(? AS TEXT) WHERE id=?')
      .run(Buffer.from(stored.excerpt + '\0padding'), id);
  }
  addReceipt(db, 'safe-parent', safe);
  const batch = [receipt, safe, receipt];
  const baseline = observe(t, db, batch, { exact: true });
  const current = observe(t, db, batch);
  assert.equal(current.threw, false);
  assert.deepEqual(baseline.allowed, [1]);
  assert.deepEqual(current.allowed, baseline.allowed);
  const [page, seek] = receiptPages(current.trace);
  assert.ok(page.sql.includes(unionSQL));
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

for (const kind of ['live lock', 'auto-rollback', 'deadline', 'validator']) test(`capture filter fault boundary: ${kind}`, async t => {
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
      injected = sqliteFault('synthetic SQLite locked during validation', 6);
    } else {
      if (!sql.startsWith('SELECT id,revision,deleted,updated_at') || !sql.includes('AND updated_at=')) return;
      if (kind === 'auto-rollback') {
        try { db.exec('INSERT OR ROLLBACK INTO rollback_witness VALUES(1)'); }
        catch (error) { injected = error; }
        assert.ok(injected);
        assert.equal(db.isTransaction, false);
      } else injected = kind === 'deadline' ? failure('read_timeout') : sqliteFault('synthetic SQLite locked during enumeration', 6);
    }
    faultEntry = entry;
    throw injected;
  } });
  assert.ok(injected, 'the injected boundary was reached');
  const walks = firstPages(run.trace);
  if (kind === 'live lock') {
    assert.deepEqual(run.allowed, baseline.allowed);
    assert.equal(walks.length, 3);
    assert.ok(run.trace.every(entry => entry.inTransaction));
    const deniedValidation = ({ sql, args }) =>
      sql.includes('FROM content_suppressions INDEXED BY content_suppression_target') && args.includes('memory-000');
    const faultIndex = run.trace.indexOf(faultEntry);
    assert.equal(run.trace.slice(0, faultIndex).some(deniedValidation), true, 'the first receipt is validated before the walk resumes');
    assert.equal(run.trace.slice(faultIndex + 1).some(deniedValidation), true, 'exact replay validates the first receipt');
  } else {
    assert.equal(run.threw, true);
    assert.equal(run.caught, injected);
    assert.equal(walks.length, 1);
    assert.equal(run.inTransaction, kind !== 'auto-rollback');
  }
});
