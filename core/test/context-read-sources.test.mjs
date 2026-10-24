import test from 'node:test';
import assert from 'node:assert/strict';
import { sourcesFixture, ns, ok, sourceQuery, memoryRef } from '../testing/context-read-sources-fixture.mjs';
import { denied } from '../testing/context-read-core-fixture.mjs';

const ids = value => value.items.map(item => item.ref.memoryId ?? item.ref.cardId);
test('C04 source expands a directly missed endpoint, adjacent to its seed, with an exact witness', async t => {
  const f = sourcesFixture(t, { sources: ['relations-one-hop-v1'] });
  const seed = f.admit('needle direct'), other = f.admit('Different endpoint');
  await f.relate(other, seed);
  const direct = ok(await f.find({ sources: [] })); assert.deepEqual(ids(direct), [seed.id]);
  const value = ok(await f.find()); assert.deepEqual(ids(value), [seed.id, other.id]);
  assert.deepEqual(value.items[1].via, { seed: memoryRef(seed), family: 'supports-decision', direction: 'incoming' });
  assert.equal(value.items[1].fusionScore, null);
  assert.deepEqual(value.items[1].channels, { lexical: null, semantic: null });
  assert.equal(value.trace.sources['relations-one-hop-v1'].added, 1);
  const assembly = ok(await f.assemble()); assert.equal(assembly.diagnostics.candidates.count, 2);
});
test('C05 title channel includes current L1 and L2 members and preserves unfiled direct search', async t => {
  const f = sourcesFixture(t, { cards: true });
  const memory = f.admit('A topic member without the title query');
  const placed = f.topic(memory, 'needle topic', 'rootquery');
  const card = f.card('Independently authored member'); f.cardTopic(card, 'needle cardtopic', 'rootquery cards');
  const unfiled = f.admit('needle unfiled');
  const value = ok(await f.find({ types: ['memory', 'card'] }));
  assert.ok(ids(value).includes(placed.memories[0].id)); assert.ok(ids(value).includes(card.cardId)); assert.ok(ids(value).includes(unfiled.id));
  const root = ok(await f.find({ query: 'rootquery', types: ['memory', 'card'] }));
  assert.ok(ids(root).includes(memory.id)); assert.ok(ids(root).includes(card.cardId));
  assert.equal(value.trace.preset, 'rrf-k60-d12-moc-v1');
  assert.equal(value.trace.sources['moc-v1'].status, 'ok');
  assert.equal(value.trace.sources['moc-v1'].summaryFreshness, 'unavailable');
  assert.equal(value.items.find(item => item.ref.memoryId === unfiled.id).channels.moc, null);
  const assembly = ok(await f.assemble({ types: ['memory', 'card'] })); assert.ok(assembly.diagnostics.candidates.trace.sources);
});
test('C06 source-disabled schemas remain strict; opt-in supports only narrowing and advertises conditional bounds', async t => {
  const f = sourcesFixture(t); f.admit('needle');
  const caps = ok(f.context.getContextReadCapabilities()); assert.equal(caps.limits.horizon, 32); assert.equal(caps.assembly.limits.counterCalls, 1634);
  for (const sources of [['unknown'], ['moc-v1', 'moc-v1'], null, 'moc-v1']) denied(await f.find({ sources }), 'invalid_input');
  const legacy = f.reopen({ counter: { id: 'synthetic-unit', countTokens: () => 1 } });
  denied(await f.trusted.call(legacy, 'findCandidates', sourceQuery({ sources: [] })), 'invalid_input');
  assert.equal(ok(legacy.getContextReadCapabilities()).limits.horizon, 24);
});

