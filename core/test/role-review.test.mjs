import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { createHash,createHmac } from 'node:crypto';
import { openMemoryCore,roleProfileReleaseRef } from '../index.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { validateRoleProfiles } from '../role-profile-schema.mjs';
import { authenticatedMAC,encodeTaskReceipt,parseTaskReceipt } from '../task-receipt.mjs';
import { fixture,host,ns,project,publish,read,adopt,importMethod,ok } from './role-fixture.mjs';

// Independent serializers/oracles never call the production wire/byte helpers.
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(k=>[k,sorted(v[k])])):v;
const C=v=>JSON.stringify(sorted(v));
const wire=m=>C({ok:true,value:m,evidenceTrust:'untrusted-data-not-instructions'});
const hash=b=>createHash('sha256').update(b).digest('hex');
const receipt=(excerpt,id)=>({client:'synthetic',sessionId:'review',eventId:id,role:'user',excerpt});
const admit=(f,text,id,namespace=ns,sources=[receipt(text,id)])=>ok(f.call('admit',{namespace,memory:{content:text,kind:'fact'},receipts:sources})).memory;
const closeDb=(t,f)=>{const db=new DatabaseSync(f.path,{timeout:5000});t.after(()=>db.close());return db;};
const triggers=db=>db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='binary_objects'").all();
function alterBinary(db,sql,args){const guards=triggers(db);db.exec('PRAGMA foreign_keys=OFF;PRAGMA ignore_check_constraints=ON');try{for(const g of guards)db.exec('DROP TRIGGER '+g.name);db.prepare(sql).run(...args);}finally{for(const g of guards)db.exec(g.sql);db.exec('PRAGMA ignore_check_constraints=OFF;PRAGMA foreign_keys=ON');}}
const mixed=(f,id='binary',bytes=Buffer.from('%PDF-1.7 synthetic attachment'))=>ok(f.call('importMethodVersion',{namespace:ns,actionId:id,title:'Synthetic',manifestFormat:'mixed-v1',files:[{kind:'text',path:'guide.txt',text:'original text',mediaType:'text/plain'},{kind:'binary',path:'attachment.pdf',bytes,mediaType:'application/pdf'}]}));
function roleMethod(f,v){ok(f.call('adoptMethodVersion',adopt(v)));ok(f.call('publishRoleProfileRelease',publish(ns,'finance','profile',null,null,{duties:['Review'],requiredOutputs:['Report'],methods:[v.package]})));return ok(f.call('readRoleTaskContext',read())).metered.receipt;}

for(const [column,value] of [['owner_id','foreign'],['scope','project'],['project_id','foreign'],['method_version_id','foreign'],['position',99],['asset_version_id','foreign'],['content_identity','x'.repeat(43)],['media_type','image/png'],['byte_count',1]]) {
 test('P1 binary metadata verifies '+column+' before delivery and again after counting',t=>{
  let armed=false,done=false,change;const h=host({counter:{id:'binary-corruption',countTokens:text=>{if(armed&&!done){done=true;change();}return Math.ceil(Buffer.byteLength(text)/4);}}}),f=fixture(t,{h});
  const v=mixed(f),saved=roleMethod(f,v),db=closeDb(t,f),row=db.prepare('SELECT * FROM binary_objects WHERE method_version_id=?').get(v.version.versionId);
  const input={mode:'file',readSet:[ns],receipt:saved,package:v.package,path:'attachment.pdf'};
  change=()=>alterBinary(db,'UPDATE binary_objects SET '+column+'=? WHERE id=?',[value,row.id]);
  armed=true;const raced=f.call('readRoleTaskContext',input);armed=false;
  assert.equal(done,true);assert.equal(raced.error?.code,'snapshot_stale',JSON.stringify(raced));assert.equal(raced.value,undefined);
  assert.equal(f.call('readRoleTaskContext',input).error?.code,'method_version_unavailable');
  alterBinary(db,'UPDATE binary_objects SET '+column+'=? WHERE id=?',[row[column],row.id]);
  assert.equal(ok(f.call('readRoleTaskContext',input)).metered.file.kind,'binary');
 });
}

