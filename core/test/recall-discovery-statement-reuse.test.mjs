import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { openDatabase, transaction } from '../database.mjs';
import { installPrivateCards, installCardMemorySources } from '../private-card-schema.mjs';
import { installPrivateEvidence } from '../private-evidence-schema.mjs';
import { SAFETY_SCHEMA_VERSIONS, resolveContentLayout } from '../content-safety-layout.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { eventTimeSafetyFixture } from '../testing/receipt-event-time-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { QUERY_SCAN_LIMIT } from '../query-candidates.mjs';

const namespaces = [
  { ownerId: 'discovery-reuse', scope: 'personal', projectId: null },
  { ownerId: 'discovery-reuse', scope: 'project', projectId: 'second' },
];
const hash = text => createHash('sha256').update(text).digest('hex');
const internal = namespace => ({ ...namespace, projectId: namespace.projectId ?? '' });
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const membershipSQL = /^SELECT id FROM index_read_memories WHERE owner_id = \? AND scope = \? AND project_id = \? AND id = \?\s+AND revision = \?$/;
const placementSQL = /^SELECT r\.\* FROM index_read_memory_refs r\s+JOIN index_read_mocs parent ON parent.id = r.moc_id\s+WHERE r.memory_id = \?/;
const discoveryKind = sql => membershipSQL.test(sql) ? 'membership' : placementSQL.test(sql) ? 'placement' : null;

// A scratch reference changes only the discovery helper to prepare on every
// use. All SQL, bindings and the public recall stack remain the real engine.
// No production hook or environment switch is installed.
async function referenceEngine(t) {
  const workspace = createTestWorkspace(t, { prefix: 'discovery-reference-' });
  const replacements = new Map();
  for (const name of ['moc-storage.mjs', 'runtime.mjs', 'contract.mjs']) {
    const originalURL = new URL('../' + name, import.meta.url);
    let source = readFileSync(originalURL, 'utf8');
    if (name === 'moc-storage.mjs') {
      const helper = /const discoveryPrepare = sql => \{[\s\S]*?\n      \};/g;
      assert.equal([...source.matchAll(helper)].length, 1, 'one transaction-local discovery helper');
      source = source.replace(helper, 'const discoveryPrepare = sql => db.prepare(projectSQL(sql));');
    }
    source = source.replace(/(\bfrom\s*['"])(\.[^'"]+)(['"])/g, (whole, start, specifier, end) => {
      const absolute = new URL(specifier, originalURL).href;
      return start + (replacements.get(absolute) ?? absolute) + end;
    });
    const target = join(workspace.path, name);
    writeFileSync(target, source);
    replacements.set(originalURL.href, pathToFileURL(target).href);
  }
  return {
    ...(await import(replacements.get(new URL('../contract.mjs', import.meta.url).href))),
    ...(await import(replacements.get(new URL('../runtime.mjs', import.meta.url).href))),
  };
}

// Count executions at execution time, independently of prepare frequency.
// Keep statements strongly reachable through the lock probe: GC must not be
// responsible for releasing a cursor/lock. The methods still call native get/all.
async function measure(call, { afterReuse } = {}) {
  const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec;
  const methods = new Map(['get', 'all', 'run', 'iterate'].map(key => [key, StatementSync.prototype[key]]));
  const sql = new Map(), prepares = new Map(), statements = [], uses = new Map(), connections = new Set();
  const trace = [], active = new Set(), releases = [];
  const clear = Map.prototype.clear;
  Map.prototype.clear = function() {
    const discovery = this.size > 0 && [...this].every(([text, statement]) =>
      typeof text === 'string' && discoveryKind(text) && statement instanceof StatementSync);
    const size = this.size, value = clear.call(this);
    if (discovery) releases.push({ before: size, after: this.size });
    return value;
  };
  let executed = 0;
  const record = (text, method, bindings) => {
    executed++;
    sql.set(text, (sql.get(text) ?? 0) + 1);
    trace.push([text, method, bindings]);
  };
  DatabaseSync.prototype.prepare = function(text) {
    const statement = prepare.call(this, text);
    prepares.set(text, (prepares.get(text) ?? 0) + 1);
    if (discoveryKind(text)) { statements.push(statement); connections.add(this); }
    return statement;
  };
  DatabaseSync.prototype.exec = function(text) {
    for (const part of text.split(';').filter(part => part.trim())) record(part, 'exec', []);
    return exec.call(this, text);
  };
  for (const [key, method] of methods) StatementSync.prototype[key] = function(...bindings) {
    const text = this.sourceSQL, kind = discoveryKind(text);
    record(text, key, bindings);
    if (kind) {
      assert.equal(key, 'get', 'reused discovery statements must complete, never iterate');
      active.add(this);
    }
    let result;
    try { result = method.apply(this, bindings); }
    finally { active.delete(this); }
    if (kind) {
      const count = (uses.get(this) ?? 0) + 1;
      uses.set(this, count);
      if (count === 2) afterReuse?.(kind);
    }
    return result;
  };
  let result, error;
  try { result = await call(); } catch (failure) { error = failure; }
  finally {
    Map.prototype.clear = clear;
    DatabaseSync.prototype.prepare = prepare;
    DatabaseSync.prototype.exec = exec;
    for (const [key, method] of methods) StatementSync.prototype[key] = method;
  }
  const counts = kind => [...prepares].filter(([text]) => discoveryKind(text) === kind).reduce((sum, [, n]) => sum + n, 0);
  return { result, error, sql: JSON.stringify([...sql].sort()), trace: JSON.stringify(trace), executed,
    counts: { membership: counts('membership'), placement: counts('placement') }, statements, uses, active, connections, releases };
}

