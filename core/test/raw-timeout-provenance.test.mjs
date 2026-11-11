import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const root = new URL('../../', import.meta.url);
globalThis.timeoutProvenanceNow=0n;
const hook=registerHooks({load(url,ctx,next){const r=next(url,ctx);if(!url.endsWith('/core/capture-deadline.mjs'))return r;
 const source=r.source.toString();assert.ok(source.includes('const monotonicNow = process.hrtime.bigint;'));
 return {...r,source:source.replace('const monotonicNow = process.hrtime.bigint;','const monotonicNow = () => globalThis.timeoutProvenanceNow;')};}});
const {fixture,request,splitRaw,ns,localPlainPort}=await import(new URL('core/testing/raw-capture-fixtures.mjs',root));
const {openMemoryCore,openMemoryStore}=await import(new URL('core/index.mjs',root));
const {MemoryStoreError}=await import(new URL('core/validation.mjs',root));
const {createRawJournal,retryRawEpochConflict}=await import(new URL('core/raw-journal.mjs',root));
const {transaction}=await import(new URL('core/database.mjs',root));
const {createCaptureDeadline}=await import(new URL('core/capture-deadline.mjs',root));
const {callModel}=await import(new URL('core/model-call.mjs',root));
hook.deregister();
for(const route of ['host','ordinary','staged'])for(const initialEpoch of [false,true])test(`a new timeout in ${route} after priorEpoch=${initialEpoch} retains timeout provenance`,async t=>{
 globalThis.timeoutProvenanceNow=0n;let f,seals=0;
 const port=localPlainPort(),seal=port.sealRaw;
 port.sealRaw=value=>{seals++;
  if(initialEpoch&&seals===1){globalThis.timeoutProvenanceNow+=50_000_000n;f.db.prepare("INSERT INTO namespace_epochs VALUES(?,?,?,2) ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET epoch=epoch+1").run(ns.ownerId,ns.scope,ns.projectId??'');}
  else globalThis.timeoutProvenanceNow+=600_000_000n;
  return seal(value);
 };
 f=fixture(t,{port,kind:route==='staged'?'staged':'ordinary',coreOptions:{captureDeadlineMs:500}});
 let core=f.core;
 if(route==='host'){
  core=openMemoryCore({path:f.path,captureDeadlineMs:500,rawSearch:false,rawConversations:{mode:'raw-v1',capBytes:200000000,port,interpretation:'host',readPolicy:()=>({generation:'notice-1',reason:null})}});
  f.workspace.defer(()=>core.close());
 }
 const result=await core.captureRaw(request(splitRaw('Synthetic later uncontended timeout')[0]));
 t.diagnostic(JSON.stringify({route,initialEpoch,seals,clockMs:Number(globalThis.timeoutProvenanceNow)/1e6,result,parts:f.db.prepare('SELECT count(*) n FROM raw_parts').get().n}));
 assert.equal(seals,initialEpoch?2:1);
 assert.equal(f.calls.filter(c=>c.method==='extract').length,0);
 assert.equal(f.db.isTransaction,false);
 assert.equal(f.db.prepare('SELECT count(*) n FROM raw_parts').get().n,0);
 assert.equal(result.error?.code,'model_timeout','the latest attempt had no epoch change; its preparation itself timed out');
});

