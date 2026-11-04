// Test-only coverage policy and canonical-input checks. No database/byte IO.
import assert from 'node:assert/strict';
import { fixtureSpecs,queries,seed,inventory,memoryText,cardText,refKey } from '../corpus.mjs';
import { goldRanking } from '../gold-rank.mjs';
import { boundedText } from '../../../core/validation.mjs';
import { cardText as canonicalCardText } from '../../../core/private-card-input.mjs';

const deterministicIds=['m1112-v18','m1112-v23'];
export function snapshotPlan(mode) {
  if(!['reduced','full'].includes(mode))throw Error('qualification_input_mode_required: reduced|full');
  return {mode,deterministicIds:[...deterministicIds],
    selected:fixtureSpecs.filter(s=>mode==='full'||deterministicIds.includes(s.id)),
    skipped:fixtureSpecs.filter(s=>mode==='reduced'&&!deterministicIds.includes(s.id))};
}

export function verifyFrozenCatalogs(manifest,labels) {
  assert.equal(manifest.seed,seed);assert.equal(manifest.hashAlgorithm,'sha256');assert.equal(labels.version,1);
  const ids=fixtureSpecs.map(s=>s.id);
  assert.deepEqual(manifest.snapshots.map(s=>s.id),ids);assert.deepEqual(labels.fixtures.map(f=>f.id),ids);
  for(const spec of fixtureSpecs) {
    const sealed=manifest.snapshots.find(s=>s.id===spec.id),f=labels.fixtures.find(f=>f.id===spec.id);
    for(const key of ['count','schema','cards'])assert.equal(sealed[key],spec[key],spec.id+':'+key);
    assert.match(sealed.contentHash,/^[a-f0-9]{64}$/);assert.match(sealed.schemaHash,/^[a-f0-9]{64}$/);
    assert.equal(f.count,spec.count);assert.equal(f.schema,spec.schema);
    for(const type of ['memory','card']) {
      const entries=f.catalog.filter(c=>c.ref.type===type),count=type==='memory'?24:Math.min(24,spec.cards);
      assert.deepEqual(entries.map(c=>c.ordinal),Array.from({length:count},(_,i)=>i));
    }
    const all=new Map(f.catalog.map(c=>[refKey(c.ref),c]));assert.equal(all.size,f.catalog.length);
    for(const c of f.catalog) {
      const ref=c.ref,memory=ref.type==='memory';assert.ok(memory||ref.type==='card');
      assert.deepEqual(Object.keys(ref).sort(),(memory?['type','namespace','memoryId','revision']:['type','namespace','cardId','revision','bodyRevision']).sort());
      assert.deepEqual(ref.namespace,inventory[c.ordinal%inventory.length]);
      assert.match(ref.memoryId??ref.cardId,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
      assert.equal(ref.revision,memory?1:2);if(!memory)assert.equal(ref.bodyRevision,1);
      const card=memory?null:cardText(c.ordinal);
      assert.equal(c.text,memory?boundedText(memoryText(c.ordinal),4000):canonicalCardText(card.title,200)+'\n'+canonicalCardText(card.body,20000));
    }
    assert.deepEqual(f.queries.map(q=>q.id),queries.map(q=>q.id));
    for(const q of f.queries) {
      assert.equal(new Set(q.relevant.map(refKey)).size,q.relevant.length,'ambiguous gold');
      for(const ref of [...q.relevant,...q.ranking,...q.knownMisses])assert.deepEqual(ref,all.get(refKey(ref))?.ref);
      if(q.id==='single-han') {
        assert.equal(q.knownMisses.length,1);assert.equal(all.get(refKey(q.knownMisses[0])).text,'中文');
        assert.deepEqual(q.ranking,[]);assert.equal(q.recallAt12,0);
      }else {
        const ranking=goldRanking(f.catalog,queries.find(x=>x.id===q.id).query);
        assert.deepEqual(q.ranking,ranking);assert.deepEqual(q.relevant,ranking);assert.deepEqual(q.knownMisses,[]);
        assert.equal(q.recallAt5,q.relevant.length?Math.min(5,q.ranking.length)/q.relevant.length:null);
        assert.equal(q.recallAt12,q.relevant.length?Math.min(12,q.ranking.length)/q.relevant.length:null);
      }
    }
  }
}
