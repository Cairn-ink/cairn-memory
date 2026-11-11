import { createHash, randomUUID } from 'node:crypto';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, chmodSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { openDatabase, transaction } from '../database.mjs';
import { installMemoryRelations } from '../memory-relations-schema.mjs';
import { createMemoryRelationStorage } from '../memory-relations-storage.mjs';
import { cachedContentLayout } from '../content-safety-schema.mjs';
import { memoryThreadFixture, threadNamespace as ns, unwrap as ok } from '../testing/memory-thread-fixture.mjs';
import { host } from '../testing/context-read-core-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';

const root=new URL('../../',import.meta.url).pathname;
const schema=db=>db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name').all();
const physical=db=>db.prepare('PRAGMA user_version').get().user_version;
const receipt=eventId=>({client:'synthetic',sessionId:'session',eventId,role:'user',excerpt:eventId});
const model={contextWindow:8192,countTokens:()=>1,extract:({input})=>({items:input.messages.map((m,i)=>({content:m.content,kind:'fact',confidence:.9,sourceIndices:[i]}))})};
const request=(eventId,content)=>({namespace:ns,client:'synthetic',sessionId:'session',eventId,messages:[{id:eventId,role:'user',content}]});
function archive(t){
 const w=createTestWorkspace(t,{prefix:'lazy-relations-'}),baseline=join(w.path,'baseline');mkdirSync(baseline);
 const a=spawnSync('git',['archive','35a29c14','--','core','plugins/cairn-memory/lib'],{cwd:root,maxBuffer:64*1024*1024});
 assert.equal(a.status,0,String(a.stderr));assert.equal(spawnSync('tar',['-xC',baseline],{input:a.stdout}).status,0);
 return {w,baseline};
}
function previous(baseline,path,code){
 const r=spawnSync(process.execPath,['--input-type=module','-e',`import {openMemoryCore} from ${JSON.stringify(join(baseline,'core/index.mjs'))};${code}`,path],{encoding:'utf8',timeout:30000});
 assert.equal(r.status,0,r.stderr);return r.stdout.trim();
}

test('no edge preserves main layout, schema, read SQL, costs and signed bytes throughout the lifecycle',async t=>{
 const {w,baseline}=archive(t),path=join(w.path,'store.sqlite');
 previous(baseline,path,'const c=openMemoryCore({path:process.argv[1]});await c.close();');
 const original=new DatabaseSync(path),objects=schema(original),version=physical(original);original.close();
 let core=openMemoryCore({path,model});
 for(const [id,text] of [['one','I repair bicycles.'],['two','My favorite soup is pumpkin.']])ok(await core.capture(request(id,text)));
 const db=new DatabaseSync(path);assert.equal(physical(db),version);assert.deepEqual(schema(db),objects);
 await core.close();
 // Clone the canonical seed: opaque IDs, clocks, secret and epoch are identical.
 const clone=join(w.path,'clone.sqlite');await backup(db,clone);chmodSync(clone,0o600);
 const currentHost=host();currentHost.state.allowed=[ns];
 const readInput={readSet:[ns],types:['memory'],intent:'current',query:'bicycles',semantic:false,budget:{maxItems:24,maxTokens:6000}};
 const config={version:'context-read-v1',authority:currentHost.authority,counter:{id:'synthetic',countTokens:()=>1}};
 core=openMemoryCore({path,contextRead:config});
 const measured=await measureContentRead('contextRead','lazy',()=>currentHost.call(core,'contextRead',readInput));
 const result=ok(measured.result),memory=ok(core.list({namespace:ns})).memories[0];
 // The archived engine uses the same synthetic host implementation in a child.
 const out=previous(baseline,clone,`
 import {host} from ${JSON.stringify(new URL('../testing/context-read-core-fixture.mjs',import.meta.url).pathname)};
 import {measureContentRead} from ${JSON.stringify(new URL('../testing/content-safety-cost-meter.mjs',import.meta.url).pathname)};
 const h=host();h.state.allowed=[${JSON.stringify(ns)}];
 let c=openMemoryCore({path:process.argv[1],contextRead:{version:'context-read-v1',authority:h.authority,counter:{id:'synthetic',countTokens:()=>1}}});
 const measured=await measureContentRead('contextRead','lazy',()=>h.call(c,'contextRead',${JSON.stringify(readInput)}));
 c.forget({namespace:${JSON.stringify(ns)},memoryId:${JSON.stringify(memory.id)},expectedRevision:${memory.revision}});await c.close();
 c=openMemoryCore({path:process.argv[1],contextRead:{version:'context-read-v1',authority:h.authority,counter:{id:'synthetic',countTokens:()=>1}}});
 const reopened=await measureContentRead('contextRead','lazy',()=>h.call(c,'contextRead',${JSON.stringify(readInput)}));
 console.log(JSON.stringify({measured,reopened}));await c.close();`);
 const before=JSON.parse(out);
 const compare=(actual,expected)=>{
  assert.deepEqual(actual.sql,expected.sql);assert.equal(actual.statements,expected.statements);assert.equal(actual.begin,expected.begin);
  const wire=row=>JSON.stringify({metered:ok(row.result).metered,snapshot:ok(row.result).snapshot});
  assert.equal(wire(actual),wire(expected));
 };
 compare(measured,before.measured);assert.ok(result);
 ok(core.forget({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision}));await core.close();
 core=openMemoryCore({path,contextRead:config});
 compare(await measureContentRead('contextRead','lazy',()=>currentHost.call(core,'contextRead',readInput)),before.reopened);await core.close();
 assert.equal(physical(db),version);assert.deepEqual(schema(db),objects);db.close();
 previous(baseline,path,'const c=openMemoryCore({path:process.argv[1]});await c.close();');
});

