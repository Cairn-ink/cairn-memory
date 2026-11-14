import test from 'node:test';
import assert from 'node:assert/strict';
import { StatementSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { hasCardLineage } from '../card-lineage.mjs';
import { ns, ok, receipt } from '../testing/card-lineage-fixture.mjs';
import { fixture, trace, normalize, memoryRef } from '../testing/shared-source-fixture.mjs';
import { request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import { model as episodeModel, input as episodeInput } from '../testing/episode-capture-helpers.mjs';
import { options as episodeOptions } from '../testing/episode-helpers.mjs';

for (const sourceKind of ['submitted-note', 'receipt', 'raw'])
test(`metadata peek reads no contributor text: ${sourceKind}`, { timeout: 15000 }, async t => {
  const f = await fixture(t, 'ordinary-48');
  assert.equal(hasCardLineage(f.db), false);
  let core = f.core, sources;
  if (sourceKind === 'raw') {
    core = openRawCaptureCore({ path: f.path, model: f.model, privateCards: f.host.options },
      { mode: 'raw-v1', sources: true, deletion: true, port: localPlainPort(),
        readPolicy: () => ({ generation: 'synthetic', reason: null }) });
    t.after(() => core.close());
    const part = splitRaw('Synthetic peek Raw evidence.')[0];
    const saved = ok(await core.captureRaw(request(part, { namespace: ns, eventId: 'synthetic-peek-raw' })));
    const conversationId = saved.raw.conversationId;
    const revision = f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversationId).revision;
    sources = ok(await f.host.call(core, 'resolveSourceReferences', { anchors: [{ rawAnchor: {
      conversationId, messageId: part.id, start: 0, end: 8, precision: 'exact' }, expectedConversationRevision: revision }] })).sources;
  }
  const cards = [];
  for (let i = 0; i < 2; i++) {
    const memory = sourceKind === 'receipt' ? ok(core.admit({ namespace: ns,
      memory: { content: 'Synthetic peek support ' + i, kind: 'fact' }, receipts: [receipt('synthetic-peek-' + i)] })).memory : null;
    const draft = ok(f.host.call(core, 'createCardDraft', { actionId: 'synthetic-peek-draft-' + i,
      drafting: 'authored', input: { title: 'Synthetic peek match', body: 'Synthetic peek body',
        ...(sourceKind === 'submitted-note' ? { authoredInput: { text: 'Synthetic peek note ' + i, occurredAt: null } } :
          sourceKind === 'receipt' ? { memoryRefs: [memoryRef(memory)], sourcePolicy: 'retained-receipts-v1' } : { sources }) } }));
    cards.push(ok(f.host.call(core, 'confirmCardDraft', { actionId: 'synthetic-peek-confirm-' + i,
      cardId: draft.id, expectedRevision: draft.revision, applicability: 'current' })));
  }
  cards.sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)));
  const measured = await trace(() => f.host.call(core, 'selectEvidence', {
    query: 'Synthetic', types: ['card'], intent: 'current', limit: 1 }));
  const value = ok(measured.result);
  assert.deepEqual(value.items.map(item => item.ref.cardId), [cards[0].id]);
  assert.equal(value.coverage.reason, 'item_limit');
  assert.ok(value.nextCursor);
  const peekSQL = "SELECT id,revision,body_revision FROM private_cards WHERE owner_id=? AND scope=? AND project_id=? AND state='confirmed' AND id>? ORDER BY id LIMIT 1";
  const peek = measured.rows.findIndex(row => row.sql === peekSQL && row.args.at(-1) === cards[0].id);
  assert.ok(peek >= 0, 'the second confirmed Card is peeked');
  const detail = measured.rows.findIndex((row, index) => index > peek &&
    row.sql.startsWith('SELECT * FROM private_cards WHERE') && row.args.at(-1) === cards[0].id);
  assert.ok(detail > peek, 'selected Card materialization follows the peek');
  // The base executes only this metadata SELECT here. Token collection has
  // already filled the per-Card memo; even a new canonical metadata pass fails.
  assert.deepEqual(measured.rows.slice(peek, detail).map(row => row.sql), [peekSQL]);
  const collectors = measured.rows.filter(row => row.sql.startsWith('SELECT c.id AS card_id,r.receipt_key'));
  assert.equal(collectors.length, 1);
  assert.doesNotMatch(collectors[0].sql, /excerpt|source_ref|raw_parts|card_body_sources/);
  assert.ok(!measured.rows.some(row => row.args.includes(cards[1].id) &&
    /SELECT (?:\*|id,revision,state,body_revision) FROM private_cards/.test(row.sql)), 'peeked Card never enters canonical validation');
});

