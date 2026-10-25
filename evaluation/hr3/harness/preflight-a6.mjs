#!/usr/bin/env node
// Mandatory first feasibility gate. No runner, product, transport or provider
// import/dispatch; a failed body gate stops A-6 implementation before migration.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {canonical,bytes,hash} from './common.mjs';
import {CONTRACT_A6,PROJECTION_A6_VERSION,projectContractA6,literalProjectionA6,expandWorkedExamplesA6} from './contract-projection-a6.mjs';
import {preflightExtractionSchemaA6,SCHEMA_VERSION} from './preflight-a6-schema.mjs';
import {EXTRACTION_PROMPT_A6,READER_PROMPT_A6} from './prompts-a6.mjs';
import {providerSchema,answerSchema} from './schema.mjs';
import {checkStrictSchema} from './strict-schema.mjs';
import {INPUT_CAPS,OUTPUT_CAPS,READER_INPUT_CAPS,PRIMARY,ALTERNATIVE} from './requests.mjs';
import {verifiedInputs} from './inputs.mjs';
import {extractionInput} from './extraction.mjs';
import {engineeringStressFixtures} from './cap-stress-fixtures.mjs';
import {accountingA6} from './accounting-a6.mjs';
export function requestA6(operation,input,{alternative=false,full=false,contractContext=input}={}) {
  assert.ok(operation==='extraction'||operation==='reader');assert.ok(!alternative||operation==='extraction');
  const public_contract=full?CONTRACT_A6:projectContractA6(operation,contractContext);
  const metadata={...input,public_contract};
  let content=canonical(metadata);
  if(operation==='reader'){const {delivered,...rest}=metadata;content=canonical(rest)+'\nCURRENT\n'+(delivered?.current??'')+'\nHISTORY\n'+(delivered?.history??'');}
  return {model:alternative?ALTERNATIVE:PRIMARY,store:false,...(alternative?{reasoning:{effort:'none'}}:{temperature:0}),max_output_tokens:OUTPUT_CAPS[operation],
    input:[{role:'system',content:operation==='extraction'?EXTRACTION_PROMPT_A6:READER_PROMPT_A6},{role:'user',content}],
    text:{format:{type:'json_schema',name:operation==='extraction'?'hr3_extraction_a6':'hr3_answer_a6',strict:true,schema:providerSchema(operation==='extraction'?preflightExtractionSchemaA6:answerSchema)}}};
}
export function preflightA6() {
  const accounting=accountingA6(),strictSchema=checkStrictSchema(providerSchema(preflightExtractionSchemaA6));
  const require=createRequire(new URL('../../../adapters/openai/package.json',import.meta.url)),encoder=require('tiktoken').get_encoding('o200k_base');
  const pilot=verifiedInputs('evaluation/hr3/generator/artifacts/pilot').families;
  const cohorts=[{split:'pilot',families:pilot},{split:'engineering-stress',families:engineeringStressFixtures().map(x=>x.family)}];
  const rows=[],worst={},best={},readerOverhead=[];
  function measure(operation,input,metadata,options={}) {
    const body=requestA6(operation,input,options),requestBytes=bytes(body),reservation=requestBytes+4096;
    const limit=operation==='reader'?READER_INPUT_CAPS[metadata.arm]:INPUT_CAPS.extraction;
    const row={...metadata,operation,requestBytes,reservation,framingUnits:4096,limit,maximumWithHeadroom:Math.floor(limit*95/100),
      marginPercent:(limit-reservation)*100/limit,excessOverHeadroom:reservation-Math.floor(limit*95/100),
      pass:reservation*100<=limit*95,providerBodyTokens:encoder.encode(canonical(body),[],[]).length,sha256:hash(body),
      contractBytes:bytes(projectContractA6(operation,options.contractContext??input)),schemaBytes:bytes(body.text.format.schema)};
    return {row,body};
  }
  try {
    for(const {split,families} of cohorts)for(const family of families)for(const b of family.batches)for(const alternative of [false,true]) {
      const input=extractionInput(family,b.ordinal),{row,body}=measure('extraction',input,{split,family:family.family_id,batch:b.ordinal,language:family.language,alternative},{alternative});
      const {public_contract,...delivered}=JSON.parse(body.input[1].content),literal=literalProjectionA6('extraction',input);
      assert.equal(canonical(input),canonical(delivered),'No source evidence may be removed to fit');
      assert.equal(canonical(expandWorkedExamplesA6(public_contract.worked_examples)),canonical(literal.worked_examples));
      const full=requestA6('extraction',input,{alternative,full:true});row.fullContractReservation=bytes(full)+4096;
      rows.push(row);const key=split+'/'+(alternative?'alternative':'primary');
      if(!worst[key]||worst[key].reservation<row.reservation)worst[key]={...row,body};
      if(!best[key]||best[key].reservation>row.reservation)best[key]=row;
    }
    // Reader overhead is explicitly a lower bound, NOT a request certificate:
    // no named-state migration/delivery is allowed after extraction gate failure.
    for(const family of pilot)for(const cp of family.checkpoints)for(const arm of ['T','U','O','P']) {
      const context={public_header:family.header,turns:family.batches.flatMap(b=>b.turns),question:cp.question};
      const input={question:cp.question,checkpoint:cp.batch,focal_turn:cp.focal_turn,requested_predecessor_turns:cp.requested_predecessor_turns,delivered:{current:'',history:''}};
      const {row}=measure('reader',input,{split:'pilot',family:family.family_id,batch:cp.batch,arm,emptyDeliveryLowerBound:true},{contractContext:context});readerOverhead.push(row);
    }
  } finally {encoder.free();}
  const sources=Object.fromEntries(['contract-projection-a6.mjs','preflight-a6-schema.mjs','prompts-a6.mjs','preflight-a6.mjs','accounting-a6.mjs','requests.mjs','schema.mjs','cap-stress-fixtures.mjs'].map(n=>['evaluation/hr3/harness/'+n,hash(readFileSync(new URL(n,import.meta.url)))]));
  for(const p of ['evaluation/hr3/generator/public-contract.json','evaluation/hr3/generator/freeze.json','evaluation/hr3/generator/artifacts/verification/a6-report.json','evaluation/hr3/scorer/REPORT.md','evaluation/hr3/protocol/errata.md','evaluation/hr3/protocol/evidence/pilot4-diagnosis.md'])sources[p]=hash(readFileSync(p));
  const minimumCeilingForMeasuredWorstAtFivePercent=Math.ceil(Math.max(...rows.map(r=>r.reservation))*100/95);
  return {version:'hr3-a6.1-complete-extraction-feasibility-v1',status:rows.every(r=>r.pass)?'PASS_EXTRACTION_INPUT_PREFLIGHT':'STOP_NUMERICAL_AMENDMENT_REQUIRED',paidAuthorization:false,
    scope:'Extraction feasibility at approved A-6.1 limits. Complete reader and embedding certification is request-certification.mjs; the reader overhead here is a lower bound only.',
    projectionVersion:PROJECTION_A6_VERSION,schemaVersion:SCHEMA_VERSION,strictSchema,minimumInputHeadroomPercent:5,
    outputCaps:OUTPUT_CAPS,inputCaps:INPUT_CAPS,readerInputCaps:READER_INPUT_CAPS,fullContractCanonicalBytes:bytes(CONTRACT_A6),
    method:'Deterministic relevant-public-name aliases only; all slots/field aliases and all operation-relevant rules. Twelve bilingual extraction examples retained without paraphrase. Minimum byte size among literal examples, exact repeated definitions, modal event-default overlays plus exact definitions, and byte-minimal-per-field event-default overlays plus exact definitions; canonical round-trip verified. No language/branch/example selection from gold, family allocation, private AST or correct answers. Provider-body UTF-8 bytes plus 4096 framing, both frozen extractor models, exact evidence preserved. Not a proof of optimality among arbitrary new semantic rewritings.',
    counts:{families:cohorts.reduce((n,c)=>n+c.families.length,0),requests:rows.length,failures:rows.filter(r=>!r.pass).length},
    minimumCeilingForMeasuredWorstAtFivePercent,best,worst,rows,readerOverhead,
    accounting:{status:accounting.status,completeLedgerChain:accounting.completeLedgerChain,preparationComplete:accounting.preparationComplete,
      settledNanodollars:accounting.carry.exposure.settled,outstandingNanodollars:accounting.carry.exposure.outstanding,totalExposureNanodollars:accounting.carry.exposure.total,
      embeddingUnits:accounting.carry.exposure.embedding,planning:accounting.planning},sources,
    stoppedWork:rows.every(r=>r.pass)?['Paid execution pending all certificates, passing non-author review and primary freeze']:['Paid execution blocked by input feasibility failure; no numerical changes permitted']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const r=preflightA6();writeFileSync('evaluation/hr3/harness/reports/input-preflight-a6.json',JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,counts:r.counts,maximumAtFivePercent:Math.floor(INPUT_CAPS.extraction*.95),minimumCeilingForMeasuredWorstAtFivePercent:r.minimumCeilingForMeasuredWorstAtFivePercent,worst:Object.fromEntries(Object.entries(r.worst).map(([k,{body,...v}])=>[k,v])),accounting:r.accounting}));process.exitCode=r.status==='PASS_EXTRACTION_INPUT_PREFLIGHT'?0:1;}
