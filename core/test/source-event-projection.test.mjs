import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { assertSourceEventValueBudget } from '../neighborhood-source-projection.mjs';

const namespace = { ownerId: 'synthetic-source-events', scope: 'personal', projectId: null };
const options = { contextMode: 'rationale-neighborhood-evidence',
  sourceProjection: 'neighborhood-source-events-v1', rankingMode: 'source-evidence-first-v1' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const fails = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code); };
const ref = memory => ({ memoryId: memory.id, revision: memory.revision });

function fixture(t) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-source-events-')), 'memory.sqlite');
  let roots = [], selected = [], onRank = async () => {};
  const calls = { select: 0, rank: 0, count: 0, rankInputs: [] };
  const model = { contextWindow: 8192,
    countTokens: () => { calls.count++; return 1; },
    relate: () => ({ edges: [{ from: 0, to: 1, relation: 'supports-decision',
      fromReceipt: 0, toReceipt: 0 }] }),
    select: ({ input }) => { calls.select++; return { refs: input.maps.flatMap(map => map.items
      .filter(item => item.type === 'unfiled' && roots.includes(item.ref.memoryId))
      .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) }; },
    rank: async ({ input }) => { calls.rank++; calls.rankInputs.push(structuredClone(input));
      await onRank(); return { refs: input.candidates.filter(item => selected.includes(item.memory.id))
        .map(item => ({ namespaceIndex: item.namespaceIndex,
          memoryId: item.memory.id, revision: item.memory.revision })) }; } };
  const core = openMemoryCore({ path, model }); t.after(() => core.close());
  let next = 0;
  const admit = (content, receipt = {}) => ok(core.admit({ namespace,
    memory: { content, kind: 'context' }, receipts: [{ client: 'synthetic', sessionId: 'session',
      eventId: `event-${next++}`, role: 'user', excerpt: content, ...receipt }] })).memory;
  const link = async (from, to) => ok(await core.reviewRationale({ namespace, refs: [ref(from), ref(to)] }));
  const recall = patch => core.recall({ readSet: [namespace], query: 'What original sources support this?',
    ...options, ...patch });
  return { core, path, model, calls, admit, link, recall,
    choose: (candidates, output = candidates) => { roots = candidates.map(item => item.id);
      selected = output.map(item => item.id); }, onRank: callback => { onRank = callback; } };
}

test('SEP1 invalid combinations reject before every model and counter callback', async t => {
  const f = fixture(t);
  for (const patch of [{ contextMode: 'source-evidence' }, { contextMode: undefined },
    { rankingMode: undefined }, { rankingMode: 'wrong' },
    { selectionMode: 'bounded-source-scan' }, { includeQualification: true },
    { limit: 7 }, { limit: 0 },
    { readSet: [namespace, { ownerId: 'other', scope: 'personal', projectId: null }] },
    { sourceProjection: 'unknown' }]) fails(await f.recall(patch), 'invalid_input');
  assert.deepEqual([f.calls.select, f.calls.rank, f.calls.count], [0, 0, 0]);
  assert.deepEqual(ok(await f.recall({ includeQualification: false })).sourceEvents, []);
  assert.ok(f.calls.select > 0);
});