function model() {
  const counters = [];
  return { counters, contextWindow: 8192,
    countTokens(text) { counters.push(text); return 1; },
    async select({ input }) {
      return { refs: input.maps.flatMap(page => page.items.filter(item => item.label.includes(input.query)).slice(0, 6)
        .map(item => ({ namespaceIndex: page.namespaceIndex, ...(item.type === 'unfiled' ? item.ref
          : { memoryId: item.ref.childId, revision: item.ref.childRevision }) }))) };
    },
    async rank({ input }) {
      return { refs: input.candidates.slice(0, input.limit).map(({ namespaceIndex, memory }) =>
        ({ namespaceIndex, memoryId: memory.id, revision: memory.revision })) };
    },
  };
}

function admit(core, namespace, index) {
  const content = `amber discovery body ${index}`, excerpt = `copper discovery receipt ${index}`;
  return ok(core.admit({ namespace, memory: { content, kind: 'fact' }, receipts: [{
    client: 'synthetic', sessionId: 'discovery', eventId: String(index), role: 'user', excerpt,
  }] })).memory;
}

const legacyLayouts = [18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33];
const layouts = ['creation', ...legacyLayouts, ...SAFETY_SCHEMA_VERSIONS];
const optionsForBase = base => base === 18 ? {} : base === 23 ? { privateCards: true }
  : base === 24 ? { rawConversations: true } : base === 25 ? { rawCapture: true }
    : base === 26 ? { rawLineage: true } : base === 27 ? { rawDeletion: true }
      : base === 28 ? { rawSources: true } : base === 29 ? { localControls: true }
        : base === 30 ? { methodPackages: true } : base === 31 ? { assets: true }
          : base === 32 ? { roleProfiles: true } : { currentDependencies: true };

async function fixture(t, physical = 'creation', count = 40) {
  let workspace, path;
  if (SAFETY_SCHEMA_VERSIONS.includes(physical)) {
    const layout = resolveContentLayout(physical);
    const f = (layout.attestedFeatures ? eventTimeSafetyFixture : safetyFixture)(t, layout.base);
    await f.migrate();
    ({ workspace, path } = f);
  } else {
    workspace = createTestWorkspace(t, { prefix: 'discovery-store-' });
    path = join(workspace.path, 'store.sqlite');
    if (physical !== 'creation') {
      const earlyCards = [20, 21, 22].includes(physical);
      const db = openDatabase(path, optionsForBase(earlyCards ? 18 : physical));
      try {
        if (earlyCards) transaction(db, () => {
          installPrivateCards(db);
          if (physical >= 21) installCardMemorySources(db);
          if (physical >= 22) installPrivateEvidence(db);
          db.exec('PRAGMA user_version=' + physical);
        });
      } finally { db.close(); }
    }
  }
  const core = openMemoryCore({ path, model: model() });
  try {
    for (const namespace of namespaces) {
      const memories = Array.from({ length: count }, (_, i) => admit(core, namespace, i));
      if (count) {
        ok(core.applyPlacement({ namespace, proposal: { items: [{ memoryId: memories[0].id, parentIds: [],
          newL1: { title: 'amber discovery topic', parentL2Ids: [] } }] },
        expectedMemoryRevisions: [{ memoryId: memories[0].id, revision: memories[0].revision }],
        expectedIndexRevision: ok(core.map({ namespace })).indexRevision }));
      }
    }
  } finally { core.close(); }
  const db = new DatabaseSync(path);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, physical === 'creation' ? 18 : physical);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
  db.close();
  return { workspace, path };
}

