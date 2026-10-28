import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { generateSnapshot } from '../generate.mjs';
import { fixtureSpecs,queries,inventory,overflowInventory,compareRefs,refKey } from '../corpus.mjs';
import { prepare,validate,validateProbe } from '../adapter.mjs';
import { createCounter } from '../counter.mjs';
import { validateFilled,segmentEstimates } from '../registration.mjs';
import template from '../registration.engine.template.json' with {type:'json'};
import { storage,prepareInput,validateWorkload,functionalOnly } from '../../../tools/testing/measure-context-read-product.mjs';
import { build } from '../../../tools/testing/fixtures/context-product/series.mjs';
import { attempt,selectReadSet,closedShape } from '../../../tools/testing/fixtures/context-product/engine.mjs';
import { summarize } from '../../../tools/testing/summarize-context-read-product.mjs';
import { methodProfile } from '../../../tools/testing/fixtures/context-product/v4-plan.mjs';
import { createReportSink } from '../../../tools/testing/fixtures/context-product/report.mjs';
const root=new URL('../',import.meta.url),read=name=>JSON.parse(readFileSync(new URL(name,root),'utf8'));
test('three physical layouts deterministically reproduce every canonical row and schema',()=>{
  const directory=mkdtempSync(join(tmpdir(),'qualification-determinism-'));
  try {for(const schema of [18,23,33]) {
    const spec={schema,count:32,cards:schema===18?0:4};
    const a=generateSnapshot(spec,join(directory,`a${schema}.sqlite`)),b=generateSnapshot(spec,join(directory,`b${schema}.sqlite`));
    assert.equal(a.contentHash,b.contentHash);assert.equal(a.schemaHash,b.schemaHash);assert.equal(a.fileHash,b.fileHash);assert.deepEqual(a.catalog,b.catalog);
  }}finally{rmSync(directory,{recursive:true,force:true});}
});
test('six sealed hashes and every labelled identity match actual SQLite inventories',async()=>{
  const manifest=read('manifest.json'),labels=read('labels.json');
  assert.equal(manifest.snapshots.length,6);assert.equal(labels.fixtures.length,6);
  const own=!process.env.QUAL_VERIFY_VOLUME,directory=process.env.QUAL_VERIFY_VOLUME??mkdtempSync(join(tmpdir(),'qualification-manifest-'));
  try {for(const spec of fixtureSpecs){
    const path=join(directory,spec.id+'.sqlite');
    const actual=generateSnapshot({...spec,...(!own?{inspectOnly:true}:{})},path);
    const sealed=manifest.snapshots.find(f=>f.id===spec.id);
    assert.equal(actual.contentHash,sealed.contentHash,spec.id);assert.equal(actual.schemaHash,sealed.schemaHash,spec.id);
    const ledger=(await storage('inspect',{path})).value;
    const f=labels.fixtures.find(f=>f.id===spec.id),all=new Map(f.catalog.map(x=>[refKey(x.ref),x]));
    for(const q of f.queries){
      assert.equal(new Set(q.relevant.map(refKey)).size,q.relevant.length,'ambiguous gold');
      for(const ref of [...q.relevant,...q.ranking,...q.knownMisses]){
        assert.ok(all.has(refKey(ref)));const row=ledger.memory.find(r=>r.id===ref.memoryId)??ledger.cards.find(r=>r.id===ref.cardId);
        assert.ok(row);assert.equal(row.revision,ref.revision);if(ref.type==='card')assert.equal(row.body_revision,ref.bodyRevision);
      }
      if(q.id==='single-han'){assert.equal(q.knownMisses.length,1);assert.equal(all.get(refKey(q.knownMisses[0])).text,'中文');assert.deepEqual(q.ranking,[]);assert.equal(q.recallAt12,0);}
      else {assert.deepEqual(q.ranking,[...q.relevant].sort(compareRefs));assert.equal(q.recallAt5,q.relevant.length?Math.min(5,q.ranking.length)/q.relevant.length:null);assert.equal(q.recallAt12,q.relevant.length?Math.min(12,q.ranking.length)/q.relevant.length:null);}
    }
    assert.deepEqual(selectReadSet(overflowInventory,'sealed').ownerCoverage,{policy:'recent-projects-v1',selectionRevision:'sealed',requestedNamespaces:33,selectedNamespaces:32,omittedNamespaces:1});
  }}finally{if(own)rmSync(directory,{recursive:true,force:true});}
});
test('filled engine template passes both harness validators; two segments cover exactly 728 cells',()=>{
  const input=structuredClone(template);
  Object.assign(input,{productionNode:'v24.22.1',platformRole:'wsl2-ext4',filesystem:'ext4',profileCommit:'a'.repeat(40),protocolCommit:'b'.repeat(40),counterId:'o200k_base-v1',volumeRoot:'/synthetic-run-volume',adapterModule:new URL('../adapter.mjs',import.meta.url).href,counterModule:new URL('../counter.mjs',import.meta.url).href});
  input.host={id:'test-host',cpu:'test-cpu',ramBytes:1024,os:'test-os',owner:'test-owner'};input.volume={id:'test-volume',mount:'/synthetic-run-volume',filesystem:'ext4',production:false};input.reservation.owner='test-owner';
  input.writerProfile.provenance='synthetic functional validation';
  assert.equal(validateFilled(input),input);
  assert.equal(new Set(input.segments.flatMap(s=>s.cellKeys)).size,728);
  const estimates=segmentEstimates(input);assert.deepEqual(estimates.map(s=>s.cells),[364,364]);assert.deepEqual(estimates.map(s=>s.estimateSeconds),[23313.7,23313.7]);
  assert.equal(estimates.reduce((n,s)=>n+s.estimateSeconds,0),46627.4);
  const probes=input.sessions.flatMap(s=>s.targets.map(t=>t.probe));assert.equal(new Set(probes).size,probes.length);
  for(const s of input.sessions)for(const batch of s.batches)assert.deepEqual(batch.query.split(' '),s.targets.filter(t=>t.batch===batch.ordinal).map(t=>t.probe));
});
test('counter wraps the product assembly tokenizer and keeps configured identity',async()=>{
  const c=await createCounter({counterId:'o200k_base-v1',dependencyRoot:process.env.QUAL_COUNTER_ROOT});
  assert.equal(c.id,'o200k_base-v1');assert.equal(c.countTokens('assembly one two three four five six seven eight nine ten eleven twelve thirteen fourteen'),15);
});
const adapter={prepare,validate,validateProbe};
async function world(t,schema) {
  const w=createTestWorkspace(t,{prefix:'qualification-functional-'}),path=join(w.path,'tiny.sqlite');
  generateSnapshot({schema,count:32,cards:schema===18?0:4},path);
  const config={path,...selectReadSet(inventory,'qualification-selection-r1'),types:schema===18?['memory']:['memory','card'],canonical:'DELETE',sidecar:'DELETE',
    readCutoffReport:{thresholdMs:1000,gate:false},functionalOnly:true,deadlines:{openMs:5000,requestMs:5000,readMs:5000},load:'idle',buildCeiling:100,counterModule:new URL('../counter.mjs',import.meta.url).href,counterId:'o200k_base-v1',counterConfiguration:{counterId:'o200k_base-v1',dependencyRoot:process.env.QUAL_COUNTER_ROOT},
    pump:{id:'functional',quantum:{maxItems:1024,maxMs:1000},cronMs:60000,pollMs:1000,renewalMs:60000,budgets:{maxItems:100000,maxMs:60000}},seriesCeilingMs:180000,
    writerProfile:{captureMs:25000,reviewMs:5000,provenance:'synthetic functional only'},ledger:(await storage('inspect',{path})).value};
  await build(config);return {w,config};
}
for(const schema of [18,23,33])test(`tiny physical v${schema} real harness reads all ten profiles, both intents, closed schemas and exact evidence`,async t=>{
  const observations=[];
  const {w,config}=await world(t,schema),sink=await createReportSink(join(w.path,'functional.jsonl'),{mode:'functional-only',timingGates:false,inventory:[]});
  try {
    for(const intent of ['current','history'])for(const label of ['c12','c24','a1500','a4000','f1-full','f1-compact','f1-snapshot','f24-full','f24-compact','f24-snapshot']){
      const cell={id:0,kind:'functional',scope:'launch',schema,count:32,intent,language:'mixed',...methodProfile(label)};
      const c=await prepareInput({...config,method:cell.method,cell},adapter);validateWorkload(c,c.input);
      const r=await attempt(c,{oracle:validate});await sink.record(0,label,r.record);observations.push(r.record);assert.equal(r.record.readExceededAdapterDefault,r.record.readMs>1000);
      assert.equal(r.result?.ok,true,label+':'+JSON.stringify(r.result));assert.equal(r.record.validated,true,label);assert.equal(r.record.bounds,true,label);assert.equal(r.record.expected,true,label);assert.equal(r.record.telemetry,'complete',label);
      assert.equal(validate(r.result,c),true);
      const unknown=structuredClone(r.result);unknown.value.unregistered=true;assert.equal(closedShape(unknown,c.responseSchema),false);
      if(cell.method==='fetchCandidateEvidence'){
        const wrong=structuredClone(r.result);wrong.value.items.reverse();if(cell.refs>1)assert.equal(validate(wrong,c),false);
        const changed=structuredClone(r.result);changed.value.items[0].ref.revision++;assert.equal(validate(changed,c),false);
      }
    }
    for(const queryId of ['zh','ja','single-han','empty']){
      const cell={id:0,kind:'functional',scope:'launch',schema,count:32,intent:'current',language:'zh',queryId,...methodProfile('c12')};
      const c=await prepareInput({...config,cell,method:cell.method},adapter),r=await attempt(c,{oracle:validate});assert.equal(r.record.expected,true,queryId);
    }
  }finally{await sink.finish('inconclusive',{timingGates:false,functionalPassed:true});}
  const reported=await summarize(join(w.path,'functional.jsonl'),()=>{});
  assert.equal(reported.adapterReadCutoffs.length,3);
  for(const group of reported.adapterReadCutoffs){const own=observations.filter(r=>r.method===group.method);assert.equal(group.reads,own.length);assert.equal(group.exceeded1000Ms,own.filter(r=>r.readExceededAdapterDefault).length);assert.equal(group.gate,false);}
});
test('existing functional-only CLI path retains a non-qualification result',async t=>{
  const w=createTestWorkspace(t),report=join(w.path,'functional.jsonl'),r=await functionalOnly(report);
  assert.equal(r.status,'inconclusive');assert.equal(r.functionalPassed,true);assert.equal(existsSync(report+'.partial'),false);
});