for(const count of [1,4])test('P2 source completeness retains canonical '+count+' sources through now/then/refresh budget trimming',t=>{
 const divisor=count===1?1:2,counter={id:'byte-based',countTokens:text=>Math.ceil(Buffer.byteLength(text)/divisor)},f=fixture(t,{h:host({counter})});
 ok(f.call('publishRoleProfileRelease',publish()));admit(f,'finance compact body','body',ns,Array.from({length:count},(_,i)=>receipt('Source '+i+' '+String(i).repeat(700),'source-'+i)));
 const full=ok(f.call('readRoleTaskContext',{...read(),task:'finance'})).metered;assert.equal(full.evidence[0].sources.length,count);assert.equal(full.evidence[0].sourcesComplete,undefined);
 const selected=count===1?0:1;
 for(const mode of ['now','then','refresh']) {
  const trial=structuredClone(full);trial.mode=mode;trial.evidence[0].sources=trial.evidence[0].sources.slice(0,selected);trial.evidence[0].sourcesComplete=false;
  if(mode!=='then'){const p=JSON.parse(trial.receipt);p.p.evidence[0][2]=p.p.evidence[0][2].slice(0,selected);trial.receipt=C(p);}
  const maxTokens=counter.countTokens(wire(trial))+2;
  const input=mode==='now'?{...read(),task:'finance'}:{mode,readSet:[ns],receipt:full.receipt,...(mode==='refresh'?{task:'finance'}:{})};
  const result=ok(f.call('readRoleTaskContext',{...input,budget:{maxTokens}}));
  assert.equal(result.metered.evidence.length,1,mode);assert.equal(result.metered.evidence[0].sources.length,selected,mode);
  assert.equal(result.metered.evidence[0].sourcesComplete,false,mode);assert.equal(result.diagnostics.omitted.sources,count-selected);
  const then=ok(f.call('readRoleTaskContext',{mode:'then',readSet:[ns],receipt:result.metered.receipt}));
  assert.equal(then.metered.evidence[0].sources.length,mode==='then'?count:selected);assert.equal(then.metered.evidence[0].sourcesComplete,mode==='then'?undefined:false);
 }
});

test('P2 canonical reason validation rejects malformed payloads on every opener; unavailable typed refs remain valid',t=>{
 const f=fixture(t),m=admit(f,'Reason source','reason'),ref={type:'memory',namespace:ns,memoryId:m.id,revision:1};
 const first=ok(f.call('publishRoleProfileRelease',{...publish(),changeReason:{text:'Recorded reason',reasonRefs:[ref]}}));
 ok(f.call('forget',{namespace:ns,memoryId:m.id,expectedRevision:1}));f.reopen();const db=closeDb(t,f);
 const original=db.prepare('SELECT payload,byte_count FROM role_profile_changes WHERE to_id=?').get(first.release.releaseId);
 assert.doesNotThrow(()=>validateRoleProfiles(db));
 const malformed=['{"text":7}',C({text:'text',reasonRefs:[],extra:true}),'{"text":"text","reasonRefs":[]}',C({text:' '.repeat(4),reasonRefs:[]}),C({text:'x'.repeat(501),reasonRefs:[]}),C({text:'\uD800',reasonRefs:[]}),C({text:'x\0',reasonRefs:[]}),C({text:'text',reasonRefs:[{...ref,revision:0}]}),C({text:'text',reasonRefs:[{...ref,extra:true}]}),C({text:'text',reasonRefs:[{...ref,namespace:{...ns,ownerId:'foreign'}}]})];
 const guard=db.prepare("SELECT sql FROM sqlite_master WHERE name='role_profile_changes_update'").get().sql;
 for(const payload of malformed){
  // Corruption fixture bypasses CHECKs, then restores canonical guards and CHECKs
  // before validation. Production opens must refuse, never repair such content.
  db.exec('PRAGMA ignore_check_constraints=ON;DROP TRIGGER role_profile_changes_update');
  db.prepare('UPDATE role_profile_changes SET payload=?,byte_count=? WHERE to_id=?').run(payload,Buffer.byteLength(payload),first.release.releaseId);
  db.exec(guard);db.exec('PRAGMA ignore_check_constraints=OFF');
  assert.throws(()=>validateRoleProfiles(db),{code:'unsupported_database'},payload);
  assert.throws(()=>openMemoryCore({path:f.path}),{code:'unsupported_database'});
  assert.throws(()=>openReadDatabase(f.path),{code:'unsupported_database'});
 }
 db.exec('DROP TRIGGER role_profile_changes_update');db.prepare('UPDATE role_profile_changes SET payload=?,byte_count=? WHERE to_id=?').run(original.payload,original.byte_count,first.release.releaseId);db.exec(guard);
 assert.doesNotThrow(()=>validateRoleProfiles(db));
 assert.equal(ok(f.call('readRoleTaskContext',read())).metered.profile.release.changeReason.status,'recorded-unavailable');
});

