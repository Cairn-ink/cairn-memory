import { performance } from 'node:perf_hooks';
import { captureMaintenanceTurnPort, createMaintenanceTurnController } from './context-maintenance-turn.mjs';
import { contextBudget } from './context-read-budget.mjs';
import { encodeVector } from './context-read-embedder.mjs';
import { rawSearchChunks, rawSearchPostings } from './raw-search-retrieval.mjs';
import { same } from './raw-search-input.mjs';
import { fail } from './validation.mjs';
import { RAW_SEARCH_CADENCE_MS } from './raw-search-cache.mjs';

const retryable = new Set(['provider_error','rate_limited','timeout']);
const refusal = error => ['budget_denied','timeout','rate_limited','dimension_mismatch','invalid_vector'].includes(error?.code) ? error.code : 'provider_error';
const metadata = port => port && ({id:port.id,revision:port.revision,dimensions:port.dimensions,normalization:port.normalization});
const commitTimes = new Map();

/** Explicit quanta only: the host owns scheduling, renewal and supervision. */
export function createRawSearchMaintenance(storage,authority,options) {
  const capture=captureMaintenanceTurnPort(options.maintenanceTurn);
  const turns=capture&&createMaintenanceTurnController(capture,{now:()=>performance.now(),setTimer:setTimeout,clearTimer:clearTimeout});
  const dispatch=options.embedder&&contextBudget({budgetConfigured:true,policy:options.policy,embedder:options.embedder});
  const providers=new Set(),controllers=new Set();
  const trackedPort=options.embedder&&{...options.embedder,embed(texts,controls){
    controls.beforeDispatch();
    const operation=Promise.resolve(options.embedder.embed(texts,controls));providers.add(operation);
    operation.then(()=>providers.delete(operation),()=>providers.delete(operation));return operation;
  }};
  const identity={key:JSON.stringify(authority.identity),physical:authority.identity.fileIdentity};
  const cadenceKey=JSON.stringify([authority.identity.storeId,identity.physical]);
  let active=null,closed=false,stopped=false,noProgress=0,quantum=0,quotaBlocked=false;
  let access = () => {};
  const inventoryFence = at => {try{return authority.fence(undefined,at);}catch(error){if(['source_budget_exceeded','search_deadline'].includes(error.code))return null;throw error;}};
  const protect = source => {
    authority.check(source);
    access(() => authority.check(source));
    authority.check(source);
  };
  const progress={scanned:0,removed:0,indexed:0,embedded:0,checkpointAdvances:0,lastActualWork:null,error:null,phase:'idle'};
  async function broker(work,maxMs) {
    if (!turns) fail('maintenance_authority_required');
    if (closed||stopped) fail('store_closed');
    const now=performance.now(),controller=new AbortController();
    const grant=await turns.wait({version:1,pumpId:'raw-search',windowId:'raw-search-local',lane:0,
      family:'lexical',kind:'lexical',phase:'work',intent:null,maxMs},{signal:controller.signal,untilMonoMs:now+maxMs,identity});
    if (grant.status!=='admitted') return {postponed:true};
    turns.started(grant.ticket);
    try {
      if (closed) fail('store_closed');
      // This lane joins the host's existing broker. The local guard also
      // prevents repeated explicit calls from defeating the commit cadence.
      if (performance.now()-(commitTimes.get(cadenceKey)??-Infinity)<RAW_SEARCH_CADENCE_MS) return {postponed:true};
      return await work(()=>{commitTimes.set(cadenceKey,performance.now());});
    } finally {
      turns.settling(grant.ticket);
      if (turns.release(grant.ticket,'settled')!=='released') {stopped=true;progress.error='maintenance_release_failed';}
    }
  }
  function changed() {progress.lastActualWork=new Date().toISOString();}
  async function refresh(row,maxMs,operationAccess) {
    const protect=source=>{authority.check(source);operationAccess(()=>authority.check(source));authority.check(source);};
    const port=options.embedder;
    if (!port) return;
    const provider=metadata(port), chunks=row.chunks;
    if (same(row.embedder,provider)&&chunks.every(c=>c.vector)) return;
    if (same(row.embedder,provider)&&row.retry?.terminal) return;
    if (same(row.embedder,provider)&&(row.retry?.nextAt??0)>Date.now()) return;
    protect(row.source);
    const text=await authority.open(row.source,'history',()=>protect(row.source));
    const inputs=rawSearchChunks(text,row.source.ref.span.start);
    if (!same(inputs.map(({input,...c})=>c),chunks.map(({vector,...c})=>c))) fail('source_unavailable');
    const selected=inputs.filter((c,i)=>!same(row.embedder,provider)||!chunks[i].vector)
      .slice(0,options.policy.family==='local'?1:64);
    if (!selected.length) return;
    // Conservative input bounds include framing. No remote fallback exists.
    if (selected.some(c=>Buffer.byteLength(c.input)+64>8192)||
      Buffer.byteLength(JSON.stringify(selected.map(c=>c.input)))>2*1024*1024||
      selected.reduce((n,c)=>n+Buffer.byteLength(c.input)+64,0)>300000) fail('index_segment_too_large');
    const attempts=same(row.embedder,provider)?row.retry?.attempts??0:0;
    if (attempts>=3) return;
    let reserved=null;
    // Provider I/O owns no broker ticket or SQLite lock. Keep its timeout
    // independent of the bounded local-work quantum.
    const controller=new AbortController(),deadlineAt=performance.now()+30000;
    controllers.add(controller);
    let vectors,error,invoked=false;
    try {
      // The budget wrapper invokes this only after its reservation succeeds.
      // Persist the possible attempt in an admitted turn, release that turn,
      // then enter the actual provider. Budget refusal writes no fake attempt.
      const chargedPort={...trackedPort,async embed(texts,controls){
        controls.beforeDispatch();
        await broker(async commit=>{
          protect(row.source);
          const next={...row,embedder:provider,retry:{attempts:attempts+1,nextAt:Date.now()+(attempts?5000:1000),terminal:attempts+1>=3}};
          delete next.segment;
          const stage=await storage.stage(next);protect(row.source);
          const state=storage.head(),checkpoint=structuredClone(state.checkpoint);
          if((checkpoint.recent?.streak??0)>=3)fail('budget_denied');
          if(checkpoint.recent)checkpoint.recent.streak=Math.min(3,Math.max(checkpoint.recent.streak+1,recentAttempts??0));
          const result=await storage.commitBatch({staged:[{...stage,expected:row.segment}],checkpoint});
          recentAttempts=checkpoint.recent?.streak??0;
          reserved={...next,segment:result.sequence-1};commit();
        },maxMs);
        if(!reserved)fail('budget_denied');
        controls.beforeDispatch();invoked=true;
        return trackedPort.embed(texts,controls);
      }};
      vectors=await dispatch(chargedPort,selected.map(c=>c.input),{signal:controller.signal,deadlineAt,
        guard:()=>{if(closed)fail('store_closed');protect(row.source);}});
      authority.check(row.source);
      if (!Array.isArray(vectors)||vectors.length!==selected.length) fail('invalid_vector');
      vectors=vectors.map(v=>encodeVector(v,port));
    } catch (failure) { error=refusal(failure); }
    finally{controllers.delete(controller);}
    if(!reserved)return;
    // Provider waits never retain a broker ticket or either SQLite lock.
    // Result settlement may be deferred by cadence; retain no plaintext work.
    const next={...reserved}; delete next.segment;
    if (!error) {
      const byInput=new Map(selected.map((c,i)=>[c.inputIdentity,vectors[i]]));
      next.chunks=chunks.map(c=>({...c,...(byInput.has(c.inputIdentity)?{vector:byInput.get(c.inputIdentity)}:{})}));
      next.retry={attempts:0,nextAt:0,terminal:false};
    } else next.retry={attempts:invoked?attempts+1:attempts,nextAt:Date.now()+(attempts?5000:1000),
      terminal:invoked&&(!retryable.has(error)||attempts+1>=3),error};
    // The host can admit the next write immediately after a provider wait, but
    // the shared cadence remains authoritative. Pending vectors are ephemeral.
    return {next,expected:reserved.segment,embedded:error?0:selected.length};
  }
  let pending=null,refreshAfter=0,refreshing=null,recentAttempts=null;
  async function run({maxItems=16,maxMs=1000,embeddings=false}={}, currentAccess) {
    if (closed||stopped) fail('store_closed');
    if (!Number.isSafeInteger(maxItems)||maxItems<1||maxItems>128||!Number.isSafeInteger(maxMs)||maxMs<1||maxMs>5000) fail('invalid_input');
    access = currentAccess;
    access();
    const before=progress.removed+progress.indexed+progress.embedded+progress.checkpointAdvances;
    progress.phase='reconciling';quantum++;
    let admitted=false,eligibleWork=!!pending,refreshRow;
    try {

      await broker(async commit=>{
        admitted=true;
        const started=performance.now(),state=storage.head();
        let checkpoint=structuredClone(state.checkpoint);
        checkpoint.fenceRetry=Math.max(0,(checkpoint.fenceRetry??0)-1);
        const staged=[],remove=[];let settledPending=false;
        recentAttempts??=checkpoint.recent?.streak??0;
        const recentAdmitted=recentAttempts<3&&!quotaBlocked;
        // Urgent lexical work never waits for a census or a provider. Cursor
        // and positives are a single signed sidecar transaction.
        if(recentAdmitted){
          recentAttempts++;
          // Small local quanta admit one part and finish its mandatory guards;
          // expiry after opening must not discard that part on every turn.
          const recent=authority.recent(checkpoint.recent,{limit:Math.min(maxItems,maxMs<=25?1:4),at:started+maxMs});
          if(!same(recent.cursor,checkpoint.recent)||recent.rows.length){
            const known=await storage.lookup(recent.rows.map(entry=>JSON.stringify(entry.key)));
            const byKey=new Map(known.map(row=>[row.key,row]));
            for(const entry of recent.rows){
              const key=JSON.stringify(entry.key),previous=byKey.get(key),fingerprint=authority.fingerprint(entry.source);
              progress.scanned++;
              if(previous?.fingerprint===fingerprint)continue;
              const text=await authority.open(entry.source,'history',()=>protect(entry.source));
              const chunks=rawSearchChunks(text,entry.source.ref.span.start);
              staged.push({...await storage.stage({key,source:entry.source,fingerprint,postings:rawSearchPostings(text),
                chunks:chunks.map(({input,...chunk})=>chunk),embedder:null,retry:{attempts:0,nextAt:0,terminal:false}}),expected:previous?.segment??null});
            }
            checkpoint.recent=recent.cursor;checkpoint.recent.streak=recentAttempts;
            if(recent.recovered){checkpoint.coverageComplete=false;checkpoint.denialsReconciled=false;checkpoint.cycleFence=null;}
            for(const row of staged)protect(row.source);
            authority.validate([{sources:staged.map(row=>row.source),intent:'history',access,value:null}],Infinity,{journal:recent});
            try{
              const result=await storage.commitBatch({staged,checkpoint});commit();
              progress.indexed+=staged.length;progress.removed+=result.removed;
              progress.checkpointAdvances++;changed();
            }catch(error){
              if((error.errcode&255)!==13)throw error;
              quotaBlocked=true;progress.error='quota_exhausted';
            }
            return;
          }
        }
        if(embeddings&&options.embedder&&!pending&&!refreshing&&recentAdmitted){
          const snapshot=await storage.snapshot({after:refreshAfter,limit:maxItems});
          refreshRow=snapshot.rows.find(row=>(!same(row.embedder,metadata(options.embedder))||row.chunks.some(c=>!c.vector))&&
            (!same(row.embedder,metadata(options.embedder))||!row.retry?.terminal&&(row.retry?.nextAt??0)<=Date.now()));
          if(refreshRow){refreshAfter=refreshRow.segment;return;}
          refreshAfter=snapshot.partial?snapshot.rows.at(-1).segment:0;
        }
        // Every fourth busy turn belongs to reconciliation. This ring is
        // independent of the fence-bound proof sweep and of incoming saves.
        recentAttempts=0;if(checkpoint.recent)checkpoint.recent.streak=0;
        const ring=checkpoint.cleanup??{afterSegment:0,throughSegment:storage.tail()};
        const cleanup=await storage.snapshot({after:ring.afterSegment,limit:Math.min(maxItems,16)});
        let checked=0;
        for(const row of cleanup.rows){
          if(row.segment>ring.throughSegment)break;
          if(performance.now()-started>=maxMs)break;
          if(authority.disposition(row.source)==='remove')remove.push(row.segment);
          ring.afterSegment=row.segment;progress.scanned++;checked++;
        }
        if(checked===cleanup.rows.length&&!cleanup.partial||ring.afterSegment>=ring.throughSegment||cleanup.rows[checked]?.segment>ring.throughSegment){
          ring.afterSegment=0;ring.throughSegment=storage.tail();
        }
        checkpoint.cleanup=ring;
        const cleanupCheckpoint=structuredClone(checkpoint);
        const fence=checkpoint.fenceRetry?null:inventoryFence(started+maxMs);
        if(!fence&&!checkpoint.fenceRetry)checkpoint.fenceRetry=64;
        cleanupCheckpoint.fenceRetry=checkpoint.fenceRetry;
        if(checkpoint.cycleFence!==fence){checkpoint={...checkpoint,sweep:0,after:['','',-1],cycleFence:fence,denialsReconciled:false,coverageComplete:false};}
        const complete=checkpoint.coverageComplete&&checkpoint.fence===fence&&!pending;
        // One denial sweep precedes a stable inventory cycle. Repeating the
        // entire sweep before every positive page makes rebuild work quadratic.
        // Without a complete canonical fence, keep sweeping conservatively.
        const sweep=complete||checkpoint.denialsReconciled&&fence?{rows:[],partial:false}:
          await storage.snapshot({after:checkpoint.sweep,limit:maxItems});
        for (const row of sweep.rows) {
          if(authority.disposition(row.source)==='remove'){remove.push(row.segment);eligibleWork=true;}
          progress.scanned++;
        }
        checkpoint.sweep=sweep.partial?sweep.rows.at(-1).segment:0;
        if (!sweep.partial&&!complete&&performance.now()-started<maxMs) {
          checkpoint.denialsReconciled=Boolean(fence);
          if (pending) {
            try {
              authority.check(pending.next.source);
              staged.push({...await storage.stage(pending.next),expected:pending.expected});settledPending=true;
            } catch(error) {
              if (!['source_unavailable','source_excluded'].includes(error.code)) throw error;
              pending=null;
            }
          } else {
            const inventory=authority.inventory(checkpoint.after,Math.min(maxItems,4));
            const known=await storage.lookup(inventory.rows.map(entry=>JSON.stringify(entry.key)));
            const byKey=new Map(known.map(row=>[row.key,row]));
            let processed=0;
            for (const entry of inventory.rows) {
              if (performance.now()-started>=maxMs) break;
              const key=JSON.stringify(entry.key),previous=byKey.get(key);
              progress.scanned++;
              if (entry.source&&!quotaBlocked) {
                const fingerprint=authority.fingerprint(entry.source);
                if (previous?.fingerprint!==fingerprint) {
                  eligibleWork=true;
                  try {
                    const text=await authority.open(entry.source,'history',()=>protect(entry.source)),parts=rawSearchChunks(text,entry.source.ref.span.start);
                    const segment={key,source:entry.source,fingerprint,postings:rawSearchPostings(text),
                      chunks:parts.map(({input,...chunk})=>chunk),embedder:null,retry:{attempts:0,nextAt:0,terminal:false}};
                    staged.push({...await storage.stage(segment),expected:previous?.segment??null});
                  } catch(error) {
                    if(!['source_unavailable','source_excluded'].includes(error.code))throw error;
                    if(previous&&authority.disposition(previous.source)==='remove')remove.push(previous.segment);
                  }
                }
              } else if(!entry.source&&previous&&authority.disposition(previous.source)==='remove') remove.push(previous.segment);
              checkpoint.after=entry.key;processed++;
            }
            if (inventory.complete&&processed===inventory.rows.length) {
              checkpoint.after=['','',-1];
              if(checkpoint.cycles===0||staged.length||remove.length||!same(checkpoint.after,state.checkpoint.after))checkpoint.cycles++;
              checkpoint.coverageComplete=Boolean(fence)&&!quotaBlocked;checkpoint.fence=fence;
            }
          }
        }
        // All async preparation is over before this last canonical comparison;
        // sidecar commit occurs with no canonical lock. Delivery closes its gap.
        for(const row of staged)protect(row.source);
        if(fence&&inventoryFence(started+maxMs)!==fence){
          // Canonical capture or denial won the race. Discard this quantum's
          // positive work and retry on the host's next turn; source movement
          // is neither an index failure nor evidence of a stalled maintainer.
          pending=null;settledPending=false;eligibleWork=false;staged.length=0;checkpoint=cleanupCheckpoint;
        }
        // Also close callback races when a full inventory fence is unavailable
        // at the work ceiling. No callback follows this exact batch snapshot.
        if(staged.length)authority.validate([{sources:staged.map(row=>row.source),intent:'history',access,value:null}]);
        if(staged.length||remove.length||!same(checkpoint,state.checkpoint)) {
          try {
            const result=await storage.commitBatch({staged,remove:[...new Set(remove)],checkpoint});commit();
            progress.removed+=result.removed;
            if(result.removed){quotaBlocked=false;progress.error=null;}
            if(settledPending){progress.embedded+=pending.embedded;pending=null;}
            else progress.indexed+=staged.length;
            progress.checkpointAdvances++;changed();
          }catch(error){
            if((error.errcode&255)!==13)throw error;
            // Positive allocation failure never blocks denial-only cleanup.
            quotaBlocked=true;pending=null;eligibleWork=false;
            if(remove.length){const result=await storage.commitBatch({remove:[...new Set(remove)],checkpoint:cleanupCheckpoint});
              commit();progress.removed+=result.removed;if(result.removed){quotaBlocked=false;changed();}}
            progress.error=quotaBlocked?'quota_exhausted':null;
          }
        }
      },maxMs);

      // Detached, observed provider work owns its original access closure.
      // Its reservation still shares the same broker/cadence as lexical work.
      if(refreshRow){
        const operationAccess=access;
        refreshing=refresh(refreshRow,maxMs,operationAccess).then(result=>{if(!closed)pending=result??null;})
          .catch(error=>{if(!closed)progress.error=error.code??'index_unavailable';}).finally(()=>{refreshing=null;});
        await new Promise(resolve=>setImmediate(resolve));
      }
      const after=progress.removed+progress.indexed+progress.embedded+progress.checkpointAdvances;
      if(admitted&&eligibleWork&&before===after){if(++noProgress>=3){stopped=true;progress.error='no_progress';}}else if(after>before)noProgress=0;
      progress.phase=stopped?'failed':quotaBlocked?'partial':'idle';
      return {...progress,quantum,noProgress,pending:!!pending,...storage.head()};
    } catch(error) {
      if(['source_unavailable','source_excluded','raw_crypto_unavailable','source_busy','source_changed','source_budget_exceeded','search_deadline','stale_publication'].includes(error.code)){
        // A writer can also move during the bounded inventory snapshots.
        pending=null;progress.phase='idle';return {...progress,quantum,noProgress,pending:false};
      }
      progress.error=error.code??'index_unavailable';progress.phase='failed';stopped=true;throw error;
    }
  }
  return { maintain(input,currentAccess) {
    if(active)fail('read_in_progress');
    active=run(input,currentAccess).finally(()=>{active=null;});return active;
  },status:()=>({...progress,quantum,noProgress,pending:!!pending||!!refreshing}),
  async close(){closed=true;for(const controller of controllers)controller.abort();await active?.catch(()=>{});
    // Providers may ignore abort. Their existing observers retain rejection
    // handling and budget settlement; closed guards forbid late publication.
    let timer;
    try { await Promise.race([Promise.allSettled([...providers]),
      new Promise(resolve=>{timer=setTimeout(resolve,2000);})]); }
    finally {clearTimeout(timer);pending=null;} } };
}
