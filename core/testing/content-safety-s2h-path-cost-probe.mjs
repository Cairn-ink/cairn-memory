// Explicit probes: method dispatch and expected variants are data, never
// unchecked String.replace operations on executable source.
import { initializeProbe } from './content-safety-s2h-probe-harness.mjs';
import { runProductProbe } from './content-safety-s2h-cost-probe.mjs';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
const emptyResult=(method,r)=> {
 if(!r.ok)return r.error?.code==='memory_not_found';
 const v=r.value;
 if(method==='get')return v.memory===null&&v.receipts.length===0;
 if(method==='list')return v.memories.length===0;
 if(method==='recall')return v.memories.length===0;
 if(method==='getCard')return v===null||v.card===null;
 if(method==='listCards')return v.items?.length===0||v.cards?.length===0;
 if(method==='getConversation')return v.conversation===null&&v.messages.length===0;
 if(method==='sourceSnapshot')return v.memories.length===0;
 if(method==='sessionStartContext'||method==='session')return Object.values(v.groups??{}).every(g=>g.items?.length===0);
 return v.items?.length===0;
};
export async function memoryProbe(state, {facts,absent,limitItems}) {
 const {core,canonical,load,transaction,physical,n,ns,memories,dbs}=state;

assert.equal(core.rebuildIndex({namespace:absent?{...ns,scope:'project',projectId:'absent'}:ns,expectedIndexRevision:core.map({namespace:absent?{...ns,scope:'project',projectId:'absent'}:ns}).value.indexRevision}).ok,true);
if(facts){const {writeContentSuppressionInside}=await load('content-suppression-storage');transaction(canonical,()=>{for(let i=0;i<facts;i++)writeContentSuppressionInside(canonical,{namespace:absent?{...ns,scope:'project',projectId:'absent'}:ns,kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'unrelated-'+i});});}
const actualFacts=[34,38,48].includes(physical)?canonical.prepare('SELECT count(*) n FROM content_suppressions WHERE owner_id=?').get(ns.ownerId).n:0;assert.equal(actualFacts,facts);
const counter={get:0,all:0,iterate:0,run:0,exec:0}, sql=new Map();let active=false,headerStacks=[];
const p=DatabaseSync.prototype.prepare,e=DatabaseSync.prototype.exec;
DatabaseSync.prototype.prepare=function(q){const st=p.call(this,q);return new Proxy(st,{get(t,k){const v=Reflect.get(t,k,t);return typeof v!=='function'?v:(...args)=>{if(active&&['get','all','iterate','run'].includes(k)){counter[k]++;sql.set(q,(sql.get(q)??0)+1);if(process.env.CAIRN_S2H_STACKS&&/schema_version AS cookie/.test(q)&&headerStacks.length<30)headerStacks.push(new Error().stack);}return v.apply(t,args);};}});};
DatabaseSync.prototype.exec=function(q){if(active)for(const x of q.split(';').filter(x=>x.trim())){counter.exec++;sql.set(x,(sql.get(x)??0)+1);}return e.call(this,q);};
const {openMemoryStore}=await load('index');
const legacyPath='/synthetic/legacy.sqlite';dbs.set(legacyPath,canonical);
const close=canonical.close.bind(canonical);canonical.close=()=>{};
const store=openMemoryStore({path:legacyPath}),scope=store.scope({ownerId:ns.ownerId,...(absent?{projectId:'absent'}:{})});
const scoped=(method,call)=>{const value=call();return {ok:true,value,empty:method==='get'?value===null:value.length===0};};
const tasks=[['scope.get',()=>scoped('get',()=>scope.get(memories[0].id))],['scope.list',()=>scoped('list',()=>scope.list({limit:limitItems}))],['scope.search',()=>scoped('search',()=>scope.search(absent?'absentterm':'probecommon',{limit:limitItems}))],['sourceSnapshot',()=>core.sourceSnapshot({readSet:[absent?{...ns,scope:'project',projectId:'absent'}:ns],limit:Math.min(12,limitItems)})],['get',()=>core.get({namespace:absent?{...ns,scope:'project',projectId:'absent'}:ns,memoryId:memories[0].id})],['list',()=>core.list({namespace:absent?{...ns,scope:'project',projectId:'absent'}:ns,limit:limitItems})],['map',()=>core.map({namespace:absent?{...ns,scope:'project',projectId:'absent'}:ns,limit:limitItems})],['fetch',()=>core.fetch({namespace:absent?{...ns,scope:'project',projectId:'absent'}:ns,refs:memories.slice(0,12).map(m=>({memoryId:m.id,revision:m.revision}))})],['recall',()=>core.recall({readSet:[absent?{...ns,scope:'project',projectId:'absent'}:ns],query:'probecommon',limit:6})],['session',()=>core.sessionStartContext({namespace:absent?{...ns,scope:'project',projectId:'absent'}:ns,groups:{nextSteps:false,procedural:false,background:true},maxTokens:2000})]];
for(const [method,call]of tasks){for(const k of Object.keys(counter))counter[k]=0;sql.clear();headerStacks=[];globalThis.__counterCalls=0;globalThis.__providerCalls=0;active=true;const r=await call();active=false;console.log(JSON.stringify({node:process.version,physical,facts:actualFacts,n,method,case:absent?(method==='get'?'missing-ref':'absent'):method==='sourceSnapshot'&&n>Math.min(12,limitItems)?'overflow':'hit',empty:r.empty??emptyResult(method,r),portCalls:globalThis.__counterCalls+globalThis.__providerCalls,counterCalls:globalThis.__counterCalls,providerCalls:globalThis.__providerCalls,ok:r.ok,error:r.error?.code,...(process.env.CAIRN_S2H_STACKS?{headerStacks}:{}),counts:{...counter},total:Object.values(counter).reduce((a,b)=>a+b),begin:[...sql].filter(([q])=>/^BEGIN/.test(q)).reduce((a,[,b])=>a+b,0),safety:[...sql].filter(([q])=>/content_suppression|owner_suppression|schema_version AS cookie/.test(q)).map(([q,c])=>({q,c}))}));}
DatabaseSync.prototype.prepare=p;DatabaseSync.prototype.exec=e;store.close();canonical.close=close;core.close();

}

