import { ownData } from './local-authority-input.mjs';
import { boundedData, coverage, credentialDigest, PRODUCT_PROFILE, hostConfiguration } from './context-product-control.mjs';
import { contextReadSet } from './context-read-input.mjs';
import { serviceIssuance } from './context-product-service.mjs';
import { semanticConfiguration } from './context-semantic-coordinator.mjs';
import { supervisorOwner } from './context-read-supervisor.mjs';
import { integer, usd, dollars, exact } from './context-semantic-input.mjs';
import { fail } from './validation.mjs';

const key=Symbol.for('context-read-product-p2e-v1/pumps');
export function semanticPump(original,{now,setTimer,clearTimer,open}) {
  const c=ownData(original,['supervisor','id','window','budgets','quantum','pollMs','renewalMs','projections','serviceCredential','semanticConfig','semanticServiceCredential','firstCoverageValidation']);
  const selected=semanticConfiguration(c.semanticConfig,{maintenance:true}),coordinator=c.semanticConfig.coordinator,handle=selected.handle;
  handle.validatePumpCredential(c.semanticServiceCredential);
  const credential=boundedData(c.serviceCredential,16384),semanticCredential=boundedData(c.semanticServiceCredential,16384);
  const first=exact(boundedData(c.firstCoverageValidation),'maxTargets,maxMs');integer(first.maxTargets,1,64);integer(first.maxMs,1,5000);
  if(typeof c.id!=='string'||!c.id.length||c.id.length>200)fail('invalid_input');
  const w=exact(boundedData(c.window),'id,endsAtMonoMs,usedItems,usedMs,usedUsd'),b=exact(boundedData(c.budgets),'maxItems,maxMs,maxUsd'),q=exact(boundedData(c.quantum),'maxItems,maxMs,maxUsd');
  if(typeof w.id!=='string'||!w.id.length||w.id.length>200||w.endsAtMonoMs<=now()||w.endsAtMonoMs>now()+60000)fail('invalid_input');
  integer(w.endsAtMonoMs);integer(w.usedItems);integer(w.usedMs);usd(w.usedUsd);integer(b.maxItems,1);integer(b.maxMs,1,60000);usd(b.maxUsd);
  integer(q.maxItems,1,1024);integer(q.maxMs,1,5000);if(usd(q.maxUsd)>usd('0.50'))fail('invalid_input');integer(c.pollMs,1,5000);integer(c.renewalMs,1,60000);
  if(!Array.isArray(c.projections)||c.projections.length<1||c.projections.length>32)fail('invalid_input');
  const projections=c.projections.flatMap(value=>{
    const p=ownData(value,['options','types','modes']),modes=p.modes??['lexical'];
    if(!['["lexical"]','["lexical","embeddings"]'].includes(JSON.stringify(boundedData(modes))))fail('invalid_input');
    const raw=ownData(p.options,['supervisor','path','version','profile','readSet','ownerCoverage','requestControl','host','diagnostics','deadlineMs','sidecarJournalMode','wal','semanticConfig']);
    const {supervisor,semanticConfig,...data}=raw,options={...hostConfiguration(data),supervisor,semanticConfig:c.semanticConfig};
    if(supervisor!==c.supervisor||options.version!=='context-read-v1'||options.profile!==PRODUCT_PROFILE)fail('invalid_input');
    options.readSet=contextReadSet(options.readSet,PRODUCT_PROFILE);options.ownerCoverage=coverage(options.ownerCoverage,options.readSet);
    const binding=serviceIssuance(options.host.configuration.serviceBinding,options.readSet,options.ownerCoverage);
    if(binding.ownerId!==handle.ownerId||credentialDigest(credential)!==binding.credentialDigest)fail('authority_required');
    const types=boundedData(p.types);if(!Array.isArray(types)||!types.length||types.length>2||new Set(types).size!==types.length||types.some(t=>!['memory','card'].includes(t)))fail('invalid_input');
    return ['current','history'].flatMap(intent=>modes.map(mode=>({options,types,intent,mode,bindingId:binding.credentialBindingId})));
  });
  const hasEmbeddings=projections.some(p=>p.mode==='embeddings');
  if((projections.length+1+2*handle.targets.length)*Math.max(c.pollMs,q.maxMs,first.maxMs)>5000)fail('invalid_input');
  // Initial targets need their independently issued public projection grants.
  if(handle.targets.some(t=>!projections.some(p=>p.options.path===t.canonicalPath&&JSON.stringify(p.options.readSet)===JSON.stringify(t.readSet)&&JSON.stringify(p.types)===JSON.stringify(t.types))))fail('invalid_input');
  const all=globalThis[key]??=new Map(),fingerprint=JSON.stringify(projections.map(p=>[p.options.path,p.options.readSet,p.options.ownerCoverage,p.types,p.intent,p.mode,p.bindingId,p.options.host.moduleUrl,p.options.wal,p.options.sidecarJournalMode]));
  const old=all.get(c.id);
  if(old){if(old.fingerprint!==fingerprint||old.supervisor!==c.supervisor||old.coordinator!==coordinator||old.semanticCredentialDigest!==credentialDigest(semanticCredential)||JSON.stringify(old.first)!==JSON.stringify(first))fail('read_in_progress');old.renew(c,w,b);return old.api;}
  const {owner,registry}=supervisorOwner(c.supervisor),record=registry.register(owner,{path:projections[0].options.path,domain:'context-read-product-p2e-v1/pump/'+c.id});
  let window=w,budgets=b,usedItems=w.usedItems,usedMs=w.usedMs,usedUsd=w.usedUsd,at=0,timer,running,closing,stopped=false,error=null,renewedUntil=now()+c.renewalMs,lastTick=now(),validationPending=false;
  let resolveCompletion,completion,settled=false;
  function cycle(){settled=false;completion=new Promise(resolve=>{resolveCompletion=value=>{settled=true;resolve(value);};});}cycle();
  const handles=new Map(),completeTargets=new Set();let targetSetDigest=null,firstComplete=false,startup=true;
  const status=()=>Object.freeze({id:c.id,state:error?'failed':stopped?'stopped':exhausted()?'budget_exhausted':now()>=renewedUntil?'renewal_expired':'active',windowId:window.id,
    usedItems,usedMs,usedUsd,maxItems:budgets.maxItems,maxMs:budgets.maxMs,maxUsd:budgets.maxUsd,error});
  const exhausted=()=>now()>=window.endsAtMonoMs||usedMs>=budgets.maxMs||usedItems>=budgets.maxItems&&!validationPending&&!startup;
  function schedule(){if(!stopped&&!error&&!exhausted()&&now()<renewedUntil)timer=setTimer(tick,Math.max(0,c.pollMs-(now()-lastTick)));else resolveCompletion(status());}
  async function reserve(mode,maxItems,maxMs,maxUsd,bindingId) {
    const result=await handle.pumpCall('pumpReserve',{mode,maxItems,maxMs,bindingId,window:{...window,usedItems,usedMs,usedUsd},budgets,maxUsd,remainingMs:Math.floor(window.endsAtMonoMs-now())});
    usedItems=result.usedItems;usedMs=result.usedMs;usedUsd=result.usedUsd;return result;
  }
  async function finish(reservation,known) {
    const result=await handle.pumpCall('pumpFinish',{id:reservation.id,known});usedItems=result.usedItems;usedMs=result.usedMs;usedUsd=result.usedUsd;
  }
  async function maintainer(p,maxMs) {
    const id=JSON.stringify([p.options.path,p.options.readSet]);let h=handles.get(id);
    if(!h){h=await open({...p.options,deadlineMs:maxMs});handles.set(id,h);}return h;
  }
  async function validation() {
    // This public method is available independently of paid item/USD capacity.
    const observation=await handle.pumpCall('firstCoverage');targetSetDigest=observation.targetSetDigest;firstComplete=observation.complete;validationPending=observation.pending;
    if(!targetSetDigest||firstComplete)return;
    const maxMs=Math.min(first.maxMs,budgets.maxMs-usedMs,Math.floor(window.endsAtMonoMs-now()),Math.floor(renewedUntil-now()));
    if(maxMs<1)return;const reservation=await reserve('validation',0,maxMs,'0');
    const result=await coordinator.validateOwnerSemanticCoverage({ownerId:handle.ownerId,expectedTargetDigest:targetSetDigest,budget:{maxTargets:first.maxTargets,maxMs}},semanticCredential);await finish(reservation,result.ok);
    if(!result.ok){error=result.error.code;return;}firstComplete=result.value.status==='complete';
    validationPending=(await handle.pumpCall('firstCoverage')).pending;
  }
  async function tick() {
    if(stopped||error)return;if(exhausted()||now()>=renewedUntil){resolveCompletion(status());return;}
    lastTick=now();return running=(async()=>{
      try {
        if(startup) {
          for(const target of handle.targets)for(const intent of ['current','history']) {
            const p=projections.find(p=>p.options.path===target.canonicalPath&&JSON.stringify(p.options.readSet)===JSON.stringify(target.readSet)&&JSON.stringify(p.types)===JSON.stringify(target.types)&&p.intent===intent);
            const maxMs=Math.min(q.maxMs,budgets.maxMs-usedMs,Math.floor(window.endsAtMonoMs-now()));if(maxMs<1)return;
            const reservation=await reserve('validation',0,maxMs,'0'),start=now();let result;
            try{const h=await maintainer(p,maxMs),remaining=Math.floor(maxMs-(now()-start));if(remaining<1)fail('read_timeout');result=await h.getContextIndexStatus({readSet:p.options.readSet,types:p.types,intent,deadlineMs:remaining},credential);}
            finally{await finish(reservation,result?.ok===true);}
            if(!result.ok){error=result.error.code;return;}if(result.value.lexical.state==='ready'&&result.value.semantic.coverage.status==='complete')completeTargets.add(JSON.stringify([p.options.path,p.types,intent]));
          }startup=false;
        }
        const firstObservation=await handle.pumpCall('firstCoverage');validationPending=firstObservation.pending;
        if(validationPending||completeTargets.size===handle.targets.length*2&&!firstObservation.complete)await validation();
        if(error||exhausted()||usedItems>=budgets.maxItems)return;
        const p=projections[at++%projections.length],isEmbedding=p.mode==='embeddings';
        if(isEmbedding) {
          const admission=await handle.pumpCall('embeddingAdmission');
          if(!admission.allowed)return;
          if(usd(usedUsd)>=usd(budgets.maxUsd))return;
        }
        const maxItems=Math.min(q.maxItems,budgets.maxItems-usedItems),maxMs=Math.min(q.maxMs,budgets.maxMs-usedMs,Math.floor(window.endsAtMonoMs-now()),Math.floor(renewedUntil-now()));
        if(maxItems<1||maxMs<1)return;const start=now();
        const reservation=await reserve(p.mode,maxItems,maxMs,isEmbedding?dollars(usd(q.maxUsd)<usd(budgets.maxUsd)-usd(usedUsd)?usd(q.maxUsd):usd(budgets.maxUsd)-usd(usedUsd)):'0',p.bindingId);
        let result;
        try{const h=await maintainer(p,maxMs),remaining=Math.floor(maxMs-(now()-start));if(remaining<1)fail('read_timeout');result=await h.refreshContextIndex({readSet:p.options.readSet,types:p.types,intent:p.intent,mode:p.mode,budget:{maxItems,maxMs:remaining,...(isEmbedding?{maxUsd:reservation.maxUsd}:{})}},credential);}
        finally{await finish(reservation,result?.ok===true);}
        if(!result.ok){error=result.error.code;return;}
        if(isEmbedding){const observation=await handle.pumpCall('firstCoverage');validationPending=observation.pending;if(result.value.status==='complete')completeTargets.add(JSON.stringify([p.options.path,p.types,p.intent]));}
      }catch(e){error=e.code??'reader_failed';}
    })().finally(()=>{running=null;if(error){void stop();return;}schedule();});
  }
  function stop() {
    if(closing)return closing;stopped=true;clearTimer(timer);registry.cleanup(record);
    closing=(async()=>{await running;const results=await Promise.allSettled([...handles.values()].map(h=>h.close()));if(results.some(r=>r.status==='rejected'))throw Error('reader_failed');registry.finish(record);all.delete(c.id);resolveCompletion(status());})();
    closing.catch(()=>{error='reader_failed';registry.finish(record,false);all.delete(c.id);resolveCompletion(status());});return closing;
  }
  record.stop=()=>{void stop();};
  const api=Object.freeze({getStatus:status,get completion(){return completion;},close:stop});
  const entry={api,fingerprint,supervisor:c.supervisor,coordinator,semanticCredentialDigest:credentialDigest(semanticCredential),first,renew(next,w,b){
    if(stopped)fail('store_closed');if(JSON.stringify(next.quantum)!==JSON.stringify(c.quantum)||next.pollMs!==c.pollMs)fail('invalid_input');
    if(w.id!==window.id){if(now()<window.endsAtMonoMs)fail('invalid_input');resolveCompletion(status());window=w;budgets=b;usedItems=w.usedItems;usedMs=w.usedMs;usedUsd=w.usedUsd;cycle();}
    else{if(JSON.stringify(b)!==JSON.stringify(budgets)||w.endsAtMonoMs!==window.endsAtMonoMs)fail('invalid_input');usedItems=Math.max(usedItems,w.usedItems);usedMs=Math.max(usedMs,w.usedMs);usedUsd=dollars(usd(usedUsd)>usd(w.usedUsd)?usd(usedUsd):usd(w.usedUsd));}
    if(settled)cycle();renewedUntil=now()+next.renewalMs;clearTimer(timer);if(!running)schedule();
  }};
  all.set(c.id,entry);schedule();return api;
}
