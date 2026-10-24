import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { sourcesFixture, publicMocCorpus, ns, ok, memoryRef } from '../testing/context-read-sources-fixture.mjs';
import { rankMoc } from '../context-read-moc.mjs';
import { instrumentSourceWork } from '../../tools/testing/context-read-source-work.mjs';
import { STORAGE_BUSY_TIMEOUT_MS, readTransaction } from '../database.mjs';

// Independent oracle: these token arrays are hand-authored T1 goldens, and all
// BM25 / maximum-over-topics / RRF arithmetic below is separate from production.
const key = ref => JSON.stringify([ref.namespace.ownerId, ref.namespace.scope, ref.namespace.projectId ?? '', ref.type, ref.memoryId ?? ref.cardId]);
const compare = (a, b) => {
  const x = JSON.parse(key(a)), y = JSON.parse(key(b));
  for (let i = 0; i < x.length; i++) { const c = Buffer.compare(Buffer.from(x[i]), Buffer.from(y[i])); if (c) return c; }
  return 0;
};
function titleOracle(documents, query) {
  const N = documents.length, average = documents.reduce((n, d) => n + d.terms.length, 0) / N;
  const df = new Map(query.map(term => [term, documents.filter(d => d.terms.includes(term)).length])), members = new Map();
  for (const document of documents) {
    let score = 0;
    for (const term of new Set(query)) {
      const frequency = document.terms.filter(t => t === term).length;
      if (frequency) score += Math.log(1 + (N - df.get(term) + 0.5) / (df.get(term) + 0.5)) * frequency * 2.2 /
        (frequency + 1.2 * (0.25 + 0.75 * document.terms.length / average));
    }
    if (!score) continue;
    for (const ref of document.members) if (!members.has(key(ref)) || members.get(key(ref)).score < score) members.set(key(ref), { ref, score });
  }
  return [...members.values()].sort((a, b) => b.score - a.score || compare(a.ref, b.ref)).slice(0, 12);
}
function fusionOracle(lexical, semantic, moc) {
  const result = new Map();
  for (const [rows, weight] of [[lexical, 0.45], [semantic, 0.45], [moc, 0.10]]) for (const [index, ref] of rows.slice(0, 12).entries()) {
    const id = key(ref), row = result.get(id) ?? { ref, score: 0 }; row.score += weight / (60 + index + 1); result.set(id, row);
  }
  return [...result.values()].sort((a, b) => b.score - a.score || compare(a.ref, b.ref)).slice(0, 24);
}
test('C05 independent full-title corpus BM25/max-member/RRF oracle, zero channels and no renormalization', async t => {
  let embeddingCalls = 0;
  const f = sourcesFixture(t, { cards: true, sources: ['moc-v1'], embedder: { id: 'synthetic-equal', revision: '1', dimensions: 2, normalization: 'l2',
    async embed(texts) { embeddingCalls++; return texts.map(() => [1, 0]); } }, selectedPolicy: { family: 'hosted', maxRequests: 100, maxUsd: 1, estimateUsd: () => 0 } });
  const a = f.topic(f.admit('alpha endpoint'), 'ＡＰＰＬＥ apple tea', 'Apple orchard');
  const b = f.topic(f.admit('beta endpoint'), 'apple 漢字');
  const c = f.topic(f.admit('gamma endpoint'), 'nonmatching title');
  const ca = f.card('delta endpoint'); f.cardTopic(ca, 'apple card');
  const direct = f.admit('apple unfiled'), omittedCard = f.card('apple omitted card', { title: 'Other' });
  const ar = memoryRef(a.memories[0]), br = memoryRef(b.memories[0]);
  // Two memberships must use max, never add a second topic contribution.
  const index = ok(f.context.map({ namespace: ns, purpose: 'classification' })).indexRevision;
  ok(f.context.applyPlacement({ namespace: ns, expectedIndexRevision: index,
    expectedMemoryRevisions: [{ memoryId: ar.memoryId, revision: ar.revision }],
    proposal: { items: [{ memoryId: ar.memoryId, parentIds: [a.createdMocs.find(m => m.level === 'L1').id, b.createdMocs[0].id] }] } }));
  const documents = [{ terms: ['apple', 'apple', 'tea'], members: [ar] }, { terms: ['apple', 'orchard'], members: [ar] },
    { terms: ['apple', '漢字'], members: [ar, br] }, { terms: ['nonmatching', 'title'], members: [memoryRef(c.memories[0])] },
    { terms: ['apple', 'card'], members: [ca] }];
  const expectedMoc = titleOracle(documents, ['apple']);
  // Warm lexical and vectors explicitly. No optional source makes a model call.
  ok(await f.call('refreshContextIndex', { readSet: [ns], types: ['memory', 'card'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } }));
  const calls = embeddingCalls;
  const lexical = ok(await f.find({ query: 'apple', types: ['memory', 'card'], sources: [] }));
  assert.equal(embeddingCalls, calls);
  const lexicalRefs = lexical.items.map(i => i.ref);
  assert.ok(lexicalRefs.some(r => r.memoryId === direct.id)); assert.ok(lexicalRefs.some(r => r.cardId === omittedCard.cardId));
  assert.ok(lexical.items.every(i => i.channels.moc === null && i.fusionScore === 0.45 / (60 + i.channels.lexical.rank)));
  for (const semantic of [false, true]) {
    const value = ok(await f.find({ query: 'apple', types: ['memory', 'card'], semantic }));
    const allRefs = [ar, br, memoryRef(c.memories[0]), ca, memoryRef(direct), omittedCard].sort(compare);
    const expected = fusionOracle(lexicalRefs, semantic ? allRefs : [], expectedMoc.map(r => r.ref));
    assert.deepEqual(value.items.map(i => i.ref), expected.map(i => i.ref));
    for (let i = 0; i < expected.length; i++) assert.ok(Math.abs(value.items[i].fusionScore - expected[i].score) < 1e-15);
    for (const row of expectedMoc) {
      const found = value.items.find(i => key(i.ref) === key(row.ref)); assert.ok(Math.abs(found.channels.moc.rawScore - row.score) < 1e-15);
    }
    assert.equal(value.trace.sources['moc-v1'].topicsMatched, 4); assert.equal(value.trace.sources['moc-v1'].membersRanked, 3);
  }
  assert.equal(embeddingCalls, calls + 1);
  const cjk = ok(await f.find({ query: '漢字', types: ['memory', 'card'] }));
  const expectedCjk = titleOracle(documents, ['漢字']); assert.equal(cjk.items.length, 2);
  for (const row of expectedCjk) assert.ok(Math.abs(cjk.items.find(i => key(i.ref) === key(row.ref)).channels.moc.rawScore - row.score) < 1e-15);
});
test('C05 all original title bindings and isolated projection omission', async t => {
  const f = sourcesFixture(t, { sources: ['moc-v1'] });
  const one = f.admit('First topic contributor'), two = f.admit('Second topic contributor');
  const result = ok(f.context.applyPlacement({ namespace: ns, expectedIndexRevision: ok(f.context.map({ namespace: ns, purpose: 'classification' })).indexRevision,
    expectedMemoryRevisions: [one, two].map(m => ({ memoryId: m.id, revision: m.revision })), proposal: { items: [one, two].map(m => ({ memoryId: m.id, parentIds: [],
      newL1: { title: 'titlequery', parentL2Ids: [], newL2Title: 'rootquery' } })) } }));
  assert.equal(ok(await f.find({ query: 'titlequery' })).items.length, 2);
  const published = ok(f.context.rebuildIndex({ namespace: ns, expectedIndexRevision: result.indexRevision, limit: 500 }));
  assert.equal(published.state, 'published');
  const writer = new DatabaseSync(f.path, { timeout: STORAGE_BUSY_TIMEOUT_MS }); t.after(() => writer.close());
  // Out-of-band omission probes start from public-operation-authored fixtures.
  const generation = writer.prepare('SELECT active_generation FROM namespace_index_state').get().active_generation;
  writer.prepare('DELETE FROM index_title_sources WHERE generation=? AND memory_id=?').run(generation, two.id);
  assert.equal(ok(await f.find({ query: 'titlequery' })).items.length, 0, 'a surviving binding must not validate an omitted original');
  const current = ok(f.context.get({ namespace: ns, memoryId: one.id })).memory;
  ok(f.context.correct({ namespace: ns, memoryId: one.id, expectedRevision: current.revision, content: 'A corrected contributor', kind: 'fact',
    receipt: { client: 'synthetic', sessionId: 'changed', eventId: 'changed', role: 'user', excerpt: 'Changed contributor' } }));
  assert.equal(ok(await f.find({ query: 'titlequery' })).items.length, 0);
});