test('P2 release deletion charge and purge searches index both edge endpoints, with exact v32 index validation',t=>{
 const f=fixture(t),a=ok(f.call('publishRoleProfileRelease',publish())),b=ok(f.call('publishRoleProfileRelease',{...publish(ns,'finance','next',a.release,1),changeReason:{text:'edge'}})),db=closeDb(t,f);
 const queries=['SELECT coalesce(sum(byte_count),0) n FROM role_profile_changes WHERE to_id=? OR from_id=?',
   'UPDATE role_profile_changes SET payload=NULL,byte_count=0 WHERE (to_id=? OR from_id=?) AND payload IS NOT NULL'];
 for(const sql of queries){const details=db.prepare('EXPLAIN QUERY PLAN '+sql).all(a.release.releaseId,a.release.releaseId).map(r=>r.detail);
  assert.equal(details.some(s=>s.includes('SCAN role_profile_changes')),false,JSON.stringify(details));
  assert.ok(details.some(s=>s.includes('SEARCH role_profile_changes')&&s.includes('to_id=?')),JSON.stringify(details));
  assert.ok(details.some(s=>s.includes('SEARCH role_profile_changes')&&s.includes('role_profile_change_from')&&s.includes('from_id=?')),JSON.stringify(details));
 }
 db.exec('DROP INDEX role_profile_change_from');assert.throws(()=>validateRoleProfiles(db),{code:'unsupported_database'});
 db.exec('CREATE INDEX role_profile_change_from ON role_profile_changes(from_id)');validateRoleProfiles(db);assert.equal(b.registry.revision,2);
});

test('P2 MAC types refuse coercion through the exported ref parser and every public ref arm',t=>{
 const f=fixture(t),a=ok(f.call('publishRoleProfileRelease',publish())),b=ok(f.call('publishRoleProfileRelease',publish(ns,'finance','next',a.release,1)));
 for(const contentIdentity of [[a.release.contentIdentity],new String(a.release.contentIdentity),{toString(){return a.release.contentIdentity;}},42,null]){
  const bad={...a.release,contentIdentity};assert.throws(()=>roleProfileReleaseRef(bad),{code:'invalid_input'});
  for(const [method,input] of [
   ['publishRoleProfileRelease',publish(ns,'finance','bad-publish',bad,2)],
   ['disableRoleProfile',{namespace:ns,roleKey:'finance',actionId:'bad-disable',expectedCurrentRelease:bad,expectedRegistryRevision:2}],
   ['deleteRoleProfileRelease',{namespace:ns,roleKey:'finance',actionId:'bad-delete',expectedCurrentRelease:b.release,expectedRegistryRevision:2,release:bad,expectedRevision:1}],
   ['readRoleTaskContext',{mode:'compare',roleKey:'finance',readSet:[ns],from:bad,to:b.release}],
  ])assert.equal(f.call(method,input).error?.code,'invalid_input',method);
 }
});

test('P2 shared length-checked full MAC comparison authenticates role history/comparison cursors',t=>{
 const f=fixture(t);let head=null;for(let i=0;i<3;i++)head=ok(f.call('publishRoleProfileRelease',publish(ns,'finance','cursor-'+i,head?.release??null,head?.registry.revision??null)));
 const input={...read(),history:{profile:head.release.profile,limit:1}},page=ok(f.call('readRoleTaskContext',input)).metered.history;
 const valid=page.nextCursor;assert.equal(typeof valid,'string');ok(f.call('readRoleTaskContext',{...input,history:{...input.history,cursor:valid}}));
 const [body,mac]=valid.split('.');assert.equal(authenticatedMAC(mac,mac),true);
 for(const forged of [undefined,null,[mac],mac.slice(1),mac+'a',mac.replace(/./,ch=>ch==='a'?'b':'a'),'é'.repeat(43)]){
  assert.equal(authenticatedMAC(mac,forged),false);
  if(!Array.isArray(forged))assert.equal(f.call('readRoleTaskContext',{...input,history:{...input.history,cursor:body+'.'+String(forged)}}).error?.code,'invalid_cursor');
 }
});

