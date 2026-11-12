import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { openDatabase, transaction } from '../database.mjs';
import { previousRelationDDL, installMemoryRelations } from '../memory-relations-schema.mjs';
import { attestContentSafety } from '../content-safety-schema.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';

const methods = ['expandRelationRefs', 'relationCandidates', 'resolveRelationCandidates', 'filterRelationFacts'];
const states = ['absent', 'earlier-revision', 'current-revision', 'empty-graph', 'populated-graph', 'forgotten-endpoint'];
const quote = name => '"' + name.replaceAll('"', '""') + '"';

// Acquire the runtime's existing native connection through the same prototype
// instrumentation as the SQL meter. Never open another handle to inspect it.
function meteredRuntime(path) {
  const prepare = DatabaseSync.prototype.prepare, connections = new Set();
  let runtime;
  DatabaseSync.prototype.prepare = function (...args) {
    connections.add(this);
    return Reflect.apply(prepare, this, args);
  };
  try { runtime = createMemoryRuntime({ path }); }
  finally { DatabaseSync.prototype.prepare = prepare; }
  assert.equal(connections.size, 1, 'one runtime connection');
  return { runtime, db: [...connections][0] };
}

function snapshot(db) {
  const schema = db.prepare('SELECT type,name,tbl_name,rootpage,sql FROM sqlite_schema ORDER BY type,name').all();
  // Include every table, including internal SQLite tables. Sort serialized rows
  // rather than relying on rowid, which WITHOUT ROWID tables do not have.
  const tables = schema.filter(row => row.type === 'table').map(({ name }) => ({
    name, rows: db.prepare(`SELECT * FROM ${quote(name)}`).all().map(row => JSON.stringify(row)).sort(),
  }));
  return { schema, tables, userVersion: db.prepare('PRAGMA user_version').get().user_version };
}

function assertReadSQL(sql) {
  // Remove quoted values/identifiers and comments before inspecting verbs. This
  // also detects writes behind WITH or EXPLAIN, rather than just the first word.
  const tokens = sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?\*\//g, ' ');
  assert.doesNotMatch(tokens, /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|VACUUM|REINDEX|ANALYZE|ATTACH|DETACH)\b/i,
    `write statement executed: ${sql}`);
  assert.match(tokens.trim(), /^(?:SELECT|WITH|EXPLAIN|PRAGMA|BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i,
    `unclassified statement executed: ${sql}`);
  if (/\bPRAGMA\b/i.test(tokens)) {
    // Parameterized metadata inspection is read-only; header PRAGMAs must have
    // no argument or assignment. query_only only changes the connection's
    // read fence, including its restoration; it never writes the database.
    // Unknown PRAGMAs fail closed.
    assert.match(tokens.trim(), /^PRAGMA\s+(?:(?:main|temp)\.)?(?:(?:table_info|table_xinfo|index_list|index_info|index_xinfo|foreign_key_list)\s*\([^;=]*\)|query_only(?:\s*=\s*(?:ON|OFF))?|(?:schema_version|user_version|application_id|data_version|database_list|compile_options))\s*;?\s*$/i,
      `writing or unreviewed PRAGMA executed: ${sql}`);
  }
}