test('C05 Card titles keep organization support semantics; members additionally require current applicability', async t => {
  const f = sourcesFixture(t, { cards: true, sources: ['moc-v1'] });
  const original = f.card('Historical title contributor');
  const detail = ok(f.host.call(f.core, 'getCard', { namespace: ns, cardId: original.cardId })).card;
  const edited = ok(f.host.call(f.core, 'editKnowledgeCard', { namespace: ns, actionId: 'historical-title-source', cardId: original.cardId, expectedRevision: original.revision,
    title: detail.title, body: detail.body, bindings: detail.bindings.map(b => b.source), applicability: 'historical' }));
  const titleSource = { ...original, revision: edited.revision, bodyRevision: edited.bodyRevision };
  const topic = f.cardTopic(titleSource, 'needle supported title');
  const current = f.card('Currently applicable member');
  ok(f.host.call(f.core, 'applyCardPlacement', { namespace: ns, actionId: 'attach-current-member', refs: [current], expectedIndexRevision:
    ok(f.host.call(f.core, 'mapEvidence', { namespace: ns, type: 'card' })).indexRevision,
    proposal: { items: [{ cardId: current.cardId, parentIds: [topic.createdMocRefs[0].mocId] }] } }));
  const value = ok(await f.find({ types: ['card'] })); assert.deepEqual(value.items.map(i => i.ref), [current]);
  assert.equal(value.trace.sources['moc-v1'].topicsMatched, 1);
});
test('C05 unavailable optional Card organization storage degrades MOC; lexical RRF continues', async t => {
  const { stripOrganizationFixture } = await import('../testing/private-organization-fixture.mjs');
  const { openContextReader } = await import('../index.mjs');
  const f = sourcesFixture(t, { cards: true, sources: ['moc-v1'] }); const card = f.card('needle direct card');
  ok(await f.find({ types: ['card'] }));
  const writer = new DatabaseSync(f.path, { timeout: STORAGE_BUSY_TIMEOUT_MS });
  stripOrganizationFixture(writer); writer.exec('PRAGMA user_version=22'); writer.close();
  const reader = openContextReader({ path: f.path, contextRead: { ...f.config, sources: ['moc-v1'] } }); t.after(() => reader.close());
  const value = ok(await f.trusted.call(reader, 'findCandidates', { readSet: [ns], query: 'needle', types: ['card'], intent: 'current' }));
  assert.deepEqual(value.items.map(i => i.ref), [card]); assert.equal(value.items[0].fusionScore, 0.45 / 61);
  assert.deepEqual(value.trace.sources['moc-v1'].reasons, ['unsupported_schema']);
});

