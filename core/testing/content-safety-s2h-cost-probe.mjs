// Synthetic in-memory transport reproduces the frozen query-cost fixture.
// Production query SQL is loaded unchanged; only file/Worker plumbing is adapted.

import {register} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url));
register('data:text/javascript,'+encodeURIComponent("\nimport {readFile} from 'node:fs/promises';\nconst root=ROOT;\nexport async function resolve(spec,ctx,next){\n if(spec==='node:worker_threads' && ctx.parentURL?.endsWith('/core/context-product-reader.mjs'))return {url:'probe:/shim-worker',shortCircuit:true};\n if(spec==='node:fs' && ctx.parentURL?.startsWith('probe:/') && !ctx.parentURL.includes('/shim-'))return {url:'probe:/shim-fs',shortCircuit:true};\n if(spec==='node:sqlite' && ctx.parentURL?.startsWith('probe:/') && !ctx.parentURL.includes('/shim-'))return {url:'probe:/shim-sqlite',shortCircuit:true};\n if(spec.startsWith('probe:'))return {url:spec,shortCircuit:true};\n if(spec.startsWith('.')&&ctx.parentURL?.startsWith('probe:/'))return {url:new URL(spec,ctx.parentURL).href,shortCircuit:true};\n return next(spec,ctx);\n}\nexport async function load(url,ctx,next){\n if(url==='probe:/shim-worker')return {format:'module',shortCircuit:true,source:`export * from 'node:worker_threads';export class Worker{constructor(url,options){return new globalThis.__probe.ProbeWorker(options.workerData)}}`};\n if(url==='probe:/shim-fs')return {format:'module',shortCircuit:true,source:`export * from 'node:fs';import * as fs from 'node:fs';export function lstatSync(p,o){return globalThis.__probe.stat(p,o,fs.lstatSync)};export function readFileSync(p,o){return globalThis.__probe.read(p,o,fs.readFileSync)};`};\n if(url==='probe:/shim-sqlite')return {format:'module',shortCircuit:true,source:`export * from 'node:sqlite';export function DatabaseSync(p,o){return globalThis.__probe.open(p,o)};`};\n if(url.endsWith('/core/sqlite-journal-probe.mjs'))return {format:'module',shortCircuit:true,source:`export const sqliteFileStat=p=>globalThis.__probe.stat(p,{bigint:true});export const probeRollbackJournal=()=>({mode:'delete',code:0});export function createExclusiveSqliteFile(){throw Error('unexpected file creation')}`};\n if(url.startsWith('probe:/')){\n const m=/^probe:\\/([^/]+)\\/(.+)$/.exec(url);if(!m)throw Error(url);\n const source=await readFile(root+'/'+m[2],'utf8');\n return {format:'module',source,shortCircuit:true};\n }\n return next(url,ctx);\n}\n".replace('ROOT',JSON.stringify(root))),import.meta.url);
const rev=process.argv[2]??'f0563088', n=Number(process.argv[3]??300), physical=Number(process.argv[4]??34), factCount=process.argv[5]??'0';
const load=p=>import('probe:/'+rev+'/core/'+p+'.mjs');
const dbs=new Map(), originals=new Map();let memorySerial=0;
globalThis.__probe={
 read(p,o,actual){if(!String(p).startsWith('probe:/'))return actual(p,o);const m=/^probe:\/([^/]+)\/(.+)$/.exec(String(p));return readFileSync(root+'/'+m[2],o);},
 open(p,o){
  if(p===':memory:'){const db=new DatabaseSync(':memory:');globalThis.__probe.latest=db;return db;}
  p=String(p).replace(/^file:\/\//,'').split('?')[0];
  if(!dbs.has(p))throw Error('unknown synthetic DB '+p);
  return dbs.get(p);
 },
 stat(p,o,actual){
  p=String(p);if(!p.startsWith('/synthetic/')){if(actual)return actual(p,o);throw Error('unexpected path '+p);}
  if(!dbs.has(p))throw Object.assign(Error('synthetic absent'),{code:'ENOENT'});
  const big=o?.bigint;const num=x=>big?BigInt(x):x;
  return {dev:num(1),ino:num([...dbs.keys()].indexOf(p)+1),size:num(8192),mode:num(0o100600),mtimeNs:num(1),ctimeNs:num(1),isFile:()=>true,isSymbolicLink:()=>false};
 }
};
const {openMemoryCore}=await load('contract');
const {openDatabase,transaction}=await load('database');
const authority={authorize:()=>null,isCurrent:()=>null};
const rawBase=[23,33,38,48].includes(physical)?{privateCards:{version:'private-cards-local-v1',source:'submitted-note-v1',storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',authority,currentDependencies:{version:'card-current-dependencies-v1'}},methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority}}:{};
if ([23,38].includes(physical)) { delete rawBase.methodPackages; delete rawBase.privateCards.currentDependencies; }
const core=openMemoryCore({path:':memory:',...rawBase});const canonical=__probe.latest;
const ns={ownerId:'synthetic-probe-owner',scope:'personal',projectId:null};
const memories=[];
for(let i=0;i<n;i++){
 const r=core.admit({namespace:ns,memory:{content:'probecommon synthetic memory '+String(i).padStart(5,'0'),kind:'fact'},receipts:[{client:'synthetic',sessionId:'probe',eventId:String(i),role:'user',excerpt:'synthetic receipt '+i}]});
 assert.equal(r.ok,true,JSON.stringify(r));memories.push(r.value.memory);
}
const base=[33,48].includes(physical)?33:[23,38].includes(physical)?23:18;
assert.equal(canonical.prepare('PRAGMA user_version').get().user_version,base);
if([34,38,48].includes(physical)){
 const {installContentSafetyInside,contentSafetyInventory}=await load('content-safety-migration');
 transaction(canonical,()=>installContentSafetyInside(canonical,base,contentSafetyInventory(canonical)));
}
const {attestContentSafety}=await load('content-safety-schema');attestContentSafety(canonical);
const path='/synthetic/store.sqlite', suffix='.context-read-product-v1.1.sqlite', side=new DatabaseSync(':memory:'), lock=new DatabaseSync(':memory:');
const source=readFileSync(root+'/core/context-product-sidecar.mjs','utf8');
const ddl=/const ddl = `([\s\S]*?)`;/.exec(source)[1],{VECTOR_DDL}=await load('context-product-vectors');
side.exec('PRAGMA application_id=0x43525032;PRAGMA user_version=3;'+ddl+VECTOR_DDL);
side.prepare('INSERT INTO product_metadata VALUES(1,?,?,?,?)').run(canonical.prepare('SELECT store_id FROM store_metadata').get().store_id,'context-read-product-p2a-v1',randomUUID(),'lexical');
// Use the production profile constant rather than assuming its spelling.
const {PRODUCT_PROFILE,credentialDigest}=await load('context-product-control');side.prepare('UPDATE product_metadata SET profile=?').run(PRODUCT_PROFILE);
for(const [p,db] of [[path,canonical],[path+suffix,side],[path+suffix+'.lifecycle-lock.sqlite',lock]]){
 dbs.set(p,db);originals.set(db,db.close.bind(db));db.close=()=>{};
}
const {openContextProductFacade}=await load('context-read-facade'),{openProductIndex}=await load('context-product-index');
const {requestAuthority}=await load('context-product-authority');
const token={opaque:'synthetic-token'},ownerCoverage={policy:'recent-projects-v1',selectionRevision:'synthetic-inventory',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0};
const baseBinding={credentialDigest:credentialDigest(token),ownerId:ns.ownerId,namespaces:{readSet:[ns],ownerCoverage},issuedAt:0};
const bindService={...baseBinding,kind:'service',serviceId:randomUUID(),credentialBindingId:randomUUID(),credentialExpiresUtcMs:null};
const authorizer=b=>requestAuthority({authorize:()=>b,isCurrent:()=>true},b,{});
const maintainAuth=authorizer(bindService),maintainFacade=openContextProductFacade(path,{authorize:maintainAuth});
const maintainer=openProductIndex({path,facade:maintainFacade,authorize:maintainAuth,ownerCoverage,maintenance:true,sidecarJournalMode:'DELETE'});
for(const intent of ['current','history']){
 let complete=false;
 for(let i=0;i<100;i++){
 const r=await maintainer.run('refreshContextIndex',{readSet:[ns],types:['memory'],intent,mode:'lexical',budget:{maxItems:1024,maxMs:5000}},token);
 assert.equal(r.ok,true,JSON.stringify(r));if(r.value.status==='complete'){complete=true;break;}
 }
 assert.ok(complete);
}
maintainer.close();maintainFacade.close();
canonical.exec('PRAGMA query_only=OFF');
const {writeContentSuppressionInside,suppressOwnerInside}=await load('content-suppression-storage');
if(factCount==='owner')transaction(canonical,()=>suppressOwnerInside(canonical,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'synthetic-erase'}));
else if(Number(factCount))transaction(canonical,()=>{for(let i=0;i<Number(factCount);i++)writeContentSuppressionInside(canonical,{namespace:ns,kind:'memory',key:memories[i].id,reason:'user_forget',actionId:'synthetic-fact-'+i});});
assert.equal(canonical.prepare('PRAGMA user_version').get().user_version,physical);
console.log(JSON.stringify({phase:'setup',node:process.version,rev,n,physical,factCount,memories:canonical.prepare('SELECT count(*) AS n FROM memories').get().n,facts:[34,38,48].includes(physical)?canonical.prepare('SELECT count(*) AS n FROM content_suppressions').get().n:0,profile:PRODUCT_PROFILE}));
// Public reader runtime's injectable Worker seam delegates to the exact production facade/index dispatcher.
const {openContextProductReader}=await load('context-product-reader');
class ProbeWorker extends EventEmitter{
 constructor(data){super();this.data=data;this.stdout={resume(){}};this.stderr={resume(){}};queueMicrotask(()=>{try{
 const authorize=(m,p,c)=>requestAuthority({authorize:()=>data.binding,isCurrent:()=>true},data.binding,data.request)(m,p,c);
 this.facade=openContextProductFacade(path,{authorize});
 this.index=openProductIndex({path,facade:this.facade,authorize,ownerCoverage,maintenance:false});
 this.emit('message',{operation:data.operation,result:{ok:true,value:null},fileIdentity:this.facade.fileIdentity});
 }catch(e){console.error(e);this.emit('error',e);}});}
 postMessage(msg){if(msg.method==='close'){queueMicrotask(()=>this.terminate());return;}queueMicrotask(async()=>{try{const r=await this.index.run(msg.method,msg.input,msg.credential);this.emit('message',{operation:msg.operation,result:r});}catch(e){console.error(e);this.emit('error',e);}});}
 unref(){}ref(){}async terminate(){this.index?.close();this.facade?.close();this.emit('exit',0);return 0;}
}
__probe.ProbeWorker=ProbeWorker;
const {createContextReadSupervisor}=await load('context-read-supervisor');
const supervisor=createContextReadSupervisor(),ids={requestId:randomUUID(),handleId:randomUUID(),credentialBindingId:randomUUID(),credentialExpiresUtcMs:null};
const binding={...baseBinding,kind:'request',...ids};
const reader=await openContextProductReader({supervisor,path,version:'context-read-v1',profile:PRODUCT_PROFILE,readSet:[ns],ownerCoverage,requestControl:{...ids,requestMaxMs:5000},host:{moduleUrl:'file:///synthetic/host.mjs',configuration:{requestBinding:binding,requestReservation:new SharedArrayBuffer(4)}}});
let effectiveFacts=Number(factCount),expectedFailure=false;let active=null;const nativePrepare=DatabaseSync.prototype.prepare,nativeExec=DatabaseSync.prototype.exec;
function record(kind,sql){if(!active)return;active[kind]=(active[kind]??0)+1;const k=sql.replace(/\s+/g,' ').trim();(active.sql[k]??={prepare:0,get:0,all:0,iterate:0,run:0,exec:0})[kind]++;if(/content_suppressions INDEXED BY content_suppression_target/.test(sql)&&kind==='all'&&active.stacks.length<2)active.stacks.push(new Error().stack);}
DatabaseSync.prototype.prepare=function(sql){record('prepare',sql);const stmt=nativePrepare.call(this,sql);return new Proxy(stmt,{get(t,k){const v=Reflect.get(t,k,t);if(typeof v!=='function')return v;return(...args)=>{if(['get','all','iterate','run'].includes(k))record(k,sql);return v.apply(t,args);};}});};
DatabaseSync.prototype.exec=function(sql){if(active)for(const s of sql.split(';').filter(x=>x.trim()))record('exec',s);return nativeExec.call(this,sql);};
async function measure(label,query){
 active={prepare:0,get:0,all:0,iterate:0,run:0,exec:0,sql:{},stacks:[]};
 const result=await reader.findCandidates(query,token);const c=active;active=null;
 const executed=c.get+c.all+c.iterate+c.run;
 console.log(JSON.stringify({phase:'query',label,node:process.version,rev,n,physical,factCount,prepare:c.prepare,executed,exec:c.exec,totalExecuted:executed+c.exec,preparePlusExecuted:c.prepare+executed+c.exec,ok:result.ok,error:result.error?.code,items:result.value?.items.length,eligible:result.value?.coverage.byType.memory.eligible,sqlSummary:Object.entries(c.sql).map(([sql,v])=>({sql,prepare:v.prepare,executions:v.get+v.all+v.iterate+v.run,exec:v.exec})),stacks:c.stacks}));
 if(factCount==='owner'||expectedFailure)assert.equal(result.error?.code,'evidence_unavailable');else {assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.coverage.byType.memory.eligible,physical===48&&Number(factCount)>0?null:n-effectiveFacts);}
 return result;
}
for(const intent of ['current','history']){
 const query={readSet:[ns],types:['memory'],intent,query:process.argv[6]==='absent'?'absentterm':'probecommon',limit:12,deadlineMs:5000};
 const first=await measure(intent+'-first',query);await measure(intent+'-repeat',query);
 if(first.ok&&first.value.nextCursor)await measure(intent+'-cursor',{...query,cursor:first.value.nextCursor});
}

DatabaseSync.prototype.prepare=nativePrepare;DatabaseSync.prototype.exec=nativeExec;
await reader.close();await supervisor.close();
for(const [db,close]of originals)close();
console.log(JSON.stringify({phase:'done'}));
