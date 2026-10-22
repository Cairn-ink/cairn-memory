import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { RELATION_LIMIT } from '../../../core/relation-limits.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { armDocuments, armQueries } from '../lib/fixture.mjs';
import { createA0Store, frozenA0Stores, a0b, A0_SEEDING } from '../lib/a0-core.mjs';
import { runRankings } from '../run.mjs';
import { toyFixture, document } from './fixtures-arms/toy.mjs';
function projections(fixture) {
  const project=(intent,include)=>armDocuments(fixture,{namespace:'target',scale:'S300',intent,include});
  return {history:project('history','body'),current:project('current','body'),spans:project('history','spans')};
}
function projectedRows(currentCount, historicalCount) {
  const rows = (count, prefix, token) => Array.from({length:count}, (_, i) => {
    const suffix = String(i).padStart(4, '0');
    return document(`${prefix}-${suffix}`, `${token} ${token}${suffix} synthetic record ${suffix}`);
  });
  const current = rows(currentCount, 'c', 'currentonly'), historical = rows(historicalCount, 'h', 'historiconly');
  const history = [...current, ...historical];
  return { current, history, spans: history.flatMap((doc, i) => Array.from({length:1 + i % 3}, (_, j) =>
    document(doc.memoryId, `Synthetic source ${doc.memoryId} excerpt ${j}`, 'span', `${doc.memoryId}#s${j}`))) };
}
function inspectStore(path, mapping) {
  const db = new DatabaseSync(path, {readOnly:true}), reverse = new Map(Object.entries(mapping).map(([id, uuid]) => [uuid, id]));
  try {
    return { states: Object.fromEntries(db.prepare('SELECT id, currentness FROM memories').all().map(row => [reverse.get(row.id), row.currentness])),
      links: db.prepare('SELECT previous_memory_id, replacement_memory_id FROM memory_supersessions').all()
        .map(row => [reverse.get(row.previous_memory_id), reverse.get(row.replacement_memory_id)])
        .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
      receiptCount: db.prepare('SELECT count(*) AS n FROM receipts').get().n };
  } finally { db.close(); }
}

test('more historical rows than the relation limit use distinct deterministic replacements and preserve eligibility', t => {
  const workspace = createTestWorkspace(t, {prefix:'hr1-a0-distinct-'}), rows = projectedRows(16, 12);
  assert.ok(rows.history.length - rows.current.length > RELATION_LIMIT);
  const expectedLinks = rows.history.filter(doc => doc.memoryId.startsWith('h-')).map((doc, i) => [doc.memoryId, rows.current[i].memoryId]);
  for (const shuffled of [false, true]) {
    const input = Object.fromEntries(Object.entries(rows).map(([key, docs]) => [key, shuffled ? [...docs].reverse() : docs]));
    const path = join(workspace.path, `store-${Number(shuffled)}.sqlite`), store = createA0Store({...input, path});
    try {
      const saved = inspectStore(path, store.mapping);
      assert.deepEqual(saved.links, expectedLinks);
      assert.equal(new Set(saved.links.map(([, current]) => current)).size, 12);
      assert.equal(saved.receiptCount, rows.spans.length); // supersede reuses already admitted receipts
      for (const doc of rows.history) {
        const historical = doc.memoryId.startsWith('h-'), token = doc.text.split(' ')[1];
        assert.equal(saved.states[doc.memoryId], historical ? 'historical' : 'current');
        for (const intent of ['current', 'history']) {
          const result = store.search({text:token, intent}, {paged:true});
          assert.deepEqual(result.errors, []);
          assert.deepEqual(result.ranked, historical && intent === 'current' ? [] : [doc.memoryId]);
        }
      }
    } finally { store.close(); }
  }
});

test('insufficient distinct current replacements refuse with a fixed code before admitting rows', t => {
  const workspace = createTestWorkspace(t, {prefix:'hr1-a0-insufficient-'});
  for (const count of [0, 1]) {
    const path = join(workspace.path, `store-${count}.sqlite`);
    assert.throws(() => createA0Store({...projectedRows(count, 2), path}), {message:'a0_current_replacement_required'});
    const db = new DatabaseSync(path, {readOnly:true});
    try { assert.equal(db.prepare('SELECT count(*) AS n FROM memories').get().n, 0); }
    finally { db.close(); }
  }
});

test('synthetic fixture scale seeds 1000 memories, 20 historical rows and one to three receipts without fan-out overflow', () => {
  const rows = projectedRows(980, 20), store = createA0Store(rows);
  try {
    assert.equal(Object.keys(store.mapping).length, 1000);
    for (const intent of ['current', 'history']) {
      const result = store.search({text:'historiconly', intent}, {paged:true});
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.ranked.sort(), intent === 'current' ? [] : rows.history.filter(doc => doc.memoryId.startsWith('h-')).map(doc => doc.memoryId));
      assert.equal(result.scannedRows, 1000); // coverage counts rows before intent eligibility
    }
    const current = store.search({text:'currentonly', intent:'current'}, {paged:true});
    assert.deepEqual(current.errors, []);
    assert.equal(current.scannedRows, 1000);
    assert.equal(current.ranked.length, 24);
    assert.ok(current.ranked.every(id => id.startsWith('c-')));
  } finally { store.close(); }
});