export async function topicProbe(state, {facts,absent,limitItems}) {
 const {core,canonical,load,transaction,physical,n,ns,memories}=state;

const {readTransaction}=await load('database'),{contentReadSafety,createContentReadMemo}=await load('content-safety'),{createTopicMembersStorage}=await load('topic-members-storage'),{createTopicOverviewStorage}=await load('topic-overview-storage');
if(facts){const {writeContentSuppressionInside}=await load('content-suppression-storage');transaction(canonical,()=>{for(let i=0;i<facts;i++)writeContentSuppressionInside(canonical,{namespace:ns,kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'unrelated-'+i});});}
const actualFacts=[34,38,48].includes(physical)?canonical.prepare('SELECT count(*) n FROM content_suppressions WHERE owner_id=?').get(ns.ownerId).n:0;assert.equal(actualFacts,facts);
const nativePrepare=DatabaseSync.prototype.prepare,nativeExec=DatabaseSync.prototype.exec;let active=false,total=0,factSql=0,headerSql=0,begins=0;
DatabaseSync.prototype.prepare=function(sql){const st=nativePrepare.call(this,sql);return new Proxy(st,{get(t,k){const v=Reflect.get(t,k,t);return typeof v!=='function'?v:(...args)=>{if(active&&['get','all','iterate','run'].includes(k)){total++;if(/FROM content_suppressions/.test(sql))factSql++;if(/SELECT schema_version AS cookie/.test(sql))headerSql++;}return v.apply(t,args);};}});};
DatabaseSync.prototype.exec=function(sql){if(active){const parts=sql.split(';').filter(x=>x.trim());total+=parts.length;begins+=parts.filter(x=>/^BEGIN/.test(x)).length;}return nativeExec.call(this,sql);};
const namespace=absent?{...ns,scope:'project',projectId:'absent'}:{...ns,projectId:''};
const members=createTopicMembersStorage(canonical,{rawAncestry:physical===48,createReadMemo:()=>createContentReadMemo(canonical),memoryReadable:[18,23,33].includes(physical)?()=>true:(namespace,row,memo)=>contentReadSafety(canonical,{namespace,memo,selectedMemory:row,ref:{type:'memory',namespace,memoryId:row.id,revision:row.revision}}).allowed});
const overview=createTopicOverviewStorage(canonical);
for(const kind of ['members','overview']){
 total=factSql=headerSql=0,begins=0;let items=[];active=true;
 readTransaction(canonical,()=>{
  if(kind==='members'){
   const state=members.create(),r={namespace,selection:{type:'unfiled'},kind:null},captured={generation:null};
   while(!state.done){members.step(state,r,captured);if(state.pending)items.push(state.pending);state.pending=null;}
  }else{
   const state=overview.create(namespace,{},overview.snapshot(namespace));while(!state.scan.next().done){}items=state.finish();
  }
 });active=false;
 assert.ok(Array.isArray(items),'actual topic storage result');
 if(absent)assert.deepEqual(items,[],'topic no-hit result is observed, never inferred from the request');
 console.log(JSON.stringify({node:process.version,physical,facts:actualFacts,n,kind,method:kind==='members'?'readTopicMembers':'readTopicOverview',case:absent?'absent':'hit',ok:true,empty:items.length===0,total,factSql,headerSql,begins}));
}
DatabaseSync.prototype.prepare=nativePrepare;DatabaseSync.prototype.exec=nativeExec;core.close();

}

