import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openMemoryCore, openMemoryStore } from '../index.mjs';
import { ns, ok, receipt, lineageHost, copySqliteFixture, quiescence } from '../testing/card-lineage-fixture.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { host as contextHost } from '../testing/context-read-core-fixture.mjs';
import { migrateCardLineage, migrateReceiptEventTime } from '../content-safety-migration.mjs';
import { receiptDenialTokens, receiptDeliverySnapshot, deliveryReceiptRows, receiptReadSafety, contentReadSafety } from '../content-safety.mjs';
import { readTransaction, transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { model as episodeModel, input as episodeInput } from '../testing/episode-capture-helpers.mjs';
import { options as episodeOptions } from '../testing/episode-helpers.mjs';
import { survivor, forgotten, message, ordinaryKinds, source, fixture, capture, act, noLeak, hasId,
  scripted, markers, memoryRef, trace } from '../testing/shared-source-fixture.mjs';

const error = (result, code) => assert.deepEqual(result, { ok: false, error: { code, retryable: false } });
const refs = memory => [{ memoryId: memory.id, revision: memory.revision }];

for (const contextMode of ['source-evidence', 'rationale-evidence'])
test(`${contextMode} recall resolves provenance only in its two fetched-source snapshots`, { timeout: 15000 }, async t => {
  const f = await correctionFixture(t, { base: 33, mode: 'safety' });
  for (let i = 0; i < 12; i++) ok(f.core.admit({ namespace: ns,
    memory: { content: 'Synthetic provenance reuse ' + i, kind: 'fact' }, receipts: [receipt('provenance-reuse-' + i)] }));
  f.model.select = ({ input }) => ({ refs: input.maps.flatMap(page => page.items.filter(item => item.type === 'unfiled')
    .map(item => ({ namespaceIndex: page.namespaceIndex, ...item.ref }))).slice(0, 6) });
  const measured = await trace(() => f.core.recall({ readSet: [ns], query: 'Synthetic', limit: 6, contextMode }));
  assert.equal(ok(measured.result).memories.length, 6);
  assert.equal(measured.result.value.coverage, 'complete');
  // Rationale retains the base's independent stored-source validation per root.
  const validationsPerMemory = contextMode === 'rationale-evidence' ? 4 : 2;
  const probePasses = contextMode === 'rationale-evidence' ? 14 : 2;
  for (const fragment of ['FROM raw_receipt_lineage l LEFT JOIN raw_conversations',
    'SELECT kind FROM raw_receipt_origins WHERE receipt_id=?',
    'SELECT 1 FROM episode_memory_links WHERE memory_id=? LIMIT 1']) {
    const rows = measured.rows.filter(row => row.sql.includes(fragment));
    assert.equal(rows.length, 6 * validationsPerMemory, fragment + ': no extra discovery validation');
    assert.equal(new Set(rows.map(row => row.snapshot)).size, 2, 'discovery reuses its canonical absence proof');
    const counts = new Map();
    for (const row of rows) counts.set(row.args[0], (counts.get(row.args[0]) ?? 0) + 1);
    assert.equal(counts.size, 6);
    assert.deepEqual([...counts.values()], Array(6).fill(validationsPerMemory));
  }
  for (const sql of ["SELECT 1 FROM sqlite_master WHERE name='raw_source_maps'",
    "SELECT 1 FROM sqlite_master WHERE name='raw_job_sources'",
    "SELECT 1 FROM sqlite_master WHERE name='raw_session_fences'"])
    assert.equal(measured.rows.filter(row => row.sql === sql).length, probePasses, sql);
  assert.equal(measured.rows.filter(row => row.sql.startsWith("SELECT name FROM sqlite_master WHERE type='table' AND name IN (")).length, probePasses);
  assert.equal(measured.rows.filter(row => row.sql.startsWith('SELECT 1 FROM raw_conversations WHERE')).length, probePasses);
  assert.equal(measured.rows.filter(row => row.sql === 'SELECT secret FROM episode_identity WHERE singleton=1').length, 2 * probePasses);
  assert.equal(measured.rows.filter(row => row.sql.startsWith('SELECT 1 FROM raw_session_fences WHERE')).length, 2 * probePasses);
});

test('a receipt denial survives a warm canonical absence proof', { timeout: 15000 }, async t => {
  const f = await correctionFixture(t, { base: 33, mode: 'safety' });
  const memory = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic denied provenance', kind: 'fact' },
    receipts: [receipt('denied-provenance')] })).memory;
  const stored = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(memory.id);
  transaction(f.db, () => writeContentSuppressionInside(f.db, { namespace: ns, kind: 'receipt', key: stored.id,
    reason: 'purge', actionId: 'synthetic-denied-provenance' }));
  readTransaction(f.db, () => {
    const memo = receiptDeliverySnapshot(f.db, [{ namespace: ns, memoryId: memory.id }]);
    const [row] = deliveryReceiptRows(f.db, ns, memory.id, memo, { idOrder: true });
    assert.equal(row.empty_raw_ancestry, 1);
    const options = { namespace: ns, receipt: row, memo, rawAncestryEmpty: true };
    assert.deepEqual(receiptReadSafety(f.db, options), { allowed: false, reason: 'purge' });
    assert.deepEqual(receiptReadSafety(f.db, options), { allowed: false, reason: 'purge' });
    assert.deepEqual(contentReadSafety(f.db, { namespace: ns, intent: 'history', memo,
      ref: { type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }, receipts: [stored] }),
    { allowed: false, reason: 'purge' });
  });
});

