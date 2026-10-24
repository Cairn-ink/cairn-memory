#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {hash,atomicJSON} from './common.mjs';
import {decodeExtraction} from './extraction.mjs';
import {extractionDiagnostics} from './extraction-diagnostics.mjs';

export const fixturePath='evaluation/hr3/harness/test/fixtures/pilot-cf24810f.jsonl';
export function replayA3() {
  const bytes=readFileSync(new URL('./test/fixtures/pilot-cf24810f.jsonl',import.meta.url));
  const fixtures=bytes.toString().trimEnd().split('\n').map(JSON.parse);
  assert.equal(fixtures.length,240);assert.equal(new Set(fixtures.map(f=>f.key)).size,240);
  let quotes=0,wrongOffsets=0,verbatimWrongOffsets=0,ambiguousQuotes=0;
  const batches=fixtures.map(({key,body,reply})=>{
    assert.equal(hash(body),key);
    const input=JSON.parse(body.input[1].content),turns=new Map(input.turns.map(t=>[t.turn_id,t.text]));
    let output;
    try {
      output=JSON.parse(reply.outputText);
      for(const e of output.events??[])for(const q of [...e.source_quotes,...e.reason_edges.flatMap(edge=>edge.source_quotes)]) {
        const text=turns.get(q.turn_id);quotes++;
        if(text?.slice(q.start,q.end)!==q.quote){wrongOffsets++;if(text?.includes(q.quote))verbatimWrongOffsets++;}
        if(q.quote&&text?.indexOf(q.quote,text.indexOf(q.quote)+1)>=0)ambiguousQuotes++;
        // Diagnostic migration only: the old provider schema had no occurrence.
        // This cannot recover the author's intended occurrence. Never infer it
        // from the wrong offsets, use gold, normalize, or alter quote strings.
        if(!Object.hasOwn(q,'occurrence'))q.occurrence=1;
      }
    } catch {output=null;}
    const converted={...reply,outputText:output===null?reply.outputText:JSON.stringify(output)};
    const result=decodeExtraction(converted,input);
    const batch=Number(input.turns[0].turn_id.match(/^b(\d+)-/)?.[1]);
    return {family:input.public_header.subject,batch,key,error:result.error,diagnostics:result.diagnostics};
  });
  const diagnostic=extractionDiagnostics(batches),histogram={};
  for(const row of diagnostic.table)histogram[row.batchFailure?'batch_failure':row.validEvents]=(histogram[row.batchFailure?'batch_failure':row.validEvents]??0)+1;
  return {version:'hr3-a3-first-pilot-offline-diagnostic-v1',sourceRun:'pilot-cf24810f',fixture:{path:fixturePath,sha256:hash(bytes),batches:fixtures.length},
    use:'Diagnostic only; no tuning, adjudication, research accuracy, pooling, or paid rerun.',
    legacyMigration:'Old quotes have no occurrence. Assign occurrence 1 explicitly for this counterfactual replay only; ignore supplied offsets. Live validation requires occurrence. Intended occurrences cannot be recovered.',
    quoteEvidence:{quotes,wrongOffsets,verbatimWrongOffsets,ambiguousQuotes},validEventsPerBatchHistogram:histogram,
    pipelineStageDiagnostics:diagnostic,batches};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length,2,'No CLI arguments supported');
  const report=replayA3();atomicJSON(new URL('./reports/a3-offline-replay.json',import.meta.url).pathname,report);
  process.stdout.write(JSON.stringify({quoteEvidence:report.quoteEvidence,histogram:report.validEventsPerBatchHistogram,...report.pipelineStageDiagnostics.totals})+'\n');
}