async function fixture(t, state) {
  const f = safetyFixture(t);
  await f.migrate();
  const core = openMemoryCore({ path: f.path }), setup = openDatabase(f.path);
  try {
    const memories = state === 'current-revision' ? [] : ['Synthetic orchard apples', 'Synthetic orchard pears'].map(content =>
      ok(core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts: [receipt(content)] })).memory);
    if (state === 'earlier-revision') transaction(setup, () => {
      setup.exec('ALTER TABLE memory_conflicts RENAME TO old_conflicts');
      setup.exec(previousRelationDDL);
      setup.exec('DROP TABLE old_conflicts; PRAGMA user_version=134');
      attestContentSafety(setup);
    });
    else if (state !== 'absent') transaction(setup, () => {
      installMemoryRelations(setup);
      attestContentSafety(setup);
    });
    if (['earlier-revision', 'populated-graph', 'forgotten-endpoint'].includes(state)) {
      const [a, b] = memories;
      setup.prepare(`INSERT INTO memory_relations
        (id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,created_at)
        VALUES('synthetic-link',?,?,?,?,'contradicts',1,'user','2026-01-01T00:00:00.000Z')`).run(a.id, a.revision, b.id, b.revision);
      assert.equal(setup.prepare('SELECT count(*) n FROM memory_relations').get().n, 1, 'link exists before forgetting');
      if (state === 'forgotten-endpoint') ok(core.forget({ namespace: ns, memoryId: b.id, expectedRevision: b.revision }));
    }
    assert.equal(setup.prepare('PRAGMA user_version').get().user_version,
      state === 'absent' ? 34 : state === 'earlier-revision' ? 134 : 234);
    if (state !== 'absent') assert.equal(setup.prepare('SELECT count(*) n FROM memory_relations').get().n,
      ['earlier-revision', 'populated-graph'].includes(state) ? 1 : 0);
    if (state === 'forgotten-endpoint') assert.equal(setup.prepare('SELECT deleted FROM memories WHERE id=?').get(memories[1].id).deleted, 1);
    return { path: f.path, memories };
  } finally { core.close(); setup.close(); }
}

for (const state of states) for (const method of methods) test(`${method} executes only reads: ${state}`, async t => {
  const { path, memories } = await fixture(t, state);
  const { runtime, db } = meteredRuntime(path);
  t.after(() => runtime.close());
  // Normal recall observes graph presence through its epoch read before it
  // expands seeds. Prime that same runtime cache before the measured call.
  runtime.epoch(ns);
  const facts = [{ content: 'Synthetic orchard fruit' }];
  const refs = memories.map(({ id, revision }) => ({ id, revision }));
  const calls = {
    expandRelationRefs: () => runtime.expandRelationRefs([ns], (state === 'populated-graph' ? refs.slice(0, 1) : refs)
      .map(({ id, revision }) => ({ namespaceIndex: 0, memoryId: id, revision }))),
    relationCandidates: () => runtime.relationCandidates(ns, facts),
    resolveRelationCandidates: () => runtime.resolveRelationCandidates(ns, refs),
    filterRelationFacts: () => runtime.filterRelationFacts(ns, facts),
  };
  const before = snapshot(db), changes = db.prepare('SELECT total_changes() n').get().n;
  const row = await measureContentRead(method, state, calls[method]);
  const afterChanges = db.prepare('SELECT total_changes() n').get().n, after = snapshot(db);
  const violations = [];
  // Check all three independent invariants even when an earlier one fails.
  for (const check of [
    () => { assert.ok(row.statements > 0, 'meter observed execution'); for (const [sql] of row.sql) assertReadSQL(sql); },
    () => assert.equal(afterChanges, changes, 'total_changes unchanged on runtime connection'),
    () => assert.deepEqual(after, before, 'all table rows, schema rows and user_version unchanged'),
  ]) { try { check(); } catch (error) { violations.push(error.message); } }
  assert.deepEqual(violations, [], violations.join('\n'));
  if (method === 'expandRelationRefs' && state === 'populated-graph')
    assert.ok(row.sql.some(([sql]) => /FROM memory_relations\b/.test(sql)), 'populated graph actually traversed from one seed');
  assert.ok(Array.isArray(row.result), 'method completed with a materialized result');
  if (method === 'filterRelationFacts') assert.deepEqual(row.result, [0]);
  else {
    const found = method === 'relationCandidates' ? row.result[0].map(ref => ref.id)
      : row.result.map(ref => ref.id ?? ref.memoryId);
    const expected = memories.filter((_, index) => state !== 'forgotten-endpoint' || index === 0).map(ref => ref.id);
    assert.deepEqual(found.sort(), expected.sort(), 'real eligible endpoints were read');
  }
  t.diagnostic(JSON.stringify({ method, state, statements: row.statements,
    readOnlySQL: true, totalChangesUnchanged: true, logicalContentUnchanged: true }));
});