test('a write between warm source reads on the same core connection is observed', { timeout: 15000 }, async t => {
  const f = await fixture(t, 'ordinary-48'), [b, a] = await capture(f);
  for (const contextMode of ['source-evidence', 'rationale-evidence']) for (let repeat = 0; repeat < 2; repeat++)
    assert.equal(ok(f.core.fetch({ namespace: ns, refs: refs(b), contextMode })).items[0].receipts.length, 1);
  ok(act(f, 'forget', a));
  for (const contextMode of ['source-evidence', 'rationale-evidence']) {
    const result = f.core.fetch({ namespace: ns, refs: refs(b), contextMode });
    error(result, 'source_unavailable'); noLeak(result, 'post-write source read');
  }
});

for (const kind of ordinaryKinds) test(`ordinary shared capture refuses incomplete source evidence on ${kind}`, { timeout: 15000 }, async t => {
  const f = await fixture(t, kind), [b, a] = await capture(f);
  const denied = ok(f.core.get({ namespace: ns, memoryId: b.id })).receipts[0].id;
  if (f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='raw_conversations'").get())
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations').get().n, 0);
  ok(act(f, 'forget', a));
  f.model.countTokens = () => 1;
  const plain = ok(f.core.fetch({ namespace: ns, refs: refs(b) }));
  assert.equal(plain.items[0].memory.id, b.id);
  assert.deepEqual(plain.items[0].receipts, []);
  const values = [f.core.fetch({ namespace: ns, refs: refs(b), contextMode: 'source-evidence' }),
    f.core.sourceSnapshot({ readSet: [ns], limit: 12 }),
    await f.core.recall({ readSet: [ns], query: survivor, contextMode: 'source-evidence' }),
    await f.core.recall({ readSet: [ns], query: survivor, contextMode: 'rationale-evidence' })];
  for (const [index, value] of values.entries()) {
    if (index === 1) {
      assert.equal(value.ok, false);
      assert.equal(JSON.stringify(value).includes('complete-current-admitted'), false);
    } else error(value, 'source_unavailable');
    noLeak(value, 'unavailable source response');
    assert.equal(hasId(value, denied), false);
  }
});

test('empty qualified rank validates every fetched source and keeps clean complete coverage', { timeout: 15000 }, async t => {
  for (const corrupt of [false, true]) {
    const f = await fixture(t, 'fresh-default');
    const text = 'Synthetic qualified reading choice';
    const memory = ok(f.core.admit({ namespace: ns, memory: { content: text, kind: 'preference' },
      receipts: [receipt('synthetic-regression-qualification', text)], qualification: { version: 1,
        slot: { subject: 'Synthetic user', property: 'format', scope: null, applies: null },
        value: 'lists', attribution: 'direct', commitment: 'considered', anchors: [{ receiptIndex: 0,
          start: 0, end: text.length, text, fields: ['subject', 'property', 'value', 'attribution', 'commitment'] }] } })).memory;
    let ranked = false;
    f.model.countTokens = () => 1;
    f.model.rank = () => {
      ranked = true;
      if (corrupt) f.db.prepare("UPDATE receipts SET excerpt='Synthetic corrupt source' WHERE memory_id=?").run(memory.id);
      return { refs: [] };
    };
    const result = await f.core.recall({ readSet: [ns], query: text, includeQualification: true });
    assert.equal(ranked, true);
    if (corrupt) error(result, 'storage_error');
    else {
      const value = ok(result);
      assert.deepEqual(value.memories, []);
      assert.equal(value.coverage, 'complete');
    }
  }
});

test('legacy forgetting preserves shared withholding', { timeout: 15000 }, async t => {
  const f = await fixture(t, 'ordinary-53'), [b, a] = await capture(f);
  const denied = ok(f.core.get({ namespace: ns, memoryId: b.id })).receipts[0].id;
  const store = openMemoryStore({ path: f.path }); t.after(() => store.close());
  const scope = store.scope({ ownerId: ns.ownerId, projectId: ns.projectId });
  assert.equal(scope.forget(a.id, a.revision), true);
  for (const value of [scope.get(b.id), ok(f.core.get({ namespace: ns, memoryId: b.id }))]) {
    assert.equal(value.id ?? value.memory.id, b.id);
    assert.deepEqual(value.receipts, []);
    noLeak(value, 'legacy sibling');
    assert.equal(hasId(value, denied), false);
  }
});

test('Episode deletion forgets its purged Memory and removes shared wording from an independently supported sibling', { timeout: 15000 }, async t => {
  const f = await fixture(t, 'ordinary-53');
  const episode = openMemoryCore({ path: f.path, privateCards: f.host.options, ...episodeOptions,
    model: episodeModel({ extract: () => ({ items: [survivor, forgotten].map(content =>
      ({ content, kind: 'fact', confidence: .8, sourceIndices: [0] })) }) }) });
  t.after(() => episode.close());
  const captured = ok(await episode.capture(episodeInput(1, 'synthetic-session', { namespace: ns,
    messages: [{ id: 'synthetic-message', role: 'user', content: message }] })));
  const [b, a] = captured.admission.memories;
  const supported = ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' },
    receipts: [receipt('synthetic-regression-independent', 'Synthetic independent surviving support')] })).memory;
  assert.equal(supported.id, b.id);
  const denied = ok(f.core.get({ namespace: ns, memoryId: supported.id })).receipts.find(row => row.excerpt === message).id;
  const episodeId = captured.episode.id;
  const revision = f.db.prepare('SELECT revision FROM session_episodes WHERE id=?').get(episodeId).revision;
  assert.equal(ok(episode.forgetEpisode({ namespace: ns, episodeId, expectedRevision: revision })).forgotten, true);
  assert.equal(f.core.get({ namespace: ns, memoryId: a.id }).error?.code, 'memory_not_found');
  const value = ok(f.core.get({ namespace: ns, memoryId: b.id }));
  assert.equal(value.memory.content, survivor);
  assert.deepEqual(value.receipts.map(row => row.excerpt), ['Synthetic independent surviving support']);
  noLeak(value, 'Episode deletion sibling');
  assert.equal(hasId(value, denied), false);
});

