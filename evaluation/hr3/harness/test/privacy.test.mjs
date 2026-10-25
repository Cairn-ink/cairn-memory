import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {PrivacyGuard,findPrivateLabels,neutralControl,namespaceAliases,sourceOrderAliases,PRIVATE_FIELD_INVENTORY} from '../privacy.mjs';
import {eventKey,identifyEvents} from '../event-identity.mjs';
import {materialize,serializeRecord} from '../research.mjs';
import {cardControl,safetyControl} from '../../generator/controls.mjs';
import {loadCarryForward} from '../accounting.mjs';
import {hash} from '../common.mjs';
import {responseRequest} from '../requests.mjs';
import {derivePrivateFieldInventory} from '../private-field-inventory.mjs';
import {inventory} from '../../generator/inventory.mjs';
import {cachedPilotBatches} from '../replay-a3.mjs';
import {event,date} from './fixtures.mjs';

const family={family_id:'pilot-scope_change-L06-W1',lineage_id:'pilot-scope_change-L06',split:'pilot',causal_class:'alternative_mediated',change_type:'scope_change',seed:'hr3-worlds-v1',namespace:{ownerId:'hr3-pilot-scope_change-L06-W1',scope:'personal',projectId:null}};

test('reader IDs and every record/graph reference use source order while semantic content is preserved',()=>{
  const events=identifyEvents(family.family_id,1,[event(1)]),first=events[0],second=identifyEvents(family.family_id,2,[event(2,{reason_nodes:[{id:family.family_id,claim:{subject:'public subject'}}],reason_edges:[{from:family.family_id,to:family.family_id,source_quotes:[]}]})])[0];
  const aliases=sourceOrderAliases([first,second]),state=materialize('T',[first,second],date(2)),wire=serializeRecord(state.current[0],aliases),body=JSON.parse(wire.body);
  assert.equal(body.record,'r2');assert.deepEqual(body.predecessors,['r1']);
  assert.equal(body.reason_nodes,undefined);assert.equal(body.reason_edges,undefined);
  assert.deepEqual(body.slots,{route:'2'});assert.deepEqual(body.scope,state.current[0].scope);assert.equal(body.change_type,'reversal');
  assert.deepEqual(findPrivateLabels(wire.body,[family.family_id,family.lineage_id]),[]);
  assert.equal(second.event_id,eventKey(family.family_id,2,'e2'),'Global key stays available in diagnostics/state');
});

test('all control branches author neutral content/action IDs/namespaces before ingestion',()=>{
  for(const path of ['declare_separately','confirm_with_dependencies'])for(let branch=0;branch<8;branch++) {
    const raw=cardControl(family,branch,path),copy=structuredClone(raw),aliases=namespaceAliases(family.namespace),control=aliases.payload(neutralControl(raw));
    const guard=new PrivacyGuard(family);
    for(const action of control.actions)guard.check('product-payload',action.payload);
    assert.equal(guard.report().hits,0);assert.deepEqual(raw,copy);
    assert.equal(control.actions.find(a=>a.call==='createCardDraft').payload.input.title,'Independent invoice procedure');
    assert.equal(control.actions.filter(a=>a.call==='adoptMethodVersion').length,raw.actions.filter(a=>a.call==='adoptMethodVersion').length);
  }
  const aliases=namespaceAliases(family.namespace),control=aliases.payload(neutralControl(safetyControl(family)));
  assert.ok(findPrivateLabels(control.actions,[family.family_id,family.lineage_id]).length,'Control wrappers retain private batch/call/expected selectors and must never be projected.');
  for(const action of control.actions.filter(a=>a.content))assert.deepEqual(findPrivateLabels({namespace:action.namespace,memory:{content:action.content}},[family.family_id,family.lineage_id]),[]);
  assert.equal(control.actions[0].content,control.actions.at(-1).content,'Replay keeps the exact named forgotten content');
  assert.notEqual(control.actions[0].namespace.ownerId,control.actions[2].namespace.ownerId);
});

test('exact reader requests for every arm and P payloads fail closed on private label injection',()=>{
  const variants=[family.family_id,family.lineage_id,'engineering-cap-expiry-direct-en-B0','scope_change-L06-W1','alternative_mediated',family.seed];
  for(const arm of ['U','T','O','P'])for(const label of variants) {
    const g=new PrivacyGuard(family),body=responseRequest('reader',{delivered:{current:label,history:''}});
    assert.throws(()=>g.check('reader-request',body,{arm}),/private_label_leak/);
    assert.equal(g.report().hits>0,true);
  }
  for(const label of variants)assert.throws(()=>new PrivacyGuard(family).check('product-payload',{namespace:{ownerId:'owner-1',scope:'personal',projectId:null},memory:{content:label}}),/private_label_leak/);
  assert.throws(()=>new PrivacyGuard(family).check('reader-request',responseRequest('reader',{delivered:{current:'\\u0070ilot-scope_change-L06-W1',history:''}})),/private_label_leak/);
  assert.doesNotThrow(()=>new PrivacyGuard(family).check('reader-request',responseRequest('reader',{delivered:{current:'{"change_type":"correction","subject":"public service"}',history:'The explicitly stated deadline passed.'}})),'Public source-supported semantics are not author-assigned condition identifiers');
});

