import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { openDatabase as openOldDatabase, transaction as oldTransaction } from '../testing/raw-v27-database.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { createRawJournal } from '../raw-journal.mjs';
import { createLocalRawSearch, localRawSearchManager } from '../local-raw-search.mjs';
import { defaultRawOptions } from '../local-defaults.mjs';
import { rawRequest, splitRaw } from '../testing/raw-fixtures.mjs';
import { openMemoryCore } from '../index.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const ns = { ownerId: 'synthetic-owner', scope: 'personal', projectId: null };
const request = (n, patch = {}) => ({ namespace: ns, client: 'codex', sessionId: 'session', eventId: 'batch-' + n,
  messages: [{ id: 'message-' + n, role: 'user', content: 'Synthetic cobalt telescope ' + n, ...patch }] });
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
function fixture(t, options = {}) {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'memory.sqlite');
  const core = openMemoryCore({ raw: true, path, model: { contextWindow:8192, extract: async () => ({ items: [] }), countTokens: () => 1 }, ...options });
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path); workspace.defer(() => db.close());
  return { core, db, path };
}

test('raw:true captures retain Raw, derive receive time, preserve explicit event time and replay', async t => {
  const { core, db } = fixture(t);
  const before = new Date().toISOString();
  ok(await core.capture(request(1)));
  const after = new Date().toISOString();
  const derived = db.prepare('SELECT occurred_at FROM raw_messages WHERE message_id=?').get('message-1').occurred_at;
  assert.ok(derived >= before && derived <= after, derived);
  ok(await core.capture(request(1)));
  const explicit = '2024-01-02T03:04:05.000Z';
  ok(await core.capture(request(2, { occurredAt: explicit })));
  assert.equal(db.prepare('SELECT occurred_at FROM raw_messages WHERE message_id=?').get('message-2').occurred_at, explicit);
  assert.equal(db.prepare('SELECT count(*) n FROM raw_parts WHERE saved=1').get().n, 2);
});

test('Raw retention survives missing extraction configuration', async t => {
  const { core, db } = fixture(t, { model:undefined });
  const result = await core.capture(request(1));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'model_not_configured');
  assert.equal(db.prepare('SELECT count(*) n FROM raw_parts WHERE saved=1').get().n, 1);
  assert.ok(db.prepare('SELECT occurred_at FROM raw_messages').get().occurred_at);
});

test('raw:false keeps capture model work and stores no Raw', async t => {
  const { core, db } = fixture(t, { raw: false });
  ok(await core.capture(request(1)));
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='raw_parts'").get().n, 0);
});

test('default maintenance publishes captures in bounded quanta without capture waiting', async t => {
  const { core, path } = fixture(t);
  for (let n = 1; n <= 6; n++) ok(await core.capture(request(n)));
  // No timer turn can execute while these capture microtasks drain.
  assert.equal(existsSync(path + '.raw-search'), false, 'capture must return before index I/O starts');
  let found;
  for (let quantum = 0; quantum < 12; quantum++) {
    await delay(1100);
    found = ok(await core.searchRaw({ namespace: ns, query: 'cobalt telescope' }));
    if (found.candidates.length === 6) break;
  }
  assert.equal(found.candidates.length, 6, JSON.stringify(found));
  const other = ok(await core.searchRaw({ namespace: { ...ns, ownerId: 'other-owner' }, query: 'cobalt telescope' }));
  assert.equal(other.candidates.length, 0);
});

test('legacy Raw metadata keeps its frozen client constraint and existing sources', async t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'legacy.sqlite');
  const old = openOldDatabase(path, { rawCapture: true, rawLineage: true, rawDeletion: true });
  const journal = createRawJournal({ db:old, ...defaultRawOptions() });
  const token = await journal.prepareRegistration(rawRequest(splitRaw('Synthetic earlier retained source.')[0]));
  oldTransaction(old, () => journal.commitRegistration(token));
  old.close();
  const core = openMemoryCore({ raw: true, path, model: { contextWindow:8192, extract: () => ({ items: [] }), countTokens: () => 1 } });
  workspace.defer(() => core.close());
  ok(await core.capture(request(1)));
  const db = new DatabaseSync(path); workspace.defer(() => db.close());
  assert.equal(db.prepare("SELECT count(*) n FROM raw_conversations WHERE client='codex'").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) n FROM raw_parts WHERE saved=1").get().n, 2);
  assert.ok(db.prepare("SELECT sealed FROM raw_parts WHERE message_id='message'").get().sealed.length > 0);
  assert.equal(db.prepare('PRAGMA foreign_key_check').get(), undefined);
});

