import { createCardCurrentStorage } from '../card-current-storage.mjs';
import { readTransaction } from '../database.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, ns, ok, host, cardOptions, importMethod, adopt } from './card-current-fixture.mjs';
import { sourceFixture, savedSource, anchor, resolve, draft, ns as rawNamespace } from '../testing/raw-source-fixtures.mjs';
import { openMemoryCore } from '../index.mjs';

for(const mutation of ['correct','forget'])test('C22 declared authored body/history survives required Memory '+mutation,t=>{
 const f=fixture(t),receipt={client:'s',sessionId:'s',eventId:'source',role:'user',excerpt:'Source record'};
 const memory=ok(f.core.admit({namespace:ns,memory:{content:'Source record',kind:'fact'},receipts:[receipt]})).memory;
 const ref=f.card({memoryRefs:[{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}]}),before=ok(f.call('getCard',{namespace:ns,cardId:ref.cardId})).card;
 ok(f.core[mutation]({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision,...(mutation==='correct'?{content:'Corrected source record',kind:'fact',receipt:{...receipt,eventId:'corrected',excerpt:'Corrected source record'}}:{})}));
 assert.equal(ok(f.call('getCard',{namespace:ns,cardId:ref.cardId})).card,null);
 const retained=f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(ref.cardId);assert.equal(retained.body,before.body);assert.equal(retained.title,before.title);
 const identity=f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
 assert.equal(readTransaction(f.db,()=>createCardCurrentStorage({db:f.db,identity}).compare(ns,retained)).status,'needs-review');
 const latest={...ref,revision:retained.revision};for(const intent of ['current','history'])assert.equal(f.call('fetchEvidence',{namespace:ns,intent,refs:[latest]}).error.code,'evidence_unavailable');
});

test('C22 feature-off forget excludes required Raw support without purging independently authored declared Card history',async t=>{
 const h=host(),f=sourceFixture(t,{coreOptions:{privateCards:cardOptions(h.authority),methodPackages:h.methods},model:{extract:()=>({items:[{content:'Synthetic source interpretation',kind:'fact',confidence:.8,sourceIndices:[0]}]})}});
 const v=ok(f.call('importMethodVersion',importMethod('raw-method','Synthetic method',rawNamespace)));ok(f.call('adoptMethodVersion',adopt(v,'raw-adopt',null,rawNamespace,null,[rawNamespace])));
 const resolved=ok(f.call('resolveMethod',{package:v.package,readSet:[rawNamespace],roleId:'finance'}));
 const source=await savedSource(f),refs=await resolve(f,[anchor(source)]),pending=ok(draft(f,refs));
 const saved=ok(f.call('confirmCardDraft',{namespace:rawNamespace,cardId:pending.id,expectedRevision:1,actionId:'confirm',applicability:'current',currentDependencies:{context:{readSet:[rawNamespace],roleId:'finance'},packages:[{package:v.package,snapshot:resolved.snapshot}]}}));
 const before=ok(f.call('getCard',{namespace:rawNamespace,cardId:saved.id})).card;
 const off=openMemoryCore({path:f.path});f.workspace.defer(()=>off.close());const memory=f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();
 ok(off.forget({namespace:rawNamespace,memoryId:memory.id,expectedRevision:memory.revision}));
 assert.equal((await f.call('getSource',{namespace:rawNamespace,source:refs[0]})).error.code,'source_excluded');
 assert.equal(ok(f.call('getCard',{namespace:rawNamespace,cardId:saved.id})).card,null);
 const after=f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(saved.id);assert.equal(after.body,before.body);
 const ref={type:'card',namespace:rawNamespace,cardId:saved.id,revision:after.revision,bodyRevision:after.body_revision};
 for(const intent of ['current','history'])assert.equal(f.call('fetchEvidence',{namespace:rawNamespace,intent,refs:[ref]}).error.code,'evidence_unavailable');
});