function publishGeneration(path) {
  const core = openMemoryCore({ path, model: model() });
  try {
    for (const namespace of namespaces) {
      const expectedIndexRevision = ok(core.map({ namespace })).indexRevision;
      let page, pages = 0;
      do {
        assert.ok(++pages <= 20, 'synthetic generation rebuild completes');
        page = ok(core.rebuildIndex({ namespace, expectedIndexRevision, limit: 100,
          ...(page ? { cursor: page.nextCursor } : {}) }));
      } while (!page.exhausted);
    }
  } finally { core.close(); }
  const db = new DatabaseSync(path);
  try {
    assert.equal(db.prepare(`SELECT count(*) n FROM namespace_index_state
      WHERE owner_id=? AND active_generation IS NOT NULL`).get(namespaces[0].ownerId).n, 2,
    'both namespaces read the published-generation UNION branch');
  } finally { db.close(); }
}

function parity(before, after) {
  assert.equal(before.error, undefined);
  assert.equal(after.error, undefined);
  assert.equal(JSON.stringify(after.result), JSON.stringify(before.result), 'byte-identical recall result');
  assert.equal(after.sql, before.sql, 'byte-identical per-SQL execution map');
  assert.equal(after.executed, before.executed, 'identical executed-statement count');
  assert.equal(after.trace, before.trace, 'byte-identical SQL order, methods and bindings');
}

for (const physical of layouts) test(`equivalence: layout ${physical}, one/two namespaces, many/zero matches, body/source/keyset, both generation branches`, async t => {
  const reference = await referenceEngine(t), f = await fixture(t, physical);
  const cells = [];
  for (const generation of ['declarations', 'published']) {
    if (generation === 'published') publishGeneration(f.path);
    for (const policy of ['body', 'source', 'keyset']) {
      const beforeModel = model(), afterModel = model();
      const options = { path: f.path, ...(policy === 'keyset' ? { sourceCandidatePolicy: 'bounded-keyset-v1' } : {}) };
      const beforeCore = reference.openMemoryCore({ ...options, model: beforeModel });
      const afterCore = openMemoryCore({ ...options, model: afterModel });
      try {
        for (const size of [1, 2]) for (const hit of [true, false]) {
          const request = { readSet: namespaces.slice(0, size), query: hit ? policy === 'body' ? 'amber' : 'copper' : 'zeppelin',
            ...(policy === 'body' ? {} : { contextMode: 'source-evidence' }) };
          beforeModel.counters.length = afterModel.counters.length = 0;
          const before = await measure(() => beforeCore.recall(request));
          const after = await measure(() => afterCore.recall(request));
          parity(before, after);
          assert.equal(JSON.stringify(afterModel.counters), JSON.stringify(beforeModel.counters), 'byte-identical token-counter calls');
          const result = ok(after.result);
          assert.equal(result.memories.length > 0, hit, 'real many-match/zero-match outcome');
          cells.push({ generation, policy, namespaces: size, hit, executed: after.executed,
            before: before.counts, after: after.counts,
            bytes: { result: [hash(JSON.stringify(before.result)), hash(JSON.stringify(after.result))],
              sql: [hash(before.sql), hash(after.sql)], trace: [hash(before.trace), hash(after.trace)],
              counters: [hash(JSON.stringify(beforeModel.counters)), hash(JSON.stringify(afterModel.counters))] },
            counterCalls: afterModel.counters.length });
        }
      } finally { beforeCore.close(); afterCore.close(); }
    }
  }
  assert.equal(cells.length, 24);
  t.diagnostic('EQUIVALENCE ' + JSON.stringify({ physical, cells }));
});

