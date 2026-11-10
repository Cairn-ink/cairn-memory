import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
globalThis.epochReviewNow = 0n;
globalThis.epochReviewDeadlineStarts = [];
const hooks = registerHooks({load(url, context, next) {
 const result = next(url, context);
 if (!url.endsWith('/core/capture-deadline.mjs')) return result;
 let source = result.source.toString();
 const marker = 'const monotonicNow = process.hrtime.bigint;';
 assert.ok(source.includes(marker));
 source = source.replace(marker, 'const monotonicNow = () => globalThis.epochReviewNow;');
 source = source.replace('const end = monotonicNow()', 'globalThis.epochReviewDeadlineStarts.push(Number(monotonicNow())/1e6); const end = monotonicNow()');
 return {...result, source};
}});
const root = new URL('../../', import.meta.url);
const { fixture, request, splitRaw, ns, localPlainPort } = await import(new URL('core/testing/raw-capture-fixtures.mjs', root));
const { openMemoryCore } = await import(new URL('core/index.mjs', root));
hooks.deregister();
for (const route of ['captureRaw', 'capture']) for (const conflicts of [0, 3]) for(const preparation of ['steady','growing']) test(`one 500ms budget across ${route}, conflicts=${conflicts}, ${preparation} preparation`, async t => {
 globalThis.epochReviewNow = 0n; globalThis.epochReviewDeadlineStarts = [];
 let f, seals = 0, preflight = false, extractedAt;
 const model = {contextWindow: 8192, countTokens() { if (preflight) { preflight = false; globalThis.epochReviewNow += preparation==='growing'&&seals===1?100_000_000n:400_000_000n; } return 1; },
  extract() {extractedAt = Number(globalThis.epochReviewNow)/1e6; return {items:[]};}, classify() { return {items:[]}; }};
 const port=localPlainPort(), seal=port.sealRaw;
 port.sealRaw = value => {
  seals++; preflight = true;
  if (seals <= conflicts) f.db.prepare("INSERT INTO namespace_epochs(owner_id,scope,project_id,epoch) VALUES(?,?,?,2) ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET epoch=epoch+1").run(ns.ownerId,ns.scope,ns.projectId??'');
  return seal(value);
 };
 f = fixture(t, {port, model, coreOptions:{captureDeadlineMs:500}});
 let core = f.core;
 if (route==='capture') {
  core = openMemoryCore({path:f.path,model,captureDeadlineMs:500,rawSearch:false,rawConversations:{mode:'raw-v1',capBytes:200000000,port,readPolicy:()=>({generation:'notice-1',reason:null})}});
  f.workspace.defer(()=>core.close());
 }
 const raw = request(splitRaw('Synthetic deadline retry')[0]);
 const input = route==='captureRaw' ? raw : {namespace:ns,client:raw.client,sessionId:raw.sessionId,eventId:raw.eventId,messages:raw.messages.map(({id,role,content,occurredAt})=>({id,role,content,occurredAt}))};
 const result = await core[route](input);
 const observed={route,conflicts,budgetMs:500,elapsedClockMs:Number(globalThis.epochReviewNow)/1e6,deadlineStarts:globalThis.epochReviewDeadlineStarts,seals,extractedAt,result};
 t.diagnostic(JSON.stringify(observed));
 if(conflicts===0) {assert.equal(result.ok,true); assert.equal(extractedAt,preparation==='growing'?100:400);}
 else {
  assert.equal(globalThis.epochReviewDeadlineStarts.length,1,'exactly one invocation deadline');
  assert.equal(extractedAt, undefined, 'expired invocation must not dispatch extraction');
  // A later preflight expiry is its own failure, before epoch revalidation.
  assert.equal(result.error?.code, preparation==='growing' ? 'model_timeout' : 'storage_busy');
  assert.ok(seals <= 2, 'another attempt must not get a renewed budget');
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_parts').get().n, 0);
 }
});


for (const mode of ['host','continuation','no-model']) test(`expiry during ${mode} preparation keeps timeout provenance and writes no new Raw`, async t => {
 globalThis.epochReviewNow=0n;let slow=false;
 const port=localPlainPort(),seal=port.sealRaw;
 port.sealRaw=value=>{if(slow)globalThis.epochReviewNow+=600_000_000n;return seal(value);};
 const f=fixture(t,{port});
 const core=openMemoryCore({path:f.path,captureDeadlineMs:500,rawSearch:false,rawConversations:{mode:'raw-v1',capBytes:200000000,port,
  ...(mode==='host'?{interpretation:'host'}:{}),readPolicy:()=>({generation:'synthetic',reason:null})}});
 f.workspace.defer(()=>core.close());
 const parts=splitRaw(mode==='continuation'?'x'.repeat(4010):'Synthetic timeout');
 if(mode==='continuation')assert.equal((await core.captureRaw(request(parts[0]))).ok,true);
 slow=true;
 const result=await core.captureRaw(request(parts.at(-1)));
 assert.equal(result.error?.code,'model_timeout',JSON.stringify(result));
 assert.equal(f.db.prepare('SELECT count(*) n FROM raw_parts').get().n,mode==='continuation'?1:0);
});

