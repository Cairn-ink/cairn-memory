#!/usr/bin/env node
import {projectContract,familyContractContext} from './contract-projection-a4.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PrivacyGuard,PRIVATE_FIELD_INVENTORY} from './privacy.mjs';
import {verifiedInputs} from './inputs.mjs';
import {runtimeClosure} from './runtime-closure.mjs';
import {extractionInput} from './extraction.mjs';
import {responseRequest} from './requests.mjs';
import {canonical,hash} from './common.mjs';

export function scanRunPrivacy(stageDirectory,inputs,{allowPartial=false}={}) {
  const read=name=>readFileSync(join(stageDirectory,name)),json=name=>JSON.parse(read(name));
  const manifestBytes=read('manifest.json'),manifest=JSON.parse(manifestBytes);
  for(const [name,entry] of Object.entries(manifest.files)) {
    assert.ok(!name.startsWith('/')&&!name.split('/').includes('..'));
    const bytes=read(name);assert.equal(hash(bytes),entry.sha256);assert.equal(bytes.length,entry.bytes);
  }
  const run=json('run.json'),summary=json('summary.json');if(!allowPartial)assert.equal(summary.complete,true);assert.equal(run.stage,'pilot');
  const {families}=verifiedInputs(inputs);assert.equal(families.length,60);
  assert.deepEqual(run.families,families.map(f=>f.family_id));
  const readers=[],extractors=[],product=[],failures=[];
  const savedExtractions=Object.keys(manifest.files).filter(p=>p.startsWith('extractions/')).map(p=>json(p));
  for(const f of families) {
    const statePath='states/'+f.family_id+'-P-final.json';if(allowPartial&&!existsSync(join(stageDirectory,statePath)))continue;
    const guard=new PrivacyGuard(f),state=json(statePath);
    for(const batch of f.batches){const expected=responseRequest('extraction',extractionInput(f,batch.ordinal)),saved=savedExtractions.find(e=>canonical(e.body)===canonical(expected));
      if(!saved){if(!allowPartial)assert.fail('Missing extraction request');continue;}
      try{guard.check('extraction-request',saved.body,{batch:batch.ordinal});}catch(e){failures.push(e.message);}
    }
    for(const op of state.operations.filter(o=>['core','mcp','constructor'].includes(o.surface))) {
      assert.ok(op.input,'Every P public-operation payload must be recorded, including refresh');
      try {guard.check('product-payload',op.input,{surface:op.surface,method:op.method});}catch(e){failures.push(e.message);}
    }
    const returned=state.operations.filter(o=>o.surface==='mcp'&&o.method==='read_memory_context');
    if(summary.complete)assert.equal(returned.length,4,'Both intents must be independently returned at each checkpoint');else assert.ok(returned.length<=4&&returned.length%2===0);
    for(const [index,cp] of f.checkpoints.entries())for(const arm of ['U','T','O','P']) {
      const name=f.family_id+'-'+arm+'-'+cp.batch;
      if(allowPartial&&!existsSync(join(stageDirectory,'answers/'+name+'.json')))continue;
      const saved=json('answers/'+name+'.json'),delivery=json('deliveries/'+name+'.json');
      const expected=responseRequest('reader',{public_contract:projectContract('reader',familyContractContext(f,cp.question)),question:cp.question,checkpoint:cp.batch,focal_turn:cp.focal_turn,requested_predecessor_turns:cp.requested_predecessor_turns,delivered:delivery.blocks});
      assert.equal(canonical(saved.body),canonical(expected),'Scan the exact request, including complete evidence and schema');
      if(arm==='P')for(const [i,intent] of ['current','history'].entries()) {
        const raw=returned[index*2+i].result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
        assert.equal(delivery.blocks[intent],raw,'P context must reach the reader unchanged');
      }
      try {guard.check('reader-request',saved.body,{arm,checkpoint:cp.batch});}catch(e){failures.push(e.message);}
    }
    extractors.push(...guard.scans.filter(s=>s.kind==='extraction-request').map(s=>({family:f.family_id,...s})));
    readers.push(...guard.scans.filter(s=>s.kind==='reader-request').map(s=>({family:f.family_id,...s})));
    product.push(...guard.scans.filter(s=>s.kind==='product-payload').map(s=>({family:f.family_id,...s})));
  }
  const inline=json('privacy-scan.json'),embeddingScans=inline.families.flatMap(f=>f.records.filter(s=>s.kind.endsWith('-embedding')).map(s=>({family:f.family,...s})));
  const embeddingReservations=read('ledger.jsonl').toString().trim().split('\n').map(JSON.parse).filter(e=>e.type==='reserve'&&e.operation.endsWith('embedding'));
  for(const e of embeddingReservations)assert.ok(embeddingScans.some(s=>s.kind===e.operation&&e.id.startsWith(s.family+'/')&&s.sha256===e.bodyHash&&s.hits.length===0),'Exact outgoing embedding body must have a matching pre-dispatch privacy scan');
  const hits=rows=>rows.reduce((n,r)=>n+r.hits.length,0);
  const byArm=Object.fromEntries(['U','T','O','P'].map(arm=>[arm,{requests:readers.filter(r=>r.arm===arm).length,hits:hits(readers.filter(r=>r.arm===arm))}]));
  for(const row of Object.values(byArm))if(summary.complete)assert.equal(row.requests,120);else assert.ok(row.requests<=120);
  const sources=Object.fromEntries(['privacy.mjs','reports/private-field-inventory-a6.json','leak-scan.mjs','research.mjs','product.mjs','runner.mjs','transport.mjs','trivia-authority-a6.mjs'].map(n=>['evaluation/hr3/harness/'+n,hash(readFileSync(new URL(n,import.meta.url)))]));
  return {runtimeClosureSHA256:hash(runtimeClosure().files),version:'hr3-exact-model-privacy-scan-a6-v1',status:failures.length?'FAIL_PRIVACY':summary.complete?'PASS':'PASS_OBSERVED_PARTIAL_ONLY',completePilot:summary.complete,completedStageManifestSHA256:hash(manifestBytes),
    extractionRequests:{planned:240,total:extractors.length,missing:240-extractors.length,hits:hits(extractors)},readerRequests:{planned:480,missing:480-readers.length,total:readers.length,hits:hits(readers),byArm},productPayloads:{total:product.length,hits:hits(product)},
    embeddingRequests:{logicalScans:embeddingScans.length,reservations:embeddingReservations.length,hits:hits(embeddingScans),exactOutgoingBodyHashesVerified:true},inventory:{sha256:hash(PRIVATE_FIELD_INVENTORY),fields:PRIVATE_FIELD_INVENTORY.fields.length,variants:new Set(PRIVATE_FIELD_INVENTORY.fields.flatMap(f=>f.variants)).size},pReturnedContextUnchanged:true,armBlinding:{identicalSystemPrompt:true,sharedPublicContractAndQuestion:true,checkedReaderBodies:readers.length},goldLeakage:{privateRegistryAndAuthenticationInventory:true,checkedCompleteExtractionBodies:extractors.length,privateMetadataHits:hits(extractors)+hits(readers)+hits(product)},extractors,readers,product,sources};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [stageDirectory,inputs,mode]=process.argv.slice(2);assert.ok(stageDirectory&&inputs&&(!mode||mode==='--partial')&&process.argv.length===(mode?5:4));
  const report=scanRunPrivacy(stageDirectory,inputs,{allowPartial:mode==='--partial'});
  writeFileSync(new URL('./reports/privacy-scan-a6.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify({status:report.status,readerRequests:report.readerRequests,productPayloads:report.productPayloads,pReturnedContextUnchanged:report.pReturnedContextUnchanged})+'\n');
  process.exitCode=report.status==='PASS'?0:1;
}
