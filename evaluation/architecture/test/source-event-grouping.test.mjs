import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { groupSourceEvents } from '../source-event-grouping.mjs';

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
const supportsCore = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 16);
const namespace = { ownerId: 'synthetic-event-grouping', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const bytes = packet => Buffer.byteLength(JSON.stringify(packet), 'utf8');
const ordered = (a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1
  : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0;
const input = (name, patch = {}) => ({ namespace, memory: { id: `memory-${name}`, revision: 1,
  currentness: 'current' }, receipts: [{ id: `receipt-${name}`, client: 'synthetic',
    sessionId: 'session', eventId: `event-${name}`, role: 'user', excerpt: `Original ${name}.` }], ...patch });
const inventory = entries => entries.flatMap(entry => entry.receipts.map(receipt => ({
  namespace: entry.namespace, client: receipt.client, sessionId: receipt.sessionId,
  eventId: receipt.eventId, role: receipt.role, excerpt: receipt.excerpt,
  memoryId: entry.memory.id, revision: entry.memory.revision,
  currentness: entry.memory.currentness, receiptId: receipt.id,
}))).sort(ordered);
const unpack = packet => packet.sources.flatMap(source => source.associations.map(association => ({
  namespace: source.namespace, client: source.client, sessionId: source.sessionId,
  eventId: source.eventId, role: source.role, excerpt: source.excerpt, ...association,
}))).sort(ordered);

test('SEG1/3 actual core stores seven distinct cards from six events, preserving every receipt link',
  { skip: supportsCore ? false : 'local core requires Node >=22.16' }, async t => {
  const { openMemoryCore } = await import('../../../core/index.mjs');
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-event-grouping-')), 'memory.sqlite');
  const core = openMemoryCore({ path }); t.after(() => core.close());
  const events = [
    ['e1', 'The team chose A because its export is auditable.'],
    ['e2', 'The export review is due Friday.'],
    ['e3', 'The export review is due Friday.'],
    ['e4', 'A later audit found a permissions issue.'],
    ['e5', 'The team will review that issue.'],
    ['e6', 'No replacement was adopted yet.'],
  ];
  const admitted = events.flatMap(([eventId, excerpt], index) => {
    const interpretations = index === 0
      ? ['The team chose A.', 'Auditable export was a reason for A.'] : [`Interpretation of ${eventId}.`];
    return interpretations.map(content => ok(core.admit({ namespace,
      memory: { content, kind: 'context' }, receipts: [{ client: 'synthetic',
        sessionId: 'one-session', eventId, role: 'user', excerpt }] })).memory);
  });
  assert.equal(admitted.length, 7);
  assert.equal(new Set(admitted.map(memory => memory.id)).size, 7);
  const read = () => admitted.map(memory => ok(core.get({ namespace, memoryId: memory.id, receiptLimit: 50 })));
  const before = read();
  assert.ok(before.every(detail => detail.exhausted && detail.nextReceiptCursor === null
    && detail.receipts.length === detail.memory.receiptCount && detail.receipts.length === 1));
  const entries = before.map(detail => ({ namespace: detail.memory.namespace,
    memory: { id: detail.memory.id, revision: detail.memory.revision,
      currentness: detail.memory.state === 'active' ? 'current' : 'historical' },
    receipts: detail.receipts }));
  const untouched = structuredClone(entries);
  const packet = groupSourceEvents(entries);
  assert.deepEqual(entries, untouched);
  assert.deepEqual(read(), before, 'packet construction does not mutate the store');
  assert.deepEqual(packet.counts, { sourceEventGroups: 6, associations: 7, provenanceCollisionGroups: 0 });
  assert.deepEqual(unpack(packet), inventory(entries));
  assert.equal(packet.sources.find(source => source.eventId === 'e1').associations.length, 2);
  assert.equal(new Set(packet.sources.find(source => source.eventId === 'e1')
    .associations.map(association => association.memoryId)).size, 2);
  assert.equal(packet.sources.filter(source => source.excerpt === events[1][1]).length, 2,
    'identical text from distinct events stays distinct');
  assert.deepEqual(groupSourceEvents([...entries].reverse()), packet,
    'source and association order cannot resolve an event collision');
  assert.ok(!JSON.stringify(packet).includes('Interpretation of e2'));
  t.diagnostic(`actual-core synthetic packet: ${packet.counts.sourceEventGroups} groups, ${packet.counts.associations} associations, ${bytes(packet)} UTF-8 bytes`);
});

test('SEG2/5 each provenance discriminator separates sources; divergent reused metadata flags both', () => {
  const base = input('base');
  const altered = [
    { namespace: { ...namespace, ownerId: 'other-owner' } },
    { namespace: { ownerId: namespace.ownerId, scope: 'project', projectId: 'other-project' } },
    { receipts: [{ ...base.receipts[0], id: 'r-client', client: 'other-client' }] },
    { receipts: [{ ...base.receipts[0], id: 'r-session', sessionId: 'other-session' }] },
    { receipts: [{ ...base.receipts[0], id: 'r-event', eventId: 'other-event' }] },
    { receipts: [{ ...base.receipts[0], id: 'r-role', role: 'assistant' }] },
    { receipts: [{ ...base.receipts[0], id: 'r-text', excerpt: 'Different original.' }] },
  ];
  for (const [index, patch] of altered.entries()) {
    const changed = input(`changed-${index}`, { ...patch,
      receipts: patch.receipts ?? [{ ...base.receipts[0], id: `r-${index}` }] });
    const packet = groupSourceEvents([base, changed]);
    assert.equal(packet.counts.sourceEventGroups, 2, `discriminator ${index}`);
    assert.deepEqual(unpack(packet), inventory([base, changed]));
    assert.equal(packet.counts.provenanceCollisionGroups, index === 6 ? 2 : 0);
    assert.ok(packet.sources.every(source => source.provenanceCollision === (index === 6)));
    if (index === 6) assert.deepEqual(groupSourceEvents([changed, base]), packet,
      'collision disclosure is independent of input order');
  }
  const textOnly = input('same-text-different-event', { receipts: [{ ...base.receipts[0],
    id: 'another-receipt', eventId: 'another-event' }] });
  assert.equal(groupSourceEvents([base, textOnly]).counts.sourceEventGroups, 2);

  const projectA = input('project-a', { namespace: { ownerId: namespace.ownerId,
    scope: 'project', projectId: 'project-a' },
  receipts: [{ ...base.receipts[0], id: 'project-receipt-a' }] });
  const projectB = input('project-b', { namespace: { ownerId: namespace.ownerId,
    scope: 'project', projectId: 'project-b' },
  receipts: [{ ...base.receipts[0], id: 'project-receipt-b' }] });
  const withoutProjectId = entry => JSON.stringify([entry.namespace.ownerId,
    entry.namespace.scope, entry.receipts[0].client, entry.receipts[0].sessionId,
    entry.receipts[0].eventId, entry.receipts[0].role, entry.receipts[0].excerpt]);
  assert.equal(withoutProjectId(projectA), withoutProjectId(projectB),
    'projectId is the only differing source-identity field');
  const projects = groupSourceEvents([projectA, projectB]);
  assert.equal(projects.counts.sourceEventGroups, 2);
  assert.equal(projects.counts.provenanceCollisionGroups, 0);
  assert.deepEqual(unpack(projects), inventory([projectA, projectB]));
});

test('SEG3/5 different revisions of one memory remain separate associations without a representative card', () => {
  const first = input('revised');
  const second = input('revised-again', { memory: { id: first.memory.id, revision: 2,
    currentness: 'historical' }, receipts: [{ ...first.receipts[0], id: 'receipt-revision-2' }] });
  const packet = groupSourceEvents([first, second]);
  assert.equal(packet.counts.sourceEventGroups, 1);
  assert.deepEqual(packet.sources[0].associations.map(item => item.revision), [1, 2]);
  assert.deepEqual(unpack(packet), inventory([first, second]));
  assert.deepEqual(Object.keys(packet.sources[0]).sort(),
    ['associations', 'client', 'eventId', 'excerpt', 'namespace', 'provenanceCollision', 'role', 'sessionId']);
  assert.throws(() => groupSourceEvents([first, first]), { code: 'duplicate_association' });
});

test('SEG4 group, association and UTF-8 byte ceilings fail whole without fallback', () => {
  assert.throws(() => groupSourceEvents(Array.from({ length: 7 }, (_, i) => input(`g${i}`))),
    { code: 'context_item_too_large' });
  const shared = Array.from({ length: 36 }, (_, i) => input(`a${i}`, {
    receipts: [{ ...input('base').receipts[0], id: `receipt-${i}` }] }));
  assert.deepEqual(groupSourceEvents(shared).counts, {
    sourceEventGroups: 1, associations: 36, provenanceCollisionGroups: 0 });
  assert.throws(() => groupSourceEvents([...shared, input('overflow', {
    receipts: [{ ...input('base').receipts[0], id: 'receipt-overflow' }] })]),
  { code: 'context_item_too_large' });
  const wide = input('wide', { receipts: [{ ...input('wide').receipts[0], excerpt: '界'.repeat(8000) }] });
  const unchecked = { version: 'source-event-grouping-experiment-v1', sources: [wide], counts: {},
    evidenceTrust: 'submitted-provenance-untrusted' };
  assert.ok(Buffer.byteLength(JSON.stringify(unchecked), 'utf8') > 24_000);
  assert.ok(JSON.stringify(unchecked).length < 24_000, 'the control distinguishes bytes from UTF-16 length');
  assert.throws(() => groupSourceEvents([wide]), { code: 'context_item_too_large' });
  let low = 1, high = 8000;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = input('boundary', { receipts: [{ ...input('boundary').receipts[0],
      excerpt: '界'.repeat(middle) }] });
    try { groupSourceEvents([candidate]); low = middle; }
    catch (error) { assert.equal(error.code, 'context_item_too_large'); high = middle - 1; }
  }
  const edge = input('boundary', { receipts: [{ ...input('boundary').receipts[0], excerpt: '界'.repeat(low) }] });
  assert.ok(bytes(groupSourceEvents([edge])) <= 24_000);
  edge.receipts[0].excerpt += '界';
  assert.throws(() => groupSourceEvents([edge]), { code: 'context_item_too_large' });
});

test('SEG6 normalized public DTR inventory replay is structural, not a new live answer', t => {
  const record = JSON.parse(readFileSync(new URL('../../../docs/decision-transition-results.json', import.meta.url)));
  const fixture = JSON.parse(readFileSync(new URL('../../live/decision-transition-fixture.json', import.meta.url)));
  const diagnostic = record.cases[0], arm = diagnostic.arms[1];
  assert.equal(arm.recallError, 'context_item_too_large');
  assert.equal(arm.answerText, null);
  const messages = new Map(fixture.cases[0].batches.flatMap(batch => batch.messages.map(message => [message.id, message])));
  const entries = arm.expandedNeighborhoodUnitIds.map(unitId => {
    const messageId = diagnostic.units[unitId], message = messages.get(messageId);
    assert.ok(message, `${unitId} has original source`);
    return { namespace: { ownerId: 'normalized-public-diagnostic', scope: 'personal', projectId: null },
      memory: { id: unitId, revision: 1, currentness: 'current' },
      receipts: [{ id: `normalized-fixture-${unitId}`, client: 'normalized-public-fixture',
        sessionId: diagnostic.id, eventId: messageId, role: message.role, excerpt: message.content }] };
  });
  assert.equal(entries.length, 7);
  assert.equal(new Set(entries.map(entry => entry.receipts[0].eventId)).size, 6);
  const packet = groupSourceEvents(entries);
  assert.deepEqual(packet.counts, { sourceEventGroups: 6, associations: 7, provenanceCollisionGroups: 0 });
  assert.deepEqual(unpack(packet), inventory(entries));
  assert.ok(bytes(packet) <= 24_000);
  t.diagnostic(`normalized public DTR inventory replay: ${packet.counts.sourceEventGroups} groups, ${packet.counts.associations} associations, ${bytes(packet)} UTF-8 bytes; no answer generated`);
});
