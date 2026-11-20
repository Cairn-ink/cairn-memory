import assert from 'node:assert/strict';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { createEngineCardStorage } from '../engine-card-storage.mjs';
import { lineageFixture, ns, ok, receipt } from '../testing/card-lineage-fixture.mjs';
import { host, publish, read } from './role-fixture.mjs';

const hidden = 'Synthetic withdrawn contributor wording';
const kept = 'Synthetic independent contributor wording';
const shared = { ...receipt('shared-contributor'), excerpt: hidden };
const memoryRef = memory => ({ type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision });
const missing = (value, text = hidden) => assert.equal(JSON.stringify(value).includes(text), false);

async function fixture(t) {
  const f = await lineageFixture(t, { base: 33, eventTime: true });
  const add = (content, receipts) => ok(f.core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts })).memory;
  const a = add('Synthetic discarded conclusion', [shared]);
  const b = add('Synthetic retained conclusion', [shared, { ...receipt('independent-contributor'), excerpt: kept }]);
  const stored = f.db.prepare('SELECT id FROM receipts WHERE memory_id=? AND excerpt=?').get(b.id, hidden);
  const forget = () => ok(f.core.forget({ namespace: ns, memoryId: a.id, expectedRevision: a.revision }));
  return { ...f, b, forget, stored };
}

test('Card bodies and lists revalidate retained contributors', async t => {
  const f = await fixture(t);
  const draft = ok(f.call('createCardDraft', { actionId: 'create-dependent-card', drafting: 'authored',
    input: { title: hidden, body: hidden, memoryRefs: [memoryRef(f.b)], sourcePolicy: 'retained-receipts-v1' } }));
  const card = f.confirm(draft);
  const get = () => ok(f.call('getCard', { cardId: card.id }));
  const list = () => ok(f.call('listCards', { states: ['confirmed'], limit: 24 }));
  assert.equal(get().card.body, hidden);
  assert.ok(list().cards.some(item => item.id === card.id));
  f.forget();
  for (const value of [get(), list()]) {
    missing(value);
    missing(value, f.stored.id);
  }
});

test('Card topics omit titles derived from withdrawn contributors', async t => {
  const f = await fixture(t);
  const draft = ok(f.call('createCardDraft', { actionId: 'create-topic-card', drafting: 'authored',
    input: { title: hidden, body: hidden, memoryRefs: [memoryRef(f.b)], sourcePolicy: 'retained-receipts-v1' } }));
  const card = f.confirm(draft);
  const map = () => ok(f.call('mapEvidence', { type: 'card' }));
  ok(f.call('applyCardPlacement', { actionId: 'place-topic-card', refs: [{ type: 'card', namespace: ns,
    cardId: card.id, revision: card.revision, bodyRevision: card.bodyRevision }],
    expectedIndexRevision: map().indexRevision, proposal: { items: [{ cardId: card.id, parentIds: [],
      newL1: { title: hidden, parentL2Ids: [] } }] } }));
  assert.ok(JSON.stringify(map()).includes(hidden));
  f.forget();
  const value = map();
  missing(value);
  missing(value, card.id);
});

test('private retained source text is revalidated at the source entry', async t => {
  const f = await fixture(t);
  const sources = ok(f.call('fetchEvidence', { intent: 'current', refs: [memoryRef(f.b)] })).items[0].provenance.sources;
  const source = sources.find(ref => ref.receiptId === f.stored.id);
  assert.ok(source);
  const get = () => f.call('getSource', { source });
  assert.ok(JSON.stringify(ok(get())).includes(hidden));
  f.forget();
  missing(get());
});

for (const intent of ['current', 'history']) {
  test(`private evidence excludes shared contributors in ${intent} reads`, async t => {
    const f = await fixture(t);
    const fetch = () => ok(f.call('fetchEvidence', { intent, refs: [memoryRef(f.b)] }));
    assert.ok(JSON.stringify(fetch()).includes(f.stored.id));
    f.forget();
    const value = fetch();
    assert.equal(value.items[0].ref.memoryId, f.b.id);
    assert.equal(value.items[0].provenance.receiptMetadata.length, 1);
    missing(value, f.stored.id);
  });
}

test('role evidence keeps independent support and excludes withdrawn receipt references', async t => {
  const f = await fixture(t);
  const h = host({ counter: { id: 'synthetic', countTokens: () => 1 } });
  const core = openMemoryCore({ path: f.path, methodPackages: h.methods, assets: h.assets, roleProfiles: h.options, contextRead: h.context });
  t.after(() => core.close());
  ok(core.publishRoleProfileRelease(publish(ns, 'evidence-role', 'publish-evidence-role'), {}));
  const context = () => ok(core.readRoleTaskContext({ ...read('evidence-role', [ns]), task: 'Synthetic retained conclusion' }, {}));
  assert.ok(JSON.stringify(context()).includes(f.stored.id));
  f.forget();
  const value = context();
  assert.ok(JSON.stringify(value).includes(f.b.id));
  missing(value);
  missing(value, f.stored.id);
});

test('engine Card source snapshots omit withdrawn receipts before clustering', async t => {
  const f = await fixture(t), storage = createEngineCardStorage({ db: f.db, identity: f.identity, ready() {} });
  const details = () => storage.pressureItems(ns, [f.b], { rawSpans: true });
  assert.ok(JSON.stringify(details()).includes(hidden));
  f.forget();
  const value = details();
  assert.ok(JSON.stringify(value).includes(kept));
  missing(value);
});