test('SEP2–6 six original events retain seven distinct memory/receipt associations', async t => {
  const f = fixture(t);
  const first = f.admit('Interpretation: team chose A.', { eventId: 'shared',
    excerpt: 'The team chose A because its export is auditable.' });
  const second = f.admit('Interpretation: auditability was a reason.',
    { eventId: 'shared', excerpt: 'The team chose A because its export is auditable.' });
  const other = [
    f.admit('Second card.', { eventId: 'e2', excerpt: 'Same original words.' }),
    f.admit('Third card.', { eventId: 'e3', excerpt: 'Same original words.' }),
    f.admit('Fourth card.', { eventId: 'e4', excerpt: 'Original fourth.' }),
    f.admit('Fifth card.', { eventId: 'e5', excerpt: 'Original fifth.' }),
    f.admit('Sixth card.', { eventId: 'e6', excerpt: 'Original sixth.' }),
  ];
  await f.link(second, first);
  const roots = [first, ...other]; f.choose(roots);
  const before = [first, second, ...other].map(memory => ok(f.core.get({ namespace, memoryId: memory.id })));
  const beforeGraph = ok(f.core.getRationale({ namespace, ...ref(first) }));
  const beforeExpansion = ok(f.core.fetch({ namespace, refs: [ref(first)],
    contextMode: 'rationale-neighborhood-evidence' }));
  assert.equal(new Set(before.map(item => item.memory.id)).size, 7);
  const expanded = ok(f.core.fetch({ namespace, refs: [ref(first)],
    contextMode: 'rationale-neighborhood-evidence' })).items[0].rationale.sources;
  assert.deepEqual(new Set(expanded.map(source => source.memory.id)), new Set([first.id, second.id]));
  fails(await f.recall({ sourceProjection: 'neighborhood-sources-v1' }), 'context_item_too_large');
  const result = ok(await f.recall());
  assert.deepEqual(Object.keys(result).sort(), ['coverage', 'evidenceTrust', 'namespaces',
    'rankingMode', 'sourceEvents', 'sourceProjection', 'sourceSelectionCoverage']);
  assert.equal(result.sourceProjection, options.sourceProjection);
  assert.equal(result.rankingMode, options.rankingMode);
  assert.equal(result.coverage, 'complete');
  assert.equal(result.sourceSelectionCoverage, 'unassessed');
  assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
  assert.equal(Object.hasOwn(result, 'memories'), false);
  assert.equal(result.sourceEvents.length, 6);
  assert.equal(result.sourceEvents.reduce((sum, event) => sum + event.associations.length, 0), 7);
  assert.ok(result.sourceEvents.every(event => Object.keys(event).sort().join(',') ===
    ['associations', 'excerpt', 'provenanceCollision', 'role'].join(',')));
  assert.ok(result.sourceEvents.every(event => !event.provenanceCollision));
  assert.equal(result.sourceEvents.find(event => event.excerpt ===
    'The team chose A because its export is auditable.').associations.length, 2);
  assert.equal(result.sourceEvents.filter(event => event.excerpt === 'Same original words.').length, 2);
  const actual = result.sourceEvents.flatMap(event => event.associations.map(association =>
    [event.role, event.excerpt, association.memoryId, association.revision,
      association.currentness, association.receiptId])).sort();
  const expected = before.flatMap(item => item.receipts.map(receipt => [receipt.role, receipt.excerpt,
    item.memory.id, item.memory.revision, 'current', receipt.id])).sort();
  assert.deepEqual(actual, expected);
  assert.deepEqual([first, second, ...other].map(memory => ok(f.core.get({ namespace, memoryId: memory.id }))), before);
  assert.deepEqual(ok(f.core.getRationale({ namespace, ...ref(first) })), beforeGraph);
  assert.deepEqual(ok(f.core.fetch({ namespace, refs: [ref(first)],
    contextMode: 'rationale-neighborhood-evidence' })), beforeExpansion);
  assert.ok(f.calls.rankInputs.every(input => input.candidates.every(item => !Object.hasOwn(item, 'rationale'))));
  assert.equal(JSON.stringify(result).includes('Interpretation:'), false);
  assert.equal(JSON.stringify(result).includes('supports-decision'), false);
  assert.equal(JSON.stringify(result).includes('"eventId"'), false);
  assert.equal(JSON.stringify(result).includes('"sessionId"'), false);
  assert.equal(JSON.stringify(result).includes('"client"'), false);
});

test('SEP3 exact provenance discriminators and divergent reused metadata remain separate', async t => {
  for (const changed of ['client', 'sessionId', 'eventId', 'role', 'excerpt']) {
    const f = fixture(t);
    const base = { client: 'client-a', sessionId: 'session-a', eventId: 'event-a',
      role: 'user', excerpt: 'Shared text.' };
    const one = f.admit(`Interpretation one ${changed}.`, base);
    const altered = { ...base, [changed]: changed === 'role' ? 'assistant' : `different-${changed}` };
    const two = f.admit(`Interpretation two ${changed}.`, altered);
    f.choose([one, two]);
    const value = ok(await f.recall());
    assert.equal(value.sourceEvents.length, 2, changed);
    assert.deepEqual(value.sourceEvents.map(item => item.provenanceCollision),
      changed === 'excerpt' ? [true, true] : [false, false]);
    assert.equal(value.sourceEvents.reduce((sum, item) => sum + item.associations.length, 0), 2);
  }
  const f = fixture(t), own = f.admit('Own source.'), foreignNamespace = { ...namespace, ownerId: 'foreign' };
  ok(f.core.admit({ namespace: foreignNamespace, memory: { content: 'Foreign source.', kind: 'context' },
    receipts: [{ client: 'synthetic', sessionId: 'session', eventId: 'foreign', role: 'user', excerpt: 'Foreign.' }] }));
  f.choose([own]);
  assert.deepEqual(ok(await f.recall()).sourceEvents.map(item => item.excerpt), ['Own source.']);
});