// Cover each legacy cell, each suppression family, and the independently
// attested receipt-time/Card-lineage feature combinations.
const layouts = [18, 23, 33].flatMap(base => ['old', 'safety', 'event',
  ...(base === 18 ? [] : ['lineage', 'lineage-event'])].map(mode => ({ base, mode })));
const label = layout => `${layout.base}/${layout.mode}`;
async function correctionFixture(t, { base, mode }) {
  const f = safetyFixture(t, base);
  if (mode === 'safety') await f.migrate();
  if (mode === 'event' || mode === 'lineage-event') {
    copySqliteFixture(f.path, f.backupPath);
    await migrateReceiptEventTime({ path: f.path, backupPath: f.backupPath,
      expected: { storeId: f.storeId, base }, quiescence });
  }
  if (mode === 'lineage' || mode === 'lineage-event') {
    const before = f.connect();
    const domain = mode === 'lineage-event' ? before.prepare('SELECT suppression_domain FROM content_safety_control').get().suppression_domain : undefined;
    before.close();
    copySqliteFixture(f.path, f.backupPath);
    await migrateCardLineage({ path: f.path, backupPath: f.backupPath,
      expected: { storeId: f.storeId, base, ...(domain ? { suppressionDomain: domain } : {}) }, quiescence });
  }
  const host = base === 18 ? null : lineageHost(), trusted = contextHost(), model = scripted('forget');
  model.countTokens = () => 1;
  const config = { path: f.path, model, decisionReview: 'required-v1', ...(host ? { privateCards: host.options } : {}) };
  const core = openMemoryCore(config), db = f.connect(), store = openMemoryStore({ path: f.path });
  const context = openMemoryCore({ ...config, contextRead: { version: 'context-read-v1', authority: trusted.authority,
    counter: { id: 'synthetic', countTokens: () => 1 } } });
  t.after(() => { context.close(); store.close(); db.close(); core.close(); });
  return { ...f, core, db, context, trusted, host, model, config,
    call: host && ((method, input) => host.call(core, method, input)),
    scope: store.scope({ ownerId: ns.ownerId, projectId: ns.projectId }) };
}
const obsolete = 'Synthetic obsolete interpretation';
const corrected = 'Synthetic current interpretation';
const newExcerpt = 'Synthetic current receipt support';
function absent(values, denied) {
  for (const [name, value] of Object.entries(values)) for (const text of denied)
    assert.equal(JSON.stringify(value).includes(text), false, name + ' withholds ' + text);
}
async function currentReads(f, memory) {
  const input = { namespace: ns, refs: refs(memory) };
  const values = {
    get: ok(f.core.get({ namespace: ns, memoryId: memory.id })),
    fetch: ok(f.core.fetch(input)), sourceFetch: ok(f.core.fetch({ ...input, contextMode: 'source-evidence' })),
    recall: ok(await f.core.recall({ readSet: [ns], query: 'Synthetic', limit: 8 })),
    sourceRecall: ok(await f.core.recall({ readSet: [ns], query: 'Synthetic', limit: 8, contextMode: 'source-evidence' })),
    rationaleRecall: ok(await f.core.recall({ readSet: [ns], query: 'Synthetic', limit: 8, contextMode: 'rationale-evidence' })),
    snapshot: ok(f.core.sourceSnapshot({ readSet: [ns], limit: 12 })),
    list: ok(f.core.list({ namespace: ns, limit: 20 })), map: ok(f.core.map({ namespace: ns, purpose: 'recall' })),
    legacyGet: f.scope.get(memory.id), legacyList: f.scope.list(), legacySearch: f.scope.search('Synthetic'),
    contextEvidence: ok(await f.trusted.call(f.context, 'fetchCandidateEvidence',
      { readSet: [ns], intent: 'current', refs: [memoryRef(memory)] })),
    contextRead: ok(await f.trusted.call(f.context, 'contextRead', { readSet: [ns], types: ['memory'], intent: 'current',
      query: 'Synthetic', semantic: false, deadlineMs: 5000, budget: { maxItems: 12, maxTokens: 3000 } })),
    session: ok(f.core.sessionStartContext({ namespace: ns, groups: { nextSteps: true, procedural: false, background: true },
      maxTokens: 2000, maxChars: 8000 })),
  };
  for (const name of ['get', 'fetch', 'sourceFetch', 'recall', 'sourceRecall', 'rationaleRecall', 'snapshot',
    'legacyGet', 'contextEvidence', 'contextRead', 'session']) assert.ok(hasId(values[name], memory.id), name + ' includes current Memory');
  if (f.call) {
    values.cardEvidence = ok(await f.call('fetchEvidence', { intent: 'current', refs: [memoryRef(memory)] }));
    values.cardSelection = ok(await f.call('selectEvidence', { intent: 'current', query: 'Synthetic', types: ['memory'], limit: 24 }));
    values.cardSources = await Promise.all(values.cardEvidence.items[0].provenance.sources.map(source =>
      Promise.resolve(f.call('getSource', { source })).then(ok)));
  }
  return values;
}

