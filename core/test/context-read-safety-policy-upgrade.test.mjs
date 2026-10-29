import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fixture, ns, ok, readTransaction } from '../testing/context-read-fixture.mjs';
import { card, descriptor } from '../testing/context-product-owner-fixture.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { productSidecar, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { accessDigest, digest, projectionDigest } from '../context-product-validation.mjs';
import { PRODUCT_PROFILE } from '../context-product-control.mjs';
import { contextReadSet } from '../context-read-input.mjs';
import { memoryReadEligible } from '../content-safety.mjs';

const legacyProjection = input => digest({ profile: PRODUCT_PROFILE, readSet: contextReadSet(input.readSet, PRODUCT_PROFILE),
  types: ['memory', 'card'].filter(type => input.types.includes(type)), intent: input.intent });
const moduleUrl = source => 'data:text/javascript,' + encodeURIComponent(source);
const validationUrl = new URL('../context-product-validation.mjs', import.meta.url).href;
const eligibilityUrl = new URL('../context-read-sidecar.mjs', import.meta.url).href;
const inputUrl = new URL('../context-read-input.mjs', import.meta.url).href;
const controlUrl = new URL('../context-product-control.mjs', import.meta.url).href;
// Exercise the real B1 writer with its pre-S1 identity and confirmed-only history policy.
const legacyValidation = moduleUrl(`export * from ${JSON.stringify(validationUrl)};
  import { digest } from ${JSON.stringify(validationUrl)};
  import { contextReadSet } from ${JSON.stringify(inputUrl)};
  import { PRODUCT_PROFILE } from ${JSON.stringify(controlUrl)};
  export const projectionDigest = ${legacyProjection.toString()};`);
const legacyEligibility = moduleUrl(`import { contextCardEligible as current } from ${JSON.stringify(eligibilityUrl)};
  export const contextCardEligible = (db, identity, features, ns, row, intent, options) =>
    intent === 'history' ? row.state === 'confirmed' : current(db, identity, features, ns, row, intent, options);`);
const sidecarUrl = new URL('../context-product-sidecar.mjs', import.meta.url);
const legacySource = readFileSync(sidecarUrl, 'utf8').replace(/from '(\.\/[^']+)'/g, (_, path) =>
  'from ' + JSON.stringify(path === './context-product-validation.mjs' ? legacyValidation :
    path === './context-read-sidecar.mjs' ? legacyEligibility : new URL(path, sidecarUrl).href));
const { productSidecar: legacySidecar } = await import(moduleUrl(legacySource));

function storage(t, f, p, factory = productSidecar) {
  const facade = openContextProductFacade(f.path, {}), { db, identity, features } = facade.port;
  let clock = 0, stop = null;
  const sidecar = factory({ path: f.path, db, identity, features, writable: true, now: () => clock,
    rendezvous(point) { if (point === stop) clock = 900; } });
  let closed = false;
  const close = () => { if (!closed) { closed = true; sidecar.close(); facade.close(); } };
  t.after(close);
  const access = accessDigest({ ownerId: ns.ownerId, namespaces: { readSet: [ns] } });
  return { close, facade,
    step(point = null) { clock = 0; stop = point; return sidecar.refresh(p, access, { maxItems: 1024, maxMs: 1000 }); },
    observe() { return readTransaction(db, () => sidecar.observe(p, access)); },
    lexical(publication, query = 'needle') { return sidecar.lexical(p, publication, query); },
    candidates() {
      const index = openProductIndex({ path: f.path, facade, ownerCoverage: p.ownerCoverage,
        authorize: () => ({ accessGenerations: access, check() {}, envelope: work => work() }) });
      try { return ok(index.run('findCandidates', { readSet: p.readSet, types: p.types, intent: p.intent, query: 'needle' }, {})); }
      finally { index.close(); }
    },
    finish() {
      const totals = {};
      for (let i = 0; i < 100; i++) {
        for (const [key, value] of Object.entries(this.step())) totals[key] = (totals[key] ?? 0) + value;
        const observed = this.observe();
        if (observed.dto.lexical.state === 'ready') return { ...observed, totals };
      }
      assert.fail('policy upgrade must converge');
    },
    delivered(publication) {
      const refs = this.lexical(publication).rows.map(row => row.ref);
      return readTransaction(db, () => refs.map(ref => facade.port.evidence.itemsInside(ns, [ref], p.intent, [ns])[0]));
    } };
}
const projection = types => ({ readSet: [ns], types, intent: 'history', ownerCoverage: descriptor([ns]) });