test('preparation inventory contains all four accepted probes, free and rejected dispatches, and both holds',()=>{
  const c=loadCarryForward('evaluation/hr3/harness/reports/a3-carry-forward.json');
  assert.equal(c.preparationComplete,true);assert.ok(c.preparationAttestation);
  assert.equal(c.preparationDispatches.reduce((n,d)=>n+d.requests,0),11);
  const probes=c.preparationDispatches.filter(d=>d.kind==='schema_probe');
  assert.deepEqual(probes.map(d=>[d.usage.inputTokens,d.usage.outputTokens,d.max_output_tokens]),[[946,5,16],[751,16,16],[934,5,16],[751,16,16]]);
  assert.equal(probes.reduce((n,d)=>n+d.settledNanodollars,0),1420000);
  assert.equal(c.preparationDispatches.find(d=>d.kind==='models_check').requests,3);
  assert.equal(c.preparationDispatches.find(d=>d.kind==='schema_rejection').settledNanodollars,0);
  assert.equal(c.exposure.settled,835244260+712400+707600);assert.equal(c.exposure.outstanding,11667200+11909200+2000000);
});

test('preparation usage arithmetic is verified even when file hashes are recomputed',t=>{
  mkdirSync('evaluation/hr3/harness/artifacts',{recursive:true});const dir=mkdtempSync('evaluation/hr3/harness/artifacts/prep-test-');t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const m=JSON.parse(readFileSync('evaluation/hr3/harness/reports/a3-carry-forward.json'));
  const source=m.preparation.receipts[0],receipt=JSON.parse(readFileSync(source.path));receipt.dispatches[0].usage.inputTokens++;
  const path=join(dir,'receipt.json');writeFileSync(path,JSON.stringify(receipt)+'\n');m.preparation.receipts[0]={path,sha256:hash(readFileSync(path))};
  const input=join(dir,'input.json');writeFileSync(input,JSON.stringify(m)+'\n');
  assert.throws(()=>loadCarryForward(input),/schema_probe_arithmetic/);
});

test('complete request certificate scans every arm and P ingestion without private labels',()=>{
  const r=JSON.parse(readFileSync(new URL('../reports/request-certification-a4.json',import.meta.url)));
  assert.ok(['PASS','FAIL_INPUT_MARGIN'].includes(r.status));assert.equal(r.privacy.hits,0);
  const scans=r.privacy.families.flatMap(f=>f.records);
  for(const arm of ['U','T','O','P'])assert.ok(scans.some(s=>s.kind==='reader-request'&&s.arm===arm));
  assert.ok(scans.some(s=>s.kind==='product-payload'));
});


test('detector reproduces the audited leak counts on preserved pre-isolation request bodies',()=>{
 const r=JSON.parse(readFileSync(new URL('../reports/privacy-baseline-a3.json',import.meta.url)));
 for(const arm of ['U','T','O'])assert.deepEqual(r.byArm[arm],{requests:120,requestsWithLeaks:120});
 assert.deepEqual(r.byArm.P,{requests:120,requestsWithLeaks:90});
});


test('engineering reference questions are authored without private fixture labels',async()=>{
 const {engineeringStressFixtures}=await import('../cap-stress-fixtures.mjs');
 for(const {family} of engineeringStressFixtures())for(const cp of family.checkpoints)assert.deepEqual(findPrivateLabels(cp.question),[]);
 assert.deepEqual(findPrivateLabels('At the engineering stage, test the pilot arm after expiry.'),[]);
});


test('full private-ID dictionary attack cannot recover source-order aliases',()=>{
  const rows=cachedPilotBatches(),allFamilies=inventory().lineages.flatMap(l=>l.members.map(m=>m.family_id));
  const rawIds=[...new Set(rows.flatMap(r=>(r.result.value?.events??[]).map(e=>e.event_id)))];
  const dictionary=new Map();let candidates=0;
  for(const family of allFamilies)for(let batch=1;batch<=4;batch++)for(const raw of rawIds){const key=eventKey(family,batch,raw);dictionary.set('r'+hash(key).slice(0,32),key);candidates++;}
  let oldRecoveries=0,newRecoveries=0,events=0;
  for(const family of new Set(rows.map(r=>r.family))) {
    const mapping=sourceOrderAliases();
    for(const row of rows.filter(r=>r.family===family).sort((a,b)=>a.batch-b.batch)) {
      const incoming=identifyEvents(family,row.batch,row.result.value?.events??[]);mapping.register(incoming);
      for(const e of incoming){events++;oldRecoveries+=Number(dictionary.has('r'+hash(e.event_id).slice(0,32)));newRecoveries+=Number(dictionary.has(mapping.id(e.event_id)));}
    }
  }
  assert.equal(events,605);assert.equal(oldRecoveries,605);assert.equal(newRecoveries,0);
  // A stronger invariance check: every possible private label assigned the same
  // source position yields the same alias, so enumeration gives no unique match.
  const aliases=new Set(allFamilies.map(f=>sourceOrderAliases(identifyEvents(f,1,[event(1)])).id(eventKey(f,1,'e1'))));
  assert.deepEqual([...aliases],['r1']);assert.equal(allFamilies.length,1890);
  process.stdout.write(JSON.stringify({aliasAttack:{families:allFamilies.length,rawIds:rawIds.length,candidates,events,oldRecoveries,newRecoveries,possibleFamiliesPerFirstAlias:allFamilies.length}})+'\n');
});