export async function cardProbe(state, {facts,absent,limitItems}) {
 const {core,canonical,load,transaction,physical,n,ns,memories}=state;

const cards=[];for(let i=0;i<n;i++){const r=core.createCardDraft({namespace:ns,actionId:'card-'+i,drafting:'authored',input:{title:'Synthetic Card '+i,body:'Synthetic Card body '+i,authoredInput:{text:'Synthetic authored input '+i,occurredAt:null}}},{});assert.equal(r.ok,true,JSON.stringify(r));cards.push(r.value);}
if(facts){const {writeContentSuppressionInside}=await load('content-suppression-storage');transaction(canonical,()=>{for(let i=0;i<facts;i++)writeContentSuppressionInside(canonical,{namespace:ns,kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'unrelated-'+i});});}
const actualFacts=[34,38,48].includes(physical)?canonical.prepare('SELECT count(*) n FROM content_suppressions WHERE owner_id=?').get(ns.ownerId).n:0;assert.equal(actualFacts,facts);
const nativePrepare=DatabaseSync.prototype.prepare,nativeExec=DatabaseSync.prototype.exec;let active=false,count=0,begins=0,factSql=0;
DatabaseSync.prototype.prepare=function(sql){const stmt=nativePrepare.call(this,sql);return new Proxy(stmt,{get(t,k){const v=Reflect.get(t,k,t);return typeof v!=='function'?v:(...args)=>{if(active&&['get','all','iterate','run'].includes(k)){count++;if(/FROM content_suppressions/.test(sql))factSql++;}return v.apply(t,args);};}});};
DatabaseSync.prototype.exec=function(sql){if(active)for(const x of sql.split(';').filter(x=>x.trim())){count++;if(/^BEGIN/.test(x))begins++;}return nativeExec.call(this,sql);};
for(const method of ['getCard','listCards']){count=begins=factSql=0;active=true;const r=await core[method]({namespace:ns,...(method==='getCard'?{cardId:absent?'absent':cards[0].id}:{states:[absent?'confirmed':'draft'],limit:50})},{});active=false;assert.equal(r.ok,true,JSON.stringify(r));console.log(JSON.stringify({node:process.version,physical,facts:actualFacts,cards:cards.length,method,case:absent?'absent':'hit',ok:r.ok,empty:emptyResult(method,r),count,begins,factSql}));}
DatabaseSync.prototype.prepare=nativePrepare;DatabaseSync.prototype.exec=nativeExec;core.close();

}