for (const family of ['supports-decision', 'challenges-premise']) for (const direction of ['incoming', 'outgoing']) {
  test(`C04 ${family} ${direction}, first path wins and additions never become seeds`, async t => {
    const f = sourcesFixture(t, { sources: ['relations-one-hop-v1'] });
    const seed = f.admit('needle seed'), other = f.admit('Endpoint absent from direct text'), second = f.admit('Two hop excluded');
    await f.relate(...(direction === 'incoming' ? [other, seed] : [seed, other]), family);
    await f.relate(second, other, 'challenges-premise');
    const value = ok(await f.find()); assert.deepEqual(ids(value), [seed.id, other.id]);
    assert.deepEqual(value.items[1].via, { seed: memoryRef(seed), family, direction });
    assert.equal(value.trace.sources['relations-one-hop-v1'].examined, direction === 'outgoing' ? 2 : 1);
    assert.equal(value.trace.sources['relations-one-hop-v1'].remaining, 0);
    const history = ok(await f.find({ intent: 'history' })); assert.deepEqual(ids(history), [seed.id]);
    assert.deepEqual(history.trace.sources['relations-one-hop-v1'].reasons, ['unsupported_intent']);
  });
}
test('C04 symmetric contradictions traverse in both physical directions', async t => {
  const f = sourcesFixture(t, { sources: ['relations-one-hop-v1'] }), seed = f.admit('needle seed');
  const other = ok(f.core.admit({ namespace: ns, memory: { content: 'opposite directword', kind: 'fact' }, receipts: [{ client: 'synthetic', sessionId: 'conflict', eventId: 'other', role: 'user', excerpt: 'Opposite' }],
    conflictHints: [{ memoryId: seed.id, expectedRevision: seed.revision, relation: 'contradicts' }] })).memory;
  for (const [query, first, second] of [['needle', seed, other], ['directword', other, seed]]) {
    const value = ok(await f.find({ query })); assert.deepEqual(ids(value), [first.id, second.id]);
    assert.equal(value.items[1].via.family, 'contradicts'); assert.equal(value.items[1].via.direction, 'undirected');
  }
});
test('C04 canonical Card→Memory binding and reverse; applicability loss excludes history MOC members too', async t => {
  const f = sourcesFixture(t, { cards: true }), memory = f.admit('needle memory');
  const card = f.card('cardquery endpoint', { memories: [memory] });
  let value = ok(await f.find({ types: ['memory', 'card'] })); assert.deepEqual(ids(value), [memory.id, card.cardId]);
  assert.equal(value.items[1].via.direction, 'incoming');
  value = ok(await f.find({ query: 'cardquery', types: ['memory', 'card'] })); assert.deepEqual(ids(value), [card.cardId, memory.id]);
  assert.equal(value.items[1].via.direction, 'outgoing');
  assert.deepEqual(ids(ok(await f.find({ types: ['memory'] }))), [memory.id]);
  f.cardTopic(card, 'topicquery');
  const detail = ok(f.host.call(f.core, 'getCard', { namespace: ns, cardId: card.cardId })).card;
  ok(f.host.call(f.core, 'editKnowledgeCard', { namespace: ns, actionId: 'lose-current', cardId: card.cardId, expectedRevision: card.revision,
    title: detail.title, body: detail.body, bindings: detail.bindings.map(b => b.source), applicability: 'historical' }));
  const history = ok(await f.find({ query: 'topicquery', types: ['memory', 'card'], intent: 'history' }));
  assert.equal(history.items.length, 0);
  assert.deepEqual(ids(ok(await f.find({ types: ['memory', 'card'] }))), [memory.id]);
});
test('C04 4/2/8 caps, canonical ordering, entire direct-horizon dedup and seed adjacency across pages', async t => {
  const f = sourcesFixture(t, { sources: ['relations-one-hop-v1'] });
  const seeds = Array.from({ length: 26 }, (_, i) => f.admit('needle direct ' + i));
  const expected = new Map();
  for (const seed of seeds) {
    const endpoints = Array.from({ length: 3 }, (_, i) => f.admit('Separate endpoint ' + seed.id + ' ' + i));
    for (const endpoint of endpoints) await f.relate(endpoint, seed);
    expected.set(seed.id, endpoints.sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id))));
  }
  const direct = ok(await f.find({ sources: [], limit: 24 })); assert.equal(direct.items.length, 24);
  let first = ok(await f.find({ limit: 1 })), items = [...first.items], cursor = first.nextCursor;
  while (cursor) { const page = ok(await f.find({ limit: 24, cursor })); items.push(...page.items); cursor = page.nextCursor; }
  assert.equal(items.length, 32); assert.deepEqual(items.filter(item => !item.via).map(item => item.ref), direct.items.map(item => item.ref));
  assert.deepEqual(items.map(item => item.rank), Array.from({ length: 32 }, (_, i) => i + 1));
  const expectedOrder = direct.items.flatMap((item, i) => [item.ref.memoryId, ...(i < 4 ? expected.get(item.ref.memoryId).slice(0, 2).map(m => m.id) : [])]);
  assert.deepEqual(ids({ items }), expectedOrder);
  const diagnostic = first.trace.sources['relations-one-hop-v1']; assert.equal(diagnostic.added, 8); assert.equal(diagnostic.capped, true);
  assert.equal(diagnostic.remaining, null); assert.equal(diagnostic.additions.length, 8); assert.deepEqual(diagnostic.reasons, ['capped']);
  const altered = await f.find({ cursor: first.nextCursor, sources: [] }); denied(altered, 'invalid_cursor');
  const assembled = ok(await f.assemble({ budget: { maxItems: 24, maxTokens: 4000 } }));
  assert.equal(assembled.diagnostics.candidates.count, 32); assert.equal(assembled.metered.items.length, 24);
  assert.ok(assembled.diagnostics.trace.counterCalls <= 1634); assert.ok(assembled.snapshot.length <= 16384);
});
test('C04 direct identities deduplicate only after exact endpoint validation', async t => {
  const f = sourcesFixture(t, { sources: ['relations-one-hop-v1'] }), a = f.admit('needle first'), b = f.admit('needle second');
  await f.relate(a, b); await f.relate(b, a);
  const value = ok(await f.find()); assert.equal(value.items.length, 2);
  assert.equal(value.trace.sources['relations-one-hop-v1'].rejected.duplicate, 4);
  assert.equal(value.trace.sources['relations-one-hop-v1'].added, 0);
});