test('C01 populated hostile owner/project rows never enter authorized profile, method, reason or evidence results',t=>{
 let restricted=false;const h=host({allow:r=>!restricted||r.namespace.ownerId===ns.ownerId&&(r.namespace.scope==='personal'||r.namespace.projectId===project.projectId)}),f=fixture(t,{h});
 const hostile=[{...ns,ownerId:'foreign-owner'},{...project,projectId:'foreign-project'}],foreign=[];
 for(const [i,namespace]of hostile.entries()){
  const memory=admit(f,'finance HOSTILE '+i,'hostile-'+i,namespace),m=ok(f.call('importMethodVersion',importMethod('hostile-method-'+i,'HOSTILE method '+i,namespace)));
  ok(f.call('adoptMethodVersion',adopt(m,'hostile-adopt-'+i,null,namespace,null,[namespace])));
  const p=ok(f.call('publishRoleProfileRelease',{...publish(namespace,'finance','hostile-profile-'+i,null,null,{duties:['HOSTILE duty '+i],requiredOutputs:['HOSTILE output'],methods:[m.package],related:[{type:'memory',namespace,memoryId:memory.id,revision:1}],appliesTo:'HOSTILE scope'}),changeReason:{text:'HOSTILE reason'}}));
  foreign.push({namespace,memory,method:m,profile:p,receipt:ok(f.call('readRoleTaskContext',read('finance',[namespace]))).metered.receipt});
 }
 const own=admit(f,'finance safe source','own'),method=ok(f.call('importMethodVersion',importMethod('own-method','safe method')));
 ok(f.call('adoptMethodVersion',adopt(method,'own-adopt')));ok(f.call('publishRoleProfileRelease',publish(ns,'finance','own-profile',null,null,{duties:['safe duty'],requiredOutputs:['safe output'],methods:[method.package],related:[{type:'memory',namespace:ns,memoryId:own.id,revision:1}]})));
 restricted=true;
 const result=ok(f.call('readRoleTaskContext',{...read('finance',[ns,project]),task:'finance'}));
 assert.equal(C(result).includes('HOSTILE'),false);assert.deepEqual(result.metered.methods[0].package,method.package);assert.deepEqual(result.metered.evidence.map(e=>e.ref.id),[own.id]);
 for(const item of foreign){
  for(const request of [read('finance',[item.namespace]),{mode:'then',readSet:[item.namespace],receipt:item.receipt},{mode:'file',readSet:[item.namespace],receipt:item.receipt,package:item.method.package,path:'guide.txt'}])assert.equal(f.call('readRoleTaskContext',request).error?.code,'authority_required');
  assert.equal(f.call('readRoleTaskContext',{mode:'then',readSet:[ns],receipt:item.receipt}).error?.code,'scope_changed');
 }
});

test('C01 every bound grant field is independently refused for each role operation',t=>{
 let tamper=null;const requests=[],grants=new WeakMap(),authority={authorize(request){requests.push(request);const {input,...binding}=request,grant={...binding,accessGeneration:1};if(tamper)tamper(grant);grants.set(grant,grant);return grant;},isCurrent:grant=>grants.get(grant)};
 const h=host();h.options={...h.options,authority};const f=fixture(t,{h});
 const a=ok(f.call('publishRoleProfileRelease',publish()));
 const common={namespace:ns,roleKey:'finance',actionId:'matrix',expectedCurrentRelease:a.release,expectedRegistryRevision:1};
 const cases=[['publishRoleProfileRelease',{...common,fields:{duties:['New'],requiredOutputs:['Report']}}],['disableRoleProfile',common],['deleteRoleProfileRelease',{...common,release:a.release,expectedRevision:1}],['readRoleTaskContext',read()]];
 const mutations={method:g=>g.method='other',owner:g=>g.namespace={...g.namespace,ownerId:'foreign'},scope:g=>g.namespace={...g.namespace,scope:'project',projectId:'project'},project:g=>g.namespace={...g.namespace,projectId:'foreign'},actionClass:g=>g.actionClass='explicit-user',actionId:g=>g.actionId='other',targetId:g=>g.targetId='other',expectedRevision:g=>g.expectedRevision=99,payloadBinding:g=>g.payloadBinding='other',accessGeneration:g=>g.accessGeneration=0,extra:g=>g.extra=true};
 for(const [method,input]of cases)for(const [field,mutate]of Object.entries(mutations)){tamper=mutate;const r=f.call(method,input);assert.equal(r.error?.code,'authority_required',method+'/'+field);assert.equal(r.value,undefined);}
 tamper=null;assert.equal(ok(f.call('readRoleTaskContext',read())).metered.profile.release.ref.releaseId,a.release.releaseId);
 assert.equal(requests.filter(r=>r.method==='publishRoleProfileRelease')[0].input.attribution.actorId,'actor');
 t.diagnostic('grant binding matrix: '+cases.length+' operations × '+Object.keys(mutations).length+' independent mutations = '+cases.length*Object.keys(mutations).length);
});