test('C05 degraded semantic coverage contributes zero under the MOC preset without renormalization or dispatch', async t => {
  let calls = 0;
  const f = sourcesFixture(t, { sources: ['moc-v1'], embedder: { id: 'synthetic-unbuilt', revision: '1', dimensions: 2, normalization: 'l2',
    async embed(texts) { calls++; return texts.map(() => [1, 0]); } }, selectedPolicy: { family: 'local', maxRequests: 100, maxUsd: 1, estimateUsd: () => 0 } });
  f.admit('needle directly searchable'); f.topic(f.admit('A filed member'), 'needle title');
  const disabled = ok(await f.find()), degraded = ok(await f.find({ semantic: true }));
  assert.deepEqual(degraded.items, disabled.items); assert.equal(degraded.channels.semantic.state, 'partial_coverage'); assert.equal(calls, 0);
  assert.ok(degraded.items.every(i => i.channels.semantic === null));
});

test('C05 Card titles enforce the existing five-source validity bound on every original binding', async t => {
  const f = sourcesFixture(t, { cards: true, sources: ['moc-v1'] });
  const cards = Array.from({ length: 6 }, (_, i) => f.card('Title contributor ' + i));
  const topic = f.cardTopic(cards[0], 'needle oversized title');
  const writer = new DatabaseSync(f.path, { timeout: STORAGE_BUSY_TIMEOUT_MS }); t.after(() => writer.close());
  // Public-authored evidence plus a deliberate out-of-band over-limit title.
  for (const card of cards.slice(1)) writer.prepare('INSERT INTO card_moc_title_sources VALUES(?,?,?,?)').run(topic.createdMocRefs[0].mocId, card.cardId, card.revision, card.bodyRevision);
  const value = ok(await f.find({ types: ['card'] })); assert.equal(value.items.length, 0); assert.equal(value.trace.sources['moc-v1'].topicsMatched, 0);
});

