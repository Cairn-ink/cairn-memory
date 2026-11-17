// Qualification only: base comparisons intentionally live outside node:test.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { openMemoryCore } from '../../core/index.mjs';
import { eventTimeSafetyFixture } from '../../core/testing/receipt-event-time-fixture.mjs';
import { safetyFixture, ns, ok } from '../../core/testing/content-safety-s2h-fixture.mjs';

const phase = process.argv[2], base = process.argv[3];
assert.ok(['before', 'after'].includes(phase), 'usage: node <qualification> before|after [base-ref]');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Independent token oracle also runs on a base predating the marker helper.
const receiptDenialTokens = rows => rows.flatMap(row => [
  'rs1:i:' + row.receipt_key,
  'rs1:a:' + digest(['receipt-source-address-v1', row.client, row.session_id, row.event_id, row.role]),
]);
const boundary = value => [value.ownerId, value.scope, value.projectId || ''];
const identity = i => ({ client: 'cairn-web', sessionId: 'cost-session', eventId: 'm' + i,
  role: 'user', excerpt: 'Synthetic independent message ' + i });

async function meter(call) {
  const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec;
  const methods = new Map(['get', 'all', 'run', 'iterate'].map(name => [name, StatementSync.prototype[name]]));
  const counts = { prepared: 0, executed: 0, exec: 0, tokenPrepared: 0, tokenExecuted: 0 };
  const tokenLookup = sql => /json_each\(\?\).*CROSS JOIN suppressed s/s.test(sql);
  DatabaseSync.prototype.prepare = function (sql) {
    counts.prepared++; if (tokenLookup(sql)) counts.tokenPrepared++;
    return Reflect.apply(prepare, this, [sql]);
  };
  DatabaseSync.prototype.exec = function (sql) { counts.exec++; return Reflect.apply(exec, this, [sql]); };
  for (const [name, original] of methods) StatementSync.prototype[name] = function (...args) {
    counts.executed++; if (tokenLookup(this.sourceSQL)) counts.tokenExecuted++;
    return Reflect.apply(original, this, args);
  };
  try { return { counts, value: await call() }; }
  finally {
    DatabaseSync.prototype.prepare = prepare; DatabaseSync.prototype.exec = exec;
    for (const [name, original] of methods) StatementSync.prototype[name] = original;
  }
}

for (const shape of ['hosted-53', 'legacy-18']) {
  const cleanups = [], t = { after: fn => cleanups.push(fn) };
  try {
    const f = shape === 'hosted-53' ? eventTimeSafetyFixture(t, 33) : safetyFixture(t, 18);
    if (shape === 'hosted-53') await f.migrate();
    const core = openMemoryCore({ path: f.path, model: { contextWindow: 8192, countTokens: () => 1,
      extract: () => ({ items: [] }) } });
    f.workspace.defer(() => core.close());
    const db = f.connect(); f.workspace.defer(() => db.close());
    const messages = Array.from({ length: 24 }, (_, i) => ({ id: 'm' + i, role: 'user', content: identity(i).excerpt }));
    for (const temperature of ['cold', 'warm']) {
      const capture = await meter(() => core.capture({ namespace: ns, client: 'cairn-web', sessionId: 'cost-session',
        eventId: 'cost-' + temperature, messages }));
      ok(capture.value);
      assert.equal(capture.counts.tokenExecuted, phase === 'after' ? 24 : 0);
      console.log(JSON.stringify({ kind: 'capture-cost', phase, shape, temperature, messages: messages.length, ...capture.counts }));
    }
    if (phase === 'after') {
      const source = readFileSync(new URL('../../core/raw-lineage-storage.mjs', import.meta.url), 'utf8');
      const lookup = source.match(/db.prepare\(`(SELECT 1 FROM json_each\(\?\) w CROSS JOIN suppressed s[\s\S]*?)`\)/)?.[1];
      assert.ok(lookup, 'review the indexed token lookup');
      const receipt = identity(0);
      const tokens = receiptDenialTokens([{ receipt_key: digest(receipt), client: receipt.client,
        session_id: receipt.sessionId, event_id: receipt.eventId, role: receipt.role }]);
      const plan = db.prepare('EXPLAIN QUERY PLAN ' + lookup).all(JSON.stringify(tokens), ...boundary(ns));
      assert.ok(plan.some(row => /SEARCH s USING (?:COVERING )?INDEX sqlite_autoindex_suppressed_1/.test(row.detail) &&
        ['owner_id=?', 'scope=?', 'project_id=?', 'fingerprint=?'].every(part => row.detail.includes(part))));
      assert.equal(plan.some(row => /SCAN s(?: |$)/.test(row.detail)), false);
      console.log(JSON.stringify({ kind: 'lookup-plan', shape, details: plan.map(row => row.detail) }));
    }
  } finally { while (cleanups.length) await cleanups.pop()(); }
}