for(const kind of ['ordinary','staged'])for(const phase of ['preflight','provider'])test(`${kind} ${phase} timeout on the next, epoch-stable attempt retains its outcome`,async t=>{
 globalThis.timeoutProvenanceNow=0n;let f,seals=0,counted=false;
 const port=localPlainPort(),seal=port.sealRaw;
 port.sealRaw=value=>{seals++;if(seals===1){globalThis.timeoutProvenanceNow+=50_000_000n;f.db.prepare("INSERT INTO namespace_epochs VALUES(?,?,?,2) ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET epoch=epoch+1").run(ns.ownerId,ns.scope,ns.projectId??'');}return seal(value);};
 f=fixture(t,{kind,port,coreOptions:{captureDeadlineMs:500},model:{countTokens(){if(phase==='preflight'&&seals===2&&!counted){counted=true;globalThis.timeoutProvenanceNow+=600_000_000n;}return 1;},extract(){if(phase==='provider'){globalThis.timeoutProvenanceNow+=600_000_000n;throw new MemoryStoreError('model_timeout');}return {items:[]};}}});
 const result=await f.core.captureRaw(request(splitRaw('Synthetic '+phase+' timeout')[0]));
 t.diagnostic(JSON.stringify({kind,phase,seals,result,extracts:f.calls.filter(c=>c.method==='extract').length,parts:f.db.prepare('SELECT count(*) n FROM raw_parts').get().n}));
 assert.equal(seals,2);
 if(phase==='provider'){assert.equal(result.ok,true);assert.equal(result.value.interpretation.error?.code,'model_timeout');assert.equal(f.calls.filter(c=>c.method==='extract').length,1);}
 else {assert.equal(result.error?.code,'model_timeout');assert.equal(f.calls.filter(c=>c.method==='extract').length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM raw_parts').get().n,0);}
 assert.equal(f.db.isTransaction,false);
});

test('a genuine provider/model timeout after an earlier epoch error is not busy in the retry helper',async t=>{
 globalThis.timeoutProvenanceNow=0n;
 const f=fixture(t);const journal=createRawJournal({db:f.db,mode:'raw-v1',port:localPlainPort(),readPolicy:()=>({generation:'notice-1',reason:null})});
 const token=await journal.prepareRegistration(request(splitRaw('Synthetic helper epoch')[0]));
 const store=openMemoryStore({path:f.path});f.workspace.defer(()=>store.close());
 store.scope({ownerId:ns.ownerId}).remember({content:'Synthetic epoch write',kind:'fact',receipt:{client:'synthetic',sessionId:'other',eventId:'epoch',role:'user',excerpt:'Synthetic evidence'}});
 let epoch;try{transaction(f.db,()=>journal.commitRegistration(token));}catch(e){epoch=e;}
 assert.equal(epoch?.code,'storage_busy');
 const deadline=createCaptureDeadline(500);let calls=0,providerCalls=0,caught;
 try{await retryRawEpochConflict(async()=>{
  if(++calls===1)throw epoch;
  return await callModel({contextWindow:8192,countTokens:()=>1,extract(){providerCalls++;globalThis.timeoutProvenanceNow+=600_000_000n;throw new MemoryStoreError('model_timeout');}},'extract','Synthetic system',{}, {deadline});
 },{deadline});}catch(e){caught=e;}
 t.diagnostic(JSON.stringify({calls,providerCalls,code:caught?.code}));
 assert.equal(providerCalls,1);assert.equal(caught?.code,'model_timeout');
});


for (const kind of ['ordinary', 'staged']) test(`a failed ${kind} preflight cannot borrow its registration's epoch refusal`, async t => {
 globalThis.timeoutProvenanceNow = 0n;
 let f, seals = 0;
 const port = localPlainPort(), seal = port.sealRaw;
 port.sealRaw = value => {
  seals++;
  f.db.prepare("INSERT INTO namespace_epochs VALUES(?,?,?,2) ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET epoch=epoch+1").run(ns.ownerId,ns.scope,ns.projectId??'');
  return seal(value);
 };
 f = fixture(t, {kind, port, coreOptions: {captureDeadlineMs:500}, model: {countTokens() {
  if (seals) { globalThis.timeoutProvenanceNow += 600_000_000n; throw new MemoryStoreError('model_timeout'); }
  return 1;
 }}});
 const result = await f.core.captureRaw(request(splitRaw('Synthetic failed preflight')[0]));
 t.diagnostic(JSON.stringify({kind, seals, result}));
 assert.equal(seals, 1);
 assert.equal(result.error?.code, 'model_timeout');
 assert.equal(f.calls.filter(c => c.method === 'extract').length, 0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM raw_parts').get().n, 0);
 assert.equal(f.db.isTransaction, false);
});