test('source-order mapping stays identical across private-label renaming, arms, checkpoints and references',()=>{
  const raw=[event(1),event(2),event(3)],a=sourceOrderAliases(),b=sourceOrderAliases();
  const events=raw.map((e,i)=>identifyEvents('private-A',i+1,[e])[0]);
  const renamed=raw.map((e,i)=>identifyEvents('private-B',i+1,[{...e,event_id:'completely-different-'+i}])[0]);
  for(let i=0;i<events.length;i++) {
    a.register([events[i]]);b.register([renamed[i]]);
    for(const arm of ['U','T','O']) {
      const first=materialize(arm,events.slice(0,i+1),date(i+1)),second=materialize(arm,renamed.slice(0,i+1),date(i+1));
      assert.deepEqual([...first.current,...first.history].map(r=>serializeRecord(r,a)),[...second.current,...second.history].map(r=>serializeRecord(r,b)));
    }
    for(let j=0;j<=i;j++)assert.equal(a.id(events[j].event_id),'r'+(j+1));
  }
  a.register(events);assert.equal(a.diagnostics().length,3,'Repeated registration cannot change aliases');
  assert.throws(()=>a.id('unknown'),/unregistered_reader_identity/);
});

test('frozen inventory matches authoring metadata and run routing; every variant rejects in every arm and P including nested JSON',()=>{
  assert.deepEqual(PRIVATE_FIELD_INVENTORY,derivePrivateFieldInventory());
  for(const name of ['stage','arm','multi_hop','multiHop','expiry_mode'])assert.ok(PRIVATE_FIELD_INVENTORY.fields.some(f=>f.name===name));
  let checks=0;
  for(const field of PRIVATE_FIELD_INVENTORY.fields)for(const name of field.variants)for(const encoding of ['object','json','nested-json','unicode-json']) {
    const payload={[name]:true};
    const value=encoding==='object'?payload:encoding==='json'?JSON.stringify(payload):encoding==='nested-json'?JSON.stringify({serialized:JSON.stringify(payload)}):JSON.stringify(payload).replace(name,[...name].map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join(''));
    for(const arm of ['U','T','O','P']) {
      assert.throws(()=>new PrivacyGuard(family).check('reader-request',responseRequest('reader',{delivered:{current:typeof value==='string'?value:JSON.stringify(value),history:''}}),{arm}),/private_label_leak/,name+' '+arm+' '+encoding);checks++;
    }
    assert.throws(()=>new PrivacyGuard(family).check('product-payload',{memory:{content:value}}),/private_label_leak/,name+' P ingestion '+encoding);checks++;
  }
  for(const sentence of ['The pilot arm reached the next stage.','Test the valve after the explicit expiry deadline.','Correction and reversal refine the route.','Engineering adopted this decision.'])assert.deepEqual(findPrivateLabels(sentence),[]);
  assert.deepEqual(findPrivateLabels({status:'stated',change_type:'correction',language:'en',scope:{any:[{all:[]}]}}),[]);
  process.stdout.write(JSON.stringify({privateInventory:{fields:PRIVATE_FIELD_INVENTORY.fields.length,variants:new Set(PRIVATE_FIELD_INVENTORY.fields.flatMap(f=>f.variants)).size,injectionChecks:checks,hitsMissed:0}})+'\n');
});


test('all authored pilot and engineering source language remains acceptable to the expanded scanner',async()=>{
 const {engineeringStressFixtures}=await import('../cap-stress-fixtures.mjs');
 const pilot=readFileSync('evaluation/hr3/generator/artifacts/pilot/families.jsonl','utf8').trim().split('\n').map(JSON.parse);
 for(const f of [...pilot,...engineeringStressFixtures().map(b=>b.family)]) {
   const guard=new PrivacyGuard(f);
   for(const batch of f.batches)for(const turn of batch.turns)assert.deepEqual(findPrivateLabels(turn.text,guard.labels),[],f.family_id+' '+turn.turn_id);
   for(const cp of f.checkpoints)assert.deepEqual(findPrivateLabels(cp.question,guard.labels),[],f.family_id+' question');
 }
});
