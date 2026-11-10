import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
const root = new URL('../../../', import.meta.url);
for(const limit of [1,4])test(`forget after epoch rollback ${limit} fences the arrived UUID before a fork`,async t=>{
 const {fixture,ok}=await import(new URL('adapters/local/test/fixtures/workspace.mjs',root));
 const {openMemoryCore,openMemoryStore}=await import(new URL('core/index.mjs',root));
 const f=fixture(t,{client:'claude-code'}),db=new DatabaseSync(f.databasePath);f.workspace.defer(()=>db.close());
 const privacy=openMemoryCore({path:f.databasePath,raw:true,rawSearch:false});f.workspace.defer(()=>privacy.close());
 const store=openMemoryStore({path:f.databasePath}),writer=store.scope({ownerId:f.namespace.ownerId});f.workspace.defer(()=>store.close());
 const memory=ok(privacy.admit({namespace:f.namespace,memory:{content:'Synthetic retained anchor',kind:'fact'},receipts:[{client:f.client,sessionId:'original-session',eventId:'anchor',role:'user',excerpt:'Synthetic retained anchor'}]})).memory;
 let seals=0,rollbacks=0,armed=true,forgotten;
 const port={version:'raw-seal-v1',sealRaw({text}){
  if(armed){seals++;writer.remember({content:'Synthetic independent Memory '+seals,kind:'fact',receipt:{client:'synthetic',sessionId:'other-writer',eventId:'epoch-'+seals,role:'user',excerpt:'Synthetic unrelated evidence'}});}
  return {format:'local-plain-v1',keyVersion:null,sealed:Buffer.from(text)};
 },openRaw({sealed}){return {text:Buffer.from(sealed).toString()};}};
 const core=openMemoryCore({path:f.databasePath,rawSearch:false,rawConversations:{mode:'raw-v1',capBytes:1000000,configureCap:false,interpretation:'host',localAuthority:f.config.authority,readPolicy:()=>({generation:'synthetic',reason:null}),port}});f.workspace.defer(()=>core.close());
 const text='Synthetic in-flight source',at=Date.now();
 const raw=(sessionId,eventId,delta)=>({namespace:f.namespace,client:f.client,sessionId,eventId,messages:[{id:'11111111-1111-4111-8111-111111111111',role:'user',occurredAt:new Date(at+delta).toISOString(),messageOrdinal:1,content:text,part:{index:0,start:0,totalUnits:text.length,totalBytes:Buffer.byteLength(text)}}]});
 const native=DatabaseSync.prototype.exec;
 DatabaseSync.prototype.exec=function(sql,...args){
  const result=native.call(this,sql,...args);
  if(armed&&seals===limit&&sql==='ROLLBACK'){
   rollbacks++;armed=false;
   forgotten=privacy.forget({namespace:f.namespace,memoryId:memory.id,expectedRevision:memory.revision});
   assert.equal(forgotten.ok,true,JSON.stringify(forgotten));
  }
  return result;
 };
 let original;try{original=await core.captureRaw(raw('original-session','original',0));}finally{DatabaseSync.prototype.exec=native;}
 assert.equal(rollbacks,1);assert.equal(forgotten.ok,true);
 const before={fences:db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,uuids:db.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n,raw:db.prepare('SELECT count(*) n FROM raw_parts').get().n};
 const fork=await core.captureRaw(raw('fork-session','fork',-2*86400000));
 t.diagnostic(JSON.stringify({limit,seals,original,forgotten,before,fork,unrelatedMemories:db.prepare('SELECT count(*) n FROM memories').get().n,rawAfter:db.prepare('SELECT count(*) n FROM raw_parts').get().n}));
 assert.ok(original.ok === false);
 assert.equal(before.uuids,1);
 assert.equal(before.raw,0);
 assert.equal(db.prepare('SELECT count(*) n FROM raw_parts').get().n,0);
 assert.deepEqual(fork,{ok:false,error:{code:'conversation_deleted',retryable:false}},'the arrived original UUID must stay fenced even when its capture did not store Raw');
});