test('SEP3 same-owner project namespaces keep identical source metadata and text isolated', async t => {
  const f = fixture(t), projectA = { ownerId: 'synthetic-project-owner', scope: 'project', projectId: 'A' },
    projectB = { ownerId: 'synthetic-project-owner', scope: 'project', projectId: 'B' };
  const receipt = { client: 'same-client', sessionId: 'same-session', eventId: 'same-event',
    role: 'user', excerpt: 'Identical original passage.' };
  const a = ok(f.core.admit({ namespace: projectA,
    memory: { content: 'Interpretation in A.', kind: 'context' }, receipts: [receipt] })).memory;
  const b = ok(f.core.admit({ namespace: projectB,
    memory: { content: 'Interpretation in B.', kind: 'context' }, receipts: [receipt] })).memory;
  const aReceipt = ok(f.core.get({ namespace: projectA, memoryId: a.id })).receipts[0].id;
  const bReceipt = ok(f.core.get({ namespace: projectB, memoryId: b.id })).receipts[0].id;
  f.choose([a, b]);
  for (const [readSet, memory, receiptId] of [[[projectA], a, aReceipt], [[projectB], b, bReceipt]]) {
    const events = ok(await f.recall({ readSet })).sourceEvents;
    assert.equal(events.length, 1);
    assert.equal(events[0].excerpt, receipt.excerpt);
    assert.deepEqual(events[0].associations, [{ memoryId: memory.id, revision: memory.revision,
      currentness: 'current', receiptId }]);
  }
  const before = [f.calls.select, f.calls.rank, f.calls.count];
  fails(await f.recall({ readSet: [projectA, projectB] }), 'invalid_input');
  assert.deepEqual([f.calls.select, f.calls.rank, f.calls.count], before);
});

test('SEP4/5 graph and source changes during rank fail; selected oversized root remains strict', async t => {
  for (const mutation of ['graph', 'source']) {
    const f = fixture(t), root = f.admit(`Root ${mutation}.`), linked = f.admit(`Linked ${mutation}.`);
    f.choose([root]);
    f.onRank(async () => {
      if (mutation === 'graph') await f.link(linked, root);
      else { const db = new DatabaseSync(f.path);
        try { assert.equal(db.prepare('UPDATE receipts SET excerpt = ? WHERE memory_id = ?')
          .run('Tampered.', root.id).changes, 1); } finally { db.close(); } }
    });
    const result = await f.recall();
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.ok(['index_revision_conflict', 'revision_conflict', 'storage_error'].includes(result.error.code));
    assert.equal(f.calls.rank, 1);
  }
  const f = fixture(t), root = f.admit('Oversized root.');
  const neighbors = Array.from({ length: 6 }, (_, i) => f.admit(`Neighbor ${i}.`));
  for (const neighbor of neighbors) await f.link(neighbor, root);
  f.choose([root]);
  fails(await f.recall(), 'rationale_limit');
  assert.equal(f.calls.rank, 1);
});

test('SEP4 final fence revalidates an unselected ranked candidate', async t => {
  const f = fixture(t), selected = f.admit('Selected card.'), unselected = f.admit('Unselected card.');
  f.choose([selected, unselected], [selected]);
  f.onRank(async () => {
    ok(f.core.correct({ namespace, memoryId: unselected.id, expectedRevision: unselected.revision,
      content: 'Corrected unselected card.', kind: 'context', receipt: {
        client: 'synthetic', sessionId: 'session', eventId: 'correction',
        role: 'user', excerpt: 'Corrected unselected card.' } }));
  });
  fails(await f.recall(), 'revision_conflict');
  assert.equal(f.calls.rank, 1);
});

