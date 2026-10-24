import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { atomicJSON, canonical, fail } from './common.mjs';
import { verifiedInputs, scorerGold } from './inputs.mjs';
import { Ledger } from './ledger.mjs';
import { GuardedTransport, FakeTransport, createEmbedder } from './transport.mjs';
import { extract } from './extraction.mjs';
import { materialize, literalQuery, retrieve } from './research.mjs';
import { responseRequest } from './requests.mjs';
import { verifyProductPin } from './pin.mjs';
import { artifactManifest } from './artifacts.mjs';
import { tokenCounter } from './dependencies.mjs';
import { validate, answerSchema } from '../scorer/schema.mjs';
import { score } from '../scorer/scorer.mjs';
export function planFor(families) {
  const ids='^(?:'+families.map(f=>f.family_id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')/';
  return [{operation:'extraction',ids:ids+'extract/[1-4]/attempt-[01]$',maxDispatches:families.length*8},
    {operation:'reader',ids:ids+'reader/[UTOP]/[24]/attempt-[01]$',maxDispatches:families.length*16},
    ...['research','product'].map(channel=>({operation:channel+'-embedding',ids:ids+channel+'-embedding/\\d+/attempt-[01]$',maxDispatches:families.length*1000}))];
}
export async function run({stage='smoke',inputs,out,transport=new FakeTransport(),counter,progress=()=>{}}) {
  if(!['smoke','pilot'].includes(stage))fail('offline_stage_only');
  const root=resolve(out);mkdirSync(root,{recursive:true,mode:0o700});if(readdirSync(root).length)fail('output_not_empty');
  const data=verifiedInputs(inputs),families=stage==='smoke'?data.families.slice(0,2):data.families;
  const productVerification=verifyProductPin();
  const {ProductAgent}=await import('./product.mjs');
  let ownedCounter=false;if(!counter){counter=await tokenCounter();ownedCounter=true;}if(counter.id!=='tiktoken-o200k_base')fail('actual_tokenizer_required');
  const ledger=new Ledger(join(root,'ledger.jsonl'),{stage,plan:planFor(families)}),guarded=new GuardedTransport(transport,ledger);
  for(const directory of ['extractions','states','deliveries','answers','scores'])mkdirSync(join(root,directory),{mode:0o700});
  const observations=[],extractionSummary=[],written=['ledger.jsonl'];let stopped=null;
  const persist=(path,value)=>{atomicJSON(path,value);written.push(path.slice(root.length+1));};
  persist(join(root,'run.json'),{stage,offline:transport instanceof FakeTransport,transport:transport.constructor.name,protocol:'v0.3.4+E-1+E-2+A-1',productPin:'b2513501a6747a163ab1cefb7d37a16744c9621a',families:families.map(f=>f.family_id),inputVerification:data.verification,productVerification,tokenizer:counter.id,readiness:transport instanceof FakeTransport?'offline exercise only; paid gates pending':'paid engineering pilot under A-1: mechanical scoring only, referrals unresolved'});
  try {
    for(const family of families) {
      const researchEmbedder=createEmbedder(guarded,{prefix:family.family_id+'/research-embedding'}),productEmbedder=createEmbedder(guarded,{channel:'product',prefix:family.family_id+'/product-embedding'});
      const product=await ProductAgent.open({namespace:family.namespace,embedder:productEmbedder,counter,onAuthorizationExposure:()=>ledger.stop('authorization_exposure')});const events=[];
      try {
        for(const batch of family.batches) {
          const extraction=await extract({family,batch:batch.ordinal,transport:guarded,cache:join(root,'extractions')});
          written.push('extractions/'+extraction.key+'.json');
          extractionSummary.push({family:family.family_id,batch:batch.ordinal,key:extraction.key,error:extraction.error});
          const next=(extraction.value?.events??[]).map((e,ordinal)=>({...e,batch:batch.ordinal,ordinal}));events.push(...next);
          await product.ingest(next,batch.observed_at);await product.controls(family.controls,batch.ordinal);
          if(ledger.snapshot().stopped)fail(ledger.snapshot().stopped);
          const checkpoint=family.checkpoints.find(c=>c.batch===batch.ordinal);if(!checkpoint)continue;
          const query=literalQuery(family.header,family.language);if(query!==checkpoint.query)fail('literal_query_mismatch');
          const controls=product.controlSnapshot();
          for(const arm of ['U','T','O','P']) {
            const name=`${family.family_id}-${arm}-${checkpoint.batch}`,state=arm==='P'?product.state():materialize(arm,events,checkpoint.at);
            persist(join(root,'states',name+'.json'),state);
            const delivery=arm==='P'?await product.retrieve(query):await retrieve(state,{query,embedder:researchEmbedder,counter,controls});
            if(ledger.snapshot().stopped)fail(ledger.snapshot().stopped);
            persist(join(root,'deliveries',name+'.json'),delivery);
            const readerInput={question:checkpoint.question,checkpoint:checkpoint.batch,focal_turn:checkpoint.focal_turn,requested_predecessor_turns:checkpoint.requested_predecessor_turns,delivered:delivery.blocks};
            const body=responseRequest('reader',readerInput),reply=await guarded.send({id:`${family.family_id}/reader/${arm}/${checkpoint.batch}`,operation:'reader',body});
            let answer=null;try{if(reply.status==='completed')answer=JSON.parse(reply.outputText);}catch{}
            const errors=validate(answerSchema,answer);persist(join(root,'answers',name+'.json'),{body,reply,answer,errors});
            // Only the scoring function receives gold/support; readers never receive these values.
            const gold=scorerGold(family,checkpoint,data.gold.find(g=>g.family_id===family.family_id),data.support.find(s=>s.family_id===family.family_id));
            const result=score(gold,{answer,delivered:delivery.delivered});persist(join(root,'scores',name+'.json'),result);observations.push({family:family.family_id,arm,batch:checkpoint.batch,...result});
          }
          progress({family:family.family_id,batch:checkpoint.batch,observations:observations.length,ledger:ledger.snapshot()});
        }
      } finally {persist(join(root,'states',family.family_id+'-P-final.json'),product.state());await product.close();}
    }
  } catch(error) {stopped=error.code??error.message;written.push('failure.json');writeFileSync(join(root,'failure.json'),canonical({reason:stopped,ledger:ledger.snapshot()})+'\n',{mode:0o600});throw error;
  } finally {
    persist(join(root,'extraction-summary.json'),extractionSummary);
    written.push('scored.jsonl');writeFileSync(join(root,'scored.jsonl'),observations.map(canonical).join('\n')+(observations.length?'\n':''),{mode:0o600});
    persist(join(root,'summary.json'),{stage,complete:!stopped,attempted:observations.length,arms:Object.fromEntries(['U','T','O','P'].map(arm=>[arm,{attempted:observations.filter(o=>o.arm===arm).length,valid:observations.filter(o=>o.arm===arm&&o.valid).length}])),ledger:ledger.snapshot(),fakeAccuracyClaim:false});
    artifactManifest(root,written);
    if(ownedCounter)counter.close();
  }
  return {root,observations,ledger:ledger.snapshot()};
}
