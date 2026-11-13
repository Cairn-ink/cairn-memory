import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { openMemoryCore } from '../contract.mjs';
import { transaction } from '../database.mjs';
import { suppressionContent } from '../suppression-content.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';

let sequence = 0;
const admission = (content, namespace = ns, patch = {}) => ({ namespace,
  memory: { content, kind: 'fact' }, receipts: [receipt(`suppression-${++sequence}`)], ...patch });
const refusal = (result, code) => assert.deepEqual(result,
  { ok: false, error: { code, retryable: code === 'storage_busy' } });
const sqlText = sql => sql.replace(/\s+/gu, ' ').trim();

async function fixture(t, base, safety, options = {}) {
  const f = safetyFixture(t, base);
  if (safety) await f.migrate();
  // Observe the engine's native connection, rather than total_changes on a
  // second connection (whose counter would miss an accidental engine write).
  const prepare = DatabaseSync.prototype.prepare;
  let native;
  DatabaseSync.prototype.prepare = function(sql) {
    if (sql.includes('cursor_secret AS cursorSecret')) native = this;
    return Reflect.apply(prepare, this, [sql]);
  };
  let core;
  try { core = openMemoryCore({ path: f.path, busyTimeoutMs: 25, ...options }); }
  finally { DatabaseSync.prototype.prepare = prepare; }
  assert.ok(native);
  const db = f.connect();
  f.workspace.defer(() => { db.close(); core.close(); });
  return { ...f, core, db, native };
}

function forget(f, content, namespace = ns) {
  const memory = ok(f.core.admit(admission(content, namespace))).memory;
  ok(f.core.forget({ namespace, memoryId: memory.id, expectedRevision: memory.revision }));
}
function fact(f, namespace, kind, key) {
  transaction(f.db, () => writeContentSuppressionInside(f.db, { namespace, kind,
    ...(['namespace', 'owner'].includes(kind) ? { matchMode: kind } : { key }),
    reason: 'privacy_erase', actionId: `suppression-fact-${++sequence}` }));
}
function equivalence(f, content, suppressed, namespace = ns) {
  const read = f.core.isSuppressed({ namespace, content });
  const admitted = f.core.admit(admission(content, namespace));
  assert.deepEqual(read, { ok: true, value: { suppressed } });
  assert.equal(admitted.error?.code === 'memory_suppressed', suppressed,
    'absolute admission expectation');
  if (suppressed) refusal(admitted, 'memory_suppressed');
  else ok(admitted);
  assert.equal(read.value.suppressed, admitted.error?.code === 'memory_suppressed');
}
function sameRefusal(f, content, code, namespace) {
  if (arguments.length < 4) namespace = ns;
  const read = f.core.isSuppressed({ namespace, content });
  const admitted = f.core.admit({ ...admission(content), namespace });
  refusal(read, code); refusal(admitted, code); assert.deepEqual(read, admitted);
  for (const result of [read, admitted]) {
    assert.deepEqual(Object.keys(result.error).sort(), ['code', 'retryable']);
    if (typeof content === 'string' && content.length > 20)
      assert.equal(JSON.stringify(result).includes(content), false);
  }
}

test('public methods: historical default facade adds only isSuppressed', async t => {
  const f = await fixture(t, 18, false);
  const previous = JSON.parse(readFileSync(new URL('../testing/method-package-history.json', import.meta.url), 'utf8'))
    .compatibility.expected.keys;
  assert.deepEqual(Object.keys(f.core), previous.flatMap(name => name === 'admit' ? ['isSuppressed', name] : [name]));
  assert.equal(typeof f.core.isSuppressed, 'function');
});