test('first matching admission installs the edge and layout atomically; outer rollback restores both and permits retry',async t=>{
 const f=memoryThreadFixture(t);await f.capture('My breakfast is oats.');
 const original=schema(f.db),version=physical(f.db),exec=DatabaseSync.prototype.exec;
 let installed=false,armed=true;
 DatabaseSync.prototype.exec=function(sql){
  if(sql==='COMMIT'&&armed&&installed){
   assert.equal(physical(f.db),version);assert.deepEqual(schema(f.db),original);
   armed=false;throw Error('synthetic admission rollback');
  }
  const value=exec.call(this,sql);if(sql.startsWith('PRAGMA user_version=')&&physical(this)>version)installed=true;return value;
 };
 let failed;try{failed=await f.core.capture(request('retry','My breakfast is eggs.'));}finally{DatabaseSync.prototype.exec=exec;}
 assert.equal(installed,true);assert.equal(failed.ok,false);
 assert.equal(physical(f.db),version);assert.deepEqual(schema(f.db),original);
 assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n,1);
 const ordinary=await f.read();assert.equal(ordinary.metered.items.length,1);assert.ok(!ordinary.metered.items[0].metadata?.thread);
 const retried=ok(await f.core.capture(request('retry','My breakfast is eggs.')));assert.equal(retried.admission.memories.length,1);
 assert.equal(physical(f.db),version+200);assert.equal(f.db.prepare('SELECT relation FROM memory_relations').get().relation,'same_thread');
});

for(const unavailable of ['schema collision','other writer','read-only','frozen'])test(`optional installation unavailable: ${unavailable} leaves ordinary admission intact`,async t=>{
 const f=memoryThreadFixture(t);await f.capture('My breakfast is oats.');
 const version=physical(f.db),exec=DatabaseSync.prototype.exec;let attempted=false;
 if(unavailable==='schema collision')f.db.exec('CREATE TABLE memory_relations(preserved TEXT)');
 else DatabaseSync.prototype.exec=function(sql){
  if(sql==='ALTER TABLE memory_conflicts RENAME TO legacy_memory_conflicts'){
   attempted=true;const e=Error('synthetic optional installation unavailable');e.code='ERR_SQLITE_ERROR';e.errcode=unavailable==='other writer'?5:8;throw e;
  }
  return exec.call(this,sql);
 };
 try{await f.capture('My breakfast is eggs.');}finally{DatabaseSync.prototype.exec=exec;}
 assert.equal(physical(f.db),version);assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n,2);
 assert.equal(f.db.prepare("SELECT type FROM sqlite_schema WHERE name='memory_conflicts'").get().type,'table');
 if(unavailable!=='schema collision')assert.equal(attempted,true);
});