// The unedited compatibility worker fixes clock/identities and hashes the
// complete result, receipts, schema and database rows against the base captures.
for (const mode of ['old', 'safety', 'event']) test(`identical recites match complete frozen base results and databases: ${mode}`,
  { timeout: 180000 }, t => {
    const workspace = createTestWorkspace(t, { prefix: 'shared-source-recite-parity-' });
    const report = join(workspace.path, 'result.json');
    const worker = fileURLToPath(new URL('./fixtures/receipt-event-time-main-worker.mjs', import.meta.url));
    const child = spawnSync(process.execPath, [worker, fileURLToPath(new URL('../../', import.meta.url)),
      workspace.path, report, mode, '-', 'receipts'], { encoding: 'utf8', timeout: 170000 });
    assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr);
    const actual = JSON.parse(readFileSync(report, 'utf8'));
    const expected = JSON.parse(readFileSync(new URL('./fixtures/receipt-event-time-main' +
      (mode === 'old' ? '' : '-' + mode) + '.json', import.meta.url), 'utf8'));
    for (const base of [18, 23, 33]) for (const api of ['correct', 'legacyCorrect'])
      assert.deepEqual(actual.writes[`${base}:${api}`], expected.writes[`${base}:${api}`], `${base}:${api}`);
  });

