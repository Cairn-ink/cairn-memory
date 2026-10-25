import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {PrivacyGuard,findPrivateLabels,neutralControl,namespaceAliases,readerId,readerNodeId} from '../privacy.mjs';
import {eventKey,identifyEvents} from '../event-identity.mjs';
import {materialize,serializeRecord} from '../research.mjs';
import {cardControl,safetyControl} from '../../generator/controls.mjs';
import {loadCarryForward} from '../accounting.mjs';
import {hash} from '../common.mjs';
import {responseRequest} from '../requests.mjs';
import {event,date} from './fixtures.mjs';

const family={family_id:'pilot-scope_change-L06-W1',lineage_id:'pilot-scope_change-L06',split:'pilot',causal_class:'alternative_mediated',change_type:'scope_change',seed:'hr3-worlds-v1',namespace:{ownerId:'hr3-pilot-scope_change-L06-W1',scope:'personal',projectId:null}};

test('reader IDs and every record/graph reference are opaque while semantic content is preserved',()=>{
  const events=identifyEvents(family.family_id,1,[event(1)]),first=events[0],second=identifyEvents(family.family_id,2,[event(2,{reason_nodes:[{id:family.family_id,claim:{subject:'public subject'}}],reason_edges:[{from:family.family_id,to:family.family_id,source_quotes:[]}]})])[0];
  const state=materialize('T',[first,second],date(2)),wire=serializeRecord(state.current[0]),body=JSON.parse(wire.body);
  assert.equal(body.id,readerId(second.event_id));assert.deepEqual(body.predecessors,[readerId(first.event_id)]);
  assert.deepEqual(body.supporting_events,[readerId(second.event_id)]);
  assert.equal(body.reason_nodes[0].id,readerNodeId(second.event_id,family.family_id));
  assert.equal(body.reason_edges[0].from,body.reason_nodes[0].id);assert.equal(body.reason_edges[0].to,body.reason_nodes[0].id);
  assert.deepEqual(body.fields,state.current[0].fields);assert.deepEqual(body.scope,state.current[0].scope);assert.equal(body.change_type,'reversal');
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
  assert.deepEqual(findPrivateLabels(control.actions,[family.family_id,family.lineage_id]),[]);
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

test('preparation inventory contains exact two-probe charges, three free lookups, rejection reference and additional hold',()=>{
  const c=loadCarryForward('evaluation/hr3/harness/reports/a3-carry-forward.json');
  assert.equal(c.preparationComplete,true);assert.ok(c.preparationAttestation);
  assert.equal(c.preparationDispatches.reduce((n,d)=>n+d.requests,0),6);
  const probes=c.preparationDispatches.filter(d=>d.kind==='schema_probe');
  assert.deepEqual(probes.map(d=>[d.usage.inputTokens,d.usage.outputTokens,d.max_output_tokens]),[[946,5,16],[751,16,16]]);
  assert.equal(probes.reduce((n,d)=>n+d.settledNanodollars,0),712400);
  assert.equal(c.preparationDispatches.find(d=>d.kind==='models_check').requests,3);
  assert.equal(c.preparationDispatches.find(d=>d.kind==='schema_rejection').settledNanodollars,0);
  assert.equal(c.exposure.settled,835244260+712400);assert.equal(c.exposure.outstanding,11667200+1000000);
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
  const r=JSON.parse(readFileSync(new URL('../reports/request-certification-a3.json',import.meta.url)));
  assert.equal(r.status,'PASS');assert.equal(r.privacy.hits,0);
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
 assert.ok(findPrivateLabels('Engineering stress: current decision.').length>0);
});
