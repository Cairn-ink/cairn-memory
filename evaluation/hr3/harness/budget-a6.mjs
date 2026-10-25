#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {accountingA6} from './accounting-a6.mjs';
import {INPUT_CAPS,OUTPUT_CAPS,READER_INPUT_CAPS} from './requests.mjs';
import {CAPS} from './ledger.mjs';
import {hash} from './common.mjs';
export function budgetA6() {
 const accounting=accountingA6(),carry=accounting.carry;
 const extraction=480*(INPUT_CAPS.extraction*400+OUTPUT_CAPS.extraction*1600);
 const reader=240*(Object.values(READER_INPUT_CAPS).reduce((n,x)=>n+x,0)*400+4*OUTPUT_CAPS.reader*1600);
 const embedding=128000000*20,remainingEmbedding=(128000000-carry.exposure.embedding.research-carry.exposure.embedding.product)*20;
 const combined=carry.exposure.total+extraction+reader+embedding;
 const stages=[['pilot',240,480,'primary'],['development',800,1600,'primary'],['test',6400,12800,'primary'],['alternative',800,800,'alternative']].map(([stage,e,r,model])=>{
  const inputRate=model==='alternative'?750:400,outputRate=model==='alternative'?4500:1600;
  const forecast=e*(8000*inputRate+4352*outputRate)+r*(6000*400+2176*1600);
  const maximum=2*e*(INPUT_CAPS.extraction*inputRate+4352*outputRate)+2*r*(Math.max(...Object.values(READER_INPUT_CAPS))*400+2176*1600);
  return {stage,extractionCalls:e,readerCalls:r,forecastNanodollars:forecast,allMaximumRetryNanodollars:maximum,unchangedLaterStageLimitUSD:CAPS[stage]};
 });
 const sources=Object.fromEntries(['requests.mjs','ledger.mjs','budget-a6.mjs','accounting.mjs','accounting-a6.mjs','projection-schema.mjs','reports/a6-carry-forward.json','reports/accounting-input-a6.json'].map(n=>['evaluation/hr3/harness/'+n,hash(readFileSync(new URL(n,import.meta.url)))]));
 if(accounting.completeLedgerChain){sources[accounting.input.path]=accounting.input.sha256;sources[carry.manifestPath]=carry.manifestSHA256;for(const spec of accounting.sourceSpecs)sources[spec.path]=spec.sha256;}
 sources['evaluation/hr3/protocol/errata.md']=hash(readFileSync(new URL('../protocol/errata.md',import.meta.url)));
 return {version:'hr3-budget-a6.1-v1',status:accounting.completeLedgerChain&&combined<=50e9?'PASS_CUMULATIVE_PILOT_BOUND':'FAIL_ACCOUNTING_OR_CUMULATIVE_BOUND',paidReadiness:false,
  cumulativePilotCapUSD:50,inputCaps:INPUT_CAPS,readerInputCaps:READER_INPUT_CAPS,outputCaps:OUTPUT_CAPS,
  attemptsPerCall:2,extractionNanodollars:extraction,readerNanodollars:reader,entireEmbeddingNanodollars:embedding,
  incrementalConservativeNanodollars:extraction+reader+embedding,
  carryForward:{path:carry.manifestPath,sha256:carry.manifestSHA256,preparationComplete:carry.preparationComplete,settledNanodollars:carry.exposure.settled,outstandingNanodollars:carry.exposure.outstanding,embedding:carry.exposure.embedding,exposureNanodollars:carry.exposure.total},
  cumulativePilotBoundNanodollars:combined,availableCarryCombinedNanodollars:combined,availableCarryFits:combined<=50e9,remainingEmbeddingNanodollars:remainingEmbedding,
  accountingGate:{status:accounting.status,completeFourthPilotMerged:accounting.completeLedgerChain,manifestUnchanged:true,availableSnapshotIsFullA6Exposure:accounting.completeLedgerChain},
  preparationComplete:accounting.preparationComplete,limitsAuthority:'A-6.1',
  stages,global:{operationalStopUSD:450,authorizationUSD:500,unavailableHeadroomUSD:50,embeddingUnits:{research:64000000,product:64000000}},
  laterStageCapsChanged:false,uncoveredAllMaximumRetryEnvelopeNanodollars:stages.reduce((n,s)=>n+s.allMaximumRetryNanodollars,0)+embedding,
  sources};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const r=budgetA6();writeFileSync(new URL('./reports/budget-a6.json',import.meta.url),JSON.stringify(r,null,2)+'\n');process.stdout.write(JSON.stringify(r,null,2)+'\n');process.exitCode=r.status==='PASS_CUMULATIVE_PILOT_BOUND'?0:1;}