for (const layout of layouts) for (const correction of ['identical', 'same-address']) for (const api of ['core', 'legacy'])
test(`${correction} correction delivers current receipts on every read path: ${label(layout)}, ${api}`, { timeout: 15000 }, async t => {
  const f = await correctionFixture(t, layout);
  // An unlinked Episode already records the new receipt's source. It keeps
  // its own interpretation while correction retires only the Memory revision.
  const port = episodeModel({ extract: () => ({ items: [] }), interpretEpisode: request => {
    const field = value => ({ value, anchors: [{ sourceIndex: 0, start: 0, end: request.input.sources[0].text.length }] });
    return { type: field('work'), language: 'en', gist: field('Synthetic source activity'), outcome: null,
      nextStep: field('Synthetic next action'), disposition: null };
  } });
  const episode = openMemoryCore({ ...f.config, ...episodeOptions, model: port }); t.after(() => episode.close());
  const captured = ok(await episode.capture(episodeInput(1, 'synthetic-recite-session', { namespace: ns,
    messages: [{ id: 'synthetic-recite-message', role: 'user', content: newExcerpt }] })));
  const episodeId = captured.episode.id;
  const session = f.db.prepare('SELECT session_key FROM session_episodes WHERE id=?').get(episodeId).session_key;
  const replacement = { client: 'synthetic', sessionId: session, eventId: 'synthetic-recite-message', role: 'user', excerpt: newExcerpt };
  const previous = { ...replacement, excerpt: correction === 'identical' ? newExcerpt : 'Synthetic previous receipt support' };
  const a = ok(f.core.admit({ namespace: ns, memory: { content: obsolete, kind: 'fact' }, receipts: [previous] })).memory;
  const siblingReceipt = correction === 'identical' ? previous : { ...previous, excerpt: 'Synthetic alternate receipt support' };
  const b = ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' }, receipts: [siblingReceipt] })).memory;
  const oldReceipt = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(a.id);
  const siblingId = ok(f.core.get({ namespace: ns, memoryId: b.id })).receipts[0].id;
  const acknowledgement = api === 'core' ? ok(f.core.correct({ namespace: ns, memoryId: a.id, expectedRevision: a.revision,
    content: corrected, kind: 'fact', receipt: replacement })) : f.scope.correct(a.id, { content: corrected, kind: 'fact', receipt: replacement }, a.revision);
  const current = ok(f.core.get({ namespace: ns, memoryId: a.id }));
  assert.equal(current.memory.revision, a.revision + 1); assert.equal(current.memory.content, corrected);
  assert.deepEqual(current.receipts.map(row => row.excerpt), [newExcerpt]);
  assert.notEqual(current.receipts[0].id, oldReceipt.id, 're-cite replaces the receipt incarnation');
  assert.deepEqual(markers(f), correction === 'identical' ? [] : [receiptDenialTokens([oldReceipt])[0]]);
  const sibling = ok(f.core.get({ namespace: ns, memoryId: b.id }));
  assert.deepEqual(sibling.receipts.map(row => row.id), [siblingId], 'the specified sibling consequence remains visible');
  const values = await currentReads(f, current.memory);
  for (const name of ['get', 'fetch', 'sourceFetch', 'recall', 'sourceRecall', 'rationaleRecall', 'snapshot',
    'legacyGet', 'contextRead', 'session', ...(f.call ? ['cardSources'] : [])])
    assert.ok(JSON.stringify(values[name]).includes(newExcerpt), name + ' delivers the new receipt');
  // Candidate evidence returns source references, not excerpt text: the new receipt is its only source.
  const newReceiptId = values.get.receipts.find(row => row.excerpt === newExcerpt).id;
  const provenance = values.contextEvidence.items[0].provenance;
  assert.deepEqual(provenance.sources.map(source => source.receiptId), [newReceiptId], 'contextEvidence delivers the new receipt');
  assert.deepEqual(provenance.coverage, { status: 'complete', included: 1, omitted: 0 });
  values.episode = ok(f.core.getEpisode({ namespace: ns, episodeId, sourceLimit: 16, memoryLimit: 50 }));
  assert.deepEqual(values.episode.sources.items.map(row => row.text), [newExcerpt]);
  assert.ok(values.session.groups.nextSteps.items.some(item => item.episodeId === episodeId), 'session keeps the independent Episode source');
  values.acknowledgement = acknowledgement;
  values.staleFetch = f.core.fetch({ namespace: ns, refs: refs(a) });
  if (f.call) values.staleCard = await f.call('fetchEvidence', { intent: 'current', refs: [memoryRef(a)] });
  absent(values, [obsolete, oldReceipt.id]);
});

