import { register } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { createWriterJournal } from './writer-journal.mjs';
import { measureWriterLifecycle } from '../../measure-topic-reader-wal.mjs';
import { observeLoop,timestamp } from './engine.mjs';
import { shutdownRetained } from './writer.mjs';
export function inspectWrittenMemory(core,namespace,operation,result,previous) {
  const memoryId=operation==='capture'?result.value.admission.memories[0]?.id:previous?.id;
  const canonical=core.get({namespace,memoryId,includeAwaiting:true});
  if(!canonical.ok)throw Error('writer_inspection_failed');return canonical.value.memory;
}
export async function writerV4(config) {
  const startup=globalThis[Symbol.for('product-cold-startup-loop')];
  const journal=createWriterJournal({...config.observation,clock:timestamp,observeEligibility:true});globalThis[Symbol.for('product-measure-writer-observer')]=journal;
  register(new URL('./sqlite-loader.mjs',import.meta.url),import.meta.url);
  const sqlite=await import('node:sqlite');if(sqlite.DatabaseSync.observerBoundary!=='loader-before-open-v1')throw Error('writer_boundary_unavailable');
  const queue=[],waiters=[];let stopping=false;
  process.on('message',m=>{if(m.type==='ack'){journal.ack(m.through);return;}if(m.type==='stop'){stopping=true;return;}
    const i=waiters.findIndex(w=>w.type===m.type);if(i<0)queue.push(m);else waiters.splice(i,1)[0].resolve(m);});
  const wait=type=>{const i=queue.findIndex(m=>m.type===type);return i<0?new Promise(resolve=>waiters.push({type,resolve})):Promise.resolve(queue.splice(i,1)[0]);};
  const send=m=>new Promise((resolve,reject)=>process.send(m,e=>e?reject(e):resolve()));
  await send({type:'armed',protocol:'product-writer-v1',...config.observation,boundary:'loader-before-open-v1'});await wait('permit');
  const {openMemoryCore}=await import('../../../../core/contract.mjs'),{rationaleModel}=await import('../../../../core/testing/rationale-model.mjs');
  const cardHost=config.session?.targets.some(t=>t.type==='card')?(await import('../../../../core/testing/raw-source-fixtures.mjs')).cardHost():null;
  const phase=(id,name,fn)=>{journal.enter(id,name);try{return fn();}finally{journal.leave();}};
  const startupLoop=await startup?.finish();
  const handles=new Map(),pending=new Map(),targetStored=new Map(),operations=[],calls=[],pacing=[],loops=startupLoop?[startupLoop]:[];let text='',disposed=true,sequence=0;
  const retained=config.lifecycle==='retained',rotation=config.load==='retained-target-rotation';
  const open=()=>openMemoryCore({path:config.path,decisionReview:'required-v1',...(cardHost?{privateCards:cardHost.options}:{}),
    ...(config.writerProfile.captureMs===null?{}:{captureDeadlineMs:config.writerProfile.captureMs}),model:{...rationaleModel(),extract:()=>({items:[{content:text,kind:'decision',confidence:.8,sourceIndices:[0]}]})}});
  if(retained){operations.push('open');const l=observeLoop();
    try{phase('open','open',()=>{for(const target of rotation?['same','other']:['same'])handles.set(target,open());});}
    catch(error){await send(journal.chunk());
      operations.push('shutdown');phase('shutdown','shutdown',()=>{for(const core of handles.values())try{core.close();}catch{disposed=false;}});
      await send(journal.chunk());throw error;
    }finally{loops.push(await l.finish());}
  }
  await send({type:'ready'});const {startAt,endAt}=await wait('start');await delay(Math.max(0,startAt-Date.now()));
  let ordinal=0,lastOrdinaryAt=null;const released=new Set();
  const targetRelease=()=>config.session?.targets.flatMap(t=>[{...t,operation:'capture',releaseMs:t.createMs},{...t,operation:'review',releaseMs:t.reviewMs}])
    .sort((a,b)=>a.releaseMs-b.releaseMs||a.id.localeCompare(b.id)||a.operation.localeCompare(b.operation));
  const releases=targetRelease()??[];
  async function execute({target,operation,type='memory',targetRecipe=null,streamKind='ordinary',ordinaryOrdinal=null,cycleStartedMono=null}) {
    const id=sequence++,namespace=target==='other'?config.otherOwnerNamespace:config.sameNamespace??config.namespace;
    const deadlineMs=config.writerProfile[operation+'Ms'],l=observeLoop();operations.push(id);
    const key=targetRecipe?type+':'+targetRecipe.id:target,previous=targetRecipe?targetStored.get(key):pending.get(key);
    text=`Synthetic product v4 ${config.observation.stream} ${id} ${targetRecipe?.probe??config.syntheticProbe??''}`;
    let stored,result;journal.enableTargets(targetRecipe!==null);
    const measured=await measureWriterLifecycle({core:handles.get(target),lifecycle:config.lifecycle,clock:timestamp,
      open:()=>phase(id,'open',open),async write(core){journal.enter(id,'write');try{
        if(type==='card')result=operation==='capture'?cardHost.call(core,'createCardDraft',{namespace,actionId:`draft-${id}`,drafting:'authored',input:{title:text,body:text,authoredInput:{text,occurredAt:null}}}):
          cardHost.call(core,'confirmCardDraft',{namespace,cardId:previous?.id,expectedRevision:previous?.revision,actionId:`confirm-${id}`,applicability:'current'});
        else result=operation==='capture'?await core.capture({namespace,client:'product-measure',sessionId:config.observation.stream,eventId:String(id),messages:[{id:String(id),role:'user',content:text}]}):
          core.confirm({namespace,memoryId:previous?.id,expectedRevision:previous?.revision,actionId:`review-${id}`,receipt:{client:'product-measure',sessionId:'review',eventId:String(id),role:'user',excerpt:'Confirm synthetic decision.'}});
        return result;
      }finally{journal.leave();}},inspect(core,r){phase(id,'inspect',()=>{
        if(!r.ok)return;
        stored=type==='card'?cardHost.call(core,'getCard',{namespace,cardId:operation==='capture'?r.value.id:previous.id}).value.card:
          inspectWrittenMemory(core,namespace,operation,r,previous);
        if(targetRecipe)targetStored.set(key,stored);else if(operation==='capture')pending.set(key,stored);else pending.delete(key);
      });},close:core=>phase(id,'close',()=>core?.close())});
    if(retained)handles.set(target,measured.core);disposed&&=measured.disposed!==false;loops.push(await l.finish());
    const code=measured.error?.code??(result?.ok===false?result.error.code:null);
    const committedAt=journal.lastCommitAt(),nativeCommit=code===null&&committedAt>=measured.call.writeStartedAt&&committedAt<=measured.call.writeFinishedAt;
    const call={...measured.call,...(config.lifecycle==='fresh'?{openStartedAt:measured.call.startedAt,openFinishedAt:measured.call.writeStartedAt,closeFinishedAt:measured.call.finishedAt}:{}),id,operation,ordinaryOrdinal,cycleStartedMono,writerTarget:target,lifecycle:config.lifecycle,streamKind,deadlineMs,code,nativeCommit};calls.push(call);
    await send({type:'call',call});await send(journal.chunk());
    if(targetRecipe&&nativeCommit&&stored){
      for(const eligible of journal.eligibleTargets(type,stored.id))
        await send({type:'target',target:{...eligible,targetId:targetRecipe.id,namespace,probe:targetRecipe.probe,batch:targetRecipe.batch,eligibilityCoverage:journal.eligibilityComplete()?'complete':'incomplete'}});
    }
    return code;
  }
  try {
    do {
      const pace=performance.now(),cycle=rotation?[['same','capture'],['other','capture'],['same','review'],['other','review']]:[['same','capture'],['same','review']];
      const [target,operation]=cycle[ordinal%cycle.length];
      const cycleOrdinal=ordinal;const code=await execute({target:rotation?target:config.load==='fresh-other'?'other':'same',operation,ordinaryOrdinal:ordinal,cycleStartedMono:pace});ordinal++;lastOrdinaryAt=Date.now();
      if(code||config.oneOperation||config.operationLimit&&sequence>=config.operationLimit)break;
      // Releases supplement the continuous ordinary stream; they never replace it.
      for(const r of releases){const k=r.type+':'+r.id+':'+r.operation;if(!released.has(k)&&Date.now()>=startAt+r.releaseMs){released.add(k);await execute({target:'same',operation:r.operation,type:r.type,targetRecipe:r,streamKind:'target'});break;}}
      await send({type:'progress',operations:sequence,lastOrdinaryAt});
      const workFinishedMono=performance.now(),delayMs=Math.max(0,Math.ceil(20-(workFinishedMono-pace)));
      await delay(delayMs);pacing.push({ordinal:cycleOrdinal,startedMono:pace,workFinishedMono,delayMs,resumedMono:performance.now()});
    }while(!stopping&&Date.now()<endAt&&sequence<config.maxOperations);
  }finally{
    let finalClose=null;const retainedCloses=[];
    if(retained){const combined={close(){let failure;for(const [target,core] of handles){const startedAt=timestamp();try{core?.close();}catch(e){failure??=e;}finally{retainedCloses.push({target,startedAt,finishedAt:timestamp()});}}if(failure)throw failure;}},r=await shutdownRetained(combined,{journal,operations});finalClose=r.finalClose;disposed&&=r.disposed;loops.push(r.hostLoop);}
    await send(journal.chunk());await send(journal.seal(operations,disposed));await wait('seal_ack');await send({type:'seal_acknowledged'});
    await send({type:'result',calls,operations,pacing,finalClose,retainedCloses,writerEndAt:Date.now(),released:[...released],lastOrdinaryAt,
      hostLoop:{maxMs:Math.max(0,...loops.map(l=>l.maxMs)),over100:loops.reduce((n,l)=>n+l.over100,0),blocks:loops.flatMap(l=>l.blocks)}});process.disconnect();
  }
}