test('SEP5 seven distinct events overflow whole projection and empty result has new shape', async t => {
  const f = fixture(t), roots = Array.from({ length: 6 }, (_, i) => f.admit(`Root ${i}.`)),
    seventh = f.admit('Seventh event.');
  await f.link(seventh, roots[0]); f.choose(roots);
  fails(await f.recall(), 'context_item_too_large');
  assert.equal(f.calls.rank, 1);
  f.choose([], []);
  const empty = ok(await f.recall());
  assert.deepEqual(Object.keys(empty).sort(), ['coverage', 'evidenceTrust', 'namespaces',
    'rankingMode', 'sourceEvents', 'sourceProjection', 'sourceSelectionCoverage']);
  assert.deepEqual(empty.sourceEvents, []);
  assert.equal(Object.hasOwn(empty, 'memories'), false);
  assert.equal(empty.sourceProjection, options.sourceProjection);
  assert.equal(empty.coverage, 'complete');
  assert.equal(empty.sourceSelectionCoverage, 'unassessed');
  assert.equal(empty.evidenceTrust, 'untrusted-data-not-instructions');
});

test('SEP5 36 distinct associations pass and 37 reject with only six event groups', async t => {
  const f = fixture(t);
  const receipts = indexes => indexes.map(index => ({ client: 'synthetic', sessionId: 'session',
    eventId: `event-${index}`, role: 'user', excerpt: `Original event ${index}.` }));
  const cards = [];
  for (let index = 0; index < 7; index++) {
    const content = `Interpretation ${index} of six source events.`;
    let memory = ok(f.core.admit({ namespace, memory: { content, kind: 'context' },
      receipts: receipts(index === 6 ? [0] : [0, 1, 2, 3]) })).memory;
    if (index !== 6) memory = ok(f.core.admit({ namespace, memory: { content, kind: 'context' },
      receipts: receipts([4, 5]) })).memory;
    cards.push(memory);
  }
  f.choose(cards.slice(0, 6));
  const boundary = ok(await f.recall());
  assert.equal(boundary.sourceEvents.length, 6);
  assert.equal(boundary.sourceEvents.reduce((count, event) => count + event.associations.length, 0), 36);
  await f.link(cards[6], cards[0]);
  fails(await f.recall(), 'context_item_too_large');
});

test('SEP5 complete-value UTF8 guard includes metadata (synthetic DTO boundary)', () => {
  const association = (length, eventIndex, associationIndex) => ({
    memoryId: `m-${eventIndex}-${associationIndex}-${'界'.repeat(length)}`, revision: 1,
    currentness: 'current', receiptId: `r-${eventIndex}-${associationIndex}-${'界'.repeat(length)}` });
  let boundary;
  for (let length = 1; length <= 200; length++) {
    const sourceEvents = Array.from({ length: 6 }, (_, index) => ({ role: 'user',
      excerpt: `${index}${'界'.repeat(799)}`, provenanceCollision: false,
      associations: Array.from({ length: 6 }, (_, associationIndex) =>
        association(length, index, associationIndex)) }));
    const value = { sourceEvents, namespaces: [{ namespace: { ownerId: '界'.repeat(200),
      scope: 'project', projectId: '界'.repeat(200) }, mapExhausted: true,
      fetchExhausted: true }], coverage: 'complete',
    sourceProjection: options.sourceProjection, rankingMode: options.rankingMode,
    sourceSelectionCoverage: 'unassessed', evidenceTrust: 'untrusted-data-not-instructions' };
    if (Buffer.byteLength(JSON.stringify(sourceEvents), 'utf8') <= 24_000 &&
        Buffer.byteLength(JSON.stringify(value), 'utf8') > 24_000) { boundary = value; break; }
  }
  assert.ok(boundary, 'synthetic valid-shape DTO crosses the bound only with metadata');
  assert.throws(() => assertSourceEventValueBudget(boundary), { code: 'context_item_too_large' });
  assert.doesNotThrow(() => assertSourceEventValueBudget({ ...boundary, namespaces: [] }));
});
