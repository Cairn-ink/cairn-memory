#!/usr/bin/env node
import {runtimeClosure} from './runtime-closure.mjs';
import {contextConformance} from './context-certification.mjs';
import {measureEmbedding,summarizeEmbeddings} from './embedding-measurement-a4.mjs';
import {accountingA6 as prepareA4Accounting} from './accounting-a6.mjs';
import {projectContract,familyContractContext} from './contract-projection-a4.mjs';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {PrivacyGuard,sourceOrderAliases} from './privacy.mjs';
import {useInstalledDependencies} from './dependencies.mjs';
import {pilotReferenceBundles,extractionReference} from './cap-certification.mjs';
import {engineeringStressFixtures} from './cap-stress-fixtures.mjs';
import {extractionInput} from './extraction.mjs';
import {validateExtraction} from './schema.mjs';
import {identifyEvents} from './event-identity.mjs';
import {materialize,retrieve,literalQuery,resolveLinks} from './research.mjs';
import {responseRequest,INPUT_CAPS,READER_INPUT_CAPS,inputLimit,validateRequest,embeddingRequest} from './requests.mjs';
import {bytes,hash} from './common.mjs';

export const INPUT_MARGIN_PERCENT=5;
export function referenceEvents(family,batch,{auditIdentity=false}={}) {
  const raw=validateExtraction(extractionReference(family,batch),extractionInput(family,batch)).events;
  return auditIdentity?raw.map((e,ordinal)=>({...e,event_id:`b${batch}/${e.event_id}`,batch,ordinal})):identifyEvents(family.family_id,batch,raw,family.namespace);
}
export const readerInput=(cp,delivered)=>({public_contract:cp.public_contract,question:cp.question,checkpoint:cp.batch,focal_turn:cp.focal_turn,requested_predecessor_turns:cp.requested_predecessor_turns,delivered});
export const embeddingMeasurements=[];let certificateFamily=null,certificatePrivacy=null;
export function certificateEmbedder(mode='constant',channel='research') {
  return {id:'offline-input-certificate-'+mode,revision:'1',dimensions:1536,normalization:'l2',async embed(texts){certificatePrivacy?.check(channel+'-embedding',embeddingRequest(texts),{mode});embeddingMeasurements.push(measureEmbedding(texts,{family:certificateFamily,mode,channel}));return texts.map(text=>{
    const vector=Array(1536).fill(0);vector[mode==='constant'?0:parseInt(hash(text).slice(0,8),16)%1536]=1;return vector;
  });}};
}

