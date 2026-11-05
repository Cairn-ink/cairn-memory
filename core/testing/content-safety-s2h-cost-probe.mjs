import { trackContentHostOptions, contentHostInvocations } from './content-safety-cost-hosts.mjs';
// Explicit product query/assembly/status cost probes. SQL uses the production
// dispatcher; the harness substitutes only file/Worker transport plumbing.
import { initializeProbe } from './content-safety-s2h-probe-harness.mjs';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
const root=process.env.CAIRN_PROBE_SOURCE_ROOT??fileURLToPath(new URL('../../',import.meta.url));
export async function runProductProbe({kind='query',physical,n,factCount='0',absent=false,mode='lexical',limitItems=12}) {
const {core,canonical,load,dbs,originals,ns,memories,transaction,rev}=await initializeProbe({physical,n,factCount});
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
const authorizer=b=>requestAuthority(trackContentHostOptions({authorize:()=>b,isCurrent:()=>true}),b,{});
const maintainAuth=authorizer(bindService),maintainFacade=openContextProductFacade(path,{authorize:maintainAuth});
const maintainer=openProductIndex({path,facade:maintainFacade,authorize:maintainAuth,ownerCoverage,maintenance:true,sidecarJournalMode:'DELETE'});
if(kind==='maintenance') {
 const {measureContentRead}=await import('./content-safety-cost-meter.mjs');
 canonical.exec('PRAGMA query_only=OFF');
 if(Number(factCount)){
  const {writeContentSuppressionInside}=await load('content-suppression-storage');
  transaction(canonical,()=>{for(let i=0;i<Number(factCount);i++)writeContentSuppressionInside(canonical,{namespace:{...ns,scope:'project',projectId:'unrelated'},kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'fact-'+i});});
 }
 for(const intent of ['current','history'])for(const phase of ['first','repeat']){
  const row=await measureContentRead('refreshContextIndex',intent+'-'+phase,()=>maintainer.run('refreshContextIndex',{readSet:[ns],types:['memory'],intent,mode:'lexical',budget:{maxItems:1024,maxMs:5000}},token));
  assert.equal(row.result.ok,true,JSON.stringify(row.result));assert.equal(row.result.value.status,'complete');
  console.log(JSON.stringify({phase:'maintenance',n,physical,factCount,...row,result:undefined}));
 }
 maintainer.close();maintainFacade.close();core.close();for(const [db,close]of originals)close();return;
}
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
console.log(JSON.stringify({phase:'setup',node:process.version,rev,n,physical,factCount,memories:canonical.prepare('SELECT count(*) AS n FROM memories').get().n,facts:[34,38,48,51,52,53].includes(physical)?canonical.prepare('SELECT count(*) AS n FROM content_suppressions').get().n:0,profile:PRODUCT_PROFILE}));
// Public reader runtime's injectable Worker seam delegates to the exact production facade/index dispatcher.
const {openContextProductReader}=await load('context-product-reader');
class ProbeWorker extends EventEmitter{
 constructor(data){super();this.data=data;this.stdout={resume(){}};this.stderr={resume(){}};queueMicrotask(()=>{try{
 const authorize=(m,p,c)=>requestAuthority(trackContentHostOptions({authorize:()=>data.binding,isCurrent:()=>true}),data.binding,data.request)(m,p,c);
 this.facade=openContextProductFacade(path,{authorize});
 this.index=openProductIndex({path,facade:this.facade,authorize,ownerCoverage,maintenance:false,counter:trackContentHostOptions({id:"synthetic",countTokens:()=>{if(active)active.counterCalls=(active.counterCalls??0)+1;return 1;}}),
   ...(mode.startsWith('semantic')?{semantic:{snapshot:async()=>{
     if(mode==='semantic-late-fact' && !expectedFailure){
       canonical.exec('PRAGMA query_only=OFF');
       transaction(canonical,()=>suppressOwnerInside(canonical,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'during-semantic-snapshot'}));
       canonical.exec('PRAGMA query_only=ON');expectedFailure=true;
     }
     return {policy:{semantic:false},identity:null};
   }},
     operation:()=>({operationCutoffMonoNs:String(process.hrtime.bigint()+5000000000n)})}:{})});
 this.emit('message',{operation:data.operation,result:{ok:true,value:null},fileIdentity:this.facade.fileIdentity});
 }catch(e){console.error(e);this.emit('error',e);}});}
 postMessage(msg){if(msg.method==='close'){queueMicrotask(()=>this.terminate());return;}queueMicrotask(async()=>{try{const fetch=()=>{const {deadlineMs,...input}=msg.input;return this.facade.fetchCandidateEvidence(input,msg.credential,msg.input);};const r=msg.method==='fetchCandidateEvidence'?fetch():await this.index.run(msg.method,msg.input,msg.credential);this.emit('message',{operation:msg.operation,result:r});}catch(e){console.error(e);this.emit('error',e);}});}
 unref(){}ref(){}async terminate(){this.index?.close();this.facade?.close();this.emit('exit',0);return 0;}
}
__probe.ProbeWorker=ProbeWorker;
const {createContextReadSupervisor}=await load('context-read-supervisor');
const supervisor=createContextReadSupervisor(),ids={requestId:randomUUID(),handleId:randomUUID(),credentialBindingId:randomUUID(),credentialExpiresUtcMs:null};
const binding={...baseBinding,kind:'request',...ids};
const reader=await openContextProductReader({supervisor,path,version:'context-read-v1',profile:PRODUCT_PROFILE,readSet:[ns],ownerCoverage,requestControl:{...ids,requestMaxMs:5000},host:{moduleUrl:'file:///synthetic/host.mjs',configuration:{requestBinding:binding,requestReservation:new SharedArrayBuffer(4)}}});
let effectiveFacts=Number(factCount),expectedFailure=false;let active=null;const nativePrepare=DatabaseSync.prototype.prepare,nativeExec=DatabaseSync.prototype.exec;
function record(kind,sql,connection){if(!active)return;active[kind]=(active[kind]??0)+1;const k=sql.replace(/\s+/g,' ').trim();if(kind!=='prepare'&&/SELECT schema_version AS cookie|FROM owner_suppression_epochs/.test(k))active.safetyTrace.push({sql:k,transaction:connection?.isTransaction});(active.sql[k]??={prepare:0,get:0,all:0,iterate:0,run:0,exec:0})[kind]++;if(/content_suppressions INDEXED BY content_suppression_target/.test(sql)&&kind==='all'&&active.stacks.length<2)active.stacks.push(new Error().stack);}
DatabaseSync.prototype.prepare=function(sql){const connection=this;record('prepare',sql,connection);const stmt=nativePrepare.call(this,sql);return new Proxy(stmt,{get(t,k){const v=Reflect.get(t,k,t);if(typeof v!=='function')return v;return(...args)=>{if(['get','all','iterate','run'].includes(k))record(k,sql,connection);return v.apply(t,args);};}});};
DatabaseSync.prototype.exec=function(sql){if(active)for(const s of sql.split(';').filter(x=>x.trim()))record('exec',s,this);return nativeExec.call(this,sql);};
async function measure(label,query){
 const hostBefore=contentHostInvocations();
 active={prepare:0,get:0,all:0,iterate:0,run:0,exec:0,sql:{},stacks:[],safetyTrace:[]};
 const result=kind==='evidence'?await reader.fetchCandidateEvidence({readSet:[ns],...(query.snapshot?{snapshot:query.snapshot}:{intent:query.intent,refs:memories.slice(Number(factCount)>0?5:0,(Number(factCount)>0?5:0)+limitItems).map(m=>({type:'memory',namespace:ns,memoryId:m.id,revision:m.revision}))})},token):kind==='context' ? await reader.contextRead((({limit,...input})=>({...input,budget:{maxTokens:4000,maxItems:limitItems}}))(query),token)
   : kind==='status' ? await reader.getContextIndexStatus({readSet:[ns],types:['memory'],intent:query.intent},token)
   : await reader.findCandidates(query,token);const c=active;active=null;
 const executed=c.get+c.all+c.iterate+c.run;
 console.log(JSON.stringify({phase:'query',label,node:process.version,rev,n,physical,factCount,method:kind==='context'?'contextRead':kind==='status'?'getContextIndexStatus':kind==='evidence'?'fetchCandidateEvidence':'findCandidates',case:label,hostInvocations:contentHostInvocations()-hostBefore,counterCalls:c.counterCalls??0,prepare:c.prepare,executed,exec:c.exec,totalExecuted:executed+c.exec,preparePlusExecuted:c.prepare+executed+c.exec,ok:result.ok,error:result.error?.code,items:kind==='context'?result.value?.metered?.items?.length:result.value?.items?.length,empty:kind==='status'?null:kind==='context'?result.value?.metered?.items?.length===0:result.value?.items?.length===0,eligible:result.value?.coverage?.byType?.memory?.eligible,safetyTrace:c.safetyTrace,sqlSummary:Object.entries(c.sql).map(([sql,v])=>({sql,prepare:v.prepare,executions:v.get+v.all+v.iterate+v.run,exec:v.exec})),stacks:c.stacks}));
 if(factCount==='owner'||expectedFailure)assert.equal(result.error?.code,'evidence_unavailable');else {assert.equal(result.ok,true,JSON.stringify(result));if(kind==='query')assert.equal(result.value.coverage.byType.memory.eligible,[48,53].includes(physical)&&Number(factCount)>0?null:n-effectiveFacts);if(absent&&kind!=='status'&&kind!=='evidence')assert.equal(kind==='context'?result.value.metered.items.length:result.value.items.length,0);}
 return result;
}
for(const intent of ['current','history']){
 const query={readSet:[ns],types:['memory'],intent,query:absent?'absentterm':'probecommon',limit:12,deadlineMs:5000,...(mode.startsWith('semantic')?{semantic:true}:{})};
 const first=await measure(intent+'-first',query);await measure(intent+'-repeat',query);
 if(kind==='evidence'&&first.ok)await measure(intent+'-snapshot',{...query,snapshot:first.value.snapshot});
 if(kind==='query'&&first.ok&&first.value.nextCursor)await measure(intent+'-cursor',{...query,cursor:first.value.nextCursor});
}

DatabaseSync.prototype.prepare=nativePrepare;DatabaseSync.prototype.exec=nativeExec;
await reader.close();await supervisor.close();
for(const [db,close]of originals)close();
console.log(JSON.stringify({phase:'done'}));

}
if(process.argv[1]===fileURLToPath(import.meta.url))await runProductProbe({n:Number(process.argv[3]??300),physical:Number(process.argv[4]??34),factCount:process.argv[5]??'0',absent:process.argv[6]==='absent',mode:process.argv[7]??'lexical'});