const {DatabaseSync}=await import('node:sqlite');
for(const kind of ['host','ordinary','episode'])test(`expiry after ${kind} binding write rolls back before COMMIT`,async t=>{
 globalThis.epochReviewNow=0n;
 const f=fixture(t,{kind:kind==='episode'?'episode':'ordinary',coreOptions:{captureDeadlineMs:500}});
 let core=f.core;
 if(kind==='host'){
  core=openMemoryCore({path:f.path,captureDeadlineMs:500,rawSearch:false,rawConversations:{mode:'raw-v1',capBytes:200000000,port:localPlainPort(),interpretation:'host',readPolicy:()=>({generation:'synthetic',reason:null})}});
  f.workspace.defer(()=>core.close());
 }
 const prepare=DatabaseSync.prototype.prepare;let writes=0;
 DatabaseSync.prototype.prepare=function(sql,...args){
  const statement=prepare.call(this,sql,...args);
  if(!sql.startsWith('INSERT INTO raw_capture_events('))return statement;
  return new Proxy(statement,{get(target,key){if(key==='run')return(...values)=>{
   const result=target.run(...values);writes++;globalThis.epochReviewNow+=600_000_000n;return result;
  };return Reflect.get(target,key,target);}});
 };
 let result;try{result=await core.captureRaw(request(splitRaw('Synthetic precommit expiry')[0],{},kind==='episode'?'episode':'ordinary'));}
 finally{DatabaseSync.prototype.prepare=prepare;}
 t.diagnostic(JSON.stringify({kind,writes,result}));
 assert.ok(writes>0);assert.equal(result.error?.code,'model_timeout');
 for(const table of ['raw_events','raw_parts','raw_capture_events','admission_claims','episode_events'])
  assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0,table);
});

const {createCaptureDeadline,captureWithDeadline}=await import('../capture-deadline.mjs');
test('a private host deadline cannot leak into a separate capture started by its sealing callback',async t=>{
 globalThis.epochReviewNow=0n;
 const independent=fixture(t),port=localPlainPort(),seal=port.sealRaw;let nested;
 port.sealRaw=async value=>{
  globalThis.epochReviewNow+=600_000_000n;
  nested=await independent.core.captureRaw(request(splitRaw('Synthetic independent capture')[0]));
  return seal(value);
 };
 const outer=fixture(t,{port});
 const result=await captureWithDeadline(outer.core,request(splitRaw('Synthetic bounded capture')[0]),createCaptureDeadline(500));
 assert.equal(nested.ok,true,JSON.stringify(nested));assert.equal(result.error?.code,'model_timeout');
 assert.equal(outer.db.prepare('SELECT count(*) n FROM raw_parts').get().n,0);
 assert.equal(independent.db.prepare('SELECT count(*) n FROM raw_parts').get().n,1);
});

test('caller-supplied deadline-shaped arguments cannot extend a configured deadline',async t=>{
 globalThis.epochReviewNow=0n;
 const port=localPlainPort(),seal=port.sealRaw;
 port.sealRaw=value=>{globalThis.epochReviewNow+=600_000_000n;return seal(value);};
 const f=fixture(t,{port,coreOptions:{captureDeadlineMs:500}});
 const result=await f.core.captureRaw(request(splitRaw('Synthetic forged clock')[0]),{check(){},expired:()=>false,remainingMs:()=>120000});
 assert.equal(result.error?.code,'model_timeout');assert.equal(f.db.prepare('SELECT count(*) n FROM raw_parts').get().n,0);
});

const {interpretation:episodeInterpretation}=await import('../testing/episode-capture-helpers.mjs');
for(const phase of ['preflight','model','commit'])test(`episode ${phase} shares the Raw invocation deadline without publishing late content`,async t=>{
 globalThis.epochReviewNow=0n;let drafting=false,advanced=false;
 const f=fixture(t,{kind:'episode',coreOptions:{captureDeadlineMs:500},model:{
  countTokens(){if(phase==='preflight'&&drafting&&!advanced){advanced=true;globalThis.epochReviewNow+=600_000_000n;}return 1;},
  interpretEpisode(value){if(phase==='model')globalThis.epochReviewNow+=600_000_000n;return episodeInterpretation(value);},
 }});
 const prepare=DatabaseSync.prototype.prepare;
 DatabaseSync.prototype.prepare=function(sql,...args){
  const statement=prepare.call(this,sql,...args);
  if(!sql.startsWith('INSERT INTO episode_attempts(')&&!sql.startsWith('UPDATE session_episodes SET record='))return statement;
  return new Proxy(statement,{get(target,key){if(key==='run')return(...values)=>{
   const result=target.run(...values);
   if(sql.startsWith('INSERT INTO episode_attempts('))drafting=true;
   if(phase==='commit'&&sql.startsWith('UPDATE session_episodes SET record=')&&JSON.parse(values[0]).gist&&!advanced){advanced=true;globalThis.epochReviewNow+=600_000_000n;}
   return result;
  };return Reflect.get(target,key,target);}});
 };
 let result;try{result=await f.core.captureRaw(request(splitRaw('Synthetic bounded episode')[0],{},'episode'));}
 finally{DatabaseSync.prototype.prepare=prepare;}
 t.diagnostic(JSON.stringify({phase,result}));
 assert.equal(result.ok,true,'the already committed Raw reservation is retained');
 assert.equal(result.value.interpretation.error?.code,'model_timeout');
 if(phase==='preflight')assert.equal(f.calls.filter(call=>call.method==='interpretEpisode').length,0);
 assert.equal(f.calls.filter(call=>call.method==='extract').length,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM raw_parts').get().n,1);
 const claims=f.db.prepare('SELECT state,token,lease_expires_at,memory_ids,suppressed_count FROM admission_claims').all();
 assert.deepEqual(claims.map(row=>({...row})),[{state:'reserved',token:null,lease_expires_at:null,memory_ids:null,suppressed_count:null}], 'only the original Raw/episode reservation survives');
 for(const table of ['episode_sources','memories'])assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0,table);
});