test('v2 fingerprints bypass stale v1 snapshots and rankings record the seeding version for all five stores', async t => {
  const workspace = createTestWorkspace(t, {prefix:'hr1-a0-version-'}), fixture = toyFixture(), rows = projections(fixture);
  const directory = join(workspace.path, 'snapshots'), fingerprint = seeding => createHash('sha256')
    .update(JSON.stringify({scale:'S300', ...rows, seeding})).digest('hex');
  assert.equal(A0_SEEDING, 'hr1-projection-v2');
  const legacyRoot = join(directory, `S300-${fingerprint('hr1-projection-v1')}`);
  mkdirSync(legacyRoot, {recursive:true});
  const legacyPath = join(legacyRoot, 'store-0.sqlite'); writeFileSync(legacyPath, 'legacy snapshot sentinel');
  const result = await runRankings({fixtureDir:workspace.path, split:'dev', scale:'S300', arms:['A0-default','A0-paged'],
    models:[], out:join(workspace.path, 'rankings'), storeDir:directory}, {
    fixtureAPI:{loadFixture:async () => fixture, armDocuments, armQueries},
  });
  assert.equal(result.outputs.length, 10);
  for (const output of result.outputs) {
    assert.equal(output.run.status, 'complete');
    assert.equal(output.run.seeding, A0_SEEDING);
    assert.equal(output.run.snapshot.path, join(directory, `S300-${fingerprint(A0_SEEDING)}`, `store-${output.run.store}.sqlite`));
    assert.equal(JSON.parse(readFileSync(output.run.snapshot.manifest, 'utf8')).fingerprint, fingerprint(A0_SEEDING));
  }
  assert.equal(new Set(result.outputs.map(output => output.run.snapshot.path)).size, 5);
  assert.equal(readFileSync(legacyPath, 'utf8'), 'legacy snapshot sentinel');
});
test('public A0 admit/supersede/receipt seed enables selectEvidence with trusted host',()=>{
  const store=createA0Store(projections(toyFixture()));
  try {
    assert.equal(store.capabilities.evidenceReads.version,'exact-namespace-evidence-v1');
    assert.equal(store.capabilities.evidenceReads.defaults.limit,12);
    assert.equal(store.capabilities.evidenceReads.defaults.scanRows,128);
    const current=store.search({text:'Amber',intent:'current'});
    assert.deepEqual(current.ranked.sort(),['m-a','m-c']);
    const history=store.search({text:'Amber',intent:'history'},{paged:true});
    assert.ok(history.ranked.includes('m-old')); assert.ok(history.ranked.includes('m-await'));
    assert.equal(history.errors.length,0); assert.equal(history.coverage.at(-1).status,'complete');
    assert.equal(history.scannedRows,6); assert.equal(current.pages,1);
    assert.equal(current.recall24Available,false);
  } finally{store.close();}
});
test('A0-paged follows unchanged cursor parameters to completion, truncates concatenated API order',()=>{
  const docs=Array.from({length:160},(_,i)=>document(`m-${i}`,'common synthetic row '+i));
  const store=createA0Store({history:docs,current:docs,spans:docs.map(doc=>document(doc.memoryId,doc.text,'span'))});
  try{
    const defaults=store.search({text:'common',intent:'current'}),paged=store.search({text:'common',intent:'current'},{paged:true});
    assert.equal(defaults.ranked.length,12); assert.equal(paged.ranked.length,24);
    assert.equal(paged.pages,7); assert.equal(paged.scannedRows,160); assert.deepEqual(paged.errors,[]);
    assert.deepEqual(paged.coverage.map(c=>c.scannedRows),[24,24,24,24,24,24,16]);
    const expected=Object.entries(store.mapping).sort((a,b)=>a[1]<b[1]?-1:1).slice(0,24).map(([id])=>id);
    assert.deepEqual(paged.ranked,expected);
  }finally{store.close();}
});
test('five frozen UUID stores, mappings and rankings stable on reopen',t=>{
  const workspace=createTestWorkspace(t,{prefix:'hr1-a0-'}), fixture=toyFixture();
  const options={...projections(fixture),directory:join(workspace.path,'snapshots'),scale:'S300'};
  const stores=frozenA0Stores(options),mapping=stores.map(store=>store.mapping),rankings=stores.map(store=>store.search({text:'Amber',intent:'history'}));
  assert.equal(stores.length,5); assert.equal(new Set(mapping.map(m=>m['m-a'])).size,5);
  for(const store of stores)store.close();
  const reopened=frozenA0Stores(options);
  try{assert.deepEqual(reopened.map(store=>store.mapping),mapping);
    assert.deepEqual(reopened.map(store=>store.search({text:'Amber',intent:'history'})),rankings);
  }finally{for(const store of reopened)store.close();}
});
test('A0 foreign projection invariance and A0b full projection retains zeroes',()=>{
  const fixture=toyFixture(),filtered=structuredClone(fixture);
  filtered.corpus.memories=filtered.corpus.memories.filter(m=>m.namespace==='target');
  const a=createA0Store(projections(fixture)),b=createA0Store(projections(filtered));
  try{
    assert.deepEqual(a.search({text:'unmatched',intent:'current'}).ranked,b.search({text:'unmatched',intent:'current'}).ranked);
    assert.deepEqual(a.search({text:'Amber',intent:'current'}).ranked.sort(),b.search({text:'Amber',intent:'current'}).ranked.sort());
    assert.deepEqual(a0b([document('b','none'),document('a','none')],'absent').map(row=>row.memoryId),['a','b']);
  }finally{a.close();b.close();}
});
