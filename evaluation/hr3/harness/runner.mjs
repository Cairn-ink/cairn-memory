import {projectContract,familyContractContext} from './contract-projection-a4.mjs';
import { mkdirSync, readdirSync, writeFileSync,readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { atomicJSON, canonical, fail } from './common.mjs';
import { verifiedInputs, scorerGold } from './inputs.mjs';
import {verifyPaidPreflight,PAID_PREFLIGHT_PATH} from './paid-preflight.mjs';
import {budgetA4} from './budget-a4.mjs';
import {FIRST_PILOT_LEDGER_SHA256,loadCarryForward} from './accounting.mjs';
import { Ledger } from './ledger.mjs';
import { GuardedTransport, FakeTransport, createEmbedder } from './transport.mjs';
import { extractionDiagnostics } from './extraction-diagnostics.mjs';
import {PrivacyGuard,sourceOrderAliases} from './privacy.mjs';
import {STAGE_CONFIGURATION,ARM_CONFIGURATION} from './run-configuration.mjs';
import { identifyEvents } from './event-identity.mjs';
import { extract } from './extraction.mjs';
import { materialize, literalQuery, retrieve,resolveLinks } from './research.mjs';
import { responseRequest } from './requests.mjs';
import { verifyProductPin } from './pin.mjs';
import { artifactManifest } from './artifacts.mjs';
import { frozenArtifacts } from './bounds.mjs';
import { tokenCounter } from './dependencies.mjs';
import { validate, answerSchema } from '../scorer/schema.mjs';
import { score } from '../scorer/scorer.mjs';
export function planFor(families) {
  const ids='^(?:'+families.map(f=>f.family_id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')/';
  return [{operation:'extraction',ids:ids+'extract/[1-4]/attempt-[01]$',maxDispatches:families.length*8},
    {operation:'reader',ids:ids+'reader/[UTOP]/[24]/attempt-[01]$',maxDispatches:families.length*16},
    ...['research','product'].map(channel=>({operation:channel+'-embedding',ids:ids+channel+'-embedding/\\d+/attempt-[01]$',maxDispatches:families.length*1000}))];
}
export function verifyA4RunAccounting(carryForward) {
  if(!carryForward)fail('verified_complete_carry_forward_required');
  const carried=loadCarryForward(carryForward);
  if(!carried.preparationComplete||!carried.exposure.sourceHashes.includes(FIRST_PILOT_LEDGER_SHA256))fail('verified_complete_carry_forward_required');
  const budget=JSON.parse(readFileSync(new URL('./reports/budget-a4.json',import.meta.url)));
  if(canonical(budget)!==canonical(budgetA4())||!budget.availableCarryFits||!budget.accountingGate.completeThirdPilotMerged||budget.carryForward.sha256!==carried.manifestSHA256)fail('a4_complete_accounting_required');
  return carried;
}
export async function run({stage='smoke',inputs,out,transport=new FakeTransport(),counter,carryForward=null,paidPreflight=PAID_PREFLIGHT_PATH,progress=()=>{}}) {
  const root=resolve(out);mkdirSync(root,{recursive:true,mode:0o700});if(readdirSync(root).length)fail('output_not_empty');
  const data=verifiedInputs(inputs),families=stage==='smoke'?data.families.slice(0,2):data.families;
  const productVerification=verifyProductPin();
  // Real runs must reconcile the entire accounting chain before opening a new
  // journal. Fake runs exercise the same limits with explicitly simulated cost.
  if(!(transport instanceof FakeTransport)) {
    const carry=verifyA4RunAccounting(carryForward);
    verifyPaidPreflight({path:paidPreflight,carry,inputs,out,stage});
  }
  if(!STAGE_CONFIGURATION.some(c=>c.stage===stage))fail('offline_stage_only');
  const ledger=new Ledger(join(root,'ledger.jsonl'),{stage,plan:planFor(families),carryForward}),guarded=new GuardedTransport(transport,ledger);
  const {ProductAgent}=await import('./product.mjs');
  let ownedCounter=false;if(!counter){counter=await tokenCounter();ownedCounter=true;}if(counter.id!=='tiktoken-o200k_base')fail('actual_tokenizer_required');
  for(const directory of ['extractions','states','deliveries','answers','scores'])mkdirSync(join(root,directory),{mode:0o700});
  const observations=[],extractionSummary=[],privacyReports=[],written=['ledger.jsonl'];let stopped=null;
  const persist=(path,value)=>{atomicJSON(path,value);written.push(path.slice(root.length+1));};
  persist(join(root,'run.json'),{stage,carryForward:ledger.configuration.carryForward??null,offline:transport instanceof FakeTransport,transport:transport.constructor.name,version:'hr3-run-a4-audit-v2',productHeadline:'Pinned product + frozen public-operation agent + shared research extraction + slot reader.',protocol:'v0.3.4+E-1+E-2+A-1+A-2+A-3+A-4+A-4.1+A-4.2+A-1.1',productPin:'b2513501a6747a163ab1cefb7d37a16744c9621a',families:families.map(f=>f.family_id),inputVerification:data.verification,frozenArtifacts:frozenArtifacts(inputs),productVerification,tokenizer:counter.id,readiness:transport instanceof FakeTransport?'offline exercise only; paid gates pending':'paid engineering pilot under A-1: mechanical scoring only, referrals unresolved'});
  guarded.startSupervision(progress);
  try {
    for(const family of families) {
      const researchEmbedder=createEmbedder(guarded,{prefix:family.family_id+'/research-embedding'}),productEmbedder=createEmbedder(guarded,{channel:'product',prefix:family.family_id+'/product-embedding'});
      const privacy=new PrivacyGuard(family),aliases=sourceOrderAliases();
      const product=await ProductAgent.open({privacy,aliases,namespace:family.namespace,embedder:productEmbedder,counter,onAuthorizationExposure:()=>ledger.stop('authorization_exposure')});const events=[];
      try {
        for(const batch of family.batches) {
          const extraction=await extract({family,batch:batch.ordinal,transport:guarded,cache:join(root,'extractions')});
          written.push('extractions/'+extraction.key+'.json');
          const raw=extraction.value?.events??[],next=identifyEvents(family.family_id,batch.ordinal,raw);
          aliases.register(next);
          extractionSummary.push({family:family.family_id,batch:batch.ordinal,key:extraction.key,error:extraction.error,diagnostics:{...extraction.diagnostics,identities:raw.map((e,i)=>({raw_event_id:e.event_id,internal_key:next[i].event_id,reader_id:aliases.id(next[i].event_id)}))}});
          events.push(...next);
          const linkedEvents=resolveLinks(events);
          await product.ingest(next,batch.observed_at,{linkedEvents});await product.controls(family.controls,batch.ordinal);
          if(ledger.snapshot().stopped)fail(ledger.snapshot().stopped);
          const checkpoint=family.checkpoints.find(c=>c.batch===batch.ordinal);if(!checkpoint)continue;
          const query=literalQuery(family.header,family.language);if(query!==checkpoint.query)fail('literal_query_mismatch');
          const controls=product.controlSnapshot();
          for(const {arm} of ARM_CONFIGURATION) {
            const name=`${family.family_id}-${arm}-${checkpoint.batch}`,state=arm==='P'?product.state():materialize(arm,events,checkpoint.at,{linkedEvents});
            persist(join(root,'states',name+'.json'),state);
            const delivery=arm==='P'?await product.retrieve(query):await retrieve(state,{query,embedder:researchEmbedder,counter,controls,aliases});
            if(ledger.snapshot().stopped)fail(ledger.snapshot().stopped);
            persist(join(root,'deliveries',name+'.json'),delivery);
            const readerInput={public_contract:projectContract('reader',familyContractContext(family,checkpoint.question)),question:checkpoint.question,checkpoint:checkpoint.batch,focal_turn:checkpoint.focal_turn,requested_predecessor_turns:checkpoint.requested_predecessor_turns,delivered:delivery.blocks};
            const body=responseRequest('reader',readerInput);privacy.check('reader-request',body,{arm,checkpoint:checkpoint.batch});
            const reply=await guarded.send({id:`${family.family_id}/reader/${arm}/${checkpoint.batch}`,operation:'reader',body});
            let answer=null;try{if(reply.status==='completed')answer=JSON.parse(reply.outputText);}catch{}
            const errors=validate(answerSchema,answer);persist(join(root,'answers',name+'.json'),{body,reply,answer,errors});
            // Only the scoring function receives gold/support; readers never receive these values.
            const gold=scorerGold(family,checkpoint,data.gold.find(g=>g.family_id===family.family_id),data.support.find(s=>s.family_id===family.family_id));
            const result=score(gold,{answer,delivered:delivery.delivered});persist(join(root,'scores',name+'.json'),result);observations.push({family:family.family_id,arm,batch:checkpoint.batch,...result});
          }
          progress({family:family.family_id,batch:checkpoint.batch,observations:observations.length,ledger:ledger.snapshot()});
        }
      } finally {privacyReports.push({family:family.family_id,...privacy.report()});persist(join(root,'states',family.family_id+'-P-final.json'),product.state());await product.close();}
    }
  } catch(error) {stopped=error.code??error.message;written.push('failure.json');writeFileSync(join(root,'failure.json'),canonical({reason:stopped,ledger:ledger.snapshot()})+'\n',{mode:0o600});throw error;
  } finally {
    guarded.stopSupervision();
    persist(join(root,'extraction-summary.json'),extractionSummary);
    persist(join(root,'privacy-scan.json'),{version:'hr3-private-label-scan-v1',hits:privacyReports.reduce((n,r)=>n+r.hits,0),families:privacyReports});
    written.push('scored.jsonl');writeFileSync(join(root,'scored.jsonl'),observations.map(canonical).join('\n')+(observations.length?'\n':''),{mode:0o600});
    persist(join(root,'summary.json'),{stage,complete:!stopped,attempted:observations.length,pipelineStageDiagnostics:extractionDiagnostics(extractionSummary),arms:Object.fromEntries(['U','T','O','P'].map(arm=>[arm,{attempted:observations.filter(o=>o.arm===arm).length,valid:observations.filter(o=>o.arm===arm&&o.valid).length}])),ledger:ledger.snapshot(),fakeAccuracyClaim:false});
    artifactManifest(root,written);
    if(ownedCounter)counter.close();
  }
  return {root,observations,ledger:ledger.snapshot()};
}
