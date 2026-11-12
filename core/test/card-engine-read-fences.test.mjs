import test from 'node:test';
import assert from 'node:assert/strict';
import { engineCardFixture, ns, ok } from '../testing/engine-card-fixture.mjs';
import { configured, prebuild } from '../testing/context-product-owner-fixture.mjs';

for (const change of ['receipt', 'forget']) test(`engine Cards fence embedded and product candidates, evidence and assembly after source ${change}`, async t => {
  const f = engineCardFixture(t), memories = f.seed(8);
  const card = ok(await f.pass()).built[0]; assert.ok(card);
  ok(await f.refresh());
  const service = configured(t, f.path, [ns], { service: true });
  await prebuild(service);
  const request = configured(t, f.path, [ns]), product = await request.open();
  const input = { readSet: [ns], types: ['memory', 'card'], intent: 'current',
    query: 'Orion current state', semantic: false, raw: false, deadlineMs: 5000 };
  const candidates = ({ raw, ...fields }) => fields;
  const embedded = (method, fields) => f.trusted.call(f.core, method, method === 'findCandidates' ? candidates(fields) : fields);
  const warmEmbedded = ok(await embedded('findCandidates', input));
  const warmProduct = ok(await product.findCandidates(candidates(input), request.token));
  assert.ok(warmEmbedded.items.some(item => item.ref.cardId === card.id));
  assert.ok(warmProduct.items.some(item => item.ref.cardId === card.id));
  const refs = [warmEmbedded.items.find(item => item.ref.cardId === card.id).ref];
  const snapshots = [ok(await embedded('contextRead', input)).snapshot,
    ok(await product.contextRead(input, request.token)).snapshot];
  if (change === 'forget') ok(f.core.forget({ namespace: ns, memoryId: memories[0].id, expectedRevision: memories[0].revision }));
  else {
    // Receipt removal does not advance the Card revision or namespace epoch.
    // This exercises canonical checks even when the sidecar remains warm.
    f.db.prepare('DELETE FROM receipts WHERE memory_id=?').run(memories[0].id);
    assert.equal(f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(card.id).revision, 1);
  }
  for (const intent of ['current', 'history']) {
    const fields = { ...input, intent };
    for (const result of [await embedded('findCandidates', fields), await embedded('contextRead', fields),
      await product.findCandidates(candidates(fields), request.token), await product.contextRead(fields, request.token),
      await embedded('fetchCandidateEvidence', { readSet: [ns], refs, intent }),
      await product.fetchCandidateEvidence({ readSet: [ns], refs, intent }, request.token)]) {
      assert.equal(JSON.stringify(result).includes(card.id), false, JSON.stringify(result));
      assert.equal(JSON.stringify(result).includes('Orion current state:'), false, JSON.stringify(result));
    }
  }
  for (const result of [await embedded('fetchCandidateEvidence', { readSet: [ns], snapshot: snapshots[0] }),
    await product.fetchCandidateEvidence({ readSet: [ns], snapshot: snapshots[1] }, request.token)])
    assert.equal(JSON.stringify(result).includes(card.id), false, JSON.stringify(result));
});