export async function rawProbe(state, {facts,absent,limitItems}) {
 const {core,canonical,load,transaction,physical,n,ns,memories}=state;

const actualClose=canonical.close.bind(canonical);canonical.close=()=>{};core.close();const origOpen=__probe.open;__probe.open=(path,opts)=>path===':memory:'?canonical:origOpen(path,opts);
const {localPlainPort,splitRaw,rawRequest}=await load('testing/raw-fixtures'),basePort=localPlainPort();let opened=0;
const port={...basePort,async sealRaw(input){assert.equal(canonical.isTransaction,false);return basePort.sealRaw(input);},async openRaw(input){assert.equal(canonical.isTransaction,false);opened++;return basePort.openRaw(input);}};
const {openMemoryCore}=await load('contract');
const live=openMemoryCore({path:':memory:',model:{contextWindow:8192,countTokens:()=>1,extract:()=>({items:[]})},rawConversations:{mode:'raw-v1',port,capBytes:1048576,readPolicy:()=>({generation:'synthetic',reason:null})}});
let id;for(const part of splitRaw('abcd',{id:'message',size:1})){const r=await live.captureRaw(rawRequest(part,{namespace:ns,client:'codex',sessionId:'raw-probe',eventId:'raw-'+part.part.index}));assert.equal(r.ok,true,JSON.stringify(r));id=r.value.raw.conversationId;}
if(facts){const {writeContentSuppressionInside}=await load('content-suppression-storage');transaction(canonical,()=>{for(let i=0;i<facts;i++)writeContentSuppressionInside(canonical,{namespace:ns,kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'unrelated-'+i});});}
const actualFacts=[34,38,48].includes(physical)?canonical.prepare('SELECT count(*) n FROM content_suppressions WHERE owner_id=?').get(ns.ownerId).n:0;assert.equal(actualFacts,facts);
const nativePrepare=DatabaseSync.prototype.prepare,nativeExec=DatabaseSync.prototype.exec;let active=false,count=0,begins=0;
DatabaseSync.prototype.prepare=function(sql){const stmt=nativePrepare.call(this,sql);return new Proxy(stmt,{get(t,k){const v=Reflect.get(t,k,t);return typeof v!=='function'?v:(...args)=>{if(active&&['get','all','iterate','run'].includes(k))count++;return v.apply(t,args);};}});};
DatabaseSync.prototype.exec=function(sql){if(active)for(const x of sql.split(';').filter(x=>x.trim())){count++;if(/^BEGIN/.test(x))begins++;}return nativeExec.call(this,sql);};
for(const limit of [1,4]){count=begins=opened=0;active=true;const r=await live.getConversation({namespace:ns,conversationId:absent?'absent':id,limit});active=false;assert.equal(r.ok,true,JSON.stringify(r));console.log(JSON.stringify({node:process.version,physical,facts:actualFacts,limit,method:'getConversation',case:absent?'absent':'hit',ok:r.ok,empty:emptyResult('getConversation',r),count,begins,opened}));}
DatabaseSync.prototype.prepare=nativePrepare;DatabaseSync.prototype.exec=nativeExec;live.close();actualClose();

}

const [kind,version,size,factCount='0',miss='match',mode='lexical',limit='12']=process.argv.slice(2);
const options={physical:Number(version),n:Number(size),facts:Number(factCount),absent:miss==='absent',mode,limitItems:Number(limit)};
if(['context','status','evidence','maintenance'].includes(kind))await runProductProbe({...options,kind,factCount});
else {
 const state=await initializeProbe({...options,model:{contextWindow:8192,countTokens:()=>{globalThis.__counterCalls=(globalThis.__counterCalls??0)+1;return 1;},select:({input})=>{globalThis.__providerCalls=(globalThis.__providerCalls??0)+1;return {refs:input.maps.flatMap(m=>m.items.filter(i=>i.type==='unfiled').slice(0,6).map(i=>({namespaceIndex:m.namespaceIndex,...i.ref}))) };},rank:({input})=>{globalThis.__providerCalls=(globalThis.__providerCalls??0)+1;return {refs:input.candidates.slice(0,input.limit).map(c=>({namespaceIndex:c.namespaceIndex,memoryId:c.memory.id,revision:c.memory.revision}))};}},cardsAuthority:{authorize(request){const {input,...binding}=request;return {...binding,accessGeneration:1};},isCurrent:grant=>grant}});
 const probes={memory:memoryProbe,topic:topicProbe,card:cardProbe,raw:rawProbe};
 assert.ok(Object.hasOwn(probes,kind),'unknown probe kind');await probes[kind](state,options);
}