test('C05 a failed query embedding contributes zero and reports zero semantic scan under MOC RRF', async t => {
  let failQuery = false;
  const f = sourcesFixture(t, { sources: ['moc-v1'], embedder: { id: 'synthetic-query-error', revision: '1', dimensions: 2, normalization: 'l2',
    async embed(texts) { if (failQuery) throw Error('private synthetic provider body'); return texts.map(() => [1, 0]); } },
    selectedPolicy: { family: 'local', maxRequests: 100, maxUsd: 1, estimateUsd: () => 0 } });
  f.admit('needle directly searchable'); f.topic(f.admit('A filed member'), 'needle topic');
  ok(await f.call('refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } }));
  const control = ok(await f.find()); failQuery = true;
  const value = ok(await f.find({ semantic: true })); assert.deepEqual(value.items, control.items);
  assert.equal(value.channels.semantic.state, 'provider_error'); assert.equal(value.coverage.byType.memory.embedded, 2);
  assert.equal(value.coverage.byType.memory.scanned, 0); assert.equal(value.coverage.depths.semantic, 0); assert.equal(value.coverage.omitted.semantic, null);
  assert.equal(JSON.stringify(value).includes('private synthetic provider body'), false);
});

for (const type of ['memory', 'card']) test(`C05 isolated stale ${type} member and containment revisions never rank`, async t => {
  const f = sourcesFixture(t, { cards: true, sources: ['moc-v1'] });
  const placed = type === 'memory' ? f.topic(f.admit('Isolated member body'), 'childquery', 'rootquery') :
    f.cardTopic(f.card('Isolated card body'), 'childquery', 'rootquery');
  const memberTable = type === 'memory' ? 'moc_memory_refs' : 'card_moc_refs', edgeTable = type === 'memory' ? 'moc_edges' : 'card_moc_edges';
  const writer = new DatabaseSync(f.path, { timeout: STORAGE_BUSY_TIMEOUT_MS }); t.after(() => writer.close());
  const member = writer.prepare(`SELECT * FROM ${memberTable}`).get(), edge = writer.prepare(`SELECT * FROM ${edgeTable}`).get();
  assert.ok(placed); assert.ok(member); assert.ok(edge);
  for (const [table, original, field, query] of [
    [memberTable, member, type === 'memory' ? 'memory_revision' : 'card_revision', 'childquery'],
    [memberTable, member, 'moc_revision', 'childquery'],
    ...(type === 'card' ? [[memberTable, member, 'body_revision', 'childquery']] : []),
    [edgeTable, edge, 'parent_revision', 'rootquery'], [edgeTable, edge, 'child_revision', 'rootquery'],
  ]) {
    assert.equal(ok(await f.find({ query, types: [type] })).items.length, 1, 'baseline before ' + field);
    writer.prepare(`UPDATE ${table} SET ${field}=?`).run(original[field] + 1);
    const value = ok(await f.find({ query, types: [type] }));
    assert.equal(value.items.length, 0, field); assert.equal(value.trace.sources['moc-v1'].topicsMatched, 1);
    assert.equal(value.trace.sources['moc-v1'].membersRanked, 0); assert.equal(value.trace.sources['moc-v1'].complete, true);
    writer.prepare(`UPDATE ${table} SET ${field}=?`).run(original[field]);
  }
});
test('C05 an explicitly reviewed navigable cross-map mapping contributes no MOC members', async t => {
  const f = sourcesFixture(t, { cards: true, sources: ['moc-v1'] });
  const memoryTopic = f.topic(f.admit('Memory member'), 'needle memory title');
  const card = f.card('Card mapped endpoint'), cardTopic = f.cardTopic(card, 'Other card title');
  const pair = { memoryTopic: { mocId: memoryTopic.createdMocs[0].id, revision: memoryTopic.createdMocs[0].revision },
    cardTopic: { mocId: cardTopic.createdMocRefs[0].mocId, revision: cardTopic.createdMocRefs[0].revision },
    expectedMemoryIndexRevision: ok(f.host.call(f.core, 'mapEvidence', { namespace: ns, type: 'memory' })).indexRevision,
    expectedCardIndexRevision: ok(f.host.call(f.core, 'mapEvidence', { namespace: ns, type: 'card' })).indexRevision };
  const proposed = ok(f.host.call(f.core, 'proposeEvidenceMapping', { namespace: ns, actionId: 'propose-cross-map', ...pair }));
  ok(f.host.call(f.core, 'reviewEvidenceMapping', { namespace: ns, actionId: 'review-cross-map', mappingId: proposed.id, expectedRevision: 1, state: 'active', ...pair }));
  const mappings = ok(f.host.call(f.core, 'listEvidenceMappings', { namespace: ns, type: 'card', mocId: pair.cardTopic.mocId })).items;
  assert.equal(mappings.length, 1); assert.equal(mappings[0].navigable, true);
  const value = ok(await f.find({ types: ['memory', 'card'] }));
  assert.deepEqual(value.items.map(i => i.ref), [memoryRef(memoryTopic.memories[0])]);
  assert.equal(value.trace.sources['moc-v1'].membersRanked, 1);
});
test('C05 independent oracle observes depth twelve over eighteen ranked members and full nonmatching statistics', async t => {
  const f = sourcesFixture(t, { sources: ['moc-v1'] }), documents = [], members = [];
  for (let i = 0; i < 18; i++) {
    const title = i < 9 ? 'apple apple ' + i : 'apple tea tea ' + i;
    const placed = f.topic(f.admit('Filed endpoint ' + i), title), ref = memoryRef(placed.memories[0]); members.push(ref);
    documents.push({ terms: i < 9 ? ['apple', 'apple', String(i)] : ['apple', 'tea', 'tea', String(i)], members: [ref] });
  }
  for (let i = 0; i < 7; i++) {
    const placed = f.topic(f.admit('Unmatched endpoint ' + i), 'Other title ' + i);
    documents.push({ terms: ['other', 'title', String(i)], members: [memoryRef(placed.memories[0])] });
  }
  const expected = titleOracle(documents, ['apple']), value = ok(await f.find({ query: 'apple', limit: 24 }));
  assert.equal(members.length, 18); assert.equal(value.trace.sources['moc-v1'].membersRanked, 18);
  assert.equal(value.trace.sources['moc-v1'].topicsMatched, 18); assert.equal(value.items.length, 12);
  assert.deepEqual(value.items.map(i => i.ref), expected.map(r => r.ref));
  for (let i = 0; i < 12; i++) {
    assert.equal(value.items[i].channels.moc.rank, i + 1);
    assert.ok(Math.abs(value.items[i].channels.moc.rawScore - expected[i].score) < 1e-15);
    assert.ok(Math.abs(value.items[i].fusionScore - 0.10 / (60 + i + 1)) < 1e-15);
  }
});

// Schema-valid links below are deliberately inconsistent existing data. Every
// endpoint/topic was authored through public operations; only cross-scope links
// are injected out of band. They confer neither authority nor source allowance.
for (const type of ['memory', 'card']) test(`C05/C08 inconsistent foreign ${type} membership and containment leave source bytes identical`, async t => {
  const f = sourcesFixture(t, { cards: true, sources: ['moc-v1'] }), foreign = { ...ns, ownerId: 'foreign-existing-data' };
  const local = type === 'memory' ? f.topic(f.admit('Local member'), 'needle local title', 'rootquery') : f.cardTopic(f.card('Local card'), 'needle local title', 'rootquery');
  const alien = type === 'memory' ? f.topic(f.admit('Foreign member', foreign), 'Foreign title', 'Foreign root', foreign) :
    f.cardTopic(f.card('Foreign card', { namespace: foreign }), 'Foreign title', 'Foreign root');
  const db = new DatabaseSync(f.path, { timeout: STORAGE_BUSY_TIMEOUT_MS }); t.after(() => db.close());
  const identityRow = db.prepare('SELECT store_id,cursor_secret FROM store_metadata').get();
  const identity = { storeId: identityRow.store_id, cursorSecret: identityRow.cursor_secret };
  const rank = query => JSON.stringify(readTransaction(db, () => rankMoc(db, identity, { cards: true, organization: true, receipts: true, reviews: true },
    { readSet: [ns], types: [type], intent: 'current', query }, Infinity)));
  const before = ['needle', 'rootquery'].map(rank);
  const l1 = type === 'memory' ? local.createdMocs.find(m => m.level === 'L1') : local.createdMocRefs.find(m => m.level === 'L1');
  const l2 = type === 'memory' ? local.createdMocs.find(m => m.level === 'L2') : local.createdMocRefs.find(m => m.level === 'L2');
  const foreignL1 = type === 'memory' ? alien.createdMocs.find(m => m.level === 'L1') : alien.createdMocRefs.find(m => m.level === 'L1');
  if (type === 'memory') {
    const member = alien.memories[0];
    db.prepare('INSERT INTO moc_memory_refs VALUES(?,?,?,?)').run(l1.id, l1.revision, member.id, member.revision);
    db.prepare('INSERT INTO moc_edges VALUES(?,?,?,?)').run(l2.id, l2.revision, foreignL1.id, foreignL1.revision);
  } else {
    const member = db.prepare('SELECT id,revision,body_revision FROM private_cards WHERE owner_id=?').get(foreign.ownerId);
    db.prepare('INSERT INTO card_moc_refs VALUES(?,?,?,?,?)').run(l1.mocId, l1.revision, member.id, member.revision, member.body_revision);
    db.prepare('INSERT INTO card_moc_edges VALUES(?,?,?,?)').run(l2.mocId, l2.revision, foreignL1.mocId, foreignL1.revision);
  }
  assert.deepEqual(['needle', 'rootquery'].map(rank), before);
});
test('C05/C08/C10 ANALYZEd 10^4 corpus plus 257 inconsistent foreign memberships still yields byte-identical complete top twelve', async t => {
  const f = await publicMocCorpus(t), foreign = { ...ns, ownerId: 'foreign-existing-data' };
  const aliens = Array.from({ length: 257 }, (_, i) => f.admit('Foreign injected member ' + i, foreign));
  const meter = instrumentSourceWork(f.db), input = { readSet: [ns], types: ['memory'], intent: 'current', query: 'needle' };
  const rank = () => readTransaction(f.db, () => rankMoc(meter.database, {}, {}, input, Infinity));
  const before = rank(), beforeCounts = structuredClone(meter.counts);
  assert.equal(before.diagnostic.complete, true); assert.equal(before.rows.length, 12); assert.equal(before.diagnostic.membersRanked, 10000);
  const topic = f.db.prepare('SELECT id,revision FROM mocs ORDER BY id LIMIT 1').get();
  for (const member of aliens) f.db.prepare('INSERT INTO moc_memory_refs VALUES(?,?,?,?)').run(topic.id, topic.revision, member.id, member.revision);
  const after = rank();
  assert.equal(JSON.stringify(after), JSON.stringify(before));
  assert.equal(meter.counts.visits - beforeCounts.visits, after.diagnostic.records);
  assert.equal(meter.counts.lookups - beforeCounts.lookups, after.diagnostic.lookups);
  const privateBefore = beforeCounts.private.lookups + beforeCounts.private.visits;
  const privateAfter = meter.counts.private.lookups + meter.counts.private.visits - privateBefore;
  assert.ok(privateAfter > privateBefore); assert.ok(privateAfter <= 50000);
  console.log(JSON.stringify({ kind: 'foreign_membership_10000', analyzed: true, foreignRows: aliens.length, baseline: before.diagnostic,
    after: after.diagnostic, privateBefore, privateAfter, publicDatabaseWork: after.diagnostic.records + after.diagnostic.lookups }));
});

test('C05/C08 foreign memberships do not change logical seeks at 127/128/129/256 authorized-member boundaries', async t => {
  for (const size of [127, 128, 129, 256]) {
    const f = await publicMocCorpus(t, { size, groupSize: 1000000 }), foreign = { ...ns, ownerId: 'foreign-existing-data' };
    const aliens = Array.from({ length: 257 }, (_, i) => f.admit('Foreign boundary member ' + i, foreign));
    const input = { readSet: [ns], types: ['memory'], intent: 'current', query: 'needle' };
    const rank = () => JSON.stringify(readTransaction(f.db, () => rankMoc(f.db, {}, {}, input, Infinity)));
    const before = rank(), topic = f.db.prepare('SELECT id,revision FROM mocs').get();
    for (const member of aliens) f.db.prepare('INSERT INTO moc_memory_refs VALUES(?,?,?,?)').run(topic.id, topic.revision, member.id, member.revision);
    assert.equal(rank(), before, 'authorized boundary ' + size);
  }
});
