// Synthetic installed-only host. No checkout runtime, provider or real source.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { join } from 'node:path';
import { register, syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import workerThreads from 'node:worker_threads';

const [installed, scratch, mode, client = 'claude-code'] = process.argv.slice(2);
assert.ok(['layouts', 'raw'].includes(mode));
const deny = () => { throw Error('synthetic_reader_network_forbidden'); };
globalThis.fetch = deny; http.request = http.get = https.request = https.get = net.connect = net.createConnection = net.Socket.prototype.connect = deny;
register('data:text/javascript,' + encodeURIComponent(`import{fileURLToPath}from'node:url';let root;
export function initialize(data){root=data.root}export async function resolve(s,c,next){const result=await next(s,c);
if(result.url.startsWith('file:')&&!fileURLToPath(result.url).startsWith(root+'/'))throw Error('installed_reader_source_fallback');return result}`),
{ parentURL: import.meta.url, data: { root: installed } });
const NativeWorker = workerThreads.Worker, workers = [];
workerThreads.Worker = class extends NativeWorker {
  constructor(url, options) {
    assert.equal(fileURLToPath(url), join(installed, 'core/topic-overview-worker.mjs'));
    assert.deepEqual(options.env, {}); assert.deepEqual(options.execArgv, []);
    assert.equal(options.resourceLimits.maxOldGenerationSizeMb, 64);
    super(url, options); const record = { path: fileURLToPath(url), closed: false };
    workers.push(record); this.once('exit', () => { record.closed = true; });
  }
};
syncBuiltinESMExports();
const importedCore = join(installed, 'core/index.mjs');
const { openMemoryCore, openMemoryReader } = await import(pathToFileURL(importedCore));
const load = file => import(pathToFileURL(join(installed, 'core', file)));
const namespace = { ownerId: 'installed-raw-overview', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const hash = value => createHash('sha256').update(value).digest('hex');
const bytes = path => Object.fromEntries(['', '-wal', '-shm'].map(suffix => [suffix,
  fs.existsSync(path + suffix) ? hash(fs.readFileSync(path + suffix)) : null]));
async function collect(reader, extra = {}) {
  let cursor; const items = []; let last;
  for (let count = 0; count < 1000; count++) {
    last = ok(await reader.readTopicOverview({ namespace, ...extra, ...(cursor ? { cursor } : {}) }));
    items.push(...last.items); cursor = last.nextCursor;
    if (!cursor) return { items, totals: last.totals };
  }
  assert.fail('bounded installed continuation did not finish');
}
async function layouts() {
  const steps = [[20, 'private-card-schema.mjs', 'installPrivateCards'], [21, 'private-card-schema.mjs', 'installCardMemorySources'],
    [22, 'private-evidence-schema.mjs', 'installPrivateEvidence'], [23, 'private-organization-schema.mjs', 'installPrivateOrganization'],
    [24, 'raw-schema.mjs', 'installRawJournal'], [25, 'raw-schema.mjs', 'installRawCapture'],
    [26, 'raw-lineage-schema.mjs', 'installRawLineage'], [27, 'raw-deletion-schema.mjs', 'installRawDeletion'],
    [28, 'raw-source-schema.mjs', 'installRawSources']];
  const outcomes = [];
  for (const version of [18, 20, 21, 22, 23, 24, 25, 26, 27, 28]) {
    const path = join(scratch, 'layout-' + version + '.sqlite'), core = openMemoryCore({ path });
    try { ok(core.admit({ namespace, memory: { content: 'LEGACY_BODY_SENTINEL', kind: 'fact' },
      receipts: [{ client: 'synthetic', sessionId: 'legacy', eventId: 'source', role: 'user', excerpt: 'Synthetic legacy receipt.' }] })); }
    finally { core.close(); }
    const db = new DatabaseSync(path);
    try {
      for (const [value, file, method] of steps) if (value <= version) { (await load(file))[method](db); db.exec('PRAGMA user_version=' + value); }
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, version);
      for (const [table, first] of [['card_notes', 20], ['card_memory_bindings', 21], ['card_applicability_reviews', 22],
        ['card_mocs', 23], ['raw_conversations', 24], ['raw_capture_events', 25], ['raw_source_maps', 26], ['raw_deletion_actions', 27], ['card_raw_bindings', 28]]) {
        assert.equal(Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)), version >= first);
      }
    } finally { db.close(); }
    const before = bytes(path), reader = openMemoryReader({ path, ownerId: namespace.ownerId });
    try {
      const result = await reader.readTopicOverview({ namespace });
      if (version <= 23) { assert.equal(ok(result).totals.unique.total, 1); assert.doesNotMatch(JSON.stringify(result), /LEGACY_BODY_SENTINEL/); }
      else assert.deepEqual(result, { ok: false, error: { code: 'unsupported_database' } });
    } finally { await reader.close(); }
    assert.deepEqual(bytes(path), before); outcomes.push({ version, supported: version <= 23, unchanged: true });
  }
  // A missing path and malformed consumed schema also refuse from installed bytes.
  const missing = join(scratch, 'missing.sqlite'), reader = openMemoryReader({ path: missing, ownerId: namespace.ownerId });
  try { assert.equal((await reader.readTopicOverview({ namespace })).error.code, 'database_not_found'); }
  finally { await reader.close(); }
  assert.equal(fs.existsSync(missing), false);
  const malformed = join(scratch, 'malformed.sqlite');
  const core = openMemoryCore({ path: malformed, rawConversations: { mode: 'off', readPolicy: () => ({ generation: 'synthetic', reason: null }) } }); core.close();
  const db = new DatabaseSync(malformed); try { db.exec('DROP INDEX index_memory_keyset'); } finally { db.close(); }
  const before = bytes(malformed), invalid = openMemoryReader({ path: malformed, ownerId: namespace.ownerId });
  try { assert.equal((await invalid.readTopicOverview({ namespace })).error.code, 'unsupported_database'); }
  finally { await invalid.close(); }
  assert.deepEqual(bytes(malformed), before); return { outcomes, missingUncreated: true, malformedUnchanged: true };
}
async function raw() {
  const path = join(scratch, 'raw29.sqlite'), state = { name: 'a', calls: 0 };
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract() { state.calls++; return { items: [{ content: 'MEMORY_BODY_SENTINEL ' + state.name,
      kind: state.name === 'b' ? 'decision' : state.name === 'unfiled' ? 'preference' : 'fact', confidence: .8, sourceIndices: [0] }] }; },
    qualifyCandidates({ input }) { state.calls++; return { qualifications: input.items.map(item => ({ itemIndex: item.itemIndex,
      ...Object.fromEntries(['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'].map(field => [field,
        { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null, evidenceIndices: field === 'value' ? [item.candidates[0].candidateIndex] : [] }])) })) }; },
    classify({ input }) { state.calls++; return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }; } };
  const port = { version: 'raw-seal-v1', async sealRaw({ text }) { return { format: 'local-plain-v1', keyVersion: null, sealed: Buffer.from(text) }; },
    async openRaw({ sealed }) { return { text: Buffer.from(sealed).toString() }; } };
  const core = openMemoryCore({ path, model, captureQualification: 'source-bound-v2', captureQualifiedDuplicates: 'append-matching-evidence-v1',
    rawConversations: { mode: 'raw-v1', capBytes: 1000000, port, readPolicy: () => ({ generation: 'synthetic', reason: null }) } });
  const db = new DatabaseSync(path); let reader;
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 29);
    const memory = id => ok(core.get({ namespace, memoryId: id })).memory;
    async function capture(name, sessionId = name) {
      state.name = name; const text = 'RAW_BODY_SENTINEL RECEIPT_BODY_SENTINEL ' + sessionId;
      const saved = ok(await core.captureRaw({ namespace, client, sessionId, eventId: 'event-' + sessionId,
        messages: [{ id: 'message-' + sessionId, role: 'user', occurredAt: null, messageOrdinal: 1, content: text,
          part: { index: 0, start: 0, totalUnits: text.length, totalBytes: Buffer.byteLength(text) } }] }));
      const id = ok(saved.interpretation).admission.memories[0].id;
      assert.ok(db.prepare('SELECT 1 FROM raw_receipt_lineage l JOIN receipts r ON r.id=l.receipt_id WHERE r.memory_id=? AND l.conversation_id=?').get(id, saved.raw.conversationId));
      return { id, conversationId: saved.raw.conversationId };
    }
    function place(items) { return ok(core.applyPlacement({ namespace, expectedIndexRevision: db.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=?').get(namespace.ownerId).epoch,
      expectedMemoryRevisions: items.map(item => ({ memoryId: item.memoryId, revision: memory(item.memoryId).revision })), proposal: { items } })); }
    const a = await capture('a'), independent = await capture('a', 'independent'), b = await capture('b'), c = await capture('c'), unfiled = await capture('unfiled');
    assert.equal(a.id, independent.id); assert.notEqual(a.conversationId, independent.conversationId);
    assert.equal(db.prepare('SELECT count(*) n FROM memories').get().n, 4); assert.equal(db.prepare('SELECT count(*) n FROM receipts').get().n, 5);
    assert.equal(db.prepare('SELECT count(*) n FROM raw_receipt_lineage').get().n, 5);
    const first = place([{ memoryId: a.id, parentIds: [], newL1: { title: 'Installed topic A', parentL2Ids: [], newL2Title: 'Installed root' } }]);
    const root = first.createdMocs.find(moc => moc.level === 'L2'), topicA = first.createdMocs.find(moc => moc.level === 'L1');
    const topicB = place([{ memoryId: b.id, parentIds: [], newL1: { title: 'Installed topic B', parentL2Ids: [root.id] } }]).createdMocs[0];
    place([{ memoryId: c.id, parentIds: [topicA.id, topicB.id] }]);
    const calls = state.calls, before = bytes(path), started = workers.length;
    reader = openMemoryReader({ path, ownerId: namespace.ownerId }); assert.equal(workers.length, started, 'lazy Worker startup');
    const result = await collect(reader, { memberLimit: 10, nodeLimit: 1, workLimit: 16 });
    assert.equal(result.items.length, 3); assert.equal(result.totals.unique.total, 4); assert.equal(result.totals.unfiled.total, 1);
    assert.deepEqual(result.items.find(item => item.id === root.id).memberRefs,
      [a.id, b.id, c.id].sort().map(id => ({ memoryId: id, revision: memory(id).revision })));
    assert.equal(result.items.find(item => item.id === root.id).descendantCounts.total, 3);
    assert.doesNotMatch(JSON.stringify(result), /MEMORY_BODY_SENTINEL|RAW_BODY_SENTINEL|RECEIPT_BODY_SENTINEL/);
    assert.deepEqual(bytes(path), before); assert.equal(state.calls, calls);
    const input = { namespace, workLimit: 16, nodeLimit: 1 }, cursor = ok(await reader.readTopicOverview(input)).nextCursor; assert.ok(cursor);
    const corrected = ok(core.correct({ namespace, memoryId: b.id, expectedRevision: memory(b.id).revision,
      content: 'Installed explicit correction.', kind: 'decision', receipt: { client: 'manual', sessionId: 'correction', eventId: 'correction', role: 'user', excerpt: 'Synthetic explicit correction.' } })).memory;
    assert.equal((await reader.readTopicOverview({ ...input, cursor })).error.code, 'cursor_stale');
    assert.equal((await collect(reader)).items.find(item => item.id === topicB.id).title, null);
    ok(core.forget({ namespace, memoryId: c.id, expectedRevision: memory(c.id).revision }));
    assert.equal((await collect(reader)).totals.unique.total, 3);
    const view = ok(await core.getConversation({ namespace, conversationId: a.conversationId }));
    const deleted = ok(core.deleteConversation({ namespace, conversationId: a.conversationId, expectedRevision: view.conversation.revision, actionId: 'delete-original' }));
    assert.equal(deleted.retainedMemories, 1); assert.equal(ok(core.get({ namespace, memoryId: a.id })).receipts.length, 1);
    assert.equal(db.prepare('SELECT count(*) n FROM raw_parts WHERE conversation_id=?').get(a.conversationId).n, 0);
    const final = await collect(reader); assert.equal(final.totals.unique.total, 3);
    assert.equal(final.items.find(item => item.id === root.id).title, null); assert.equal(final.items.find(item => item.id === topicA.id).title, null);
    assert.equal(state.calls, calls); assert.ok(memory(unfiled.id)); assert.equal(corrected.id, b.id);
    await reader.close(); assert.equal((await reader.readTopicOverview({ namespace })).error.code, 'store_closed');
    return { client, publicCaptures: 5, memoriesBefore: 4, receiptsBefore: 5, lineageBefore: 5, finalMemories: 3,
      metadataModelCalls: 0, sourceDeleted: true, independentSupportSurvived: true, correctionThenSeparateForget: true, databaseUnchangedDuringRead: true };
  } finally { await reader?.close(); db.close(); core.close(); }
}
try {
  const result = mode === 'layouts' ? await layouts() : await raw();
  assert.ok(workers.length); assert.ok(workers.every(worker => worker.closed), 'awaited close terminated every actual Worker');
  console.log(JSON.stringify({ importedCore, mode, ...result, fixedWorkers: workers.length, workersClosed: true }));
} finally { workerThreads.Worker = NativeWorker; syncBuiltinESMExports(); }
