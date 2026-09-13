// Maintainer-only, synthetic SQLite recipe. Prints JSON; never writes repository files.
// Usage: node core/testing/generate-qualified-transition-v10-fixture.mjs /absolute/unmodified/base/checkout
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const base = 'ddd4468db6dbf1fc625073548a34ade9129705f6';
const checkout = process.argv[2];
assert.ok(checkout?.startsWith('/'));
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim(), base);
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: checkout, encoding: 'utf8' }).trim(), '');
const { openMemoryCore } = await import(pathToFileURL(join(checkout, 'core/contract.mjs')));
const path = join(mkdtempSync(join(tmpdir(), 'cairn-v10-fixture-recipe-')), 'synthetic.sqlite');
const core = openMemoryCore({ path, model: { contextWindow: 8192, countTokens: () => 1,
  extract: ({ input }) => ({ items: [{ content: input.messages[0].content, kind: 'fact', confidence: 0.8, sourceIndices: [0] }] }),
  reconcile: () => ({ transitions: [] }) } });
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const namespace = { ownerId: 'qualification-v10-synthetic', scope: 'personal', projectId: null };
const receipt = (eventId, excerpt) => ({ client: 'synthetic', sessionId: 'session', eventId, role: 'user', excerpt });
const first = ok(core.admit({ namespace, memory: { content: 'Synthetic Friday', kind: 'fact' }, receipts: [receipt('friday', 'Synthetic Friday')] })).memory;
ok(core.supersede({ namespace, memoryId: first.id, expectedRevision: first.revision,
  replacement: { content: 'Synthetic Monday', kind: 'fact' }, receipts: [receipt('monday', 'Synthetic Monday')] }));
const captureInput = { namespace, client: 'synthetic', sessionId: 'session', eventId: 'ordered-event',
  causal: { streamId: 'synthetic-stream', sequence: 1 }, messages: [{ id: 'message', role: 'user', content: 'Synthetic tram schedule' }] };
const captureResult = ok(await core.capture(captureInput));
const key = { namespace, client: 'synthetic', eventId: 'empty-claim', payloadDigest: 'a'.repeat(64) };
const { token } = ok(core.claimAdmission({ ...key, leaseMs: 1000 })); ok(core.finishAdmission({ ...key, token, items: [] }));
const qualifiedText = 'Synthetic deadline is Friday.';
const qualified = ok(core.admit({ namespace, memory: { content: qualifiedText, kind: 'fact' },
  receipts: [receipt('qualified', qualifiedText)], qualification: { version: 1,
    slot: { subject: 'Synthetic project', property: 'deadline', scope: 'work', applies: 'release' },
    value: 'Friday', attribution: 'direct', commitment: 'adopted',
    anchors: [{ receiptIndex: 0, start: 0, end: qualifiedText.length, text: qualifiedText,
      fields: ['subject','property','scope','applies','value','attribution','commitment'] }] } })).memory;
const qualificationDetail = ok(core.get({ namespace, memoryId: qualified.id, includeQualification: true }));
const indexRevision = ok(core.map({ namespace })).indexRevision;
ok(core.rebuildIndex({ namespace, expectedIndexRevision: indexRevision, limit: 500 }));
const rebuild = { namespace, expectedIndexRevision: ok(core.map({ namespace })).indexRevision, limit: 1 };
rebuild.cursor = ok(core.rebuildIndex(rebuild)).nextCursor;
assert.ok(rebuild.cursor);
const cursor = ok(core.list({ namespace, limit: 1 })).nextCursor;
const next = ok(core.list({ namespace, limit: 1, cursor }));
const history = ok(core.get({ namespace, memoryId: first.id }));
const db = new DatabaseSync(path);
assert.equal(db.prepare('PRAGMA user_version').get().user_version, 10);
const schema = db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all();
const tables = schema.filter((r) => r.type === 'table').map(({ name }) => ({ name, rows: db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all() }));
console.log(JSON.stringify({ provenance: { base, node: process.version, recipe: 'core/testing/generate-qualified-transition-v10-fixture.mjs', synthetic: true },
  namespace, qualificationDetail, key, captureInput, captureResult, rebuild, cursor, next, history, schema, tables }, null, 2));
db.close(); core.close();