for (const pending of [false, true]) test(`S1 policy upgrade rebuilds pre-S1 ${pending ? 'verification work' : 'publication'}`, t => {
  const f = fixture(t, { cards: true }), memory = f.admit('Synthetic forgotten source.');
  const unsafe = card(f, ns, 'Unsafe needle title', 'Unsafe authored needle body.', memory);
  const safe = card(f, ns, 'Safe needle title', 'Safe authored needle body.');
  ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  assert.equal(ok(f.call('getCard', { namespace: ns, cardId: unsafe.id })).card, null);
  const p = projection(pending ? ['memory', 'card'] : ['card']), old = storage(t, f, p, legacySidecar);
  let previous;
  if (pending) {
    old.step('verification');
    const db = new DatabaseSync(f.path + PRODUCT_SIDECAR_SUFFIX, { readOnly: true });
    try {
      previous = db.prepare('SELECT g.* FROM work w JOIN generations g ON g.id=w.generation').get();
      assert.ok(previous.phase >= (pending ? 5 : 4));
      assert.equal(JSON.parse(previous.verify).counts.byType.card.eligible, 2);
      assert.equal(old.observe().publication, null);
    } finally { db.close(); }
  } else {
    previous = old.finish().publication;
    assert.equal(previous.counts.byType.card.eligible, 2);
    assert.equal(old.lexical(previous).matched, 2);
  }
  old.close();
  const upgraded = storage(t, f, p), result = upgraded.finish();
  assert.equal(result.dto.lexical.state, 'ready');
  assert.equal(result.publication.counts.byType.card.eligible, 1);
  assert.ok(result.totals.canonicalRows >= 2);
  assert.notEqual(result.publication.generation.id, pending ? previous.id : previous.generation.id);
  assert.deepEqual(upgraded.lexical(result.publication).rows.map(row => row.ref.cardId), [safe.id]);
  assert.deepEqual(upgraded.candidates().items.map(item => item.ref.cardId), [safe.id]);
  const delivered = upgraded.delivered(result.publication);
  assert.equal(delivered[0].body, 'Safe authored needle body.');
  assert.equal(JSON.stringify(delivered).includes('Unsafe'), false);
  assert.equal(upgraded.step().canonicalRows, 0);
});

for (const intent of ['current', 'history']) test(`S1 Memory-only ${intent} projection preserves identity and serves its pre-S1 publication`, t => {
  for (const deleted of [0, 1]) for (const currentness of ['current', 'historical']) for (const review_state of ['confirmed', 'awaiting']) {
    const row = { deleted, currentness, review_state };
    assert.equal(memoryReadEligible(row, intent), !row.deleted &&
      (intent === 'history' || row.currentness === 'current' && row.review_state !== 'awaiting'));
  }
  const f = fixture(t);
  ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic needle Memory content.', kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'upgrade', eventId: 'receipt', role: 'user', excerpt: 'receiptOnlyToken' }] }));
  const p = { ...projection(['memory']), intent };
  assert.equal(projectionDigest(p), legacyProjection(p));
  const old = storage(t, f, p, legacySidecar), previous = old.finish().publication;
  old.close();
  const upgraded = storage(t, f, p), found = upgraded.observe();
  assert.equal(found.dto.lexical.state, 'ready');
  assert.deepEqual(found.publication, previous);
  const metrics = upgraded.step();
  assert.equal(metrics.canonicalRows, 0);
  assert.equal(metrics.tokenized, 0);
  assert.equal(upgraded.observe().publication.publicationId, previous.publicationId);
  assert.equal(upgraded.candidates().items.length, 1);
  assert.equal(upgraded.delivered(previous)[0].content, 'Synthetic needle Memory content.');
  assert.equal(upgraded.lexical(previous, 'receiptOnlyToken').matched, 0);
});
