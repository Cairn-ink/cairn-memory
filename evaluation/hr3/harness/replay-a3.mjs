#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {hash,atomicJSON} from './common.mjs';
import {decodeExtraction} from './extraction.mjs';
import {sourceOrderAliases} from './privacy.mjs';
import {identifyEvents,freshEvents} from './event-identity.mjs';
import {resolveLinks} from './historical-links-a3.mjs';
import {extractionInput} from './extraction.mjs';
import {extractionDiagnostics} from './extraction-diagnostics.mjs';

export const fixturePath='evaluation/hr3/harness/test/fixtures/pilot-cf24810f.jsonl';
export function cachedPilotBatches() {
  // A-4 never interprets historical graph output under the new slot schema.
  // Reconstruct only the separately frozen A-3 diagnostic's admitted events.
  const saved=JSON.parse(readFileSync(new URL('./reports/a3-offline-replay.json',import.meta.url)));
  const bytes=readFileSync(new URL('./test/fixtures/pilot-cf24810f.jsonl',import.meta.url));
  assert.equal(hash(bytes),saved.fixture.sha256);
  const locations=new Map(saved.batches.map(b=>[b.key,b]));
  return bytes.toString().trimEnd().split('\n').map(JSON.parse).map(f=>{
    assert.equal(hash(f.body),f.key);const loc=locations.get(f.key);assert.ok(loc);
    const input=JSON.parse(f.body.input[1].content),original=JSON.parse(f.reply.outputText),turns=new Map(input.turns.map(t=>[t.turn_id,t.text]));
    const rejected=new Set(loc.diagnostics.rejected.map(r=>r.index));
    const anchor=q=>{const at=turns.get(q.turn_id)?.indexOf(q.quote);assert.ok(at>=0);return {turn_id:q.turn_id,quote:q.quote,occurrence:1,start:at,end:at+q.quote.length};};
    const events=original.events.filter((e,i)=>!rejected.has(i)).map(e=>({...e,source_quotes:e.source_quotes.map(anchor),reason_edges:e.reason_edges.map(edge=>({...edge,source_quotes:edge.source_quotes.map(anchor)}))}));
    assert.equal(events.length,loc.diagnostics.validEvents);
    return {family:loc.family,batch:loc.batch,key:f.key,input,original,result:{value:{events},error:loc.error,diagnostics:loc.diagnostics}};
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
 const saved=JSON.parse(readFileSync(new URL('./reports/a3-offline-replay.json',import.meta.url)));
 const bytes=readFileSync(new URL('./test/fixtures/pilot-cf24810f.jsonl',import.meta.url));assert.equal(hash(bytes),saved.fixture.sha256);
 assert.equal(cachedPilotBatches().length,240);return saved;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length,2,'No CLI arguments supported');
  const report=replayA3();atomicJSON(new URL('./reports/a3-offline-replay.json',import.meta.url).pathname,report);
  const {table,...identity}=report.identityDiagnostics;
  process.stdout.write(JSON.stringify({eventQuoteEvidence:report.eventQuoteEvidence,identityDiagnostics:identity,quoteEvidence:report.quoteEvidence,histogram:report.validEventsPerBatchHistogram,...report.pipelineStageDiagnostics.totals})+'\n');
}