for (const base of [18, 23, 33]) for (const safety of [false, true]) {
  const layout = `base ${base} ${safety ? 'suppressionRevision' : 'plain'}`;
  test(`equivalence corpus: ${layout}`, async t => {
    const f = await fixture(t, base, safety);
    const original = 'Synthetic Café 😀 marker';
    forget(f, original);
    forget(f, 'Synthetic zero\u200bwidth');
    forget(f, 'x'.repeat(4000));
    const other = { ...ns, ownerId: 'synthetic-other-owner' };
    forget(f, 'Synthetic other namespace only', other);
    const corpus = [
      ['forgotten exact text', original, true],
      ['case variants', original.toUpperCase(), true],
      ['NFC', original.normalize('NFC'), true],
      ['NFD combining marks', original.normalize('NFD'), true],
      ['NFKC full-width', 'Ｓｙｎｔｈｅｔｉｃ Café 😀 marker', true],
      ['non-BMP exact', original, true],
      ['non-BMP distinct', 'Synthetic Café 🚀 marker', false],
      ['different combining mark', 'Synthetic Cafè 😀 marker', false],
      ['zero-width distinct', 'Synthetic Café\u200b 😀 marker', false],
      ['zero-width preserved exact', 'Synthetic zero\u200bwidth', true],
      ['leading whitespace', `  ${original}`, true],
      ['trailing whitespace', `${original}  `, true],
      ['internal whitespace', 'Synthetic   Café  😀   marker', true],
      ['tabs', 'Synthetic\tCafé\t😀\tmarker', true],
      ['newlines', 'Synthetic\nCafé\r\n😀\nmarker', true],
      ['exactly 4000 forgotten', 'x'.repeat(4000), true],
      ['exactly 4000 new', 'y'.repeat(4000), false],
      ['long raw whitespace normalizes below bound', `  ${' '.repeat(4100)}${original}`, true],
      ['never forgotten', 'Synthetic never forgotten', false],
      ['forgotten in another namespace', 'Synthetic other namespace only', false],
    ];
    for (const [name, content, expected] of corpus)
      await t.test(name, () => equivalence(f, content, expected));
    for (const [name, content] of [
      ['over 4000', 'z'.repeat(4001)], ['over raw input ceiling', ' '.repeat(20001)],
      ['empty', ''], ['whitespace only', ' \t\n'], ['null', null], ['missing', undefined],
      ['number', 7], ['object', {}], ['array', []], ['NUL', 'Synthetic\0invalid'],
      ['redaction only', '[REDACTED]'],
    ]) await t.test(`invalid content: ${name}`, () => sameRefusal(f, content, 'invalid_input'));
    if (safety) await t.test('content-safety branch hides a live matching Memory', () => {
      const content = 'Synthetic live hidden memory';
      const memory = ok(f.core.admit(admission(content))).memory;
      const before = f.db.prepare('SELECT count(*) n FROM suppressed').get().n;
      fact(f, ns, 'memory', memory.id);
      assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted, 0);
      assert.equal(f.db.prepare('SELECT count(*) n FROM suppressed').get().n, before,
        'only the content-safety branch can decide this case');
      equivalence(f, content, true);
    });
  });
}

test('refusals: namespace validation and closed store match admission', async t => {
  const f = await fixture(t, 18, false), content = 'Synthetic private invalid namespace input';
  for (const [name, namespace] of [
    ['missing', undefined], ['null', null], ['empty', {}],
    ['missing project field', { ownerId: ns.ownerId, scope: 'personal' }],
    ['invalid owner', { ...ns, ownerId: '' }], ['invalid scope', { ...ns, scope: 'other' }],
    ['invalid project', { ...ns, projectId: '' }],
    ['personal with project', { ...ns, scope: 'personal' }],
    ['unknown field', { ...ns, extra: true }],
    ['accessor', Object.defineProperty({}, 'ownerId', { enumerable: true, get() { throw Error(content); } })],
    ['proxy', new Proxy(ns, {})],
  ]) await t.test(name, () => sameRefusal(f, content, 'invalid_input', namespace));
  await t.test('unknown top-level fields', () => {
    refusal(f.core.isSuppressed({ namespace: ns, content, extra: true }), 'invalid_input');
    refusal(f.core.admit(admission(content, ns, { extra: true })), 'invalid_input');
  });
  f.core.close();
  sameRefusal(f, content, 'store_closed');
});

test('refusals: erased namespace uses the same scope boundary as admission', async t => {
  const f = await fixture(t, 18, true);
  fact(f, ns, 'namespace');
  sameRefusal(f, 'Synthetic content in erased namespace', 'memory_not_found');
});

test('role context: host-bound foreign owner and project behave exactly as admission', async t => {
  let authorizations = 0;
  const authority = { authorize() { authorizations++; return null; }, isCurrent() { return false; } };
  const f = await fixture(t, 18, true, { contextRead: { version: 'context-read-v1', authority,
    counter: { id: 'synthetic-counter', countTokens: () => 1 } } });
  for (const namespace of [{ ...ns, ownerId: 'synthetic-foreign-owner' },
    { ...ns, projectId: 'synthetic-foreign-project' },
    { ownerId: ns.ownerId, scope: 'personal', projectId: null }]) {
    equivalence(f, 'Synthetic host-bound namespace text', false, namespace);
    forget(f, 'Synthetic host-bound namespace text', namespace);
    equivalence(f, 'Synthetic host-bound namespace text', true, namespace);
  }
  assert.equal(authorizations, 0, 'admission and this read both rely on host namespace binding');
});