test('managed stores never install implicitly; host upgrade enables relation writes',async t=>{
 const {w,baseline}=archive(t),path=join(w.path,'store.sqlite');let core=openMemoryCore({path,rawConversations:{mode:'off',readPolicy:()=>({generation:'synthetic',reason:null})}});await core.close();
 const db=new DatabaseSync(path),storeId=db.prepare('SELECT store_id FROM store_metadata').get().store_id,objects=schema(db),version=physical(db);
 let calls=0;
 const managedModel={...model,relateMemories:({input})=>{calls++;return {facts:input.facts.map(f=>({factIndex:f.factIndex,eventTime:null,
  edges:input.candidates[f.factIndex].slice(0,1).map(c=>({candidateId:c.id,relation:'supersedes',confidence:.9}))}))};}};
 const options={path,model:managedModel,existingStore:{version:'schema29-existing-v1',storeId}};
 core=openMemoryCore(options);ok(await core.capture(request('one','My breakfast is oats.')));ok(await core.capture(request('two','My breakfast is eggs.')));await core.close();
 assert.equal(physical(db),version);assert.deepEqual(schema(db),objects);assert.equal(calls,0);
 const reference=join(w.path,'managed-reference.sqlite');await backup(db,reference);chmodSync(reference,0o600);
 const duplicate=request('baseline-duplicate','My breakfast is oats.');
 const baselineWire=previous(baseline,reference,`
 const model={contextWindow:8192,countTokens:()=>1,extract:({input})=>({items:input.messages.map((m,i)=>({content:m.content,kind:'fact',confidence:.9,sourceIndices:[i]}))})};
 const c=openMemoryCore({path:process.argv[1],model,existingStore:${JSON.stringify(options.existingStore)}});
 console.log(JSON.stringify(await c.capture(${JSON.stringify(duplicate)})));await c.close();`);
 core=openMemoryCore(options);const admitted=await core.capture(duplicate);await core.close();
 assert.equal(JSON.stringify(admitted),baselineWire);assert.equal(calls,0);
 transaction(db,()=>installMemoryRelations(db));db.close();
 core=openMemoryCore(options);ok(await core.capture(request('three','My breakfast is toast.')));await core.close();
 assert.equal(calls,1);const upgraded=new DatabaseSync(path);assert.ok(upgraded.prepare('SELECT count(*) n FROM memory_relations').get().n);upgraded.close();
});

test('explicitly disabled relations leave matching captures readable by main; gained relations cause clear refusal',async t=>{
 const {w,baseline}=archive(t),path=join(w.path,'store.sqlite');
 let core=openMemoryCore({path,model,memoryRelations:false});
 ok(await core.capture(request('one','My breakfast is oats.')));ok(await core.capture(request('two','My breakfast is eggs.')));await core.close();
 previous(baseline,path,'const c=openMemoryCore({path:process.argv[1]});await c.close();');
 core=openMemoryCore({path,model});ok(await core.capture(request('three','My breakfast is toast.')));await core.close();
 assert.equal(previous(baseline,path,"try{openMemoryCore({path:process.argv[1]});process.exitCode=1;}catch(e){console.log(e.code);if(e.code!=='unsupported_database')process.exitCode=1;}"),'unsupported_database');
});

test('actual read-only connection cleanly skips optional insertion without DDL',async t=>{
 const w=createTestWorkspace(t),path=join(w.path,'store.sqlite');const writer=openDatabase(path);writer.close();
 const db=new DatabaseSync(path,{readOnly:true});t.after(()=>db.close());
 const storage=createMemoryRelationStorage({db,advanceEpoch:()=>assert.fail('no epoch write')});
 assert.deepEqual(storage.insert(ns,[],[{factIndex:0,candidateId:'synthetic'}]),{edges:[],times:[]});
 assert.equal(physical(db),18);assert.equal(cachedContentLayout(db),undefined);
});

