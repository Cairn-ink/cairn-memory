import { register } from 'node:module';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { createWriterJournal } from './writer-journal.mjs';
import { measureWriterLifecycle } from '../../measure-topic-reader-wal.mjs';
import { observeLoop, timestamp } from './engine.mjs';
export async function writerProcess(config) {
  const journal=createWriterJournal(config.observation);
  globalThis[Symbol.for('product-measure-writer-observer')]=journal;
  register(new URL('./sqlite-loader.mjs',import.meta.url),import.meta.url);
  // The ordinary import has not run yet. The redirected native constructor is
  // verified before the parent permits any ordinary writable opener.
  const sqlite=await import('node:sqlite');
  if(sqlite.DatabaseSync.observerBoundary!=='loader-before-open-v1')throw Error('writer_boundary_unavailable');
  const queue=[],waiters=[];
  let stop=false,sealed=false;
  process.on('message',m=>{
    if(m.type==='ack') {journal.ack(m.through);return;}
    if(m.type==='stop'){stop=true;return;}
    const i=waiters.findIndex(w=>w.type===m.type);if(i<0)queue.push(m);else waiters.splice(i,1)[0].resolve(m);
  });
  const wait=type=>{const i=queue.findIndex(m=>m.type===type);return i>=0?Promise.resolve(queue.splice(i,1)[0]):new Promise(resolve=>waiters.push({type,resolve}));};
  const send=m=>new Promise((resolve,reject)=>process.send(m,e=>e?reject(e):resolve()));
  await send({type:'armed',protocol:'product-writer-v1',...config.observation,boundary:sqlite.DatabaseSync.observerBoundary});
  await wait('permit');
  const {openMemoryCore}=await import('../../../../core/contract.mjs');
  const {rationaleModel}=await import('../../../../core/testing/rationale-model.mjs');
  const cardHost=config.targetType==='card'?(await import('../../../../core/testing/raw-source-fixtures.mjs')).cardHost():null;
  let core,pending=null,sequence=0,lastProgress=Date.now();
  const eligibleCommits=new Map(),calls=[],operations=[],loops=[];let finalClose=null,disposalComplete=true;
  const probe=()=>config.probes?.[Math.floor((sequence-1)/2)]??null;
  const open=()=>openMemoryCore({path:config.path,decisionReview:'required-v1',...(cardHost?{privateCards:cardHost.options}:{}),
    ...(config.writerProfile.captureMs===null?{}:{captureDeadlineMs:config.writerProfile.captureMs}),
    model:{...rationaleModel(),extract:()=>({items:[{content:`Synthetic product writer ${config.observation.stream} ${sequence} ${probe()??""}`,kind:'decision',confidence:.8,sourceIndices:[0]}]})}});
  const phase=(id,kind,call)=>{journal.enter(id,kind);try{return call();}finally{journal.leave();}};
  // Parent pre-registers the complete operation range. Unstarted IDs are not
  // expected; the final range must be the exact contiguous prefix actually used.
  if(config.lifecycle==='retained') {const loop=observeLoop();try{operations.push('open');core=phase('open','open',open);}finally{loops.push(await loop.finish());}}
  await send({type:'ready'});const {startAt,endAt}=await wait('start');await delay(Math.max(0,startAt-Date.now()));
  try {
    do {
      const id=sequence++,operation=pending?'review':'capture',deadlineMs=config.writerProfile[operation+'Ms'];
      operations.push(id);let code=null,result,targetStored;
      const callLoop=observeLoop(),paceStart=performance.now();
      const measured=await measureWriterLifecycle({core,lifecycle:config.lifecycle,clock:timestamp,
        open:()=>phase(id,'open',open),
        async write(handle){core=handle;journal.enter(id,'write');try {
          if(cardHost) {
            result=pending?cardHost.call(core,'confirmCardDraft',{namespace:config.namespace,cardId:pending.id,expectedRevision:pending.revision,actionId:`confirm-${config.observation.stream}-${sequence}`,applicability:'current'}):
              cardHost.call(core,'createCardDraft',{namespace:config.namespace,actionId:`draft-${config.observation.stream}-${sequence}`,drafting:'authored',input:{title:'Synthetic product Card',body:`Synthetic ${probe()??sequence}`,authoredInput:{text:'Synthetic retained source',occurredAt:null}}});
          } else result=pending?core.confirm({namespace:config.namespace,memoryId:pending.id,expectedRevision:pending.revision,
            actionId:`review-${config.observation.stream}-${sequence}`,receipt:{client:'product-measure',sessionId:'review',eventId:String(sequence),role:'user',excerpt:'Confirm synthetic decision.'}}):
            await core.capture({namespace:config.namespace,client:'product-measure',sessionId:config.observation.stream,eventId:String(sequence),
              messages:[{id:String(sequence),role:'user',content:`Synthetic product capture ${sequence}.`}]});

          return result;
        }finally{journal.leave();}},
        inspect(handle,value){core=handle;result=value;
          phase(id,'inspect',()=>{
          if(result.ok && operation==='capture') pending=cardHost?cardHost.call(core,'getCard',{namespace:config.namespace,cardId:result.value.id}).value.card:core.list({namespace:config.namespace,reviewState:'awaiting'}).value.memories.at(-1);
          else if(result.ok) { targetStored=cardHost?cardHost.call(core,'getCard',{namespace:config.namespace,cardId:pending.id}).value.card:core.list({namespace:config.namespace}).value.memories.find(m=>m.id===pending.id);
            pending=null; }
        });
        },close:handle=>phase(id,'close',()=>handle?.close())});
      core=measured.core;result=measured.value;if(measured.disposed===false)disposalComplete=false;
      loops.push(await callLoop.finish());
      code=measured.error?(measured.error.code??'writer_failed'):result?.ok===false?result.error.code:null;
      const target=freshnessTarget({eligible:code===null,type:cardHost?'card':'memory',intent:config.cell?.intent,operation,stored:targetStored??pending,committedAt:journal.lastCommitAt(),probe:probe()},eligibleCommits);
      if(target)await send({type:'target',target});
      calls.push({...measured.call,id,operation,deadlineMs,code});
      await send({type:'call',call:calls.at(-1)});await send(journal.chunk());
      if(Date.now()-lastProgress>1000){await send({type:'progress',operations:sequence});lastProgress=Date.now();}
      if(config.oneOperation||code||config.operationLimit&&sequence>=config.operationLimit)break;
      await delay(Math.max(0,20-(performance.now()-paceStart)));
    }while(!stop&&Date.now()<endAt&&sequence<config.maxOperations);
  }finally {
    if(core){const shutdown=await shutdownRetained(core,{journal,operations});core=null;finalClose=shutdown.finalClose;disposalComplete&&=shutdown.disposed;loops.push(shutdown.hostLoop);}
    const hostLoop={maxMs:Math.max(0,...loops.map(l=>l.maxMs)),over100:loops.reduce((n,l)=>n+l.over100,0),blocks:loops.flatMap(l=>l.blocks)};await send(journal.chunk());
    const seal=journal.seal(operations,disposalComplete);await send(seal);await wait('seal_ack');sealed=true;
    await send({type:'seal_acknowledged'});await send({type:'result',calls,hostLoop,finalClose,operations});
    if(sealed)process.disconnect();
  }
}

// History Memories are eligible at capture; current Memories and Cards enter at
// confirmation. Later revisions update the expected ref, never the time origin.
export function freshnessTarget({eligible=true,type,intent,operation,stored,committedAt,probe},eligibleCommits=new Map()) {
  if(!eligible||!stored||!probe||operation==='capture'&&!(type==='memory'&&intent==='history'))return null;
  if(!eligibleCommits.has(stored.id))eligibleCommits.set(stored.id,committedAt);
  return {type,id:stored.id,revision:stored.revision,...(type==='card'?{bodyRevision:stored.bodyRevision}:{}),
    committedAt:eligibleCommits.get(stored.id),probe};
}

export async function shutdownRetained(core,{journal,operations,clock=timestamp,loopFactory=observeLoop}) {
  const loop=loopFactory(),startedAt=clock();let disposed=false;
  try {operations.push('shutdown');journal.enter('shutdown','shutdown');try{core.close();disposed=true;}finally{journal.leave();}}
  catch { /* Export the native ledger even when final disposal fails. */ }
  finally {var finalClose={startedAt,finishedAt:clock()},hostLoop=await loop.finish();}
  return {finalClose,hostLoop,disposed};
}
