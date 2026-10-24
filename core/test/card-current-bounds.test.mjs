import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createCardCurrentStorage } from '../card-current-storage.mjs';
import { readTransaction } from '../database.mjs';
import { fixture, host, ok, ns, project, importMethod, adopt, query } from './card-current-fixture.mjs';
import { meteredText } from '../context-read-assembly.mjs';

test('C26 independent 16-package/four-level probe bound, no method-body reads and exact assembly wire recount',async t=>{
 const f=fixture(t,{h:host({counter:{id:'synthetic-utf8-16',countTokens:text=>Math.ceil(Buffer.byteLength(text)/16)}})}),packages=[f.v1.package];
 for(let i=1;i<16;i++){const v=ok(f.call('importMethodVersion',importMethod('import-'+i)));ok(f.call('adoptMethodVersion',adopt(v,'binding-'+i)));packages.push(v.package);}
 const ref=f.card({packages,context:{readSet:[ns,project],roleId:'finance'}}),identity=f.db.prepare('SELECT store_id,cursor_secret FROM store_metadata').get();
 const storage=createCardCurrentStorage({db:f.db,identity:{storeId:identity.store_id,cursorSecret:identity.cursor_secret}}),card=f.db.prepare('SELECT id,revision,body_revision FROM private_cards WHERE id=?').get(ref.cardId);
 let record=0,binding=0,methodBody=0;const original=DatabaseSync.prototype.prepare;
 const spy=t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
   if(/SELECT.*\btext\b.*FROM method_files/s.test(sql))methodBody++;
   if(/FROM card_current_dependencies WHERE card_id=/.test(sql))record++;
   if(/FROM method_bindings WHERE/.test(sql))binding++;
   return original.call(this,sql);
 });
 for(let i=0;i<2;i++)readTransaction(f.db,()=>assert.equal(storage.compare(ns,card,[ns,project]).status,'current'));
 assert.equal(record,2);assert.equal(binding,128);assert.equal(methodBody,0);spy.mock.restore();
 const result=ok(await f.call('contextRead',query({readSet:[ns,project]})));
 assert.equal(result.diagnostics.budget.used,Math.ceil(Buffer.byteLength(meteredText(result.metered))/16));
 assert.equal(result.diagnostics.items[0].metadata.support.currentDependency.versions.length,16);
 console.log(JSON.stringify({C26:{cards:1,passes:2,dependencyLookups:record,bindingProbes:binding,subtotal:record+binding,bound:65*2,methodBodyReads:methodBody}}));
});

test('C26 authoring accepts 16 reviewed pins above the legacy Card snapshot budget while keeping the stored vector bounded',t=>{
 const f=fixture(t),personal={ownerId:'o'.repeat(130),scope:'personal',projectId:null},projectScope={...personal,scope:'project',projectId:'界'.repeat(200)},context={readSet:[personal,projectScope],roleId:'finance'},packages=[],vector=[];
 for(let i=0;i<16;i++){
  const v=ok(f.call('importMethodVersion',importMethod('long-package-'+i,'Method',personal)));ok(f.call('adoptMethodVersion',adopt(v,'long-bind-'+i,'finance',projectScope,null,context.readSet)));
  const resolution=ok(f.call('resolveMethod',{...context,package:v.package})),state=JSON.parse(Buffer.from(resolution.snapshot.split('.')[0],'base64url').toString('utf8')).states[0];packages.push({package:v.package,snapshot:resolution.snapshot});
  vector.push({package:v.package,version:v.version,consulted:state.consulted,availability:{packageState:'available',versionState:'available',versionRevision:1}});
 }
 for(const entry of packages)entry.snapshot=ok(f.call('resolveMethod',{...context,package:entry.package})).snapshot;
 const currentDependencies={context,packages},units=JSON.stringify(currentDependencies).length,bytes=Buffer.byteLength(JSON.stringify(vector));console.log(JSON.stringify({reviewedPinUnits:units,storedVectorBytes:bytes}));assert.ok(units>100000);assert.ok(bytes<=32768);
 const draft=ok(f.call('createCardDraft',{namespace:personal,actionId:'long-draft',drafting:'authored',input:{title:'Finance',body:'Uses current method',authoredInput:{text:'Source',occurredAt:null}}}));
 ok(f.call('confirmCardDraft',{namespace:personal,cardId:draft.id,expectedRevision:1,actionId:'long-confirm',applicability:'current',currentDependencies}));
 assert.equal(f.db.prepare('SELECT count(*) n FROM card_current_dependencies WHERE card_id=?').get(draft.id).n,1);
});