for (const contentSafety of [undefined, 's2h-v1']) test(`default Raw search withholds forgotten evidence and isolates namespaces (${contentSafety ?? 'legacy'})`, async t => {
  const { core } = fixture(t, { model:rationaleModel(), ...(contentSafety ? { contentSafety } : {}) });
  const captured = ok(await core.capture(request(1)));
  const otherNamespace = { ...ns, scope:'project', projectId:'other-project' };
  ok(await core.capture({ ...request(2), namespace:otherNamespace }));
  let found;
  for (let quantum = 0; quantum < 12; quantum++) {
    await delay(1100);
    found = ok(await core.searchRaw({ namespace:ns, query:'cobalt telescope' }));
    if (found.candidates.length) break;
  }
  assert.equal(found.candidates.length, 1);
  assert.deepEqual(found.candidates[0].namespace, ns);
  const memoryId = captured.admission.memories[0].id;
  const memory = ok(core.get({ namespace:ns, memoryId })).memory;
  ok(core.forget({ namespace:ns, memoryId, expectedRevision:memory.revision }));
  const hidden = ok(await core.searchRaw({ namespace:ns, query:'cobalt telescope' }));
  assert.equal(hidden.candidates.length, 0);
});

test('context Raw port shares maintenance and validates one fixed personal/project read set', async t => {
  const { core, path } = fixture(t, { rawSearch:false, model:rationaleModel() });
  const project = { ...ns, scope:'project', projectId:'selected-project' };
  const manager = createLocalRawSearch(path, defaultRawOptions().port);
  const port = manager.contextPort([project, ns]);
  t.after(() => manager.close());
  assert.equal(localRawSearchManager(port), manager);
  const captured = ok(await core.capture(request(1)));
  ok(await core.capture({ ...request(2), namespace:project }));
  ok(await core.capture({ ...request(3), namespace:{ ...ns, ownerId:'unselected-owner' } }));
  ok(await core.capture({ ...request(4), namespace:{ ...project, projectId:'unselected-project' } }));
  manager.schedule(ns);
  let found;
  for (let quantum = 0; quantum < 12; quantum++) {
    await delay(1100);
    found = await port.search({ query:'cobalt telescope', intent:'current' });
    if (found.coverage.status === 'complete' && found.candidates.length === 2) break;
  }
  assert.equal(found.candidates.length, 2, JSON.stringify(found));
  assert.ok(found.candidates.every(row => [ns, project].some(scope => JSON.stringify(scope) === JSON.stringify(row.namespace))));
  const candidate = found.candidates.find(row => row.namespace.scope === 'personal');
  const handle = await port.prepare(candidate, { intent:'current' });
  assert.match(port.revalidate([handle])[0].ranges.map(range => range.text).join(''), /cobalt telescope/);
  assert.throws(() => port.revalidate([{}]), { code:'stale_publication' });
  const memoryId = captured.admission.memories[0].id;
  const memory = ok(core.get({ namespace:ns, memoryId })).memory;
  ok(core.forget({ namespace:ns, memoryId, expectedRevision:memory.revision }));
  assert.throws(() => port.revalidate([handle]));
  await manager.close();
  assert.throws(() => port.revalidate([handle]), { code:'store_closed' });
});

for (const raw of [undefined, false]) test(`library default is Raw-free (${raw ?? 'omitted'})`, async t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'library.sqlite');
  const core = openMemoryCore({ path, model:rationaleModel(), ...(raw === undefined ? {} : { raw }) });
  workspace.defer(() => core.close());
  ok(await core.capture(request(1)));
  assert.equal(core.captureRaw, undefined);
  assert.equal(core.searchRaw, undefined);
  const db = new DatabaseSync(path); workspace.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18);
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name LIKE 'raw_%'").get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM memories').get().n, 1);
});