// Capture executed statements, including exec, on the engine's own connection.
// SQL is whitespace-normalized only; order and repetitions remain significant.
function statements(db, work) {
  const trace = [], prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec;
  const nativeStatements = new WeakSet();
  const methods = new Map(['get', 'all', 'run', 'iterate'].map(key => [key, StatementSync.prototype[key]]));
  DatabaseSync.prototype.prepare = function(sql) {
    const statement = Reflect.apply(prepare, this, [sql]);
    if (this === db) nativeStatements.add(statement);
    return statement;
  };
  DatabaseSync.prototype.exec = function(sql) {
    if (this === db) for (const part of sql.split(';').filter(value => value.trim())) trace.push(sqlText(part));
    return Reflect.apply(exec, this, [sql]);
  };
  for (const [key, method] of methods) StatementSync.prototype[key] = function(...args) {
    if (nativeStatements.has(this)) trace.push(sqlText(this.sourceSQL));
    return Reflect.apply(method, this, args);
  };
  try { return { result: work(), trace }; }
  finally {
    DatabaseSync.prototype.prepare = prepare; DatabaseSync.prototype.exec = exec;
    for (const [key, method] of methods) StatementSync.prototype[key] = method;
  }
}
function snapshot(db) {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
  // All tables, including admission claims, events, and recall units, are
  // compared by value. Quoting comes solely from SQLite's schema inventory.
  return JSON.stringify(names.map(name => [name,
    db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()]));
}

// Exact public-call statement pins live here; historical gate rows stay frozen.
const plainStatements = [
  'PRAGMA query_only', 'PRAGMA query_only=ON', 'BEGIN',
  'SELECT 1 FROM suppressed WHERE owner_id = ? AND scope = ? AND project_id = ? AND fingerprint = ?',
  'COMMIT', 'PRAGMA query_only=OFF',
];
const safetyPrefix = [
  "PRAGMA query_only",
  "PRAGMA query_only=ON",
  "BEGIN",
  "SELECT schema_version AS cookie,(SELECT user_version FROM pragma_user_version) AS physical, (SELECT application_id FROM pragma_application_id) AS applicationId,(SELECT json_array(singleton,base_layout,suppression_revision,card_lineage_revision,migration_state,suppression_domain,migration_id,inventory_digest) FROM content_safety_control WHERE singleton=1) AS control FROM pragma_schema_version",
  "SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=?",
  "SELECT * FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,'owner','','owner','','') LIMIT 4097",
  "SELECT * FROM content_suppressions INDEXED BY content_suppression_target WHERE (owner_id,scope,project_id)=(?,?,?) LIMIT ?"
];
const safetySuffix = [
  "COMMIT",
  "PRAGMA query_only=OFF",
  "SELECT schema_version AS cookie,(SELECT user_version FROM pragma_user_version) AS physical, (SELECT application_id FROM pragma_application_id) AS applicationId,(SELECT json_array(singleton,base_layout,suppression_revision,card_lineage_revision,migration_state,suppression_domain,migration_id,inventory_digest) FROM content_safety_control WHERE singleton=1) AS control FROM pragma_schema_version",
  "SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=?"
];
const matchingMemory = "SELECT id,revision FROM memories WHERE owner_id = ? AND scope = ? AND project_id = ? AND fingerprint=? AND deleted=0";
const canonicalMemory = "SELECT id,revision,deleted,currentness,review_state FROM memories WHERE owner_id=? AND scope=? AND project_id=? AND id=?";
const lineageMemory = "SELECT id,revision,deleted,currentness,review_state,EXISTS( SELECT 1 FROM receipts ar JOIN raw_receipt_lineage al ON al.receipt_id=ar.id LEFT JOIN raw_conversations ac ON ac.id=al.conversation_id WHERE ar.memory_id=memories.id AND (ac.owner_id IS NOT memories.owner_id OR ac.scope IS NOT memories.scope OR ac.project_id IS NOT memories.project_id)) AS invalid_raw_ancestry FROM memories WHERE owner_id=? AND scope=? AND project_id=? AND id=?";
function safetyStatements(base, text) {
  return [...safetyPrefix, plainStatements[3],
    ...(text === 'Synthetic purity forgotten' ? [] : [matchingMemory]),
    ...(text === 'Synthetic purity live' ? [base === 33 ? lineageMemory : canonicalMemory] : []),
    ...safetySuffix];
}

