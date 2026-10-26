/** Offline observation only: creates its own synthetic v18 store, then migrates
 * three independent backup copies per target through the public constructor.
 * Reports stopped-store backup, precheck, migration and verification separately.
 * No input paths, production access, providers, keys or latency assertions.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { backup, DatabaseSync } from 'node:sqlite';
import { openMemoryCore, openMemoryReader } from '../../core/index.mjs';
import { cardHost } from '../../core/testing/raw-source-fixtures.mjs';
import { rationaleModel } from '../../core/testing/rationale-model.mjs';
import { seedStore } from './measure-topic-overview-contention.mjs';
import { createTestWorkspace } from './workspace.mjs';

assert.equal(process.argv.length, 2, 'This synthetic-only script accepts no arguments');
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const digest = rows => createHash('sha256').update(JSON.stringify(rows.map(row => JSON.stringify(row)).sort())).digest('hex');
const namespaceOf = row => ({ ownerId: row.ownerId, scope: row.scope, projectId: row.projectId || null });
const sameNamespace = (row, ns) => JSON.stringify(namespaceOf(row)) === JSON.stringify(ns);
const missing = result => { assert.equal(result.ok, false); assert.equal(result.error.code, 'memory_not_found'); };
function inspect(path, { retainedTables, hashes = true } = {}) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('BEGIN');
    assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map(row => row.integrity_check), ['ok']);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const tables = retainedTables ?? db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
    const data = Object.fromEntries(tables.map(name => {
      const count = db.prepare('SELECT count(*) AS n FROM ' + quote(name)).get().n;
      return [name, { count, ...(hashes ? { sha256: digest(db.prepare('SELECT * FROM ' + quote(name)).all()) } : {}) }];
    }));
    return { applicationId: db.prepare('PRAGMA application_id').get().application_id,
      schema: db.prepare('PRAGMA user_version').get().user_version,
      journal: db.prepare('PRAGMA journal_mode').get().journal_mode,
      bytes: statSync(path).size, tables, data,
      ...(hashes ? {
        namespaces: db.prepare('SELECT DISTINCT owner_id AS ownerId,scope,project_id AS projectId FROM memories ORDER BY owner_id,scope,project_id').all().map(namespaceOf),
        samples: db.prepare(`SELECT id,owner_id AS ownerId,scope,project_id AS projectId,revision,content,kind,
          deleted,currentness,review_state AS reviewState,filing_status AS filing FROM memories ORDER BY id`).all(),
        receipts: db.prepare(`SELECT memory_id AS memoryId,id,client,session_id AS sessionId,event_id AS eventId,
          role,excerpt,created_at AS createdAt FROM receipts ORDER BY created_at,id`).all(),
      } : {}) };
  } finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
}
async function consistentBackup(source, destination) {
  assert.equal(existsSync(destination), false, 'owned backup destination must be new');
  const db = new DatabaseSync(source, { readOnly: true });
  try { await backup(db, destination); }
  finally { db.close(); }
  chmodSync(destination, 0o600);
}
function assertIdentity(snapshot, before, schema) {
  assert.equal(snapshot.applicationId, 0x43414952);
  assert.equal(snapshot.applicationId, before.applicationId);
  assert.equal(snapshot.schema, schema); assert.equal(snapshot.journal, before.journal);
}
function verifyPublicReadability(path, before) {
  const core = openMemoryCore({ path, decisionReview: 'required-v1' });
  let memoriesRead = 0, receiptPages = 0, receiptsRead = 0;
  try {
    for (const namespace of before.namespaces) for (const awaiting of [false, true]) {
      const expected = before.samples.filter(row => sameNamespace(row, namespace) && !row.deleted && (row.reviewState === 'awaiting') === awaiting);
      const actual = []; let cursor;
      do {
        const page = ok(core.list({ namespace, states: ['active', 'historical'], limit: 64,
          ...(awaiting ? { reviewState: 'awaiting' } : {}), ...(cursor ? { cursor } : {}) }));
        actual.push(...page.memories.map(row => row.id)); cursor = page.nextCursor;
        assert.equal(page.exhausted, cursor === null);
      } while (cursor);
      assert.deepEqual(actual.sort(), expected.map(row => row.id).sort());
    }
    for (const row of before.samples) {
      const input = { namespace: namespaceOf(row), memoryId: row.id };
      if (row.deleted) { missing(core.get(input)); missing(core.get({ ...input, includeAwaiting: true })); continue; }
      if (row.reviewState === 'awaiting') missing(core.get(input));
      const actual = []; let receiptCursor;
      do {
        const value = ok(core.get({ ...input, includeAwaiting: true, receiptLimit: 1,
          ...(receiptCursor ? { receiptCursor } : {}) }));
        const memory = value.memory;
        assert.equal(memory.content, row.content); assert.equal(memory.revision, row.revision);
        assert.equal(memory.kind, row.kind); assert.equal(memory.reviewState, row.reviewState);
        assert.equal(memory.state, row.currentness === 'historical' ? 'historical' : 'active');
        assert.equal(memory.filing.status, row.filing);
        actual.push(...value.receipts); receiptPages++; receiptCursor = value.nextReceiptCursor;
        assert.equal(value.exhausted, receiptCursor === null);
      } while (receiptCursor);
      const expected = before.receipts.filter(receipt => receipt.memoryId === row.id).map(({ memoryId, ...receipt }) => receipt);
      assert.deepEqual(actual, expected); receiptsRead += actual.length; memoriesRead++;
    }
  } finally { core.close(); }
  return { memoriesRead, receiptsRead, receiptPages,
    awaiting: before.samples.filter(row => !row.deleted && row.reviewState === 'awaiting').length,
    historical: before.samples.filter(row => !row.deleted && row.currentness === 'historical').length,
    tombstones: before.samples.filter(row => row.deleted).length };
}
async function verifyVisibilityCanary(path) {
  const namespace = { ownerId: 'synthetic-visibility', scope: 'personal', projectId: null };
  const receipt = eventId => ({ client: 'synthetic-visibility', sessionId: 'canary', eventId, role: 'user', excerpt: 'Synthetic canary evidence.' });
  const core = openMemoryCore({ path, decisionReview: 'required-v1', model: {
    ...rationaleModel(), extract: () => ({ items: [{ content: 'Synthetic awaiting decision.', kind: 'decision', confidence: 0.8, sourceIndices: [0] }] }),
  } });
  try {
    const live = ok(core.admit({ namespace, memory: { content: 'Synthetic historical fact.', kind: 'fact' }, receipts: [receipt('one'), receipt('two'), receipt('three')] })).memory;
    ok(core.supersede({ namespace, memoryId: live.id, expectedRevision: live.revision,
      replacement: { content: 'Synthetic replacement fact.', kind: 'fact' }, receipts: [receipt('replacement')] }));
    const dead = ok(core.admit({ namespace, memory: { content: 'Synthetic forgotten fact.', kind: 'fact' }, receipts: [receipt('forgotten')] })).memory;
    ok(core.forget({ namespace, memoryId: dead.id, expectedRevision: dead.revision }));
    ok(await core.capture({ namespace, client: 'synthetic-visibility', sessionId: 'canary', eventId: 'awaiting',
      messages: [{ id: 'awaiting', role: 'user', content: 'Synthetic awaiting decision.' }] }));
  } finally { core.close(); }
  const baseline = inspect(path), result = verifyPublicReadability(path, baseline);
  assert.equal(result.awaiting, 1); assert.equal(result.tombstones, 1); assert.equal(result.historical, 1);
  assert.ok(result.receiptPages > result.memoriesRead, 'multiple receipt pages exercised');
  assert.deepEqual(inspect(path).data, baseline.data);
  return result;
}
async function verifyBackupWalCanary(path, destination) {
  const writer = new DatabaseSync(path);
  try {
    writer.exec('PRAGMA journal_mode=WAL; CREATE TABLE probe(value TEXT); INSERT INTO probe VALUES(\'committed\'); BEGIN IMMEDIATE; INSERT INTO probe VALUES(\'uncommitted\');');
    assert.ok(statSync(path + '-wal').size > 0, 'committed WAL exists during backup');
    await consistentBackup(path, destination);
    const copy = new DatabaseSync(destination, { readOnly: true });
    try { assert.deepEqual(copy.prepare('SELECT value FROM probe').all().map(row => row.value), ['committed']); }
    finally { copy.close(); }
    assert.equal(writer.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    return { sourceJournal: 'WAL', committedVisible: true, uncommittedExcluded: true, sourceModeUnchanged: true };
  } finally { if (writer.isTransaction) writer.exec('ROLLBACK'); writer.close(); }
}
const workspace = createTestWorkspace(null, { prefix: 'cairn-schema-timing-' });
try {
  const visibilityCanary = await verifyVisibilityCanary(join(workspace.path, 'visibility-canary.sqlite'));
  const backupWalCanary = await verifyBackupWalCanary(join(workspace.path, 'backup-wal-canary.sqlite'), join(workspace.path, 'backup-wal-copy.sqlite'));
  console.error(JSON.stringify({ phase: 'untimed-canaries', visibilityCanary, backupWalCanary }));
  const source = join(workspace.path, 'v18.sqlite');
  await seedStore(source, 18, { onProgress: progress => console.error(JSON.stringify({ phase: 'seed', ...progress })) });
  // Keep all MOC title-support Memories intact. Enlarge the other Memories using
  // public correction: supply 3,500 units for each body and receipt excerpt;
  // contractReceipt retains only 800 excerpt units (core/contract.mjs:102).
  // This is a workload approximation, not padding pages or relabelling schema.
  const probe = new DatabaseSync(source, { readOnly: true });
  let rows;
  try { rows = probe.prepare(`SELECT id,owner_id AS ownerId,scope,project_id AS projectId,revision FROM memories
    WHERE id NOT IN (SELECT memory_id FROM moc_title_sources) ORDER BY id`).all(); }
  finally { probe.close(); }
  const seed = openMemoryCore({ path: source });
  try {
    for (const [index, row] of rows.entries()) {
      const content = (`Synthetic migration payload ${index}. ` + 'Offline bounded body and retained receipt. '.repeat(100)).slice(0, 3500);
      ok(seed.correct({ namespace: { ownerId: row.ownerId, scope: row.scope, projectId: row.projectId || null },
        memoryId: row.id, expectedRevision: row.revision, kind: 'fact', content,
        receipt: { client: 'synthetic-migration', sessionId: 'size-profile', eventId: String(index), role: 'user', excerpt: content } }));
      if ((index + 1) % 128 === 0) console.error(JSON.stringify({ phase: 'size-profile', corrected: index + 1, total: rows.length }));
    }
  } finally { seed.close(); }
  const before = inspect(source);
  assert.equal(before.schema, 18); assert.equal(before.journal, 'delete');
  assert.equal(before.applicationId, 0x43414952);
  assert.equal(before.data.memories.count, 1112); assert.equal(before.namespaces.length, 4);
  assert.equal(before.data.mocs.count, 71);
  const enlarged = new Set(rows.map(row => row.id));
  assert.ok(before.samples.filter(row => enlarged.has(row.id)).every(row => row.content.length === 3500));
  assert.ok(before.receipts.filter(row => enlarged.has(row.memoryId)).every(row => row.excerpt.length === 800));
  const report = { version: 'synthetic-schema-migration-timing-v2', runtime: process.version,
    platform: process.platform, arch: process.arch, sqlite: process.versions.sqlite,
    backupMethod: 'node:sqlite.backup', visibilityCanary, backupWalCanary,
    profile: { memories: 1112, namespaces: 4, mocs: 71, correctedMemories: rows.length,
      suppliedBodyUnits: 3500, suppliedReceiptExcerptUnits: 3500, retainedBodyUnits: 3500, retainedReceiptExcerptUnits: 800,
      journal: 'DELETE', bytesBefore: before.bytes,
      scope: 'warm process; stopped-store backup + precheck + migration + verification; seeding, canaries and source baseline excluded' }, trials: [] };
  for (const target of [23, 33]) for (let trial = 1; trial <= 3; trial++) {
    const path = join(workspace.path, `v${target}-${trial}.sqlite`);
    const host = cardHost();
    const options = { path, privateCards: { ...host.options,
      ...(target === 33 ? { currentDependencies: { version: 'card-current-dependencies-v1' } } : {}) },
      ...(target === 33 ? { methodPackages: { version: 'method-packages-local-v1', storage: 'local-plain-v1', authority: host.options.authority } } : {}) };
    for (const suffix of ['-wal', '-shm', '-journal']) assert.equal(existsSync(source + suffix), false);
    console.error(JSON.stringify({ phase: 'backup', target, trial }));
    const totalStarted = performance.now();
    let started = performance.now();
    await consistentBackup(source, path);
    const backupMs = performance.now() - started, backupBytes = statSync(path).size;
    console.error(JSON.stringify({ phase: 'precheck', target, trial, backupMs }));
    started = performance.now();
    const precheck = inspect(path, { hashes: false });
    assertIdentity(precheck, before, 18);
    assert.deepEqual(precheck.tables, before.tables);
    for (const table of before.tables) assert.equal(precheck.data[table].count, before.data[table].count);
    const precheckMs = performance.now() - started;
    console.error(JSON.stringify({ phase: 'migration', target, trial, precheckMs }));
    started = performance.now();
    const core = openMemoryCore(options);
    core.close();
    const migrationMs = performance.now() - started;
    console.error(JSON.stringify({ phase: 'verification', target, trial, migrationMs }));
    started = performance.now();
    const after = inspect(path, { retainedTables: before.tables });
    assertIdentity(after, before, target);
    assert.deepEqual(after.data, before.data, 'all original table counts and row hashes preserved');
    const readability = verifyPublicReadability(path, before);
    for (const namespace of before.namespaces) {
      const reader = openMemoryReader({ path, ownerId: namespace.ownerId });
      try { ok(await reader.readTopicOverview({ namespace })); }
      finally { await reader.close(); }
    }
    for (const suffix of ['-wal', '-shm', '-journal']) assert.equal(existsSync(path + suffix), false);
    assert.deepEqual(inspect(path, { retainedTables: before.tables }).data, before.data, 'public verification does not change original data');
    const verificationMs = performance.now() - started, totalMs = performance.now() - totalStarted;
    const stepSumMs = backupMs + precheckMs + migrationMs + verificationMs;
    report.trials.push({ target, trial, backupMs, precheckMs, migrationMs, verificationMs, stepSumMs, totalMs,
      overheadMs: totalMs - stepSumMs, bytesBefore: before.bytes, backupBytes, bytesAfter: statSync(path).size,
      retainedTablesVerified: before.tables.length, ...readability, integrity: 'ok', foreignKeyViolations: 0 });
    console.error(JSON.stringify({ phase: 'trial', ...report.trials.at(-1) }));
  }
  assert.equal(inspect(source).schema, 18);
  assert.deepEqual(inspect(source).data, before.data);
  console.log(JSON.stringify(report, null, 2));
} finally { await workspace.cleanup(); }
