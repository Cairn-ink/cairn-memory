import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { openMemoryStore } from '../index.mjs';

const namespace = { ownerId: 'rebuild', scope: 'personal', projectId: null };
const other = { ...namespace, ownerId: 'other' };
const model = { countTokens: () => 1 };
const databases = new WeakMap();
const projectionCount = (db) => ['index_memories', 'index_mocs', 'index_title_sources', 'index_memory_refs', 'index_edges']
  .reduce((sum, table) => sum + db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const error = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.error.code, code); };
function fixture(t, options = { model }) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-index-')), 'synthetic.sqlite');
  const core = openMemoryCore({ path, ...options });
  const db = new DatabaseSync(path);
  databases.set(core, db);
  t.after(() => { core.close(); db.close(); });
  return { core, db, path };
}
const receipt = (text) => ({ client: 'index-test', sessionId: 'synthetic', eventId: text, role: 'user', excerpt: text });
function admit(core, text, ns = namespace) {
  return ok(core.admit({ namespace: ns, memory: { content: text, kind: 'fact' }, receipts: [receipt(text)] })).memory;
}
const epoch = (db) => db.prepare("SELECT epoch FROM namespace_epochs WHERE owner_id='rebuild' AND scope='personal' AND project_id=''").get()?.epoch ?? 1;
const detail = (core, id) => ok(core.get({ namespace, memoryId: id }));
const map = (core, options = {}) => ok(core.map({ namespace, ...options }));
function page(core, expectedIndexRevision, limit = 500, cursor) {
  const db = databases.get(core);
  const before = db ? projectionCount(db) : 0;
  const value = ok(core.rebuildIndex({ namespace, expectedIndexRevision, limit, ...(cursor ? { cursor } : {}) }));
  assert.deepEqual(Object.keys(value).sort(), ['exhausted', 'indexRevision', 'invalidRefs', 'nextCursor', 'state']);
  assert.ok(value.invalidRefs.length <= limit);
  if (db) assert.ok(projectionCount(db) - before + value.invalidRefs.length <= limit,
    'one page may visit at most limit total valid nodes/references plus invalid references');
  assert.equal(value.exhausted, value.state === 'published');
  assert.equal(value.indexRevision, expectedIndexRevision + (value.exhausted ? 1 : 0));
  if (value.exhausted) assert.equal(value.nextCursor, null);
  else assert.equal(typeof value.nextCursor, 'string');
  return value;
}
function finish(core, revision, limit = 500, cursor) {
  const pages = [];
  do {
    const value = page(core, revision, limit, cursor); pages.push(value); cursor = value.nextCursor;
    assert.ok(pages.length < 10000, 'rebuild must make progress');
  } while (cursor);
  return pages;
}
function topic(core, db, memories, title = 'Synthetic topic') {
  return ok(core.applyPlacement({ namespace, expectedIndexRevision: epoch(db),
    expectedMemoryRevisions: memories.map((m) => ({ memoryId: m.id, revision: detail(core, m.id).memory.revision })),
    proposal: { items: memories.map((m) => ({ memoryId: m.id, parentIds: [], newL1: { title, parentL2Ids: [] } })) } })).createdMocs[0];
}
function rawMemories(db, count) {
  const insert = db.prepare("INSERT INTO memories (id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,deleted,created_at,updated_at,filing_status) VALUES (?,'rebuild','personal','',?,?,'fact','explicit',1,1,0,'2025-01-01','2025-01-01','unfiled')");
  db.exec('BEGIN');
  for (let i = 0; i < count; i++) { const id = `synthetic-${String(i).padStart(5, '0')}`; insert.run(id, id, id); }
  db.exec('COMMIT');
}