for (const base of [18, 23, 33]) for (const safety of [false, true]) {
  test(`purity and exact statements: base ${base} ${safety ? 'suppressionRevision' : 'plain'}`, async t => {
    const f = await fixture(t, base, safety);
    forget(f, 'Synthetic purity forgotten');
    const content = 'Synthetic purity live';
    const live = ok(f.core.admit(admission(content))).memory;
    if (safety) fact(f, ns, 'memory', live.id);
    for (const [text, expected] of [[content, safety], ['Synthetic purity forgotten', true], ['Synthetic purity absent', false]]) {
      const before = snapshot(f.db), changes = f.native.prepare('SELECT total_changes() n').get().n;
      const measured = statements(f.native, () => f.core.isSuppressed({ namespace: ns, content: text }));
      assert.deepEqual(measured.result, { ok: true, value: { suppressed: expected } });
      assert.equal(f.native.prepare('SELECT total_changes() n').get().n, changes);
      assert.equal(snapshot(f.db), before, 'all tables unchanged');
      assert.equal(measured.trace.filter(sql => sql === 'BEGIN').length, 1, 'one deferred transaction');
      assert.equal(measured.trace.some(sql => /^(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|BEGIN IMMEDIATE)\b/i.test(sql)), false);
      const pinned = safety ? safetyStatements(base, text) : plainStatements;
      assert.deepEqual(measured.trace, pinned, JSON.stringify({ base, safety, text, trace: measured.trace }));
    }
    // A second native SQLite connection holds RESERVED throughout the call.
    f.db.exec('BEGIN IMMEDIATE');
    try {
      assert.equal(f.db.isTransaction, true);
      assert.deepEqual(f.core.isSuppressed({ namespace: ns, content }),
        { ok: true, value: { suppressed: safety } });
    } finally { f.db.exec('ROLLBACK'); }
  });
}

test('write-only receipt refusals do not turn the suppression read into admission', async t => {
  const f = await fixture(t, 18, false), content = 'Synthetic valid content with invalid receipt';
  assert.deepEqual(f.core.isSuppressed({ namespace: ns, content }), { ok: true, value: { suppressed: false } });
  for (const patch of [{ receipts: [] }, { receipts: [{ ...receipt('future'), occurredAt: '2999-01-01T00:00:00.000Z' }] },
    { memory: { content, kind: 'invalid' } }]) refusal(f.core.admit(admission(content, ns, patch)), 'invalid_input');
});

for (const safety of [false, true]) test(`refusals: exclusive lock matches admission (${safety ? 'safety' : 'plain'})`, async t => {
  const f = await fixture(t, 18, safety);
  f.db.exec('BEGIN EXCLUSIVE');
  try { sameRefusal(f, 'Synthetic private busy-store content', 'storage_busy'); }
  finally { f.db.exec('ROLLBACK'); }
});

test('refusals: erased owner matches admission', async t => {
  const f = await fixture(t, 18, true);
  fact(f, { ownerId: ns.ownerId, scope: 'owner', projectId: '' }, 'owner', '');
  sameRefusal(f, 'Synthetic private erased-owner content', 'memory_not_found');
});

test('refusals: changed safety layout attestation matches admission', async t => {
  const f = await fixture(t, 18, true);
  f.db.exec('PRAGMA user_version=999');
  sameRefusal(f, 'Synthetic private unsupported-layout content', 'unsupported_database');
});

test('errors: shared input helper and closed runtime throw content-free codes', async t => {
  const f = await fixture(t, 18, false), content = 'Synthetic private over-bound text '.repeat(200);
  const codeOnly = code => error => {
    assert.equal(error.code, code); assert.equal(error.message, code);
    assert.equal(JSON.stringify(error).includes(content), false);
    assert.equal(String(error).includes(content), false);
    return true;
  };
  assert.throws(() => suppressionContent(content), codeOnly('invalid_input'));
  const runtime = createMemoryRuntime({ path: f.path }); runtime.close();
  assert.throws(() => runtime.isSuppressed(ns, content), codeOnly('store_closed'));
});

test('write-only refusal: a query-only connection still permits the read', async t => {
  const f = await fixture(t, 18, false), content = 'Synthetic query-only connection content';
  f.native.exec('PRAGMA query_only=ON');
  try {
    assert.deepEqual(f.core.isSuppressed({ namespace: ns, content }), { ok: true, value: { suppressed: false } });
    assert.equal(f.native.prepare('PRAGMA query_only').get().query_only, 1, 'read restores caller state');
    refusal(f.core.admit(admission(content)), 'storage_error');
  } finally { f.native.exec('PRAGMA query_only=OFF'); }
});
