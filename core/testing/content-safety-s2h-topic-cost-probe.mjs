// Full public topic API -> production Worker dispatcher -> production session.
// Only Worker transport and fixture file plumbing use the in-memory harness.
import { register } from 'node:module';
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { initializeProbe } from './content-safety-s2h-probe-harness.mjs';
import { measureContentRead } from './content-safety-cost-meter.mjs';
const [version,size,factCount='0',miss='match']=process.argv.slice(2),physical=Number(version),n=Number(size),absent=miss==='absent';
// Test-only mutation exercises retained prepared statements through the public
// dispatcher. The exact source assertion prevents a silent no-op mutation.
if (process.argv[6] === 'retained-statement-mutation') register('data:text/javascript,' + encodeURIComponent(`
export async function load(url, context, next) {
 const result = await next(url, context);
 if (!url.endsWith('/core/topic-overview-storage.mjs')) return result;
 const source = String(result.source), needle = 'function snapshot(namespace) {';
 if (source.split(needle).length !== 2) throw Error('topic_meter_mutation_target');
 return { ...result, source: source.replace(needle, needle + '\\n    stateRow.get(...boundary(namespace));') };
}`), import.meta.url);
const state=await initializeProbe({physical,n,deterministicIds:true,model:{countTokens:()=>1}}),{core,canonical,load,dbs,transaction,ns,memories}=state;
for(let i=0;i<2;i++){
 const index=core.map({namespace:ns});assert.equal(index.ok,true,JSON.stringify(index));
 const placed=core.applyPlacement({namespace:ns,expectedIndexRevision:index.value.indexRevision,expectedMemoryRevisions:[{memoryId:memories[i].id,revision:memories[i].revision}],proposal:{items:[{memoryId:memories[i].id,parentIds:[],newL1:{title:'Synthetic topic '+i,parentL2Ids:[],newL2Title:'Synthetic root '+i}}]}});assert.equal(placed.ok,true,JSON.stringify(placed));
}
if(Number(factCount)){const {writeContentSuppressionInside}=await load('content-suppression-storage');transaction(canonical,()=>{for(let i=0;i<Number(factCount);i++)writeContentSuppressionInside(canonical,{namespace:ns,kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'fact-'+i});});}
const path='/synthetic/topic.sqlite';dbs.set(path,canonical);const close=canonical.close.bind(canonical);canonical.close=()=>{};
register('data:text/javascript,'+encodeURIComponent(`
export async function resolve(spec,ctx,next){
 if(spec==='node:worker_threads'&&ctx.parentURL?.endsWith('/core/memory-reader.mjs'))return {url:'probe-topic:/worker',shortCircuit:true};
 if(spec==='node:worker_threads'&&ctx.parentURL?.endsWith('/core/topic-overview-worker.mjs'))return {url:'probe-topic:/port/'+ctx.parentURL.split('/')[1],shortCircuit:true};
 if(spec.startsWith('probe-topic:'))return {url:spec,shortCircuit:true};return next(spec,ctx);
}
export async function load(url,ctx,next){
 if(url==='probe-topic:/worker')return {format:'module',shortCircuit:true,source:"export * from 'node:worker_threads';export class Worker{constructor(url,options){return new globalThis.__probe.TopicWorker(options.workerData)}}"};
 if(url.startsWith('probe-topic:/port/')){const id=url.split('/').at(-1);return {format:'module',shortCircuit:true,source:'const worker=globalThis.__probe.topicWorkers.get('+JSON.stringify(id)+');export const parentPort=worker.port;export const workerData=worker.data;'};}
 return next(url,ctx);
}`),import.meta.url);
let serial=0;__probe.topicWorkers=new Map();
__probe.TopicWorker=class extends EventEmitter {
 constructor(data){super();this.data=structuredClone(data);this.stdout={resume(){}};this.stderr={resume(){}};const id='topic-'+serial++;
  this.port=new EventEmitter();this.port.postMessage=value=>queueMicrotask(()=>this.emit('message',structuredClone(value)));__probe.topicWorkers.set(id,this);
  this.ready=import('probe:/'+id+'/core/topic-overview-worker.mjs');this.ready.catch(error=>this.emit('error',error));
 }
 postMessage(value){const message=structuredClone(value);this.ready.then(()=>this.port.emit('message',message)).catch(()=>{});}
 ref(){}unref(){}async terminate(){await this.ready.catch(()=>{});this.port.removeAllListeners();this.emit('exit',0);return 0;}
};
const now=Object.getOwnPropertyDescriptor(performance,'now');Object.defineProperty(performance,'now',{configurable:true,value:()=>0});
const {openMemoryReader}=await load('memory-reader'),reader=openMemoryReader({path,ownerId:ns.ownerId});
try {
 const p={namespace:ns,workLimit:50000};
 // Finish lazy opening/schema review before counting requests. R3 separately
 // pins physical open counts; the method gates retain every page/session fence.
 for(const [method,input]of [['readTopicOverview',{...p,nodeLimit:100}],['readTopicOverview',{...p,nodeLimit:100,snapshotVersion:'topic-snapshot-v1'}],['readTopicMembers',{...p,selection:{type:'unfiled'},accessRevision:'synthetic',limit:100,deadlineMs:5000}]]){const result=await reader[method](input);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.coverage.complete,true);}
 const namespace=absent?{...ns,scope:'project',projectId:'absent'}:ns;
 const cases=[['readTopicOverview',{...p,namespace,nodeLimit:1},'legacy'],['readTopicOverview',{...p,namespace,nodeLimit:1,snapshotVersion:'topic-snapshot-v1'},'optin'],['readTopicMembers',{...p,namespace,selection:{type:'unfiled'},accessRevision:'synthetic',limit:1,deadlineMs:5000},'members']];
 for(const [method,input,variant]of cases){const row=await measureContentRead(method,variant,()=>reader[method](input));assert.equal(row.result.ok,true,JSON.stringify(row.result));if(absent)assert.deepEqual(row.result.value.items,[]);console.log(JSON.stringify({...row,n,physical,factCount,absent,result:undefined}));
  if(!absent){assert.ok(row.result.value.nextCursor,'real cursor page: '+method+' '+variant);const page=await measureContentRead(method,variant+'-cursor',()=>reader[method]({...input,cursor:row.result.value.nextCursor}));assert.equal(page.result.ok,true,JSON.stringify(page.result));assert.ok(page.result.value.items.length);console.log(JSON.stringify({...page,n,physical,factCount,absent,result:undefined}));}
 }
} finally {await reader.close();if(now)Object.defineProperty(performance,'now',now);else delete performance.now;canonical.close=close;core.close();}