test('C03 passing exact maxima for fields, refs, identifiers, history, budgets, deadline and file range',t=>{
 const h=host({counter:{id:'boundary',countTokens:()=>1}});h.options={...h.options,attribution:{actorId:'a'.repeat(200),agentId:'b'.repeat(200)}};const f=fixture(t,{h});
 const memories=Array.from({length:16},(_,i)=>admit(f,'Boundary reason '+i,'boundary-'+i)),refs=memories.map(m=>({type:'memory',namespace:ns,memoryId:m.id,revision:1}));
 const methods=Array.from({length:16},(_,i)=>ok(f.call('importMethodVersion',importMethod('max-method-'+i))).package);
 const input={...publish(ns,'r'.repeat(200),'a'.repeat(200),null,null,{duties:Array(8).fill('d'.repeat(300)),requiredOutputs:Array(8).fill('o'.repeat(300)),methods,related:refs,appliesTo:'s'.repeat(500)}),changeReason:{text:'r'.repeat(500),reasonRefs:refs}};
 const a=ok(f.call('publishRoleProfileRelease',input));assert.equal(a.registry.roleKey.length,200);
 const maximum=ok(f.call('readRoleTaskContext',{...read(input.roleKey),budget:{maxTokens:4000,maxItems:24},deadlineMs:5000})).metered;
 assert.equal(maximum.profile.release.fields.methods.length,16);assert.equal(maximum.profile.release.fields.related.length,16);
 assert.equal(maximum.profile.release.fields.duties[7].length,300);assert.equal(maximum.profile.release.fields.appliesTo.length,500);assert.equal(maximum.profile.release.changeReason.refs.length,16);
 let head=null;for(let i=0;i<20;i++)head=ok(f.call('publishRoleProfileRelease',publish(ns,'history','history-'+i,head?.release??null,head?.registry.revision??null)));
 assert.equal(ok(f.call('readRoleTaskContext',{...read('history'),history:{profile:head.release.profile,limit:20},budget:{maxTokens:4000,maxItems:24},deadlineMs:5000})).metered.history.rows.length,20);
 const v=ok(f.call('importMethodVersion',importMethod('boundary-file','x'.repeat(4000))));ok(f.call('adoptMethodVersion',adopt(v,'boundary-adopt')));
 ok(f.call('publishRoleProfileRelease',publish(ns,'file','file',null,null,{duties:['Review'],requiredOutputs:['Report'],methods:[v.package]})));
 const saved=ok(f.call('readRoleTaskContext',read('file'))).metered.receipt;
 const file=ok(f.call('readRoleTaskContext',{mode:'file',readSet:[ns],receipt:saved,package:v.package,path:'guide.txt',range:{start:0,end:4000},deadlineMs:5000})).metered.file;
 assert.equal(file.parts[0].text.length,4000);assert.equal(file.nextRange,null);
});

test('C03 receipt boundary maxima pass, including exactly 32768 UTF-8 bytes and 200-unit scalars',()=>{
 const H=createHash('sha256').update('boundary').digest('base64url'),identity={storeId:'store',cursorSecret:'0'.repeat(64)};
 const p={id:'i'.repeat(200),readSet:[ns,project],roleKey:'r'.repeat(200),profiles:Array.from({length:21},(_,i)=>[0,'p'+i,'r'+i,H,1]),heads:[[1,null,null,null,null],[0,'p0',Number.MAX_SAFE_INTEGER,'active',0]],
  methods:Array.from({length:16},(_,i)=>[0,'pkg'+i,'current',['v'+i,H],3,[[0,null,null],[1,null,null],[2,null,null],[3,Number.MAX_SAFE_INTEGER,'active']],[Number.MAX_SAFE_INTEGER,'available',1,'available']]),
  evidence:Array.from({length:24},(_,i)=>[[0,0,'m'+i,Number.MAX_SAFE_INTEGER],H,Array.from({length:16},(_,j)=>[j,'s'+i+'_'+j,H,null])])};
 let text=encodeTaskReceipt(identity,p),remaining=32768-Buffer.byteLength(text);assert.ok(remaining>=0);
 for(const e of p.evidence){const n=Math.min(remaining,200-e[0][2].length);e[0][2]+='x'.repeat(n);remaining-=n;}
 assert.equal(remaining,0);text=encodeTaskReceipt(identity,p);assert.equal(Buffer.byteLength(text),32768);assert.deepEqual(parseTaskReceipt(identity,text),p);
 const over=structuredClone(p);over.id+='x';assert.throws(()=>encodeTaskReceipt(identity,over),{code:'invalid_receipt'});
});