if (base) {
  const before = execFileSync('git', ['show', base + ':core/raw-lineage-storage.mjs'], { encoding: 'utf8' });
  const after = readFileSync(new URL('../../core/raw-lineage-storage.mjs', import.meta.url), 'utf8');
  const extract = source => source.slice(source.lastIndexOf('  function filter(ns, receipts) {'), source.lastIndexOf('\n  return {'));
  const run = (source, { layout, raw, states, hits, lookupError }) => {
    const events = [];
    const fail = code => { const error = new Error('unchanged base error: ' + code); error.code = code; throw error; };
    const db = { prepare() { events.push('lookup'); return { get(tokens) {
      if (lookupError) fail(lookupError);
      return JSON.parse(tokens).some(token => hits.has(token)) ? { denied: 1 } : undefined;
    } }; } };
    const filter = Function('cachedContentLayout', 'db', 'fail', 'enabled', 'assertReceipts',
      'receiptDenialTokens', 'receiptDigest', 'boundary', extract(source) + '\nreturn filter;')(
      () => layout, db, fail, () => raw, (_, [receipt]) => {
        events.push('assert:' + receipt.eventId);
        const state = states[Number(receipt.eventId.slice(1))]; if (state) fail(state);
      }, receiptDenialTokens, digest, boundary);
    try { return { value: filter(ns, [identity(0), identity(1)]), events }; }
    catch (error) { return { error: { name: error.name, code: error.code, message: error.message }, events }; }
  };
  let cells = 0;
  for (const layout of [null, {}, { suppressionRevision: 1 }]) for (const raw of [false, true])
  for (const first of [null, 'source_excluded', 'conversation_deleted', 'storage_error', 'raw_lineage_unavailable'])
  for (const second of [null, 'source_excluded', 'conversation_deleted', 'storage_error', 'raw_lineage_unavailable'])
  for (const marked of [false, true]) {
    const r = identity(0), token = receiptDenialTokens([{ receipt_key: digest(r), client: r.client,
      session_id: r.sessionId, event_id: r.eventId, role: r.role }])[1];
    const config = { layout, raw, states: [first, second], hits: new Set(marked ? [token] : []) };
    const a = run(before, config), b = run(after, config);
    if (a.error) assert.deepEqual(b.error, a.error, 'base error and precedence');
    else assert.deepEqual(b.value, a.value.filter(index => !marked || index !== 0), 'only allowed-to-dropped on a hit');
    assert.deepEqual(b.events.filter(value => value.startsWith('assert:')), a.events.filter(value => value.startsWith('assert:')));
    if (b.events.includes('assert:m0') && b.events.includes('lookup'))
      assert.ok(b.events.indexOf('assert:m0') < b.events.indexOf('lookup'), 'validation precedes token lookup');
    cells++;
  }
  const storage = run(after, { layout: { suppressionRevision: 1 }, raw: false,
    states: [null, null], hits: new Set(), lookupError: 'storage_error' });
  assert.equal(storage.error.code, 'storage_error', 'new lookup storage failures propagate');
  console.log(JSON.stringify({ kind: 'base-filter-outcomes', base, cells, result: 'equal except allowed-to-dropped on token hits',
    lookupStorageFailure: storage.error.code }));
}