test('R01 empty, exact limit, limit one and >500 nodes are bounded and model-free', (t) => {
  for (const [count, limit] of [[0, 500], [1, 1], [5, 5], [6, 5], [1003, 500]]) {
    const { core, db } = fixture(t, {});
    rawMemories(db, count);
    const before = epoch(db);
    const pages = finish(core, before, limit);
    assert.equal(pages.length, Math.max(1, Math.ceil(count / limit)));
    assert.equal(epoch(db), before + 1);
    assert.ok(pages.every((p) => p.invalidRefs.length === 0));
    assert.equal(ok(core.list({ namespace, limit: 1 })).memories.length, Math.min(1, count));
  }
});

test('R01 input shape, revision and page limits are closed', (t) => {
  const { core, db } = fixture(t);
  const input = { namespace, expectedIndexRevision: epoch(db) };
  for (const limit of [0, -1, 501, 1.5, '1', null]) error(core.rebuildIndex({ ...input, limit }), 'invalid_input');
  for (const expectedIndexRevision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null]) error(core.rebuildIndex({ ...input, expectedIndexRevision }), 'invalid_input');
  error(core.rebuildIndex({ ...input, extra: true }), 'invalid_input');
  error(core.rebuildIndex({ ...input, namespace: { ...namespace, projectId: '' } }), 'invalid_input');
  error(core.rebuildIndex({ ...input, expectedIndexRevision: 100 }), 'index_revision_conflict');
});

test('R02 signed cursors bind operation, store, namespace, epoch, limit and exact consumed progress', (t) => {
  const { core, db } = fixture(t); rawMemories(db, 6);
  const revision = epoch(db); const first = page(core, revision, 1);
  const input = { namespace, expectedIndexRevision: revision, limit: 1, cursor: first.nextCursor };
  for (const changed of [{ limit: 2 }, { namespace: other }, { expectedIndexRevision: revision + 1 },
    { cursor: 'malformed' }, { cursor: `${first.nextCursor}x` }]) error(core.rebuildIndex({ ...input, ...changed }), 'invalid_cursor');
  const secondStore = fixture(t);
  error(secondStore.core.rebuildIndex(input), 'invalid_cursor');
  error(core.list({ namespace, limit: 1, cursor: first.nextCursor }), 'invalid_cursor');
  const identity = db.prepare('SELECT * FROM store_metadata').get();
  const body = JSON.parse(Buffer.from(first.nextCursor.split('.')[0], 'base64url').toString());
  body.a = { malformed: true };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const signature = createHmac('sha256', identity.cursor_secret).update(encoded).digest('base64url');
  error(core.rebuildIndex({ ...input, cursor: `${encoded}.${signature}` }), 'invalid_cursor');
  const second = page(core, revision, 1, first.nextCursor);
  error(core.rebuildIndex(input), 'invalid_cursor');
  finish(core, revision, 1, second.nextCursor);
});