export async function certifyRequests({progress=()=>{}}={}) {
  const repo=new URL('../../../',import.meta.url),local=p=>new URL(p,repo);
  const accounting=prepareA4Accounting();assert.equal(accounting.completeLedgerChain,true,'Complete cumulative embedding accounting required');
  useInstalledDependencies({mcp:fileURLToPath(local('adapters/mcp/node_modules')),tokenizer:fileURLToPath(local('adapters/openai/node_modules'))});
  const {ProductAgent}=await import('./product.mjs');
  const encoder=createRequire(local('adapters/openai/package.json'))('tiktoken').get_encoding('o200k_base');
  const counter={id:'tiktoken-o200k_base',countTokens:text=>encoder.encode(text,[],[]).length};
  const root=fileURLToPath(new URL('./artifacts/',import.meta.url));mkdirSync(root,{recursive:true});const temp=mkdtempSync(join(root,'request-certificate-'));
  embeddingMeasurements.length=0;const rows=[],worst={},audit=[],privacyReports=[];let currentPrivacy=null;
  function measure(operation,input,metadata) {
    const body=responseRequest(operation,input,{alternative:metadata.alternative??false});
    const id=metadata.arm?`${metadata.family}/reader/${metadata.arm}/${metadata.batch}`:'certificate';
    currentPrivacy.check(operation==='reader'?'reader-request':'extraction-request',body,{arm:metadata.arm,checkpoint:metadata.batch});
    const reservation=bytes(body)+4096,limit=inputLimit(operation,id);
    const row={...metadata,operation,requestBytes:bytes(body),reservation,limit,margin:limit-reservation,marginPercent:(limit-reservation)/limit*100,
      providerBodyTokens:counter.countTokens(JSON.stringify(body)),sha256:hash(body),pass:reservation*100<=limit*(100-INPUT_MARGIN_PERCENT)};
    if(row.pass)assert.equal(validateRequest({operation,body,id}).input,reservation);
    rows.push(row);if(!worst[operation]||worst[operation].reservation<reservation)worst[operation]={...row,body};return row;
  }
  try {
    for(const cohort of [{split:'pilot',bundles:pilotReferenceBundles()},{split:'engineering-stress',bundles:engineeringStressFixtures()}]) {
      let n=0;
      for(const {family} of cohort.bundles) {
        certificateFamily=family.family_id;const meta={split:cohort.split,family:family.family_id};for(const cp of family.checkpoints)cp.public_contract=projectContract('reader',familyContractContext(family,cp.question));currentPrivacy=new PrivacyGuard(family);certificatePrivacy=currentPrivacy;const aliases=sourceOrderAliases();
        for(const b of family.batches)for(const alternative of [false,true])measure('extraction',extractionInput(family,b.ordinal),{...meta,batch:b.ordinal,alternative});
        // Every pilot P case, plus independent maximal graph/language/time
        // structures: alternative has the largest union, direct expiry adds
        // its distinct supported deadline-trigger graph. Other research arms
        // still cover the full 180-case engineering Cartesian product.
        const productCase=true;
        const product=productCase?await ProductAgent.open({privacy:currentPrivacy,aliases,namespace:family.namespace??{ownerId:'hr3-request-certificate',scope:'personal',projectId:null},embedder:certificateEmbedder('constant','product'),counter,tempRoot:temp}):null;
        const events=[];
        try {
          for(const b of family.batches) {
            const next=referenceEvents(family,b.ordinal);events.push(...next);aliases.register(next);
            const linkedEvents=resolveLinks(events);
            if(product){await product.ingest(next,b.observed_at,{linkedEvents});await product.controls(family.controls??[],b.ordinal);}
            const cp=family.checkpoints.find(c=>c.batch===b.ordinal);if(!cp)continue;
            const query=literalQuery(family.header,family.language),controls=product?.controlSnapshot()??[];
            for(const mode of ['constant','hashed-axis'])for(const arm of ['U','T','O']) {
              const d=await retrieve(materialize(arm,events,cp.at,{linkedEvents}),{query,embedder:certificateEmbedder(mode),counter,controls,aliases});
              const tokens={current:d.diagnostics.current.tokens,history:d.diagnostics.history.tokens};
              assert.ok(Object.values(tokens).every(t=>t<=2000),'Intent delivery budget changed');
              measure('reader',readerInput(cp,d.blocks),{...meta,batch:cp.batch,arm,embedding:mode,deliveryTokens:tokens});
            }
            if(product) {
              const d=await product.retrieve(query),tokens=Object.fromEntries(['current','history'].map(intent=>[intent,counter.countTokens(d.blocks[intent])]));
              // P's maxTokens=2000 remains on the public operation. Count its
              // entire response envelope as well when reserving provider input.
              measure('reader',readerInput(cp,d.blocks),{...meta,batch:cp.batch,arm:'P',embedding:'constant',deliveryTokens:tokens});
            }
          }
        } finally {await product?.close();}
        if(family.family_id==='pilot-scope_change-L06-W1') {
          const cp=family.checkpoints.find(c=>c.batch===4),events=family.batches.flatMap(b=>referenceEvents(family,b.ordinal,{auditIdentity:true})),linkedEvents=resolveLinks(events);
          for(const arm of ['U','T']) {
            const d=await retrieve(materialize(arm,events,cp.at,{linkedEvents}),{query:literalQuery(family.header,family.language),counter,embedder:certificateEmbedder(),aliases:sourceOrderAliases(events)});
            const row=measure('reader',readerInput(cp,d.blocks),{...meta,batch:4,arm,embedding:'constant',regression:'auditor-batch-qualified-reference-ids',deliveryTokens:{current:d.diagnostics.current.tokens,history:d.diagnostics.history.tokens}});
            audit.push(row);
          }
        }
        privacyReports.push({family:family.family_id,...currentPrivacy.report()});
        if(++n%20===0)progress(`${cohort.split}: complete provider requests ${n}/${cohort.bundles.length}`);
      }
    }
    const contextCoverage=await contextConformance({counter});
    assert.ok(contextCoverage.embeddingMeasurements.length>0,'Independent context embeddings must be measured');
    embeddingMeasurements.push(...contextCoverage.embeddingMeasurements);
    const embeddingSummary=summarizeEmbeddings(embeddingMeasurements,accounting.carry.exposure.embedding),cumulative=embeddingSummary.cumulativeProjection;
    const sources=Object.fromEntries(['references-a4.mjs','contract-projection-a4.mjs','prompts-a4.mjs','preflight-a4-schema.mjs','privacy.mjs','reports/private-field-inventory-a6.json','run-configuration.mjs','requests.mjs','schema.mjs','event-identity.mjs','request-certification.mjs','context-certification.mjs','embedding-measurement-a4.mjs','runtime-closure.mjs','public-paths-a4.mjs','accounting-a6.mjs','reports/a6-carry-forward.json','reports/accounting-input-a6.json','research.mjs','product.mjs','cap-certification.mjs','cap-stress-fixtures.mjs'].map(name=>['evaluation/hr3/harness/'+name,hash(readFileSync(new URL(name,import.meta.url)))]));
    for(const spec of accounting.sourceSpecs)sources[spec.path]=spec.sha256;
    sources['evaluation/hr3/protocol/errata.md']=hash(readFileSync(local('evaluation/hr3/protocol/errata.md')));
    return {runtimeClosureSHA256:hash(runtimeClosure().files),contextCoverage,version:'hr3-a6-complete-request-certificate-v1',status:accounting.preparationComplete&&rows.every(r=>r.pass)&&Object.values(cumulative).every(c=>c.withinAllowance)&&privacyReports.every(p=>p.hits===0)?'PASS':'FAIL_INPUT_EMBEDDING_OR_PRIVACY_GATE',minimumMarginPercent:INPUT_MARGIN_PERCENT,inputCaps:INPUT_CAPS,readerInputCaps:READER_INPUT_CAPS,
      method:'Complete provider JSON body UTF-8 bytes + 4096 reservation; real o200k_base tokenizer; unmodified whole-item 2000-token intent delivery budgets. All pilot and all 180 independent engineering references for U/T/O with constant and hashed 1536-dimensional unit-vector fixtures. Actual public-operation P for all 60 pilot families and all 180 independent engineering cases, using constant unit vectors. No held-out generation or network.',
      limits:'Grammar/reference-structure certification, not a bound over unbounded schema spellings or every possible embedding ranking. P public identities and resulting exact token selections can vary between fresh stores; certify the observed bodies and retain their hashes.',
      embeddings:{...embeddingSummary,contextRequests:contextCoverage.embeddingMeasurements.length,contextCasesMeasured:new Set(contextCoverage.embeddingMeasurements.map(m=>m.family)).size,contextMeasurementsIncludedBeforeProjection:true,cumulativeLimits:{research:64000000,product:64000000},enforcement:'validateRequest checks every per-input/request body; ledger cumulatively reserves every retry before dispatch with no reset. Certificate repeated fixture measurements are offline, not billable counters.'},counts:{families:240,requests:rows.length},privacy:{hits:privacyReports.reduce((n,r)=>n+r.hits,0),families:privacyReports},historicalAuditReservations:[{arm:'U',reservation:20855},{arm:'T',reservation:24133}],auditRegressions:audit,worst,rows,sources,paidAuthorization:false};
  } finally {certificatePrivacy=null;certificateFamily=null;encoder.free();rmSync(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const report=await certifyRequests({progress:m=>process.stderr.write(m+'\n')});
  writeFileSync(new URL('./reports/request-certification-a6.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify({status:report.status,counts:report.counts,worst:Object.fromEntries(Object.entries(report.worst).map(([k,{body,...v}])=>[k,v])),auditRegressions:report.auditRegressions})+'\n');
  process.exitCode=report.status==='PASS'?0:1;
}