test('C03 maximum 560 comparison optional units obey the counter bound and independent core/transport byte ceilings',t=>{
 let calls=0,byteMode=false;const counter={id:'unit-count',countTokens:text=>{calls++;return byteMode?Math.ceil(Buffer.byteLength(text)/4):1;}},f=fixture(t,{h:host({counter})});
 const refs=Array.from({length:16},(_,i)=>{const m=admit(f,'Comparison reason '+i,'reason-'+i);return {type:'memory',namespace:ns,memoryId:m.id,revision:1};});
 const files=prefix=>Array.from({length:256},(_,i)=>({path:prefix+i+'.txt',text:'x',mediaType:'text/plain'}));
 const a=ok(f.call('importMethodVersion',{namespace:ns,actionId:'many-a',title:'Many a',files:files('a')}));
 const b=ok(f.call('importMethodVersion',{namespace:ns,actionId:'many-b',title:'Many b',package:a.package,basedOn:a.version,expectedPackageRevision:1,files:files('b'),change:{items:Array.from({length:32},(_,i)=>({summary:'Recorded '+i,paths:['b'+i+'.txt']})),reasonRefs:refs}}));
 calls=0;const result=ok(f.call('readRoleTaskContext',{mode:'compare',roleKey:'finance',readSet:[ns],from:a.version,to:b.version,deadlineMs:5000}));
 assert.equal(result.metered.comparison.changes.length,512);assert.equal(result.metered.comparison.items.length,32);assert.equal(result.metered.comparison.reason.refs.length,16);
 const U=512+32+16,R=0;assert.equal(U,560);assert.equal(calls,2+2*U+R);assert.equal(result.diagnostics.trace.counterCalls,calls);assert.ok(calls<=1682);
 const core=Buffer.byteLength(C({ok:true,value:result})),transport=Buffer.byteLength(JSON.stringify({content:[{type:'text',text:wire(result.metered)}],isError:false,_meta:{'ink.cairn/context-read-diagnostics':result.diagnostics}}));
 assert.ok(core<=65536);assert.ok(transport<=262144);t.diagnostic(JSON.stringify({optionalUnits:U,rejected:R,counterCalls:calls,coreBytes:core,transportBytes:transport}));
 byteMode=true;
 const input={mode:'compare',roleKey:'finance',readSet:[ns],from:a.version,to:b.version,deadlineMs:5000};
 const first=ok(f.call('readRoleTaskContext',input)).metered.comparison;
 assert.equal(typeof first.nextCursor,'string');const [body,mac]=first.nextCursor.split('.');
 ok(f.call('readRoleTaskContext',{...input,cursor:first.nextCursor}));
 for(const invalid of [mac.slice(1),mac+'a',mac.replace(/./,ch=>ch==='a'?'b':'a')])assert.equal(f.call('readRoleTaskContext',{...input,cursor:body+'.'+invalid}).error?.code,'invalid_cursor');

});

test('C03 independent overflow recount measures exact required tokens, receipt/core/transport bytes',t=>{
 const counted=[],counter={id:'byte-overflow',countTokens:text=>{counted.push(text);return Math.ceil(Buffer.byteLength(text)/4);}},f=fixture(t,{h:host({counter})});ok(f.call('publishRoleProfileRelease',publish()));
 const descriptor=Object.getOwnPropertyDescriptor(performance,'now');let response;
 Object.defineProperty(performance,'now',{configurable:true,value:()=>123});
 try{response=f.call('readRoleTaskContext',{...read(),budget:{maxTokens:64}});}finally{if(descriptor)Object.defineProperty(performance,'now',descriptor);else delete performance.now;}
 assert.equal(response.error?.code,'budget_insufficient');assert.equal(counted.length,1);
 const m=JSON.parse(counted[0]).value,tokens=Math.ceil(Buffer.byteLength(wire(m))/4),diagnostics={version:'context-read-v1',representation:'representation-v2',policy:{id:'rank-first-whole-v1'},counter:{id:counter.id},items:[],budget:{maxTokens:64,maxItems:12,used:tokens},candidates:null,
  omitted:{items:0,bodies:0,sources:0,unavailable:0,oversized:0},dedup:{sources:0,body:0},stops:{budget:false,items:false,deadline:false},trace:{timings:{assemblyMs:0},counterCalls:1}};
 const bytes={receipt:Buffer.byteLength(m.receipt),core:Buffer.byteLength(C({ok:true,value:{metered:m,diagnostics}})),transport:Buffer.byteLength(JSON.stringify({content:[{type:'text',text:wire(m)}],isError:false,_meta:{'ink.cairn/context-read-diagnostics':diagnostics}}))};
 assert.equal(response.error.details.requiredTokens,tokens);assert.deepEqual(response.error.details.requiredBytes,bytes);assert.equal(response.value,undefined);
});

test('C04 delete and disable exact replay survive later transitions/purge, changed actions conflict without extra quota/events',t=>{
 const f=fixture(t),a=ok(f.call('publishRoleProfileRelease',publish())),common={namespace:ns,roleKey:'finance',expectedCurrentRelease:a.release,expectedRegistryRevision:1},disable={...common,actionId:'disable'},disabled=ok(f.call('disableRoleProfile',disable));
 const b=ok(f.call('publishRoleProfileRelease',publish(ns,'finance','new',a.release,2))),del={namespace:ns,roleKey:'finance',actionId:'delete',expectedCurrentRelease:b.release,expectedRegistryRevision:3,release:a.release,expectedRevision:1},deleted=ok(f.call('deleteRoleProfileRelease',del));
 const db=closeDb(t,f),state=()=>C(['role_profile_events','role_profile_epochs','role_profile_owner_usage'].map(table=>db.prepare('SELECT * FROM '+table).all())),before=state();
 for(let i=0;i<2;i++){assert.deepEqual(ok(f.call('disableRoleProfile',disable)),disabled);assert.deepEqual(ok(f.call('deleteRoleProfileRelease',del)),deleted);assert.equal(state(),before);}
 assert.equal(f.call('disableRoleProfile',{...disable,expectedRegistryRevision:99}).error?.code,'action_conflict');
 assert.equal(f.call('deleteRoleProfileRelease',{...del,release:b.release}).error?.code,'action_conflict');assert.equal(state(),before);
});

