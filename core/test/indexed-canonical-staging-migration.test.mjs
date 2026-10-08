import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { openDatabase as oldOpen } from '../testing/canonical-staging-v18-database.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const base = '1a7a4826ea310a07b281a7c2133cd51826db1dc9';
const payload = JSON.stringify({ messages: [{ id: 'old-source', role: 'assistant', content: 'Prior bounded source.' }],
  retainedSourceWindow: { maxUnitsPerMessage: 800, truncatedMessageIndices: [] } });
const tables = db => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all().map(row => ({ ...row }))]));
function fixture(t, suffix = 'migration') {
  const workspace = createTestWorkspace(t, { prefix: 'canonical-v18-' });
  const path = join(workspace.path, `${suffix}.sqlite`), seed = oldOpen(path);
  let closed = false;
  const close = () => { if (!closed) { seed.close(); closed = true; } }; workspace.defer(close);
  assert.equal(seed.prepare('PRAGMA user_version').get().user_version, 18);
  const now = Date.now();
  seed.exec(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,created_at,updated_at)
    VALUES('old-memory','migration','personal','','fingerprint','Prior admitted memory','fact','explicit',1,3,
      '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
    VALUES('old-receipt','old-memory','old-key','synthetic','session','old-source','assistant','Prior bounded source.','2026-01-01T00:00:00.000Z');
    INSERT INTO admission_claims(owner_id,scope,project_id,client,event_id,payload_digest,state,memory_ids,suppressed_count)
    VALUES('migration','personal','','synthetic','old-event','${'a'.repeat(64)}','completed','["old-memory"]',0);`);
  seed.prepare(`INSERT INTO staged_capture_evidence(owner_id,scope,project_id,client,event_id,state,created_at,expires_at,payload,payload_bytes)
    VALUES('migration','personal','','synthetic','old-event','admitted',?,?,?,?)`).run(now, now + 86400000, payload, Buffer.byteLength(payload));
  seed.prepare("INSERT INTO staged_capture_clocks VALUES('migration','personal','',?)").run(now);
  close();
  const db = new DatabaseSync(path); workspace.defer(() => db.close());
  return { workspace, path, db };
}

test('S3 fixed v18 opener is the actual prior implementation with only import paths relocated', () => {
  const fixture = readFileSync(new URL('../testing/canonical-staging-v18-database.mjs', import.meta.url), 'utf8');
  const header = `// Frozen from ${base}; only import paths relocated.\n`;
  assert(fixture.startsWith(header));
  const original = fixture.slice(header.length).replaceAll('"../', '"./').replaceAll("'../", "'./");
  // Independently pinned from the fixed base before implementation; no Git ancestry required in shallow CI.
  assert.equal(Buffer.byteLength(original), 16870);
  assert.equal(createHash('sha256').update(original).digest('hex'), '75898ac6295be56bf1f984774d1819a6f19d374306044894c03b077177ca0e34');
});

test('S3 eager v18 upgrade preserves every existing column/row and exact prefix bytes; actual v18 opener refuses v19', t => {
  const { path, db } = fixture(t), before = tables(db);
  openMemoryCore({ path }).close();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 19);
  const after = tables(db);
  for (const [name, rows] of Object.entries(before)) {
    assert.deepEqual(after[name].map(row => Object.fromEntries(Object.keys(rows[0] ?? {}).map(key => [key, row[key]]))), rows);
  }
  const staged = db.prepare('SELECT * FROM staged_capture_evidence').get();
  assert.equal(staged.payload, payload); assert.equal(staged.payload_format, 'prefix-messages-v1');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const core = openMemoryCore({ path });
  try {
    const inspected = core.inspectCaptureEvidence({ namespace: { ownerId: 'migration', scope: 'personal', projectId: null },
      client: 'synthetic', eventId: 'old-event' });
    assert.equal(inspected.ok, true); assert.deepEqual(inspected.value.evidence.view, JSON.parse(payload));
  } finally { core.close(); }
  const schema = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), material = tables(db);
  assert.throws(() => oldOpen(path), { code: 'unsupported_database' });
  assert.deepEqual(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), schema);
  assert.deepEqual(tables(db), material);
});

test('S3 late v19 column collision rolls back schema/version/data and leaves the actual v18 opener usable', t => {
  const { path, db } = fixture(t, 'rollback');
  db.exec("ALTER TABLE staged_capture_evidence ADD COLUMN payload_format TEXT DEFAULT 'precious-old-column'");
  const schema = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), before = tables(db);
  assert.throws(() => openMemoryCore({ path }));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18);
  assert.deepEqual(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), schema);
  assert.deepEqual(tables(db), before);
  oldOpen(path).close();
});
