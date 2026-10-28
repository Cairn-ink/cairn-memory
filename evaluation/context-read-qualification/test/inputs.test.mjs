import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {fileURLToPath} from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import {snapshotPlan,verifyFrozenCatalogs} from './snapshot-checks.mjs';
import { generateSnapshot } from '../generate.mjs';
import { fixtureSpecs,queries,inventory,overflowInventory,refKey } from '../corpus.mjs';
import { prepare,validate,validateProbe,selectEvidenceRefs } from '../adapter.mjs';
import { createCounter,counterConfiguration } from '../counter.mjs';
import { validateFilled,segmentEstimates } from '../registration.mjs';
import template from '../registration.engine.template.json' with {type:'json'};
import { storage,prepareInput,validateWorkload,functionalOnly } from '../../../tools/testing/measure-context-read-product.mjs';
import { build } from '../../../tools/testing/fixtures/context-product/series.mjs';
import { attempt,selectReadSet,closedShape } from '../../../tools/testing/fixtures/context-product/engine.mjs';
import { summarize } from '../../../tools/testing/summarize-context-read-product.mjs';
import { methodProfile } from '../../../tools/testing/fixtures/context-product/v4-plan.mjs';
import { createReportSink } from '../../../tools/testing/fixtures/context-product/report.mjs';
const root=new URL('../',import.meta.url),read=name=>JSON.parse(readFileSync(new URL(name,root),'utf8'));
const plan=snapshotPlan(process.env.QUAL_INPUT_MODE);
test('three physical layouts deterministically reproduce every canonical row and schema',()=>{
  const directory=mkdtempSync(join(tmpdir(),'qualification-determinism-'));
  try {for(const schema of [18,23,33]) {
    const spec={schema,count:32,cards:schema===18?0:4};
    const a=generateSnapshot(spec,join(directory,`a${schema}.sqlite`)),b=generateSnapshot(spec,join(directory,`b${schema}.sqlite`));
    assert.equal(a.contentHash,b.contentHash);assert.equal(a.schemaHash,b.schemaHash);assert.equal(a.fileHash,b.fileHash);assert.deepEqual(a.catalog,b.catalog);
  }}finally{rmSync(directory,{recursive:true,force:true});}
});
test('all six manifest entries and all six canonical label/ref catalogs remain checked in both modes',t=>{
  verifyFrozenCatalogs(read('manifest.json'),read('labels.json'));
  t.diagnostic(`${plan.mode} snapshot coverage: rebuild ${plan.selected.map(s=>s.id).join(', ')}; ${plan.skipped.length} layouts skipped by design${plan.skipped.length?': '+plan.skipped.map(s=>s.id).join(', '):''}`);
  assert.deepEqual(selectReadSet(overflowInventory,'sealed').ownerCoverage,{policy:'recent-projects-v1',selectionRevision:'sealed',requestedNamespaces:33,selectedNamespaces:32,omittedNamespaces:1});
});
for(const spec of fixtureSpecs) {
  const selected=plan.selected.some(s=>s.id===spec.id),deterministic=plan.deterministicIds.includes(spec.id);
  test(`${plan.mode} ${spec.id}: rebuilt seal, canonical inventory${deterministic?' and full-layout determinism':''}`,{
    skip:selected?false:'reduced mode: four layouts skipped by design; manifest and label/ref checks still run',
  },async t=>{
    const manifest=read('manifest.json'),labels=read('labels.json'),w=createTestWorkspace(t,{prefix:'qualification-seal-'}),path=join(w.path,spec.id+'.sqlite');
    // Always generate fresh databases. No existing-volume option can bypass a
    // rebuild, including in the explicit full acceptance mode.
    const actual=generateSnapshot(spec,path),sealed=manifest.snapshots.find(f=>f.id===spec.id);
    assert.equal(actual.contentHash,sealed.contentHash,spec.id);assert.equal(actual.schemaHash,sealed.schemaHash,spec.id);
    if(deterministic){
      const repeat=generateSnapshot(spec,join(w.path,'repeat.sqlite'));
      assert.equal(repeat.contentHash,actual.contentHash);assert.equal(repeat.schemaHash,actual.schemaHash);
      assert.equal(repeat.fileHash,actual.fileHash);assert.deepEqual(repeat.catalog,actual.catalog);
    }
    const ledger=(await storage('inspect',{path})).value;
    for(const language of ['zh','ja','mixed'])for(const label of ['f1-full','f1-compact','f24-full','f24-compact','f24-snapshot']){
      const selected=selectReadSet(inventory,'qualification-selection-r1'),cell={language,...methodProfile(label)},refs=selectEvidenceRefs(cell,selected,ledger),items=refs.map(ref=>ledger.evidence.find(i=>refKey(i.ref)===refKey(ref)));
      assert.equal(refs.length,cell.refs);assert.ok(items.some(i=>(i.content?.length===4000||i.body?.length===20000)));
      const snapshot={v:1,scope:'x'.repeat(43),intent:'current',refs:refs.map(r=>[selected.readSet.findIndex(n=>JSON.stringify(n)===JSON.stringify(r.namespace)),r.type,r.memoryId??r.cardId,r.revision,...(r.type==='card'?[r.bodyRevision]:[])]),generations:selected.readSet.map(()=>({memory:Number.MAX_SAFE_INTEGER,card:Number.MAX_SAFE_INTEGER})),access:'x'.repeat(43),fences:refs.map(()=> 'x'.repeat(43))};
      const snapshotLength=Math.ceil(Buffer.byteLength(JSON.stringify(snapshot))*4/3)+44;assert.ok(snapshotLength<=16384);
      assert.ok(Buffer.byteLength(JSON.stringify({ok:true,value:{items,snapshot:'x'.repeat(snapshotLength)}}))<=65536,label+':'+spec.id);
    }
    const f=labels.fixtures.find(f=>f.id===spec.id);
    for(const c of f.catalog){
      const ref=c.ref,row=ref.type==='memory'?ledger.memory.find(r=>r.id===ref.memoryId):ledger.cards.find(r=>r.id===ref.cardId);
      assert.ok(row);assert.equal(row.revision,ref.revision);if(ref.type==='card')assert.equal(row.body_revision,ref.bodyRevision);
      assert.equal(c.text,ref.type==='memory'?row.content:row.title+'\n'+row.body);
    }
  });
}
test('filled engine template passes both harness validators; two segments cover exactly 728 cells',()=>{
  const input=JSON.parse(JSON.stringify(template).replaceAll('${volumeRoot}','/synthetic-run-volume').replaceAll('${packageRoot}',fileURLToPath(root)));
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
const adapter={prepare,validate,validateProbe,selectEvidenceRefs};
async function world(t,schema) {
  const w=createTestWorkspace(t,{prefix:'qualification-functional-'}),path=join(w.path,'tiny.sqlite');
  generateSnapshot({schema,count:32,cards:schema===18?0:4},path);
  const config={path,...selectReadSet(inventory,'qualification-selection-r1'),types:schema===18?['memory']:['memory','card'],canonical:'DELETE',sidecar:'DELETE',
    readCutoffReport:{thresholdMs:1000,gate:false},functionalOnly:true,deadlines:{openMs:5000,requestMs:5000,readMs:5000},load:'idle',buildCeiling:100,counterModule:new URL('../counter.mjs',import.meta.url).href,counterId:'o200k_base-v1',counterConfiguration:counterConfiguration({counterId:'o200k_base-v1'}),
    pump:{id:'functional',quantum:{maxItems:1024,maxMs:5000},cronMs:60000,pollMs:1000,renewalMs:60000,budgets:{maxItems:100000,maxMs:60000}},seriesCeilingMs:180000,
    writerProfile:{captureMs:25000,reviewMs:5000,provenance:'synthetic functional only'},ledger:(await storage('inspect',{path})).value};
  // Functional preparation uses the supported 5-second bound, independently of
  // the frozen production pump quantum. Ordinary tests impose no speed gate.
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
