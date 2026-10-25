#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {hash,atomicJSON} from './common.mjs';
import {decodeExtraction} from './extraction.mjs';
import {readerId} from './privacy.mjs';
import {identifyEvents,freshEvents} from './event-identity.mjs';
import {resolveLinks} from './research.mjs';
import {extractionInput} from './extraction.mjs';
import {extractionDiagnostics} from './extraction-diagnostics.mjs';

export const fixturePath='evaluation/hr3/harness/test/fixtures/pilot-cf24810f.jsonl';
export function cachedPilotBatches() {
  const families=readFileSync(new URL('../generator/artifacts/pilot/families.jsonl',import.meta.url),'utf8').trimEnd().split('\n').map(JSON.parse);
  const byInput=new Map(families.flatMap(f=>f.batches.map(b=>[hash(extractionInput(f,b.ordinal)),{family:f.family_id,batch:b.ordinal}])));
  return readFileSync(new URL('./test/fixtures/pilot-cf24810f.jsonl',import.meta.url),'utf8').trimEnd().split('\n').map(JSON.parse).map(f=>{
    assert.equal(hash(f.body),f.key);
    const input=JSON.parse(f.body.input[1].content),location=byInput.get(hash(input));assert.ok(location,'Cached source input must match frozen pilot');
    const original=JSON.parse(f.reply.outputText),converted=structuredClone(original);
    for(const e of converted.events)for(const q of [...e.source_quotes,...e.reason_edges.flatMap(x=>x.source_quotes)])if(!Object.hasOwn(q,'occurrence'))q.occurrence=1;
    const result=decodeExtraction({...f.reply,outputText:JSON.stringify(converted)},input);
    return {...location,key:f.key,input,original,result};
  });
}
export function identityDiagnostics(rows) {
  const families=[...new Set(rows.map(r=>r.family))].sort(),table=[];
  for(const family of families) {
    let old=[],current=[],oldReselections=0,newReselections=0;
    for(const row of rows.filter(r=>r.family===family).sort((a,b)=>a.batch-b.batch)) {
      const incoming=(row.result.value?.events??[]).map((e,ordinal)=>({...e,batch:row.batch,ordinal}));
      const rawIds=new Set(incoming.map(e=>e.event_id));oldReselections+=resolveLinks([...old,...incoming]).filter(e=>e.batch<row.batch&&e.commitment==='adopted'&&!e.unresolved&&rawIds.has(e.event_id)).length;
      const identified=identifyEvents(family,row.batch,row.result.value?.events??[]),fresh=freshEvents(current,identified),keys=new Set(fresh.map(e=>e.event_id));
      newReselections+=current.filter(e=>e.commitment==='adopted'&&keys.has(e.event_id)).length;
      old.push(...incoming);current.push(...fresh);
    }
    const oldErrors=resolveLinks(old).filter(e=>e.link_errors.includes('duplicate_event_id')),newErrors=resolveLinks(current).filter(e=>e.link_errors.includes('duplicate_event_id'));
    table.push({family,crossBatchCollision:new Set(old.map(e=>e.event_id)).size!==old.length,duplicateIdErrors:oldErrors.length,adoptedDuplicateIdErrors:oldErrors.filter(e=>e.commitment==='adopted').length,
      oldReselections,newDuplicateIdErrors:newErrors.length,newReselections,retainedEvents:current.length});
  }
  const total=k=>table.reduce((n,r)=>n+Number(r[k]),0);
  return {families:families.length,familiesWithCrossBatchCollisions:total('crossBatchCollision'),duplicateIdErrors:total('duplicateIdErrors'),adoptedDuplicateIdErrors:total('adoptedDuplicateIdErrors'),oldReselections:total('oldReselections'),newDuplicateIdErrors:total('newDuplicateIdErrors'),newReselections:total('newReselections'),table};
}
export function replayA3() {
  const bytes=readFileSync(new URL('./test/fixtures/pilot-cf24810f.jsonl',import.meta.url)),rows=cachedPilotBatches();
  assert.equal(rows.length,240);assert.equal(new Set(rows.map(f=>f.key)).size,240);
  function quoteCounts(edgeQuotes) {
    let quotes=0,wrongOffsets=0,verbatimWrongOffsets=0,ambiguousQuotes=0;
    for(const {input,original} of rows) {
      const turns=new Map(input.turns.map(t=>[t.turn_id,t.text]));
      for(const e of original.events)for(const q of edgeQuotes?[...e.source_quotes,...e.reason_edges.flatMap(edge=>edge.source_quotes)]:e.source_quotes) {
        const text=turns.get(q.turn_id);quotes++;
        if(text?.slice(q.start,q.end)!==q.quote){wrongOffsets++;if(text?.includes(q.quote))verbatimWrongOffsets++;}
        if(q.quote&&text?.indexOf(q.quote,text.indexOf(q.quote)+1)>=0)ambiguousQuotes++;
      }
    }
    return {quotes,wrongOffsets,verbatimWrongOffsets,ambiguousQuotes};
  }
  const batches=rows.map(({family,batch,key,result})=>({family,batch,key,error:result.error,diagnostics:{...result.diagnostics,
    identities:(result.value?.events??[]).map(e=>({raw_event_id:e.event_id,internal_key:identifyEvents(family,batch,[e])[0].event_id,reader_id:readerId(identifyEvents(family,batch,[e])[0].event_id)}))}}));
  const diagnostic=extractionDiagnostics(batches),histogram={};
  for(const row of diagnostic.table)histogram[row.batchFailure?'batch_failure':row.validEvents]=(histogram[row.batchFailure?'batch_failure':row.validEvents]??0)+1;
  return {version:'hr3-a3-first-pilot-offline-diagnostic-v2',sourceRun:'pilot-cf24810f',fixture:{path:fixturePath,sha256:hash(bytes),batches:rows.length},
    use:'Diagnostic only; no tuning, adjudication, research accuracy, pooling, or paid rerun.',
    legacyMigration:'Old quotes have no occurrence. Assign occurrence 1 explicitly for this counterfactual replay only; ignore supplied offsets. Live validation requires occurrence. Intended occurrences cannot be recovered.',
    quoteEvidence:quoteCounts(true),eventQuoteEvidence:quoteCounts(false),identityDiagnostics:identityDiagnostics(rows),validEventsPerBatchHistogram:histogram,pipelineStageDiagnostics:diagnostic,batches};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length,2,'No CLI arguments supported');
  const report=replayA3();atomicJSON(new URL('./reports/a3-offline-replay.json',import.meta.url).pathname,report);
  const {table,...identity}=report.identityDiagnostics;
  process.stdout.write(JSON.stringify({eventQuoteEvidence:report.eventQuoteEvidence,identityDiagnostics:identity,quoteEvidence:report.quoteEvidence,histogram:report.validEventsPerBatchHistogram,...report.pipelineStageDiagnostics.totals})+'\n');
}