for (const layout of layouts) test(`different-address correction withholds a sibling's different excerpt: ${label(layout)}`,
  { timeout: 15000 }, async t => {
    const f = await correctionFixture(t, layout);
    const a = ok(f.core.admit({ namespace: ns, memory: { content: obsolete, kind: 'fact' }, receipts: [source('Synthetic original receipt')] })).memory;
    const b = ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' }, receipts: [source('Synthetic alternate receipt')] })).memory;
    const old = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(a.id);
    const denied = ok(f.core.get({ namespace: ns, memoryId: b.id })).receipts[0].id;
    ok(f.core.correct({ namespace: ns, memoryId: a.id, expectedRevision: a.revision, content: corrected, kind: 'fact',
      receipt: receipt('synthetic-other-address', newExcerpt) }));
    assert.deepEqual(markers(f), receiptDenialTokens([old]).sort());
    const value = ok(f.core.get({ namespace: ns, memoryId: b.id }));
    assert.deepEqual(value.receipts, []); absent({ value }, ['Synthetic alternate receipt', denied]);
  });

for (const layout of layouts.filter(layout => layout.mode !== 'old')) for (const correction of ['identical', 'same-address'])
test(`prior forget denials survive ${correction} correction: ${label(layout)}`, { timeout: 15000 }, async t => {
  const f = await correctionFixture(t, layout);
  const episode = openMemoryCore({ ...f.config, ...episodeOptions, model: episodeModel({ extract: () => ({ items: [] }) }) });
  t.after(() => episode.close());
  const captured = ok(await episode.capture(episodeInput(1, 'synthetic-prior-forget', { namespace: ns,
    messages: [{ id: 'synthetic-prior-forget-message', role: 'user', content: 'Synthetic erased source wording' }] })));
  const episodeId = captured.episode.id;
  const session = f.db.prepare('SELECT session_key FROM session_episodes WHERE id=?').get(episodeId).session_key;
  const shared = { ...source('Synthetic erased source wording'), sessionId: session, eventId: 'synthetic-prior-forget-message' };
  assert.ok(JSON.stringify(ok(f.core.getEpisode({ namespace: ns, episodeId }))).includes(shared.excerpt));
  const a = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic erased interpretation', kind: 'fact' }, receipts: [shared] })).memory;
  const b = ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' }, receipts: [shared] })).memory;
  const denied = f.db.prepare('SELECT id FROM receipts WHERE memory_id IN (?,?)').all(a.id, b.id).map(row => row.id);
  ok(f.core.forget({ namespace: ns, memoryId: a.id, expectedRevision: a.revision }));
  const before = markers(f);
  const acknowledgement = ok(f.core.correct({ namespace: ns, memoryId: b.id, expectedRevision: b.revision, content: corrected, kind: 'fact',
    receipt: correction === 'identical' ? shared : { ...shared, excerpt: newExcerpt } }));
  const current = acknowledgement.memory;
  assert.deepEqual(markers(f), before, 'correction never removes a prior forget marker');
  const values = {
    acknowledgement,
    get: ok(f.core.get({ namespace: ns, memoryId: current.id })),
    fetch: ok(f.core.fetch({ namespace: ns, refs: refs(current) })),
    recall: ok(await f.core.recall({ readSet: [ns], query: 'Synthetic' })),
    legacy: f.scope.get(current.id), legacyList: f.scope.list(), legacySearch: f.scope.search('Synthetic'),
    list: f.core.list({ namespace: ns }), map: f.core.map({ namespace: ns }),
    source: f.core.fetch({ namespace: ns, refs: refs(current), contextMode: 'source-evidence' }),
    sourceRecall: await f.core.recall({ readSet: [ns], query: 'Synthetic', contextMode: 'source-evidence' }),
    rationaleRecall: await f.core.recall({ readSet: [ns], query: 'Synthetic', contextMode: 'rationale-evidence' }),
    snapshot: f.core.sourceSnapshot({ readSet: [ns], limit: 12 }),
    context: ok(await f.trusted.call(f.context, 'contextRead', { readSet: [ns], types: ['memory'], intent: 'current',
      query: 'Synthetic', semantic: false, deadlineMs: 5000, budget: { maxItems: 12, maxTokens: 3000 } })),
    evidence: ok(await f.trusted.call(f.context, 'fetchCandidateEvidence', { readSet: [ns], intent: 'current', refs: [memoryRef(current)] })),
    episode: f.core.getEpisode({ namespace: ns, episodeId }),
    session: f.core.sessionStartContext({ namespace: ns, groups: { background: true } }),
  };
  assert.deepEqual(values.get.receipts, []); assert.deepEqual(values.legacy.receipts, []);
  if (f.call) values.card = ok(await f.call('fetchEvidence', { intent: 'current', refs: [memoryRef(current)] }));
  absent(values, ['Synthetic erased source wording', 'Synthetic erased interpretation', ...denied]);
});

