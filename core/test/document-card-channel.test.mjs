import assert from 'node:assert/strict';
import test from 'node:test';
import { openContextReader, openMemoryCore } from '../index.mjs';
import { meteredText } from '../context-read-assembly.mjs';
import { contextReadBudgetDiagnostic } from '../context-read-budget.mjs';
import { host, ns, ok, policy } from '../testing/context-read-core-fixture.mjs';
import { controlledClock } from '../testing/context-read-assembly-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const counter = { id: 'sample', countTokens: text => Math.ceil(text.length / 4) };
const query = 'Quartz gasket';
const header = '# Fixture assembly';
const body = [header, ...Array.from({ length: 20 }, (_, i) =>
  (i === 14 ? 'Quartz gasket: check the seal.' : 'Use the wrench.') + ' Check the adjacent fittings.'.repeat(5))].join('\n');

async function fixture(t, options = {}) {
  const { createInMemoryDocumentCardPort, routeDocumentCards } = await import('../document-card.mjs');
  const workspace = createTestWorkspace(t);
  const path = workspace.path + '/store.sqlite';
  const cardPort = createInMemoryDocumentCardPort();
  const trusted = host();
  const contextRead = { version: 'context-read-v1', authority: trusted.authority, counter, ...options };
  const core = openMemoryCore({ path, contextRead, cardPort });
  workspace.defer(() => core.close());
  const reader = cardPort => {
    const value = openContextReader({ path, contextRead, ...(cardPort ? { cardPort } : {}) });
    workspace.defer(() => value.close());
    return value;
  };
  const add = (id, value = body, namespace = ns) => {
    const { cards: [card] } = routeDocumentCards(namespace, 'client', 'session', [{ id, role: 'assistant', content: value }]);
    cardPort.put(namespace, card);
    return card;
  };
  const read = async (text, budget = { maxItems: 1, maxTokens: 1200 }, reader = core) =>
    ok(await trusted.call(reader, 'contextRead', { query: text, readSet: [ns], types: ['memory'],
      intent: 'current', raw: false, representation: 'memory-compact-v1', deadlineMs: 5000, budget }));
  return { core, reader, cardPort, add, read };
}
const cardItem = result => result.metered.items.find(item => item.channel === 'document-card-v1');

test('pieces and stale replacements occupy one metered item', async t => {
  controlledClock(t);
  const { add, read, cardPort, core, reader } = await fixture(t);
  const card = add('long');
  const pack = await read(query);
  assert.equal(pack.metered.items.length, 1);
  assert.equal(pack.diagnostics.budget.used, counter.countTokens(meteredText(pack.metered)));
  assert.equal(cardItem(pack).piece, 'window');
  assert.match(cardItem(pack).body, /^# Fixture assembly\n…\n/);
  assert.match(cardItem(pack).body, /Quartz gasket/);
  assert.equal(cardItem(await read('whole ' + query)).piece, 'truncated');
  assert.equal(cardItem(await read('whole ' + query, { maxItems: 1, maxTokens: 3000 })).piece, 'whole');
  const unrelated = 'zan zib zef';
  assert.equal(JSON.stringify(await read(unrelated, undefined, reader(cardPort))), JSON.stringify(await read(unrelated, undefined, reader())));
  cardPort.markStale(ns, card.id, { memoryId: 'source', replacement: {
    memoryId: 'new', revision: 2, content: 'Use the steel gasket.', date: '2024-03-02T00:00:00.000Z',
  } });
  const stale = cardItem(await read(query));
  assert.equal(stale.stale, true);
  assert.match(stale.precedence, /take precedence/);
  assert.equal(stale.replacements[0].content, 'Use the steel gasket.');
  assert.equal(stale.replacements[0].date, '2024-03-02T00:00:00.000Z');
  ok(core.forgetCard({ namespace: ns, cardId: card.id }));
  assert.equal(cardItem(await read(query)), undefined);
  add('short', 'Quartz gasket\n- Set the seal\n- Check the fit\n' + 'Repeat after inspection. '.repeat(10));
  assert.equal(cardItem(await read(query)).piece, 'whole');
});

test('semantic selection uses budgeted vectors and caches document vectors in the port', async t => {
  let calls = 0;
  const embedder = { id: 'document-fixture', revision: 'v1', dimensions: 2, normalization: 'none',
    embed: texts => { calls++; return texts.map(text => text.startsWith('# Fixture') || text === 'seal design' ? [1, 0] : [0, 1]); } };
  const { add, read } = await fixture(t, { embedder, policy: policy() });
  const card = add('long');
  const result = await read('seal design');
  assert.equal(cardItem(result).id, card.id);
  const initialCalls = calls;
  assert.ok(initialCalls > 0);
  assert.equal(cardItem(await read('seal design')).id, card.id);
  assert.equal(calls - initialCalls, 1);
  assert.equal(cardItem(await read('different wording')), undefined);
  const ledger = contextReadBudgetDiagnostic(embedder);
  assert.equal(ledger.query.requests + ledger.maintenance.requests, calls);
});