for(const mode of ['now','then','compare','file'])test('C05 full '+mode+' has no authority/count/await after its final read begins',async t=>{
 let armed=false;const events=[],record=kind=>{if(armed)events.push(kind);};
 const h=host({onCurrent:()=>record('authority-current'),counter:{id:'final-observer',countTokens:text=>{record('count');return Math.ceil(Buffer.byteLength(text)/4);}}});
 const authorize=h.authority.authorize;h.authority.authorize=(...args)=>{record('authorize');return authorize(...args);};
 const f=fixture(t,{h}),m=admit(f,'finance full evidence','full'),ref={type:'memory',namespace:ns,memoryId:m.id,revision:1},v=mixed(f,'full-binary');
 ok(f.call('adoptMethodVersion',adopt(v)));const a=ok(f.call('publishRoleProfileRelease',publish(ns,'finance','first',null,null,{duties:['First full duty'],requiredOutputs:['Output'],methods:[v.package],related:[ref]})));
 const b=ok(f.call('publishRoleProfileRelease',{...publish(ns,'finance','second',a.release,1,{duties:['Updated full duty'],requiredOutputs:['Output'],methods:[v.package],related:[ref]}),changeReason:{text:'Full recorded reason',reasonRefs:[ref]}}));
 const history={profile:b.release.profile},saved=ok(f.call('readRoleTaskContext',{...read(),task:'finance',history})).metered.receipt;
 const input=mode==='now'?{...read(),task:'finance',history}:mode==='then'?{mode,readSet:[ns],receipt:saved,history}:mode==='compare'?{mode,readSet:[ns],roleKey:'finance',from:a.release,to:b.release}:{mode,readSet:[ns],receipt:saved,package:v.package,path:'attachment.pdf'};
 const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){if(armed&&sql==='BEGIN')events.push('BEGIN');return exec.call(this,sql);};
 let microtask=false,result;Promise.resolve().then(()=>{microtask=true;});
 try{armed=true;result=f.call('readRoleTaskContext',input);assert.equal(typeof result?.then,'undefined');assert.equal(microtask,false);ok(result);}finally{armed=false;DatabaseSync.prototype.exec=exec;}
 const last=events.lastIndexOf('BEGIN');assert.ok(last>0);assert.equal(events.slice(last+1).length,0,JSON.stringify(events));
 assert.ok(events.includes('count'));assert.ok(events.includes('authorize'));
 const meter=result.value.metered;
 if(mode==='now'||mode==='then'){assert.equal(meter.evidence.length,1);assert.equal(meter.history.rows.length,2);assert.equal(meter.methods.length,1);}
 if(mode==='compare'){assert.equal(meter.comparison.changes.length,5);assert.equal(meter.comparison.reason.refs.length,1);}
 if(mode==='file')assert.equal(meter.file.kind,'binary');
 await Promise.resolve();assert.equal(microtask,true);
});

test('C02 sourced method comparisons preserve exact edge reasons and unavailable ref labels',t=>{
 const f=fixture(t),m=admit(f,'Independent method decision','method-reason'),ref={type:'memory',namespace:ns,memoryId:m.id,revision:1};
 const a=ok(f.call('importMethodVersion',importMethod('sourced-a','Before'))),b=ok(f.call('importMethodVersion',{...importMethod('sourced-b','After'),package:a.package,basedOn:a.version,expectedPackageRevision:1,change:{items:[{summary:'Explicit sourced method revision',paths:['guide.txt']}],reasonRefs:[ref]}}));
 const input={mode:'compare',readSet:[ns],roleKey:'finance',from:a.version,to:b.version};
 const comparison=ok(f.call('readRoleTaskContext',input)).metered.comparison;
 assert.equal(comparison.reason.status,'available');assert.deepEqual(comparison.reason.refs,[{ref,status:'available'}]);assert.deepEqual(comparison.items,[{summary:'Explicit sourced method revision',paths:['guide.txt']}]);
 ok(f.call('forget',{namespace:ns,memoryId:m.id,expectedRevision:1}));
 const unavailable=ok(f.call('readRoleTaskContext',input)).metered.comparison;assert.equal(unavailable.reason.status,'recorded-unavailable');assert.deepEqual(unavailable.reason.refs,[{ref,status:'unavailable'}]);assert.equal(unavailable.reason.text,null);
});

