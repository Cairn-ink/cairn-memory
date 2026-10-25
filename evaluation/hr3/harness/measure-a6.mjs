#!/usr/bin/env node
// Non-certifying offline construction. There is no transport, journal, key,
// dispatch API or runtime option for bypassing the paid certifying gates.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {canonical,bytes,hash} from './common.mjs';
import {verifiedInputs} from './inputs.mjs';import {extractionInput} from './extraction.mjs';
import {engineeringStressFixtures} from './cap-stress-fixtures.mjs';
import {extractionReference,readerReference} from './references-a4.mjs';
import {serializeOutput,referenceDelivery} from './cap-certification.mjs';
import {extractionSchema,answerSchema,validateExtraction} from './schema.mjs';
import {identifyEvents} from './event-identity.mjs';import {resolveLinks,materialize,retrieve,literalQuery} from './research.mjs';
import {responseRequest,INPUT_CAPS,READER_INPUT_CAPS,OUTPUT_CAPS,validateRequest} from './requests.mjs';
import {projectContract,familyContractContext} from './contract-projection-a4.mjs';
import {sourceOrderAliases,PrivacyGuard} from './privacy.mjs';
import {useInstalledDependencies} from './dependencies.mjs';
import {contextConformance} from './context-certification.mjs';
import {inheritanceCasesA6} from './inheritance-a6.mjs';
import {runtimeClosure} from './runtime-closure.mjs';
export async function measureA6({progress=()=>{}}={}) {
 useInstalledDependencies({mcp:'adapters/mcp/node_modules',tokenizer:'adapters/openai/node_modules'});
 const closure=runtimeClosure(),sourcePaths=[...Object.keys(closure.files),...['measure-a6.mjs','inheritance-a6.mjs','references-a4.mjs','cap-stress-fixtures.mjs','context-certification.mjs'].map(n=>'evaluation/hr3/harness/'+n),'evaluation/hr3/generator/freeze.json',...Object.keys(JSON.parse(readFileSync('evaluation/hr3/generator/freeze.json')).hashes).filter(n=>!n.startsWith('artifacts/')).map(n=>'evaluation/hr3/generator/'+n),...Object.keys(JSON.parse(readFileSync('evaluation/hr3/generator/artifacts/pilot/manifest.json')).hashes).map(n=>'evaluation/hr3/generator/artifacts/pilot/'+n)];
 const sources=Object.fromEntries([...new Set(sourcePaths)].map(p=>[p,hash(readFileSync(p))]));
 const {ProductAgent}=await import('./product.mjs');
 const encoder=createRequire(new URL('../../../adapters/openai/package.json',import.meta.url))('tiktoken').get_encoding('o200k_base');
 const counter={id:'tiktoken-o200k_base',countTokens:s=>encoder.encode(s,[],[]).length};
 const embedder={id:'offline-measurement-unit-vector',revision:'1',dimensions:1536,normalization:'l2',embed:async ts=>ts.map(()=>[1,...Array(1535).fill(0)])};
 const data=verifiedInputs('evaluation/hr3/generator/artifacts/pilot'),bundles=data.families.map(family=>({family,gold:data.gold.find(g=>g.family_id===family.family_id),support:data.support.find(s=>s.family_id===family.family_id)}));
 const rows=[],worst={},coverage=[];let privacyHits=0,skippedP=0,actualPOperations=0;
 function request(operation,input,meta) {
  const body=responseRequest(operation,input,{alternative:meta.alternative??false});return bodyRow(body,operation,meta);
 }
 function bodyRow(body,operation,meta){
  const kind=operation==='extraction'?'input/extractor/'+(meta.alternative?'5.4':'4.1'):'input/reader/'+meta.arm;
  const reservation=bytes(body)+4096,limit=operation==='extraction'?INPUT_CAPS.extraction:READER_INPUT_CAPS[meta.arm];
  const row={...meta,kind,units:reservation,bodyBytes:bytes(body),tokens:counter.countTokens(canonical(body)),limit,minimumCeiling:Math.ceil(reservation*100/95),marginPercent:(limit-reservation)*100/limit,bodySHA256:hash(body),passesUnchangedGate:reservation*100<=limit*95};rows.push(row);
  if(!worst[kind]||worst[kind].units<row.units)worst[kind]={...row,body};return row;
 }
 function output(operation,value,meta){
  const schema=operation==='extraction'?extractionSchema:answerSchema,serialization=serializeOutput(schema,value),tokens=counter.countTokens(serialization),kind='output/'+operation,limit=OUTPUT_CAPS[operation];
  const row={...meta,kind,units:tokens,bytes:Buffer.byteLength(serialization),limit,minimumCeiling:Math.ceil(tokens*100/90),marginPercent:(limit-tokens)*100/limit,bodySHA256:hash(serialization),passesUnchangedGate:tokens*100<=limit*90};rows.push(row);if(!worst[kind]||worst[kind].units<tokens)worst[kind]={...row,serialization};
 }
 try {
  for(const {split,cohort} of [{split:'pilot',cohort:bundles},{split:'engineering',cohort:engineeringStressFixtures()}]){
   let completed=0;
   for(const bundle of cohort){
    const {family}=bundle,meta={split,family:family.family_id,language:family.language,change:family.change_type,cause:family.causal_class},events=[],aliases=sourceOrderAliases(),privacy=new PrivacyGuard(family);
    const product=await ProductAgent.open({namespace:family.namespace??{ownerId:'independent-measurement',scope:'personal',projectId:null},embedder,counter,aliases,privacy});
    try{
     for(const batch of family.batches){
      const input=extractionInput(family,batch.ordinal),reference=extractionReference(family,batch.ordinal);
      output('extraction',reference,{...meta,batch:batch.ordinal});
      for(const alternative of [false,true]){const body=responseRequest('extraction',input,{alternative});privacy.check('extraction-request',body);bodyRow(body,'extraction',{...meta,batch:batch.ordinal,alternative});}
      const next=identifyEvents(family.family_id,batch.ordinal,validateExtraction(reference,input).events,family.namespace??null);events.push(...next);aliases.register(next);const linkedEvents=resolveLinks(events);
      await product.ingest(next,batch.observed_at,{linkedEvents});await product.controls(family.controls??[],batch.ordinal);
      const cp=family.checkpoints.find(c=>c.batch===batch.ordinal);if(!cp)continue;
      const query=literalQuery(family.header,family.language),public_contract=projectContract('reader',familyContractContext(family,cp.question));
      output('reader',readerReference(bundle,cp.batch),{...meta,batch:cp.batch,variant:'complete-union'});
      const graphs=bundle.support.checkpoints.find(c=>c.batch===cp.batch).acceptedGraphs;
      for(let graph=0;graph<Math.max(1,graphs.length);graph++)output('reader',readerReference(bundle,cp.batch,{graph,assertionCitations:false}),{...meta,batch:cp.batch,variant:'required-path-'+graph});
      for(const arm of ['T','U','O','P'])for(const mode of arm==='P'?['constant']:['constant','hashed-axis']){
       const varied=mode==='constant'?embedder:{...embedder,embed:async ts=>ts.map(t=>{const v=Array(1536).fill(0);v[parseInt(hash(t).slice(0,8),16)%1536]=1;return v;})};
       const delivery=arm==='P'?await product.retrieve(query):await retrieve(materialize(arm,events,cp.at,{linkedEvents}),{query,counter,embedder:varied,controls:product.controlSnapshot(),aliases});
       const readerInput={public_contract,question:cp.question,checkpoint:cp.batch,focal_turn:cp.focal_turn,requested_predecessor_turns:cp.requested_predecessor_turns,delivered:delivery.blocks};
       const body=responseRequest('reader',readerInput);privacy.check('reader-request',body,{arm});bodyRow(body,'reader',{...meta,batch:cp.batch,arm,embedding:mode});
      }
     }
     skippedP+=product.log.filter(l=>l.method==='unresolved_mapping'||l.method==='skip_nonadopted').length;
     actualPOperations+=product.log.filter(l=>l.outcome==='operation_success').length;
    }finally{privacyHits+=privacy.report().hits;await product.close();}
    coverage.push(meta);if(++completed%10===0)progress(`${split}: ${completed}/${cohort.length} complete families`);
   }
  }
  const context=await contextConformance({counter,measurementOnly:true});
  for(const r of context.rows){const meta={split:'independent-context',family:r.id,arm:r.operation==='reader'?r.id.split('/').at(-2):undefined,alternative:r.body.model.includes('5.4')};bodyRow(r.body,r.operation,meta);output(r.operation,r.reference,meta);}
  const inheritance=[];
  for(const fixture of inheritanceCasesA6()){
   const {family,wires}=fixture,aliases=sourceOrderAliases(),privacy=new PrivacyGuard(family),events=[],meta={split:'independent-inheritance',family:family.family_id,language:family.language,explicit_preservation:fixture.explicit_preservation};
   const p=await ProductAgent.open({namespace:family.namespace,embedder,counter,aliases,privacy});
   try{
    for(const batch of family.batches){const input=extractionInput(family,batch.ordinal),wire={events:[wires[batch.ordinal-1]]};for(const alternative of [false,true]){privacy.check('extraction-request',responseRequest('extraction',input,{alternative}));request('extraction',input,{...meta,batch:batch.ordinal,alternative});}output('extraction',wire,{...meta,batch:batch.ordinal});const next=identifyEvents(family.family_id,batch.ordinal,validateExtraction(wire,input).events,family.namespace);events.push(...next);aliases.register(next);await p.ingest(next,batch.observed_at,{linkedEvents:resolveLinks(events)});}
    const cp=family.checkpoints[0],linkedEvents=resolveLinks(events),public_contract=projectContract('reader',familyContractContext(family,cp.question));assert.equal(linkedEvents[1].unresolved,false);
    for(const arm of ['T','U','O','P']){const d=arm==='P'?await p.retrieve('demoService dispatch configuration'):await retrieve(materialize(arm,events,cp.at,{linkedEvents}),{query:'demoService dispatch configuration',counter,embedder,aliases});const body=responseRequest('reader',{public_contract,question:cp.question,checkpoint:2,focal_turn:cp.focal_turn,requested_predecessor_turns:cp.requested_predecessor_turns,delivered:d.blocks});privacy.check('reader-request',body,{arm});bodyRow(body,'reader',{...meta,arm,batch:2});}
    inheritance.push(meta);
   }finally{privacyHits+=privacy.report().hits;await p.close();}
  }
  assert.equal(privacyHits,0);assert.equal(Object.keys(worst).length,8);
  // Demonstrate that measurement did not change dispatch validation.
  const extraction=worst['input/extractor/4.1'];if(extraction.units<=extraction.limit)assert.equal(validateRequest({operation:'extraction',body:extraction.body,id:'measurement-only'}).input,extraction.units);else assert.throws(()=>validateRequest({operation:'extraction',body:extraction.body,id:'measurement-only'}),/request_byte_bound/);
  for(const [p,digest]of Object.entries(sources))assert.equal(hash(readFileSync(p)),digest,'Measurement source changed during execution: '+p);
  return {version:'hr3-a6-noncertifying-measurement-v1',status:'MEASUREMENT_ONLY_NOT_CERTIFIED',paidAuthorization:false,networkCalls:0,paidCalls:0,dispatches:0,journalsCreated:0,limitsUnchanged:true,
   method:'Exact runtime provider bodies, UTF-8 bytes +4096 framing; actual o200k_base output tokens in closed schema property order. All pilot and independent full Cartesian engineering families; actual P operations for every case; two research ranking fixtures. No evidence truncation beyond frozen policies, no paid gate bypass or runtime measurement flag.',
   scopeLimits:'Finite grammar/reference and ranking fixtures, not unbounded schema spellings or every possible embedding ranking. Output references are independent engineering constructions, not previous paid replies. Hosted embeddings are replaced by declared deterministic offline unit vectors only in this program.',
   runtimeClosureSHA256:hash(closure.files),sources,coverage,inheritance,context:{cases:context.cases,requests:context.rows.length},counts:{families:coverage.length,requests:rows.filter(r=>r.kind.startsWith('input/')).length,outputs:rows.filter(r=>r.kind.startsWith('output/')).length},privacyHits,skippedP,actualPOperations,rows,worst};
 }finally{encoder.free();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){assert.equal(process.argv.length,2,'Measurement program has no dispatch or override options');const r=await measureA6({progress:m=>process.stderr.write(m+'\n')});mkdirSync('evaluation/hr3/harness/reports',{recursive:true});writeFileSync('evaluation/hr3/harness/reports/measurement-a6.json',JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({status:r.status,counts:r.counts,worst:Object.fromEntries(Object.entries(r.worst).map(([k,{body,serialization,...v}])=>[k,v]))}));}