for (const rejection of ['membership', 'eligibility'])
test(`source recall reads no receipt text after ${rejection} rejection`, { timeout: 15000 }, async t => {
  const f = await fixture(t, 'ordinary-48');
  const memories = ['retained', 'rejected'].map(label => ok(f.core.admit({ namespace: ns,
    memory: { content: 'Synthetic scan ' + label, kind: 'fact' }, receipts: [{ ...receipt('synthetic-scan-' + label),
      excerpt: 'Synthetic winning excerpt ' + label }] })).memory);
  const [retained, rejected] = memories;
  const runtime = createMemoryRuntime({ path: f.path });
  t.after(() => runtime.close());
  let rejections = 0;
  // Inject each residual refusal at its existing read seam, without changing
  // stored rows or the snapshot. The observer still executes the real SQL.
  if (rejection === 'membership') {
    const get = StatementSync.prototype.get;
    t.mock.method(StatementSync.prototype, 'get', function (...args) {
      const result = Reflect.apply(get, this, args);
      if (/^SELECT id FROM index_read_memories WHERE/.test(normalize(this.sourceSQL)) && args.includes(rejected.id)) {
        rejections++; return undefined;
      }
      return result;
    });
  } else {
    const all = StatementSync.prototype.all;
    t.mock.method(StatementSync.prototype, 'all', function (...args) {
      const rows = Reflect.apply(all, this, args);
      if (/^SELECT id, revision, content, deleted, currentness.* FROM memories INDEXED BY namespace_memories/.test(normalize(this.sourceSQL)))
        for (const row of rows) if (row.id === rejected.id) { row.currentness = 'historical'; rejections++; }
      return rows;
    });
  }
  const scored = [];
  const measured = await trace(() => runtime.queryCandidateRows(ns, { sourceReceiptLimit: 4,
    score: text => { scored.push(text); return text.includes('winning') ? 2 : 1; }, memoryLabel: text => text }));
  assert.equal(rejections, 1, 'the candidate reaches the intended residual check');
  assert.deepEqual(measured.result.rows.map(row => row.item.ref.memoryId), [retained.id]);
  assert.equal(measured.result.rows[0].item.label, 'Synthetic winning excerpt retained');
  assert.deepEqual(scored, ['Synthetic scan retained', 'Synthetic winning excerpt retained']);
  const texts = measured.rows.filter(row => row.sql.startsWith('SELECT r.rowid AS cursor_row,r.* FROM json_each(?) wanted'));
  assert.equal(texts.length, 1, 'only the admitted candidate materializes receipt text');
  assert.equal(texts[0].args[1], retained.id);
  assert.ok(!measured.rows.some(row => row.args.includes(rejected.id) &&
    /SELECT (?:\*|r\.\*|r\.rowid AS cursor_row,r\.\*) FROM .*receipts/.test(row.sql)));
  assert.ok(measured.rows.some(row => row.sql.includes('r.receipt_key') && !/excerpt|r\.\*/.test(row.sql)), 'marker inputs still use headers');
});

test('Episode link filtering reads receipt tokens and keeps base checks', { timeout: 15000 }, async t => {
  const f = await fixture(t, 'ordinary-48');
  const core = openMemoryCore({ path: f.path, privateCards: f.host.options, ...episodeOptions,
    model: episodeModel({ extract: () => ({ items: [{ content: 'Synthetic linked signal', kind: 'fact', confidence: .8, sourceIndices: [0] }] }) }) });
  t.after(() => core.close());
  const captured = ok(await core.capture(episodeInput(1, 'synthetic-token-episode', { namespace: ns })));
  const memory = captured.admission.memories[0];
  const saved = ok(core.get({ namespace: ns, memoryId: memory.id })).receipts[0];
  const sibling = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic independent sibling', kind: 'fact' },
    receipts: [{ client: saved.client, sessionId: saved.sessionId, eventId: saved.eventId, role: saved.role, excerpt: saved.excerpt }] })).memory;
  const input = { namespace: ns, episodeId: captured.episode.id, sourceLimit: 16, memoryLimit: 50 };
  for (const marked of [false, true]) {
    if (marked) ok(f.core.forget({ namespace: ns, memoryId: sibling.id, expectedRevision: sibling.revision }));
    const measured = await trace(() => core.getEpisode(input));
    const value = ok(measured.result);
    assert.deepEqual(value.memoryLinks.items.find(link => link.memoryId === memory.id).receiptIds, marked ? [] : [saved.id]);
    const linked = measured.rows.filter(row => row.sql.includes("r.id=json_extract(wanted.value,'$[1]')"));
    assert.equal(linked.length, 1);
    assert.match(linked[0].sql, /^SELECT r\.id,r\.memory_id,r\.receipt_key,r\.client,r\.session_id,r\.event_id,r\.role FROM json_each\(\?\)/);
    assert.doesNotMatch(linked[0].sql, /excerpt|r\.\*/);
  }
});
