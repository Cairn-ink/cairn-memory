/** Offline observation only: creates its own synthetic v18 store, then migrates
 * three independent closed copies per target through the public constructor.
 * No input paths, production access, providers, keys or latency assertions.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore, openMemoryReader } from '../../core/index.mjs';
import { cardHost } from '../../core/testing/raw-source-fixtures.mjs';
import { seedStore } from './measure-topic-overview-contention.mjs';
import { createTestWorkspace } from './workspace.mjs';

assert.equal(process.argv.length, 2, 'This synthetic-only script accepts no arguments');
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const digest = rows => createHash('sha256').update(JSON.stringify(rows.map(row => JSON.stringify(row)).sort())).digest('hex');
function inspect(path, retainedTables) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map(row => row.integrity_check), ['ok']);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const tables = retainedTables ?? db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
    const data = Object.fromEntries(tables.map(name => {
      const rows = db.prepare('SELECT * FROM ' + quote(name)).all();
      return [name, { count: rows.length, sha256: digest(rows) }];
    }));
    return { schema: db.prepare('PRAGMA user_version').get().user_version,
      journal: db.prepare('PRAGMA journal_mode').get().journal_mode,
      bytes: statSync(path).size, tables, data,
      namespaces: db.prepare('SELECT DISTINCT owner_id AS ownerId,scope,project_id AS projectId FROM memories ORDER BY owner_id,scope,project_id').all().map(row => ({ ...row, projectId: row.projectId || null })),
      samples: db.prepare('SELECT id,owner_id AS ownerId,scope,project_id AS projectId,revision,content FROM memories ORDER BY id').all() };
  } finally { db.close(); }
}
const workspace = createTestWorkspace(null, { prefix: 'cairn-schema-timing-' });
try {
  const source = join(workspace.path, 'v18.sqlite');
  await seedStore(source, 18, { onProgress: progress => console.error(JSON.stringify({ phase: 'seed', ...progress })) });
  // Keep all MOC title-support Memories intact. Enlarge the other Memories using
  // public correction, with actual bounded synthetic body/receipt payloads.
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
  assert.equal(before.data.memories.count, 1112); assert.equal(before.namespaces.length, 4);
  assert.equal(before.data.mocs.count, 71);
  const report = { version: 'synthetic-schema-migration-timing-v1', runtime: process.version,
    platform: process.platform, arch: process.arch, sqlite: process.versions.sqlite,
    profile: { memories: 1112, namespaces: 4, mocs: 71, correctedMemories: rows.length, payloadUnits: 3500,
      journal: 'DELETE', bytesBefore: before.bytes, scope: 'warm-process public open-and-close only; copy, seeding, integrity and readability excluded' }, trials: [] };
  for (const target of [23, 33]) for (let trial = 1; trial <= 3; trial++) {
    const path = join(workspace.path, `v${target}-${trial}.sqlite`);
    copyFileSync(source, path); chmodSync(path, 0o600);
    const host = cardHost();
    const options = { path, privateCards: { ...host.options,
      ...(target === 33 ? { currentDependencies: { version: 'card-current-dependencies-v1' } } : {}) },
      ...(target === 33 ? { methodPackages: { version: 'method-packages-local-v1', storage: 'local-plain-v1', authority: host.options.authority } } : {}) };
    const started = performance.now();
    const core = openMemoryCore(options);
    core.close();
    const wallMs = performance.now() - started;
    const after = inspect(path, before.tables);
    assert.equal(after.schema, target); assert.equal(after.journal, before.journal);
    assert.deepEqual(after.data, before.data, 'all original table counts and row hashes preserved');
    const reopened = openMemoryCore({ path });
    try { for (const row of before.samples) {
      const value = ok(reopened.get({ namespace: { ownerId: row.ownerId, scope: row.scope, projectId: row.projectId || null }, memoryId: row.id }));
      assert.equal(value.memory.content, row.content); assert.equal(value.memory.revision, row.revision);
    } } finally { reopened.close(); }
    for (const namespace of before.namespaces) {
      const reader = openMemoryReader({ path, ownerId: namespace.ownerId });
      try { ok(await reader.readTopicOverview({ namespace })); }
      finally { await reader.close(); }
    }
    for (const suffix of ['-wal', '-shm', '-journal']) assert.equal(existsSync(path + suffix), false);
    report.trials.push({ target, trial, wallMs, bytesBefore: before.bytes, bytesAfter: after.bytes,
      retainedTablesVerified: before.tables.length, memoriesRead: before.samples.length, integrity: 'ok', foreignKeyViolations: 0 });
    console.error(JSON.stringify({ phase: 'trial', ...report.trials.at(-1) }));
  }
  assert.equal(inspect(source).schema, 18);
  assert.deepEqual(inspect(source).data, before.data);
  console.log(JSON.stringify(report, null, 2));
} finally { await workspace.cleanup(); }
