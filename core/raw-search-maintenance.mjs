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
  const inventoryFence = () => {try{return authority.fence();}catch(error){if(error.code==='source_budget_exceeded')return null;throw error;}};
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
  async function refresh(row,maxMs) {
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
    const controller=new AbortController(),deadlineAt=performance.now()+maxMs;
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
          reserved={...next,segment:await storage.publish(stage,row.segment)};commit();
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
  let pending=null,refreshAfter=0;
  async function run({maxItems=16,maxMs=1000,embeddings=false}={}, currentAccess) {
    if (closed||stopped) fail('store_closed');
    if (!Number.isSafeInteger(maxItems)||maxItems<1||maxItems>128||!Number.isSafeInteger(maxMs)||maxMs<1||maxMs>5000) fail('invalid_input');
    access = currentAccess;
    access();
    const before=progress.removed+progress.indexed+progress.embedded+progress.checkpointAdvances;
    progress.phase='reconciling';quantum++;
    let admitted=false,eligibleWork=!!pending;
    try {
      let refreshed=false;
      if (embeddings&&options.embedder&&!pending) {
        const snapshot=await storage.snapshot({after:refreshAfter,limit:maxItems});
        const reconciled=snapshot.checkpoint.coverageComplete&&snapshot.checkpoint.fence===inventoryFence();
        const rows=reconciled?snapshot.rows:[];
        const row=rows.find(row=>(!same(row.embedder,metadata(options.embedder))||row.chunks.some(c=>!c.vector))&&
          (!same(row.embedder,metadata(options.embedder))||!row.retry?.terminal&&(row.retry?.nextAt??0)<=Date.now()));
        if(row) {refreshAfter=row.segment;pending=await refresh(row,maxMs);refreshed=!!pending;}
        else refreshAfter=snapshot.partial?snapshot.rows.at(-1).segment:0;
      }
      if(!refreshed) await broker(async commit=>{
        admitted=true;
        const started=performance.now(),state=await storage.status();
        let checkpoint={...state.checkpoint};
        const fence=inventoryFence();
        if(checkpoint.cycleFence!==fence){checkpoint={...checkpoint,sweep:0,after:['','',-1],cycleFence:fence,denialsReconciled:false,coverageComplete:false};}
        if(checkpoint.coverageComplete&&checkpoint.fence===fence&&!pending)return;
        // One denial sweep precedes a stable inventory cycle. Repeating the
        // entire sweep before every positive page makes rebuild work quadratic.
        // Without a complete canonical fence, keep sweeping conservatively.
        const sweep=checkpoint.denialsReconciled&&fence?{rows:[],partial:false}:
          await storage.snapshot({after:checkpoint.sweep,limit:maxItems});
        const remove=[],staged=[];
        for (const row of sweep.rows) {
          try {authority.check(row.source);} catch(error) {
            if (!['source_unavailable','source_excluded','raw_crypto_unavailable'].includes(error.code)) throw error;
            remove.push(row.segment);eligibleWork=true;
          }
          progress.scanned++;
        }
        checkpoint.sweep=sweep.partial?sweep.rows.at(-1).segment:0;
        if (!sweep.partial) {
          checkpoint.denialsReconciled=Boolean(fence);
          if (pending) {
            try {
              authority.check(pending.next.source);
              staged.push({...await storage.stage(pending.next),expected:pending.expected});
            } catch(error) {
              if (!['source_unavailable','source_excluded'].includes(error.code)) throw error;
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
                    if(previous)remove.push(previous.segment);
                  }
                }
              } else if(!entry.source&&previous) remove.push(previous.segment);
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
        if(fence&&inventoryFence()!==fence){
          // Canonical capture or denial won the race. Discard this quantum's
          // positive work and retry on the host's next turn; source movement
          // is neither an index failure nor evidence of a stalled maintainer.
          pending=null;eligibleWork=false;return;
        }
        // Also close callback races when a full inventory fence is unavailable
        // at the work ceiling. No callback follows this exact batch snapshot.
        if(staged.length)authority.validate([{sources:staged.map(row=>row.source),intent:'history',access,value:null}]);
        if(staged.length||remove.length||!same(checkpoint,state.checkpoint)) {
          try {
            const result=await storage.commitBatch({staged,remove:[...new Set(remove)],checkpoint});commit();
            progress.removed+=result.removed;
            if(result.removed){quotaBlocked=false;progress.error=null;}
            if(pending){progress.embedded+=pending.embedded;pending=null;}
            else progress.indexed+=staged.length;
            progress.checkpointAdvances++;changed();
          }catch(error){
            if((error.errcode&255)!==13)throw error;
            // Positive allocation failure never blocks denial-only cleanup.
            quotaBlocked=true;pending=null;eligibleWork=false;
            if(remove.length){const result=await storage.commitBatch({remove:[...new Set(remove)],checkpoint:state.checkpoint});
              commit();progress.removed+=result.removed;if(result.removed){quotaBlocked=false;changed();}}
            progress.error=quotaBlocked?'quota_exhausted':null;
          }
        }
      },maxMs);
      const after=progress.removed+progress.indexed+progress.embedded+progress.checkpointAdvances;
      if(admitted&&eligibleWork&&before===after){if(++noProgress>=3){stopped=true;progress.error='no_progress';}}else if(after>before)noProgress=0;
      progress.phase=stopped?'failed':quotaBlocked?'partial':'idle';
      return {...progress,quantum,noProgress,pending:!!pending,...await storage.status()};
    } catch(error) {
      if(error.code==='source_unavailable'){
        // A writer can also move during the bounded inventory snapshots.
        pending=null;progress.phase='idle';return {...progress,quantum,noProgress,pending:false};
      }
      progress.error=error.code??'index_unavailable';progress.phase='failed';stopped=true;throw error;
    }
  }
  return { maintain(input,currentAccess) {
    if(active)fail('read_in_progress');
    active=run(input,currentAccess).finally(()=>{active=null;});return active;
  },status:()=>({...progress,quantum,noProgress,pending:!!pending}),
  async close(){closed=true;for(const controller of controllers)controller.abort();await active?.catch(()=>{});
    await Promise.allSettled([...providers]);pending=null;} };
}
