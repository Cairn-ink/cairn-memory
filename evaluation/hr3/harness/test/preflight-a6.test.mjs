import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CONTRACT_A6,literalProjectionA6,projectContractA6,expandWorkedExamplesA6} from '../contract-projection-a6.mjs';
import {preflightExtractionSchemaA6} from '../preflight-a6-schema.mjs';
import {requestA6} from '../preflight-a6.mjs';
import {providerSchema} from '../schema.mjs';
import {validate} from '../../scorer/schema.mjs';
import {checkStrictSchema} from '../strict-schema.mjs';
import {canonical,hash,bytes} from '../common.mjs';
import {accountingA6,A6_CARRY} from '../accounting-a6.mjs';
import {auditLedger,loadCarryForward} from '../accounting.mjs';
const context={public_header:{subject:'lumiu服務',predicate:'派送設定'},observed_at:'2034-07-09T02:00:00.000Z',turns:[{turn_id:'current-only',text:'Correct record oldName; adopt record newName with route exact_1. 原因：容量不足。'}]};
test('A6 projection: all operation-relevant rules and worked examples round-trip exactly, including explicit nulls',()=>{
  for(const operation of ['extraction','reader']) {
    const literal=literalProjectionA6(operation,context),projected=projectContractA6(operation,context);
    assert.deepEqual(expandWorkedExamplesA6(projected.worked_examples),literal.worked_examples);
    const {worked_examples,...rest}=projected;assert.deepEqual(rest,Object.fromEntries(Object.entries(literal).filter(([k])=>k!=='worked_examples')));
    assert.ok(bytes(projected)<bytes(literal));assert.deepEqual(projected,projectContractA6(operation,JSON.parse(JSON.stringify(context))));
    projected.slots[0].name='tampered';assert.equal(projectContractA6(operation,context).slots[0].name,'route');
  }
  const p=projectContractA6('extraction',context),examples=expandWorkedExamplesA6(p.worked_examples);
  assert.equal(examples.extraction.length,12);assert.deepEqual(examples.extraction,CONTRACT_A6.worked_examples.extraction);
  assert.deepEqual(p.extraction,CONTRACT_A6.extraction);assert.deepEqual(p.name_tokens,CONTRACT_A6.name_tokens);
  for(const x of examples.extraction)for(const b of x.batches??[x])for(const e of b.expected)assert.deepEqual(validate(preflightExtractionSchemaA6,{events:[e]}),[]);
});
test('A6 projection: relevant aliases and every slot survive bilingual/mixed public context without arm dependence',()=>{
  for(const name of ['lumiu service','lumiu服務','lumiu service 服務']) {
    const p=projectContractA6('extraction',{...context,public_header:{subject:name,predicate:'dispatch 設定'}});
    assert.deepEqual(p.slots.map(s=>s.name),['route','approval','cap']);assert.ok(p.aliases.subjects.some(s=>s.canonical==='lumiu service'));
    for(const row of [...p.aliases.subjects,...p.aliases.predicates]) {
      const original=[...CONTRACT_A6.aliases.subjects,...CONTRACT_A6.aliases.predicates].find(r=>r.canonical===row.canonical);
      assert.deepEqual(new Set([row.canonical,...row.aliases]),new Set([original.canonical,...original['zh-Hant'],...original.en,...original.mixed]));
    }
  }
  assert.throws(()=>projectContractA6('reader',{...context,delivered:{current:'anything'}}),/shared_public_context/);
  const reader=projectContractA6('reader',context);
  for(const arm of ['T','U','O','P'])assert.deepEqual(projectContractA6('reader',context),reader,arm);
});
test('A6 projection: inheritance and addressing examples remain independent bilingual full pairs',()=>{
  const p=projectContractA6('reader',context),w=expandWorkedExamplesA6(p.worked_examples);
  for(const k of ['citation_address','inheritance_pairs','slot_recovery','causal_selection'])assert.deepEqual(w[k],CONTRACT_A6.worked_examples[k]);
  assert.deepEqual(w.inheritance_pairs.map(x=>x.language),['en','zh-Hant']);
  for(const pair of w.inheritance_pairs){assert.equal(pair.variants.length,2);assert.deepEqual(pair.variants[0].supplied_slots,pair.variants[1].supplied_slots);assert.equal(pair.variants[0].supplied_slots.route,null);assert.equal(pair.variants[0].supplied_slots.approval,null);}
});
test('A6 schema: own/current-reference anchors replace old wire without restricting event-domain enums',()=>{
  const schema=providerSchema(preflightExtractionSchemaA6);assert.ok(checkStrictSchema(schema).nodes>0);
  const e=structuredClone(CONTRACT_A6.worked_examples.extraction[0].batches[1].expected[0]);
  assert.equal(e.record_name.name,'demoNeso');assert.equal(e.predecessor_refs[0].record_name,'demoLira');
  assert.equal(e.record_name.anchor.turn_id,'demo-decision');assert.equal(e.predecessor_refs[0].anchor.turn_id,'demo-decision');
  assert.deepEqual(validate(schema,{events:[e]}),[]);
  const old=structuredClone(e);delete old.record_name;delete old.predecessor_refs;old.predecessor_anchors=[];assert.ok(validate(schema,{events:[old]}).length);
  const missing=structuredClone(e);delete missing.predecessor_refs[0].anchor;assert.ok(validate(schema,{events:[missing]}).length);
  e.commitment='correction';assert.deepEqual(validate(schema,{events:[e]}),[],'Well-shaped domain errors must still reach event admission');
});
test('A6 request: exact evidence survives both complete provider envelopes; model settings and all limits remain frozen',()=>{
  for(const alternative of [false,true]) {
    const body=requestA6('extraction',context,{alternative}),{public_contract,...delivered}=JSON.parse(body.input[1].content);
    assert.deepEqual(delivered,context);assert.deepEqual(public_contract,projectContractA6('extraction',context));
    assert.equal(body.max_output_tokens,4352);assert.equal(body.store,false);assert.equal(body.text.format.strict,true);
    if(alternative){assert.deepEqual(body.reasoning,{effort:'none'});assert.equal(body.temperature,undefined);}else{assert.equal(body.temperature,0);assert.equal(body.reasoning,undefined);}
    assert.ok(!canonical(public_contract).includes('private_registry'));
  }
});
test('A6 feasibility: saved bodies independently reproduce the failing exact-byte 5% gate and source bindings',()=>{
  const r=JSON.parse(readFileSync(new URL('../reports/preflight-a6.json',import.meta.url)));
  assert.equal(r.status,'STOP_NUMERICAL_AMENDMENT_REQUIRED');assert.equal(r.paidAuthorization,false);
  assert.deepEqual(r.inputCaps,{reader:40960,extraction:20480});assert.deepEqual(r.outputCaps,{reader:2176,extraction:4352});
  assert.equal(r.counts.requests,1920);assert.equal(r.rows.length,1920);assert.equal(r.counts.failures,1920);
  for(const row of r.rows){assert.equal(row.requestBytes+4096,row.reservation);assert.equal(row.limit,20480);assert.equal(row.maximumWithHeadroom,19456);assert.equal(row.pass,row.reservation*100<=row.limit*95);}
  for(const row of Object.values(r.worst)){assert.equal(bytes(row.body),row.requestBytes);assert.equal(hash(row.body),row.sha256);assert.equal(bytes(JSON.parse(row.body.input[1].content).public_contract),row.contractBytes);}
  assert.ok(Object.entries(r.sources).some(([path,digest])=>hash(readFileSync(path))!==digest),'Historical first-stop evidence is not an A-6 runtime certificate');
  assert.equal(r.minimumCeilingForMeasuredWorstAtFivePercent,Math.ceil(Math.max(...r.rows.map(x=>x.reservation))*100/95));
  assert.equal(r.readerOverhead.length,480);assert.ok(r.readerOverhead.every(x=>x.emptyDeliveryLowerBound));
});
test('A6 factoring: cyclic and absent exact references cannot silently discard or fabricate examples',()=>{
  for(const packed of [{notation:'test',definitions:[{'@':0}],document:{'@':0}},{notation:'test',definitions:[],document:{'@':0}}])assert.throws(()=>expandWorkedExamplesA6(packed),/invalid_example_reference/);
});
test('A6 accounting: all four ledgers verify exactly once with outstanding charges and unchanged ancestor retained',()=>{
  const r=accountingA6(),input=JSON.parse(readFileSync(new URL('../reports/accounting-input-a6.json',import.meta.url)));
  const independent=auditLedger(readFileSync(input.fourthPilotLedger.path,'utf8'));
  assert.equal(r.completeLedgerChain,true);assert.equal(r.carry.exposure.total,4145077720);assert.equal(r.carry.exposure.settled,4110354120);assert.equal(r.carry.exposure.outstanding,34723600);
  assert.equal(r.carry.exposure.total,independent.exposure.total);assert.deepEqual(r.carry.exposure.embedding,{product:436859,research:1799591});
  assert.equal(r.priorExposureNanodollars,2136861040);assert.equal(r.additionalExposureNanodollars,2008216680);
  assert.equal(r.planning.cumulativeBoundNanodollars,42487733720);assert.ok(r.planning.cumulativeBoundNanodollars<=50e9);
  assert.equal(input.preparation.suppliedBy,'primary');assert.equal(input.preparation.testOnly,false);assert.equal(loadCarryForward(A6_CARRY).preparationComplete,true,'Primary-supplied preparation completeness is verified, never authored by this script');
  for(const s of r.sourceSpecs)assert.equal(hash(readFileSync(s.path)),s.sha256);
});