for (const operation of ['forget', 'reject']) test(`${operation} denies both receipt identity and same-message address`,
  { timeout: 15000 }, async t => {
    const f = await fixture(t, 'ordinary-53', operation), [b, a] = await capture(f);
    const c = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic alternate sibling', kind: 'fact' },
      receipts: [source('Synthetic different excerpt')] })).memory;
    const old = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(a.id);
    const denied = f.db.prepare('SELECT id FROM receipts WHERE memory_id IN (?,?)').all(b.id, c.id).map(row => row.id);
    ok(act(f, operation, a)); assert.deepEqual(markers(f), receiptDenialTokens([old]).sort());
    for (const memory of [b, c]) {
      const value = ok(f.core.get({ namespace: ns, memoryId: memory.id }));
      assert.deepEqual(value.receipts, []); absent({ value }, [forgotten, 'Synthetic different excerpt', ...denied]);
    }
  });

// Compare every table, including metadata, journals, reservations, suppression
// facts and Episode effects, so a failed commit cannot leave a partial write.
function databaseState(db) {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  return names.map(({ name }) => [name, db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all()
    .map(row => JSON.stringify(row)).sort()]);
}
for (const layout of [{ base: 33, mode: 'safety' }, { base: 33, mode: 'lineage' }])
for (const method of ['forget', 'correct', 'forgetEpisode']) for (const forgery of ['marker', 'fingerprint',
  ...(method === 'correct' ? ['identical-identity', 'identical-address', 'same-address'] : [])])