// Independent implementation of U4's E encoding, confined to this byte oracle.
function binaryEncoding(value){
 const header=(tag,length)=>{const b=Buffer.alloc(length===undefined?1:9);b[0]=tag;if(length!==undefined)b.writeBigUInt64BE(BigInt(length),1);return b;};
 if(value===null)return header(0);
 if(typeof value==='string'){const bytes=Buffer.from(value);return Buffer.concat([header(4,bytes.length),bytes]);}
 if(typeof value==='number'){const bytes=Buffer.from(JSON.stringify(value));return Buffer.concat([header(3,bytes.length),bytes]);}
 if(Buffer.isBuffer(value))return Buffer.concat([header(5,value.length),value]);
 assert.ok(Array.isArray(value));return Buffer.concat([header(6,value.length),...value.map(binaryEncoding)]);
}
for(const terminal of ['delete','revoke'])test('C07 independent manifest bytes/hashes and multi-page U4 '+terminal+' continuations refuse bytes',t=>{
 const role=host(),u4=host(),f=fixture(t,{h:role,assets:u4.assets}),bytes=Buffer.concat([Buffer.from('%PDF-1.7 '),Buffer.alloc(70000,65)]),v=mixed(f,'multi-'+terminal,bytes),saved=roleMethod(f,v),db=closeDb(t,f);
 const identity=db.prepare('SELECT store_id,cursor_secret FROM store_metadata').get(),scope=[ns.ownerId,ns.scope,ns.projectId];
 const textIdentity=createHmac('sha256',identity.cursor_secret).update(JSON.stringify(['method-file-content-v1',[identity.store_id,[ns,'original text']]])).digest('base64url');
 const binaryIdentity=createHmac('sha256',identity.cursor_secret).update(binaryEncoding(['binary-content-v1',identity.store_id,scope,'application/pdf',bytes])).digest('base64url');
 const expected=[{path:'guide.txt',byteCount:Buffer.byteLength('original text'),contentIdentity:textIdentity,mediaType:'text/plain',kind:'text'},
  {path:'attachment.pdf',byteCount:bytes.length,contentIdentity:binaryIdentity,mediaType:'application/pdf',kind:'binary'}];
 const manifestIdentity=createHmac('sha256',identity.cursor_secret).update(binaryEncoding(['method-mixed-manifest-v1',identity.store_id,scope,expected.map(e=>[e.kind,e.path,e.mediaType,e.byteCount,e.contentIdentity])])).digest('base64url');
 assert.equal(v.version.manifestIdentity,manifestIdentity);
 const manifest=()=>ok(f.call('listMethodManifest',{version:v.version,intent:'history',context:{readSet:[ns],roleId:'finance'}})).files;
 assert.equal(C(manifest()),C(expected));assert.equal(hash(Buffer.from(C(manifest()))),hash(Buffer.from(C(expected))));
 const meta=ok(f.call('readRoleTaskContext',{mode:'file',readSet:[ns],receipt:saved,package:v.package,path:'attachment.pdf'})).metered.file;assert.equal(meta.contentIdentity,binaryIdentity);
 const input={version:meta.version,path:meta.path,intent:'history',context:{readSet:[ns],roleId:'finance'}},parts=[],cursors=[];let cursor;
 do{const page=ok(f.call('readMethodAttachmentBytes',{...input,...(cursor?{cursor}:{})}));parts.push(Buffer.from(page.bytes,'base64'));cursor=page.nextCursor;if(cursor)cursors.push(cursor);}while(cursor);
 assert.equal(parts.length,3);assert.equal(cursors.length,2);assert.deepEqual(Buffer.concat(parts),bytes);assert.equal(hash(Buffer.concat(parts)),hash(bytes));
 f.reopen();assert.equal(C(manifest()),C(expected));
 if(terminal==='delete')ok(f.call('deleteMethodVersion',{actionId:'delete-multi',ref:v.version,expectedRevision:1}));else u4.revoke();
 for(const cursor of cursors){const result=f.call('readMethodAttachmentBytes',{...input,cursor});
  if(terminal==='delete'){assert.deepEqual(ok(result),{status:'unavailable',adoptionStatus:'unavailable'});assert.equal(ok(result).bytes,undefined);}else{assert.equal(result.error?.code,'authority_required');assert.equal(result.value,undefined);}
 }
 const roleFile=f.call('readRoleTaskContext',{mode:'file',readSet:[ns],receipt:saved,package:v.package,path:'attachment.pdf'});
 if(terminal==='delete')assert.equal(ok(roleFile).metered.file,null);else assert.equal(roleFile.error?.code,'authority_required');
});