test('prepare counts: exact lazy per-namespace bound at zero, one, many and scan-limit candidates', async t => {
  const reference = await referenceEngine(t), rows = [];
  for (const count of [0, 1, 32, QUERY_SCAN_LIMIT + 1]) {
    const f = await fixture(t, 'creation', count);
    const beforeRuntime = reference.createMemoryRuntime({ path: f.path });
    const afterRuntime = createMemoryRuntime({ path: f.path });
    try {
      for (const size of [1, 2]) {
        const call = runtime => namespaces.slice(0, size).map(namespace => runtime.queryCandidateRows(internal(namespace), {
          score: () => 1, memoryLabel: text => text,
        }));
        const before = await measure(() => call(beforeRuntime));
        const after = await measure(() => call(afterRuntime));
        parity(before, after);
        const oldCount = Math.min(count, QUERY_SCAN_LIMIT) * size, newCount = count ? size : 0;
        assert.deepEqual(before.counts, { membership: oldCount, placement: oldCount });
        assert.deepEqual(after.counts, { membership: newCount, placement: newCount }, 'discovery prepares stay constant per namespace');
        assert.equal(new Set(after.statements).size, 2 * newCount, 'no statement shared across transactions/namespaces');
        rows.push({ candidates: count, namespaces: size, before: before.counts, after: after.counts });
      }
    } finally { beforeRuntime.close(); afterRuntime.close(); }
  }
  t.diagnostic('PREPARE_COUNTS ' + JSON.stringify(rows));
});

test('cache lifetime: repeated transactions and separate connections prepare independently', async t => {
  const f = await fixture(t, 'creation', 3);
  const first = createMemoryRuntime({ path: f.path }), second = createMemoryRuntime({ path: f.path });
  try {
    const row = await measure(() => [first, first, second, second].map(runtime =>
      runtime.queryCandidateRows(internal(namespaces[0]), { score: () => 1, memoryLabel: text => text })));
    assert.equal(row.error, undefined);
    assert.equal(row.connections.size, 2);
    assert.deepEqual(row.counts, { membership: 4, placement: 4 });
    assert.equal(new Set(row.statements).size, 8, 'all eight statements belong to one transaction each');
    assert.deepEqual(row.releases, Array.from({ length: 4 }, () => ({ before: 2, after: 0 })));
    assert.equal(row.active.size, 0);
  } finally { first.close(); second.close(); }
});

// The writer is a separate process. No in-process raw database descriptor is
// opened/closed, and all reader handles/statements remain strongly reachable.
function writerProbe(path) {
  const source = `import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.argv[1]);
    try {
      db.exec('PRAGMA busy_timeout=0');
      for (const mode of ['IMMEDIATE', 'EXCLUSIVE']) {
        db.exec('BEGIN ' + mode); db.exec('ROLLBACK');
        console.log(mode + ': acquired');
      }
    } finally { db.close(); }`;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source, path], {
    encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'IMMEDIATE: acquired\nEXCLUSIVE: acquired\n');
  return child.stdout.trim().split('\n');
}

for (const physical of ['creation', ...SAFETY_SCHEMA_VERSIONS]) test(`lock hazard: layout ${physical}, success and throw after first reuse of each statement`, async t => {
  const f = await fixture(t, physical, 8), observations = [];
  for (const fault of [null, 'membership', 'placement']) {
    const core = openMemoryCore({ path: f.path, model: model() });
    let injected = 0;
    try {
      const row = await measure(() => core.recall({ readSet: namespaces, query: 'amber' }), {
        afterReuse(kind) { if (kind === fault) { injected++; throw new Error('injected discovery failure'); } },
      });
      assert.equal(row.error, undefined, 'public recall returns its normal envelope on internal failure');
      assert.equal(injected, fault ? 1 : 0, 'failure occurs after the first actual reuse');
      if (fault) {
        assert.equal(row.result.ok, false);
        assert.equal(row.result.error.code, 'storage_error');
      } else ok(row.result);
      assert.ok(row.statements.length >= (fault === 'membership' ? 1 : 2));
      assert.equal(row.active.size, 0, 'no statement in an incomplete execution');
      assert.deepEqual(row.releases, fault === 'membership' ? [{ before: 1, after: 0 }]
        : fault === 'placement' ? [{ before: 2, after: 0 }] : [{ before: 2, after: 0 }, { before: 2, after: 0 }],
      'every transaction drops its discovery statement references, including failures');
      assert.ok([...row.connections].every(db => !db.isTransaction), 'reader transaction has ended');
      const writer = writerProbe(f.path);
      // A subsequent successful recall also proves the connection remains usable.
      ok(await core.recall({ readSet: namespaces, query: 'amber' }));
      observations.push({ fault, injected, active: row.active.size, releases: row.releases, writer, childExit: 0 });
    } finally { core.close(); }
  }
  t.diagnostic('LOCK_HAZARD ' + JSON.stringify({ physical, observations }));
});