test(`commit rejects ${forgery} during ${method}: ${label(layout)}`, { timeout: 15000 }, async t => {
  const f = await correctionFixture(t, layout);
  let a, episodeId;
  if (method === 'forgetEpisode') {
    const episode = openMemoryCore({ ...f.config, ...episodeOptions,
      model: episodeModel({ extract: () => ({ items: [{ content: obsolete, kind: 'fact', confidence: .8, sourceIndices: [0] }] }) }) });
    t.after(() => episode.close());
    const captured = ok(await episode.capture(episodeInput(1, 'synthetic-forged-episode', { namespace: ns })));
    [a] = captured.admission.memories; episodeId = captured.episode.id;
  } else a = ok(f.core.admit({ namespace: ns, memory: { content: obsolete, kind: 'fact' }, receipts: [source(newExcerpt)] })).memory;
  const old = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(a.id);
  const before = databaseState(f.db);
  let injected = false;
  const result = await trace(() => {
    if (method === 'forgetEpisode') return f.core.forgetEpisode({ namespace: ns, episodeId,
      expectedRevision: f.db.prepare('SELECT revision FROM session_episodes WHERE id=?').get(episodeId).revision });
    if (method === 'forget') return f.core.forget({ namespace: ns, memoryId: a.id, expectedRevision: a.revision });
    return f.core.correct({ namespace: ns, memoryId: a.id, expectedRevision: a.revision, content: corrected, kind: 'fact',
      receipt: forgery === 'same-address' ? source('Synthetic changed excerpt') : source(newExcerpt) });
  }, (sql, args, writer) => {
    if (injected || !sql.startsWith('UPDATE memories SET content') || args.at(-1) !== a.id) return;
    injected = true;
    const token = forgery === 'fingerprint' ? 'f'.repeat(64) : forgery === 'marker' ? 'rs1:i:' + '0'.repeat(64)
      : receiptDenialTokens([old])[forgery === 'identical-identity' ? 0 : 1];
    writer.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId, ns.scope, ns.projectId, token);
  });
  assert.equal(injected, true); error(result.result, 'evidence_unavailable');
  assert.deepEqual(databaseState(f.db), before, 'every persisted row is unchanged after the failed commit');
});