test('C04 stale exact endpoints and invalid receipt digests reject public-authored incident edges', async t => {
  const { DatabaseSync } = await import('node:sqlite');
  const f = sourcesFixture(t, { sources: ['relations-one-hop-v1'] }), seed = f.admit('needle stable'), endpoint = f.admit('Endpoint body');
  await f.relate(endpoint, seed);
  const row = f.db.prepare('SELECT * FROM rationale_edges').get();
  ok(f.core.correct({ namespace: ns, memoryId: endpoint.id, expectedRevision: endpoint.revision, content: 'Revised endpoint body', kind: 'fact',
    receipt: { client: 'synthetic', sessionId: 'stale', eventId: 'correction', role: 'user', excerpt: 'Revised source' } }));
  const writer = new DatabaseSync(f.path); writer.exec('PRAGMA foreign_keys=OFF'); t.after(() => writer.close());
  // Deliberately restore an out-of-band stale row after public correction.
  writer.prepare('INSERT INTO rationale_edges VALUES(?,?,?,?,?,?,?,?,?)').run(...Object.values(row));
  const stale = ok(await f.find()); assert.deepEqual(ids(stale), [seed.id]); assert.equal(stale.trace.sources['relations-one-hop-v1'].rejected.revision, 1);
  writer.exec('DELETE FROM rationale_edges');
  const current = ok(f.core.get({ namespace: ns, memoryId: endpoint.id })).memory; await f.relate(current, seed);
  writer.exec("UPDATE rationale_edges SET from_digest='invalid-digest'");
  const invalid = ok(await f.find()); assert.deepEqual(ids(invalid), [seed.id]);
  assert.equal(invalid.trace.sources['relations-one-hop-v1'].rejected.invalid_binding, 1);
});

test('C05 total lexical failure reports unavailable sources and never complete-empty', async t => {
  const { openMemoryCore } = await import('../index.mjs');
  const { host } = await import('../testing/context-read-core-fixture.mjs');
  const trusted = host(), core = openMemoryCore({ path: ':memory:', contextRead: { version: 'context-read-v1', authority: trusted.authority,
    sources: ['relations-one-hop-v1', 'moc-v1'] } }); t.after(() => core.close());
  const result = await trusted.call(core, 'findCandidates', sourceQuery()); denied(result, 'index_unavailable');
  assert.equal(Array.isArray(result.error.details.trace.sources), false);
  for (const value of Object.values(result.error.details.trace.sources)) { assert.equal(value.status, 'unavailable'); assert.deepEqual(value.reasons, ['index_unavailable']); }
});
