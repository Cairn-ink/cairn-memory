import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {PUBLIC_CONTRACT,projectContract} from '../contract-projection-a4.mjs';
import {preflightRequest,PREFLIGHT_PROMPT} from '../preflight-a4.mjs';
import {preflightExtractionSchema} from '../preflight-a4-schema.mjs';
import {validate} from '../../scorer/schema.mjs';
import {providerSchema} from '../schema.mjs';
import {checkStrictSchema} from '../strict-schema.mjs';
import {findPrivateLabels} from '../privacy.mjs';
import {canonical,bytes,hash} from '../common.mjs';

const context={public_header:{subject:'lumiu服務',predicate:'派送設定',scope_text:'all'},observed_at:'2031-03-01T02:00:00.000Z',
  turns:[{turn_id:'t1',speaker:'user',text:'lumiu服務 Annex; dispatch 設定; daily cap 每日請求上限 = 4 requests/hour. abababa'}]};
const spellings=row=>[row.canonical,...row['zh-Hant'],...row.en,...row.mixed];

test('projection preserves every relevant name, field and semantic rule without private inputs',()=>{
  const p=projectContract('extraction',context),r=projectContract('reader',context);
  assert.deepEqual(p.slots.map(s=>s.name),['route','approval','cap']);
  assert.equal(p.aliases.subjects.length,2);
  for(const kind of ['subjects','predicates'])for(const projected of p.aliases[kind]) {
    const original=PUBLIC_CONTRACT.aliases[kind].find(x=>x.canonical===projected.canonical);
    assert.deepEqual(new Set([projected.canonical,...projected.aliases]),new Set(spellings(original)));
  }
  for(const slot of p.slots) {
    const original=PUBLIC_CONTRACT.slots.find(s=>s.name===slot.name),field=PUBLIC_CONTRACT.aliases.fields.find(f=>f.canonical===slot.name);
    assert.deepEqual(new Set(slot.aliases),new Set([...original.aliases,...spellings(field)]));
    for(const key of ['type','unit','legacy_field'])assert.equal(slot[key],original[key]);
  }
  for(const key of ['version','languages','scope','updates','examples'])assert.deepEqual(p[key],PUBLIC_CONTRACT[key]);
  for(const [key,value] of Object.entries(PUBLIC_CONTRACT.values))if(!['slot_states','slot_state_rule'].includes(key))assert.deepEqual(p.values[key],value);
  assert.deepEqual(p.citations,{extraction_anchor:PUBLIC_CONTRACT.citations.extraction_anchor});
  assert.equal(p.answer,undefined);assert.equal(p.historical_labels,undefined);
  for(const key of ['answer','historical_labels'])assert.deepEqual(r[key],PUBLIC_CONTRACT[key]);
  const citations=structuredClone(PUBLIC_CONTRACT.citations);delete citations.extraction_anchor;assert.deepEqual(r.citations,citations);
  const values=structuredClone(PUBLIC_CONTRACT.values);delete values.supplied_null;assert.deepEqual(r.values,values);
  assert.ok(r.slots.every(s=>!Object.hasOwn(s,'legacy_field')));
  assert.ok(bytes(p)<bytes(PUBLIC_CONTRACT));
  assert.deepEqual(projectContract('extraction',structuredClone(context)),p);
  assert.throws(()=>projectContract('reader',{...context,delivered:{}}),/shared_public_context/);
  // A-3's inventory predates the public contract. Preserve its fail-closed
  // behavior and expose the necessary A-4 classification review explicitly.
  const hits=findPrivateLabels({public_contract:r});
  assert.deepEqual(hits,[]);
  const injected=structuredClone(r);injected.stage='private';assert.ok(findPrivateLabels({public_contract:injected}).some(h=>h.label==='stage'));
});

test('prospective strict wire schema has slot/context branches and no extracted masks or graphs',()=>{
  assert.ok(checkStrictSchema(providerSchema(preflightExtractionSchema)).nodes>0);
  const schemaText=canonical(preflightExtractionSchema);
  for(const forbidden of ['field_mask','reason_nodes','reason_edges','Claim'])assert.ok(!schemaText.includes(forbidden));
  const event={event_id:'e1',source_turns:['t1'],observed_at:context.observed_at,kind:'decision',commitment:'adopted',change_type:'initial',
    subject:'lumiu service',predicate:'dispatch configuration',payload:{type:'slots',route:null,approval:null,cap:null},
    scope:{any:[{all:[]}]},effective_interval:{from:null,to:null},predecessor_anchors:[],replacement_extent:'entire_predecessor',
    reason_quotes:[],source_quotes:[{turn_id:'t1',quote:'abababa',occurrence:1}]};
  const check=e=>validate(preflightExtractionSchema,{events:[e]});
  // The schema must leave well-shaped domain mistakes to assignment admission.
  event.payload.route={value:{type:'Quantity',decimal:'4',unit:'requests/hour'},anchors:event.source_quotes};
  assert.deepEqual(check(event),[]);
  const malformed=structuredClone(event);delete malformed.payload.route.value.decimal;assert.ok(check(malformed).length);
  const legacy=structuredClone(event);legacy.field_mask=['value'];assert.ok(check(legacy).length);
  event.kind='context';event.commitment='unresolved';event.payload={type:'context',text:'abababa',anchors:event.source_quotes};
  assert.deepEqual(check(event),[]);
});

test('both complete prospective requests preserve input exactly and expose only public contract data',()=>{
  for(const alternative of [false,true]) {
    const body=preflightRequest(context,{alternative});
    const {public_contract,...input}=JSON.parse(body.input[1].content);
    assert.deepEqual(input,context);assert.deepEqual(public_contract,projectContract('extraction',context));
    assert.equal(body.input[0].content,PREFLIGHT_PROMPT);assert.equal(body.max_output_tokens,4352);
    assert.equal(body.store,false);
    const hits=findPrivateLabels(body);
    assert.deepEqual(hits,[]);
    assert.equal(bytes(body),Buffer.byteLength(JSON.stringify(body)));
  }
});

test('saved failure certificate independently reproduces sizes, hashes, thresholds and unchanged carry bytes',()=>{
  const report=JSON.parse(readFileSync(new URL('../reports/preflight-a4.json',import.meta.url)));
  assert.equal(report.status,'STOP_NUMERICAL_AMENDMENT_REQUIRED');
  assert.equal(report.counts.requests,1920);assert.equal(report.counts.failures,1920);
  assert.equal(report.maximumReservationWithHeadroom,Math.floor(16384*0.95));
  for(const row of report.rows) {
    assert.equal(row.reservation,row.requestBytes+4096);
    assert.equal(row.pass,row.reservation*100<=row.limit*95);
  }
  for(const row of Object.values(report.worst)) {
    assert.equal(row.requestBytes,Buffer.byteLength(JSON.stringify(row.body)));
    assert.equal(row.sha256,hash(row.body));
    assert.equal(row.contractBytes,bytes(JSON.parse(row.body.input[1].content).public_contract));
    assert.equal(row.schemaBytes,bytes(row.body.text.format.schema));
  }
  for(const path of ['evaluation/hr3/harness/reports/a3-carry-forward.json','evaluation/hr3/generator/public-contract.json','evaluation/hr3/generator/freeze.json'])assert.equal(hash(readFileSync(path)),report.sources[path],path);
});