test('a host-pinned layout admits matching Memories without changing the sealed layout',async t=>{
 const w=createTestWorkspace(t),path=join(w.path,'store.sqlite');let core=openMemoryCore({path});await core.close();
 const db=new DatabaseSync(path),version=physical(db),objects=schema(db),stat=lstatSync(path,{bigint:true});
 const storeFence={version:'store-fence-v1',dev:String(stat.dev),ino:String(stat.ino),
  applicationId:db.prepare('PRAGMA application_id').get().application_id,userVersion:version,
  storeId:db.prepare('SELECT store_id FROM store_metadata').get().store_id};
 core=openMemoryCore({path,model,storeFence});
 ok(await core.capture(request('sealed-one','My breakfast is oats.')));ok(await core.capture(request('sealed-two','My breakfast is eggs.')));await core.close();
 assert.equal(physical(db),version);assert.deepEqual(schema(db),objects);db.close();
});

test('lazy layout retains main ordered fallback with 32768 receipts',async t=>{
 const f=safetyFixture(t);await f.migrate();const db=f.connect();let calls=0;
 const core=openMemoryCore({path:f.path,model:{contextWindow:8192,countTokens:()=>1,extract:({input})=>({items:[{content:input.messages[0].content,kind:'fact',confidence:.8,sourceIndices:[0]}]}),reconcile(){calls++;return{transitions:[]};}}});t.after(()=>{core.close();db.close();});
 const input=n=>({namespace:ns,client:'synthetic',sessionId:'ordered',eventId:'ordered-'+n,causal:{streamId:'stream',sequence:n},messages:[{id:'ordered-'+n,role:'user',content:'Synthetic ordered value '+n}]});
 const memory=ok(await core.capture(input(1))).admission.memories[0];
 transaction(db,()=>{const insert=db.prepare('INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at) VALUES(?,?,?,?,?,?,?,?,?)');for(let i=1;i<32768;i++){
  const r={client:'synthetic',sessionId:'ordered',eventId:'extra-'+i,role:'user',excerpt:'Synthetic bounded receipt '+i};
  insert.run(randomUUID(),memory.id,createHash('sha256').update(JSON.stringify(r)).digest('hex'),r.client,r.sessionId,r.eventId,r.role,r.excerpt,new Date().toISOString());
 }});
 const prepare=DatabaseSync.prototype.prepare;let maximum=0;
 DatabaseSync.prototype.prepare=function(sql){const stmt=prepare.call(this,sql);if(!/FROM receipts\b.*memory_id/s.test(sql)&&!sql.includes('FROM json_each(?) wanted CROSS JOIN receipts r INDEXED BY memory_receipts'))return stmt;return new Proxy(stmt,{get(target,key){const value=Reflect.get(target,key,target);if(key==='all')return(...args)=>{const rows=value.apply(target,args);maximum=Math.max(maximum,rows.length);return rows;};return typeof value==='function'?value.bind(target):value;}});};
 let result;try{result=await core.capture(input(2));}finally{DatabaseSync.prototype.prepare=prepare;}
 await t.test('materialized receipt bound',()=>assert.ok(maximum<=5,'ordered_materialization_bound rows='+maximum));
 assert.equal(result.ok,true,'ordered_receipt_bound '+JSON.stringify(result));assert.equal(result.value.reconciliation.reason,'unordered_sources');assert.ok(maximum<=5,'materialized '+maximum+' receipt rows');assert.equal(calls,0);assert.equal(physical(db),34);assert.equal(db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='memory_relations'").get().n,0);
});


test('legacy recall without a relation layout retains main SQL, transaction counts and delivered bytes',async t=>{
 const {w,baseline}=archive(t),path=join(w.path,'store.sqlite');
 const ref=JSON.parse(previous(baseline,path,`
 const c=openMemoryCore({path:process.argv[1]});
 const r=c.admit({namespace:${JSON.stringify(ns)},memory:{content:'Independent orchard record',kind:'fact'},receipts:[{client:'synthetic',sessionId:'session',eventId:'orchard',role:'user',excerpt:'Independent orchard record'}]});
 if(!r.ok)throw Error(JSON.stringify(r));console.log(JSON.stringify({id:r.value.memory.id,revision:r.value.memory.revision}));await c.close();`));
 const db=new DatabaseSync(path),reference=join(w.path,'reference.sqlite');await backup(db,reference);db.close();chmodSync(reference,0o600);
 const select=()=>({refs:[{namespaceIndex:0,memoryId:ref.id,revision:ref.revision}]}),
  rank=({input})=>({refs:input.candidates.slice(0,1).map(c=>({namespaceIndex:c.namespaceIndex,memoryId:c.memory.id,revision:c.memory.revision}))});
 const core=openMemoryCore({path,model:{contextWindow:8192,countTokens:()=>1,select,rank}});w.defer(()=>core.close());
 const input={readSet:[ns],query:'orchard',limit:2};
 const after=await measureContentRead('recall','legacy',()=>core.recall(input));ok(after.result);
 const baselineRead=JSON.parse(previous(baseline,reference,`
 import {measureContentRead} from ${JSON.stringify(new URL('../testing/content-safety-cost-meter.mjs',import.meta.url).pathname)};
 const ref=${JSON.stringify(ref)},select=${select.toString()},rank=${rank.toString()};
 const c=openMemoryCore({path:process.argv[1],model:{contextWindow:8192,countTokens:()=>1,select,rank}});
 const row=await measureContentRead('recall','legacy',()=>c.recall(${JSON.stringify(input)}));
 const diagnostic=await c.recall({...${JSON.stringify(input)},diagnostics:true});if(!diagnostic.ok)throw Error(JSON.stringify(diagnostic));
 console.log(JSON.stringify({row,storageCalls:diagnostic.value.diagnostics.storageCalls}));await c.close();`));
 const before=baselineRead.row;
 ok(before.result);assert.deepEqual(after.sql,before.sql);assert.equal(after.statements,before.statements);assert.equal(after.begin,before.begin);
 assert.equal(JSON.stringify(after.result),JSON.stringify(before.result));
 assert.equal(ok(await core.recall({...input,diagnostics:true})).diagnostics.storageCalls,baselineRead.storageCalls);
});


test('a cross-process first relation requires reopening a plain legacy reader',async t=>{
 const f=memoryThreadFixture(t),first=await f.capture('My breakfast is oats.');
 const old=ok(f.core.get({namespace:ns,memoryId:first.admission.memories[0].id})).memory;
 const select=()=>({refs:[{namespaceIndex:0,memoryId:old.id,revision:old.revision}]}),
  rank=({input})=>({refs:input.candidates.slice(0,1).map(candidate=>({namespaceIndex:candidate.namespaceIndex,memoryId:candidate.memory.id,revision:candidate.memory.revision}))});
 const options={path:f.path,memoryRelations:false,model:{contextWindow:8192,countTokens:()=>1,select,rank}};
 let reader=openMemoryCore(options);
 try{
 // A child bypasses same-runtime peer notifications. Main's plain legacy read
 // has no schema poll; the host reopens connections after an external upgrade.
 const newest=JSON.parse(previous(root,f.path,`
 const model={contextWindow:8192,countTokens:()=>1,extract:({input})=>({items:input.messages.map((message,index)=>({content:message.content,kind:'fact',confidence:.9,sourceIndices:[index]}))})};
 const c=openMemoryCore({path:process.argv[1],model});
 const result=await c.capture(${JSON.stringify(request('peer-edge','My breakfast is eggs.'))});
 if(!result.ok)throw Error(JSON.stringify(result));console.log(JSON.stringify(result.value.admission.memories[0]));await c.close();`));
 const input={readSet:[ns],query:'breakfast',limit:2};
 const beforeReopen=ok(await reader.recall(input));
 assert.equal(beforeReopen.memories[0].memory.id,old.id);
 assert.ok(beforeReopen.memories.every(item=>!item.relations?.length));
 await reader.close();reader=openMemoryCore(options);
 const result=ok(await reader.recall(input));
 assert.equal(result.memories[0].memory.id,newest.id);
 assert.ok(result.memories.some(item=>item.memory.id===old.id));
 assert.equal(result.memories[0].relations[0].relation,'same_thread');
 }finally{await reader.close();}
});