test('R02 continuation commits across an independent process and reopen', (t) => {
  const { core, db, path } = fixture(t); rawMemories(db, 3);
  const revision = epoch(db); const first = page(core, revision, 1);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { openMemoryCore } from ${JSON.stringify(new URL('../contract.mjs', import.meta.url).href)};
     const core=openMemoryCore({path:process.argv[1]});
     console.log(JSON.stringify(core.rebuildIndex(JSON.parse(process.argv[2])))); core.close();`,
    path, JSON.stringify({ namespace, expectedIndexRevision: revision, limit: 1, cursor: first.nextCursor })], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const second = ok(JSON.parse(child.stdout.trim()));
  error(core.rebuildIndex({ namespace, expectedIndexRevision: revision, limit: 1, cursor: first.nextCursor }), 'invalid_cursor');
  const reopened = openMemoryCore({ path }); t.after(() => reopened.close());
  assert.equal(page(reopened, revision, 1, second.nextCursor).state, 'published');
});

test('R03 namespace mutations fence pages, while unrelated writes and exact duplicates preserve them', (t) => {
  const { core, db } = fixture(t);
  admit(core, 'first'); admit(core, 'second'); admit(core, 'third');
  let revision = epoch(db); let staged = page(core, revision, 1);
  admit(core, 'foreign synthetic', other); admit(core, 'first');
  assert.equal(epoch(db), revision);
  staged = page(core, revision, 1, staged.nextCursor);
  admit(core, 'fourth');
  error(core.rebuildIndex({ namespace, expectedIndexRevision: revision, limit: 1, cursor: staged.nextCursor }), 'stale_rebuild');
  revision = epoch(db); staged = page(core, revision, 1);
  finish(core, revision);
  error(core.rebuildIndex({ namespace, expectedIndexRevision: revision, limit: 1, cursor: staged.nextCursor }), 'stale_rebuild');
});

test('R04 high title-source fanout counts every reference and never launders a partly stale title', (t) => {
  const { core, db } = fixture(t); rawMemories(db, 503);
  db.exec("INSERT INTO mocs VALUES ('topic','rebuild','personal','',1,'Unsafe synthetic title','unsafe',1,'2025','2025')");
  db.exec("INSERT INTO moc_title_sources SELECT 'topic',id,CASE WHEN id='synthetic-00000' THEN 2 ELSE 1 END FROM memories");
  const revision = epoch(db);
  const pages = finish(core, revision, 500);
  assert.equal(pages.length, 3, '503 memories + 1 MOC + 503 sources require three pages');
  assert.deepEqual(pages.flatMap((p) => p.invalidRefs), [{ parentId: 'topic', childType: 'memory', childId: 'synthetic-00000', reason: 'stale' }]);
  const result = map(core, { purpose: 'classification' });
  assert.equal(result.items.find((i) => i.type === 'moc' && i.moc.id === 'topic').moc.title, null);
  assert.ok(!JSON.stringify(result).includes('Unsafe synthetic title'));
});

test('R05 first build hides staging from map/classification, leaves get usable and survives reopen', (t) => {
  const { core, db, path } = fixture(t);
  const m = admit(core, 'First build source'); topic(core, db, [m]);
  const before = detail(core, m.id); const revision = epoch(db);
  const first = page(core, revision, 1);
  assert.equal(epoch(db), revision); assert.deepEqual(detail(core, m.id), before);
  error(core.map({ namespace }), 'index_unavailable');
  error(core.map({ namespace, purpose: 'classification' }), 'index_unavailable');
  const reopened = openMemoryCore({ path, model }); t.after(() => reopened.close());
  error(reopened.map({ namespace }), 'index_unavailable');
  assert.deepEqual(detail(reopened, m.id), before);
  finish(reopened, revision, 1, first.nextCursor);
  assert.deepEqual(detail(core, m.id), before);
  const visible = map(core); const next = page(core, epoch(db), 1);
  assert.deepEqual(map(core), visible);
  assert.equal(next.state, 'staged');
});

test('R06 published authority accepts placement, admission, correction and forget immediately', (t) => {
  const { core, db } = fixture(t);
  const a = admit(core, 'Initial synthetic memory'); topic(core, db, [a]);
  finish(core, epoch(db));
  const b = admit(core, 'New synthetic memory'); const group = topic(core, db, [b], 'New synthetic topic');
  assert.equal(detail(core, b.id).placements[0].mocId, group.id);
  assert.ok(map(core, { purpose: 'classification' }).items.some((i) => i.type === 'moc' && i.moc.id === group.id));
  const corrected = ok(core.correct({ namespace, memoryId: b.id, expectedRevision: detail(core, b.id).memory.revision,
    content: 'Corrected synthetic memory', kind: 'fact', receipt: receipt('Corrected synthetic memory') })).memory;
  assert.deepEqual(detail(core, b.id).placements, []);
  assert.equal(map(core, { purpose: 'classification' }).items.find((i) => i.type === 'moc' && i.moc.id === group.id).moc.title, null);
  ok(core.forget({ namespace, memoryId: b.id, expectedRevision: corrected.revision }));
  assert.ok(!ok(core.list({ namespace })).memories.some((m) => m.id === b.id));
});

test('R04 corrupt references have exact reasons, namespace attribution and no foreign text', (t) => {
  const { core, db } = fixture(t);
  const a = admit(core, 'Owned source'); const group = topic(core, db, [a]);
  const f = admit(core, 'FOREIGN SECRET CONTENT', other);
  db.exec('PRAGMA foreign_keys=OFF');
  db.prepare('INSERT INTO moc_memory_refs VALUES (?,1,?,1)').run(group.id, f.id);
  db.prepare("INSERT INTO moc_memory_refs VALUES (?,1,'missing',1)").run(group.id);
  db.prepare("INSERT INTO moc_memory_refs VALUES ('missing-parent',1,?,2)").run(a.id);
  db.exec("INSERT INTO moc_memory_refs VALUES ('fully-orphan-parent',1,'fully-orphan-child',1)");
  db.prepare('UPDATE moc_memory_refs SET memory_revision=99 WHERE moc_id=? AND memory_id=?').run(group.id, a.id);
  db.exec("INSERT INTO mocs VALUES ('wrong-level','rebuild','personal','',2,'Wrong','wrong',1,'2025','2025')");
  db.prepare("INSERT INTO moc_memory_refs VALUES ('wrong-level',1,?,99)").run(a.id);
  db.prepare("INSERT INTO moc_edges VALUES (?,1,'wrong-level',1)").run(group.id);
  const pages = finish(core, epoch(db), 2);
  const refs = pages.flatMap((p) => p.invalidRefs);
  const expected = [
    { parentId: group.id, childType: 'memory', childId: f.id, reason: 'not_found' },
    { parentId: group.id, childType: 'memory', childId: 'missing', reason: 'not_found' },
    { parentId: 'missing-parent', childType: 'memory', childId: a.id, reason: 'not_found' },
    { parentId: group.id, childType: 'memory', childId: a.id, reason: 'stale' },
    { parentId: 'wrong-level', childType: 'memory', childId: a.id, reason: 'invalid_level' },
    { parentId: group.id, childType: 'moc', childId: 'wrong-level', reason: 'invalid_level' },
  ];
  const sorted = (items) => items.map((x) => JSON.stringify(x)).sort();
  assert.deepEqual(sorted(refs), sorted(expected));
  assert.ok(!JSON.stringify(pages).includes('FOREIGN SECRET'));
  assert.deepEqual(detail(core, a.id).placements, []);
  const before = detail(core, a.id).memory;
  assert.equal(before.filing.status, 'filed');
  assert.ok(map(core).items.some((i) => i.type === 'unfiled' && i.ref.memoryId === a.id));
  admit(core, 'Unrelated valid admission');
  assert.deepEqual(detail(core, a.id).memory, before);
  assert.deepEqual(detail(core, a.id).placements, []);
});

test('R05 publication switches actual map, get and classification authority without exposing staging', (t) => {
  const { core, db } = fixture(t);
  const m = admit(core, 'Authority source'); const group = topic(core, db, [m]);
  finish(core, epoch(db));
  const old = db.prepare('SELECT active_generation FROM namespace_index_state').get().active_generation;
  // Remove projection rows only: declarations remain a complete valid rebuild source.
  db.prepare('DELETE FROM index_memory_refs WHERE generation=?').run(old);
  db.prepare('DELETE FROM index_mocs WHERE generation=?').run(old);
  assert.deepEqual(detail(core, m.id).placements, []);
  assert.ok(!map(core, { purpose: 'classification' }).items.some((i) => i.type === 'moc' && i.moc.id === group.id));
  const revision = epoch(db); let cursor;
  do {
    const value = page(core, revision, 1, cursor); cursor = value.nextCursor;
    if (cursor) {
      assert.deepEqual(detail(core, m.id).placements, []);
      assert.ok(!map(core, { purpose: 'classification' }).items.some((i) => i.type === 'moc' && i.moc.id === group.id));
      assert.equal(db.prepare('SELECT active_generation FROM namespace_index_state').get().active_generation, old);
    }
  } while (cursor);
  assert.equal(detail(core, m.id).placements[0].mocId, group.id);
  assert.ok(map(core, { purpose: 'classification' }).items.some((i) => i.type === 'moc' && i.moc.id === group.id));
  assert.ok(map(core).items.some((i) => i.type === 'ref' && i.ref.childId === m.id));
});

const indexTables = ['namespace_index_state', 'index_generations', 'index_memories', 'index_mocs', 'index_title_sources', 'index_memory_refs', 'index_edges', 'namespace_epochs'];
const indexSnapshot = (db) => indexTables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
test('R07 a failed page restores progress and projection; the same cursor retries', (t) => {
  const { core, db } = fixture(t); rawMemories(db, 3);
  const revision = epoch(db); const first = page(core, revision, 1);
  const before = indexSnapshot(db);
  db.exec("CREATE TRIGGER fail_index_page BEFORE INSERT ON index_memories BEGIN SELECT RAISE(ABORT,'synthetic page fault'); END");
  const result = core.rebuildIndex({ namespace, expectedIndexRevision: revision, limit: 1, cursor: first.nextCursor });
  assert.equal(result.ok, false);
  assert.deepEqual(indexSnapshot(db), before);
  db.exec('DROP TRIGGER fail_index_page');
  const second = page(core, revision, 1, first.nextCursor);
  finish(core, revision, 1, second.nextCursor);
});

test('R07 final pointer failure preserves prior published authority and survives retry on reopen', (t) => {
  const { core, db, path } = fixture(t); rawMemories(db, 2);
  finish(core, epoch(db)); const visible = map(core);
  const revision = epoch(db); const first = page(core, revision, 1);
  const before = indexSnapshot(db);
  db.exec("CREATE TRIGGER fail_index_pointer BEFORE UPDATE ON namespace_index_state BEGIN SELECT RAISE(ABORT,'synthetic pointer fault'); END");
  assert.equal(core.rebuildIndex({ namespace, expectedIndexRevision: revision, limit: 1, cursor: first.nextCursor }).ok, false);
  assert.deepEqual(indexSnapshot(db), before); assert.deepEqual(map(core), visible);
  db.exec('DROP TRIGGER fail_index_pointer');
  const reopened = openMemoryCore({ path, model }); t.after(() => reopened.close());
  assert.equal(page(reopened, revision, 1, first.nextCursor).state, 'published');
});

test('R06 published projections track hierarchy links, receipt revisions and legacy mutations', (t) => {
  const { core, db, path } = fixture(t);
  finish(core, epoch(db));
  const a = admit(core, 'Hierarchy source');
  const created = ok(core.applyPlacement({ namespace, expectedIndexRevision: epoch(db),
    expectedMemoryRevisions: [{ memoryId: a.id, revision: a.revision }],
    proposal: { items: [{ memoryId: a.id, parentIds: [], newL1: {
      title: 'Hierarchy child', parentL2Ids: [], newL2Title: 'Hierarchy root' } }] } })).createdMocs;
  const parent = created.find((m) => m.level === 'L2');
  const b = admit(core, 'Second hierarchy source'); const child = topic(core, db, [b], 'Second child');
  const linked = ok(core.linkMocs({ namespace, parentId: parent.id, expectedParentRevision: parent.revision,
    childId: child.id, expectedChildRevision: child.revision, expectedIndexRevision: epoch(db) }));
  const expanded = map(core, { parentRef: { mocId: parent.id, revision: linked.ref.parentRevision } });
  assert.ok(expanded.items.some((i) => i.type === 'ref' && i.ref.childId === child.id && i.ref.childRevision === child.revision));
  const duplicate = ok(core.linkMocs({ namespace, parentId: parent.id, expectedParentRevision: linked.ref.parentRevision,
    childId: child.id, expectedChildRevision: child.revision, expectedIndexRevision: epoch(db) }));
  assert.equal(duplicate.duplicate, true); assert.equal(duplicate.indexRevision, linked.indexRevision);
  const beforeReceipt = detail(core, b.id);
  const revision = epoch(db); const staged = page(core, revision, 1);
  const merged = ok(core.admit({ namespace, memory: { content: 'Second hierarchy source', kind: 'fact' },
    receipts: [{ ...receipt('Second hierarchy source'), eventId: 'additional-evidence' }] })).memory;
  assert.equal(merged.id, b.id); assert.ok(merged.revision > beforeReceipt.memory.revision);
  assert.equal(detail(core, b.id).receipts.length, beforeReceipt.receipts.length + 1);
  assert.deepEqual(detail(core, b.id).placements, []);
  assert.ok(map(core).items.some((i) => i.type === 'unfiled' && i.ref.memoryId === b.id && i.ref.revision === merged.revision));
  assert.equal(map(core, { purpose: 'classification' }).items.find((i) => i.type === 'moc' && i.moc.id === child.id).moc.title, null);
  error(core.rebuildIndex({ namespace, expectedIndexRevision: revision, limit: 1, cursor: staged.nextCursor }), 'stale_rebuild');

  const store = openMemoryStore({ path }); t.after(() => store.close());
  const legacy = store.scope({ ownerId: namespace.ownerId });
  const c = legacy.remember({ content: 'Legacy source', kind: 'fact', receipt: receipt('Legacy source') });
  const group = topic(core, db, [c], 'Legacy topic');
  const filed = detail(core, c.id).memory;
  const corrected = legacy.correct(c.id, { content: 'Legacy corrected', kind: 'fact', receipt: receipt('Legacy corrected') }, filed.revision);
  assert.equal(detail(core, c.id).memory.content, 'Legacy corrected');
  assert.deepEqual(detail(core, c.id).placements, []);
  assert.ok(map(core).items.some((i) => i.type === 'unfiled' && i.ref.memoryId === c.id && i.ref.revision === corrected.revision));
  assert.equal(map(core, { purpose: 'classification' }).items.find((i) => i.type === 'moc' && i.moc.id === group.id).moc.title, null);
  assert.equal(legacy.forget(c.id, corrected.revision), true);
  assert.ok(!map(core).items.some((i) => i.type === 'unfiled' && i.ref.memoryId === c.id));
  assert.ok(!ok(core.list({ namespace })).memories.some((m) => m.id === c.id));
});

test('R01 foreign and orphan reference gaps consume bounded pages without exposing their keys', (t) => {
  for (const includeOwned of [false, true]) {
    const { core, db } = fixture(t);
    const count = 90;
    const memory = db.prepare("INSERT INTO memories (id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,deleted,created_at,updated_at,filing_status) VALUES (?,?,'personal','',?,?,'fact','explicit',1,1,0,'2025','2025','unfiled')");
    const moc = db.prepare("INSERT INTO mocs VALUES (?,?,'personal','',?,?,?,1,'2025','2025')");
    const source = db.prepare('INSERT INTO moc_title_sources VALUES (?,?,1)');
    const membership = db.prepare('INSERT INTO moc_memory_refs VALUES (?,1,?,1)');
    const edge = db.prepare('INSERT INTO moc_edges VALUES (?,1,?,1)');
    db.exec('PRAGMA foreign_keys=OFF; BEGIN');
    for (let i = 0; i < count; i++) {
      const suffix = String(i).padStart(4, '0');
      const f = `foreign-secret-${suffix}`; const o = `orphan-secret-${suffix}`;
      memory.run(f, 'other', f, 'Foreign synthetic text');
      moc.run(`${f}-l1`, 'other', 1, f, f);
      moc.run(`${f}-l2`, 'other', 2, f, f);
      source.run(`${f}-l1`, f); membership.run(`${f}-l1`, f); edge.run(`${f}-l2`, `${f}-l1`);
      source.run(`${o}-l1`, o); membership.run(`${o}-l1`, o); edge.run(`${o}-l2`, `${o}-l1`);
    }
    if (includeOwned) {
      memory.run('zz-owned-memory', namespace.ownerId, 'owned', 'Owned synthetic text');
      moc.run('zz-owned-l1', namespace.ownerId, 1, 'Owned topic', 'owned topic');
      moc.run('zz-owned-l2', namespace.ownerId, 2, 'Owned root', 'owned root');
      source.run('zz-owned-l1', 'zz-owned-memory');
      membership.run('zz-owned-l1', 'zz-owned-memory');
      edge.run('zz-owned-l2', 'zz-owned-l1');
    }
    db.exec('COMMIT');
    // Rank persisted keysets against physical rows, including ignored references.
    // This catches unbounded scans independently of projection insert counts.
    const phases = [
      ['memories', ['id']], ['mocs', ['id']], ['moc_title_sources', ['moc_id', 'memory_id']],
      ['moc_memory_refs', ['moc_id', 'memory_id']], ['moc_edges', ['parent_id', 'child_id']],
    ];
    const keys = phases.map(([table, columns], phase) => db.prepare(
      `SELECT ${columns.join(',')} FROM ${table}${phase < 2 ? " WHERE owner_id='rebuild'" : ''} ORDER BY ${columns.join(',')}`)
      .all().map((row) => JSON.stringify(columns.map((column) => row[column]))));
    for (const [table, columns] of phases.slice(2)) {
      const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM ${table}
        WHERE (${columns.join(',')}) > (?,?) ORDER BY ${columns.join(',')} LIMIT 1`).all('', '');
      assert.ok(plan.some((row) => /SEARCH .* USING INDEX/.test(row.detail)), JSON.stringify(plan));
      assert.ok(plan.every((row) => !/TEMP B-TREE/.test(row.detail)), JSON.stringify(plan));
    }
    const total = keys.reduce((sum, rows) => sum + rows.length, 0);
    assert.equal(total, 6 * count + (includeOwned ? 6 : 0));
    const revision = epoch(db); let cursor; let visited = 0;
    do {
      const result = page(core, revision, 1, cursor);
      assert.deepEqual(result.invalidRefs, [], 'foreign and fully orphaned refs have no owned diagnostics');
      cursor = result.nextCursor;
      if (cursor) {
        const decoded = JSON.parse(Buffer.from(cursor.split('.')[0], 'base64url').toString());
        assert.deepEqual(Object.keys(decoded.a).sort(), ['generation', 'phase', 'sequence']);
        assert.ok(!JSON.stringify(decoded).includes('foreign-secret'));
        assert.ok(!JSON.stringify(decoded).includes('orphan-secret'));
        const progress = db.prepare('SELECT phase,last_key FROM index_generations WHERE id=?').get(decoded.a.generation);
        const position = progress.last_key === 'null' ? 0 : keys[progress.phase].indexOf(progress.last_key) + 1;
        assert.ok(progress.last_key === 'null' || position > 0, 'persisted key identifies an actual physical row');
        const traversed = keys.slice(0, progress.phase).reduce((sum, rows) => sum + rows.length, 0) + position;
        assert.equal(traversed, visited + 1, 'limit one visits exactly one physical node or reference, including ignored rows');
      } else assert.equal(visited + 1, total, 'publication must not skip an unbounded foreign/orphan tail');
      visited++;
      assert.ok(visited <= total);
    } while (cursor);
    assert.equal(visited, total);
    if (includeOwned) {
      assert.equal(detail(core, 'zz-owned-memory').placements[0].mocId, 'zz-owned-l1');
      assert.ok(map(core).items.some((item) => item.type === 'ref' && item.ref.childId === 'zz-owned-l1'));
    } else assert.deepEqual(map(core).items, []);
  }
});
