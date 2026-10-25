import test from 'node:test';import assert from 'node:assert/strict';
import {validateExtraction} from '../schema.mjs';import {identifyEvents} from '../event-identity.mjs';
import {NameRegistry,resolveNamedLinks} from '../name-registry-a6.mjs';
import {materialize,serializeRecord} from '../research.mjs';import {sourceOrderAliases,findPrivateLabels} from '../privacy.mjs';
import {named} from './name-fixtures-a6.mjs';
const date=n=>`2034-01-${String(n).padStart(2,'0')}T00:00:00.000Z`;
const e=(n,p)=>named(n,p).event();
test('A6 names: English, Chinese and mixed references resolve across batches with public subject/predicate aliases',()=>{
 for(const [subject,predicate,text]of [['lumiu service','dispatch configuration','Correct n1; adopt n2.'],['lumiu服務','派送設定','更正 n1；採用紀錄 n2。'],['lumiu服務','dispatch 設定','更正 record n1；採用 n2。']]){
  const out=resolveNamedLinks([e(1),e(2,{subject,predicate,text,change_type:'correction',replacement_extent:'entire_predecessor'})]);assert.equal(out[1].unresolved,false);assert.deepEqual(out[1].targets,[out[0].event_id]);assert.deepEqual(out[1].name_diagnostics.references[0].target_source_turns,['turn1']);
 }
});
test('A6 names: missing own declaration retains admitted facts but supplies no future binding',()=>{
 const out=resolveNamedLinks([e(1,{name:null}),e(2)]);assert.equal(out[0].unresolved,false);assert.equal(out[0].claims.length,1);assert.ok(out[1].link_errors.includes('missing_named_predecessor'));
});
test('A6 names: invalid prefix/own annotations keep facts unresolved and never become receipts',()=>{
 for(const own of [true,false]){const f=named(2,{name:'n2',refs:['n1'],text:'Record n20 adopts secretRoute2, referencing n10.'});if(own)f.wire.predecessor_refs=[];else f.wire.record_name=null;
  const admitted=validateExtraction({events:[f.wire]},f.input).events[0];assert.equal(admitted.claims.length,1);assert.ok(admitted.name_errors.includes(own?'invalid_record_name':'invalid_predecessor_ref'));
  const out=resolveNamedLinks([e(1),{...admitted,batch:2,ordinal:0}]);assert.equal(out[1].unresolved,true);assert.ok(admitted.source_quotes.every(q=>q.quote!=='n1'&&q.quote!=='n2'));
 }
});
test('A6 names: structural missing annotations fail the whole wire; invalid core never salvages reasons',()=>{
 const f=named(1);delete f.wire.record_name;assert.throws(()=>validateExtraction({events:[f.wire]},f.input),/malformed_extraction/);
 const g=named(1);g.wire.commitment='correction';g.wire.reason_quotes=g.wire.source_quotes;const r=validateExtraction({events:[g.wire]},g.input);assert.equal(r.events.length,0);assert.equal(r.diagnostics.excludedQuotations,1);
});
test('A6 names: own collision is unresolved before retirement and all colliding claims remain ambiguous',()=>{
 const out=resolveNamedLinks([e(1),e(2,{name:'n1',refs:[],change_type:'initial'}),e(3,{refs:['n1']})]);assert.equal(out[0].unresolved,false);assert.ok(out[1].link_errors.includes('colliding_record_name'));assert.ok(out[2].link_errors.includes('ambiguous_named_predecessor'));assert.equal(out[2].name_diagnostics.references[0].matches.length,2);assert.deepEqual(out[2].targets,[]);
});
test('A6 names: self and duplicate references fail closed; multi-target links are all or none',()=>{
 const a=e(1),b=e(2,{refs:[],change_type:'initial'});
 for(const refs of [['n1','n1'],['n1','missing'],['n3']]){const out=resolveNamedLinks([a,b,e(3,{refs})]);assert.equal(out[2].unresolved,true);assert.deepEqual(out[2].targets,[]);}
 const out=resolveNamedLinks([a,b,e(3,{refs:['n1','n2']})]);assert.deepEqual(out[2].targets,[a.event_id,b.event_id]);assert.equal(out[2].unresolved,false);
});
test('A6 names: rejected/colliding candidates are never disambiguated by adoption or audience',()=>{
 const out=resolveNamedLinks([e(1),e(2,{name:'n1',refs:[],change_type:'initial',commitment:'rejected',scope:{any:[{all:[{field:'country',values:['TW']}]}]}}),e(3,{refs:['n1']})]);assert.ok(out[2].link_errors.includes('ambiguous_named_predecessor'));
});
test('A6 names: exact names preserve case; public canonical subject collisions share a key',()=>{
 assert.ok(resolveNamedLinks([e(1),e(2,{refs:['N1']})])[1].link_errors.includes('missing_named_predecessor'));
 const out=resolveNamedLinks([e(1),e(2,{name:'n1',refs:[],subject:'lumiu服務',predicate:'dispatch 設定',change_type:'initial'}),e(3,{refs:['n1']})]);assert.ok(out[2].link_errors.includes('ambiguous_named_predecessor'));
});
test('A6 names: forward references never retry using later declarations or checkpoints',()=>{
 const before=e(1,{name:'start',refs:['later'],change_type:'refinement'}),later=e(2,{name:'later',refs:[],change_type:'initial'});
 const first=resolveNamedLinks([before])[0],second=resolveNamedLinks([before,later])[0];assert.deepEqual(second,first);assert.ok(first.unresolved);
 const cycle=resolveNamedLinks([e(1,{name:'cycleA',refs:['cycleB'],change_type:'refinement'}),e(2,{name:'cycleB',refs:['cycleA']})]);assert.ok(cycle.every(e=>e.unresolved&&e.targets.length===0));
});
test('A6 names: same-batch source order and frozen event order must both precede a reference',()=>{
 const a=e(1),b=e(2);b.observed_at=a.observed_at;b.batch=a.batch;b.ordinal=1;b.source_turn_order=['turn1','turn2'];a.source_turn_order=b.source_turn_order;
 assert.equal(resolveNamedLinks([a,b])[1].unresolved,false);
 a.source_turn_order=['turn2','turn1'];b.source_turn_order=a.source_turn_order;const out=resolveNamedLinks([a,b]);assert.ok(out[1].link_errors.includes('forward_named_predecessor'));
});
test('A6 names: incompatible scopes, retired and forgotten targets remain identity tombstones',()=>{
 const a=e(1,{scope:{any:[{all:[{field:'country',values:['TW']}]}]}}),b=e(2,{scope:{any:[{all:[{field:'country',values:['JP']}]}]}});assert.ok(resolveNamedLinks([a,b])[1].link_errors.includes('incompatible_or_historical_named_predecessor'));
 const out=resolveNamedLinks([e(1),e(2,{change_type:'correction',replacement_extent:'entire_predecessor'}),e(3,{refs:['n1']})]);assert.ok(out[2].link_errors.includes('incompatible_or_historical_named_predecessor'));
 const registry=new NameRegistry({forgottenEventIds:[e(1).event_id]});const forgotten=resolveNamedLinks([e(1),e(2)],{registry});assert.ok(forgotten[1].link_errors.includes('forgotten_named_predecessor'));assert.equal(registry.audit().bindings.length,2);
});
test('A6 names: replay is idempotent; namespace/family keys prevent cross-world lookup',()=>{
 const a=e(1),b=e(2);assert.equal(resolveNamedLinks([a,a,b,b]).length,2);
 for(const partition of ['different-family','different-authorized-namespace']){const c=structuredClone(b);c.identity_partition=partition;assert.ok(resolveNamedLinks([a,c])[1].unresolved);}
 const one={ownerId:'one',scope:'personal',projectId:null},two={...one,ownerId:'two'},wire=named(1),raw=validateExtraction({events:[wire.wire]},wire.input).events;
 const first=identifyEvents('same-family',1,raw,one),second=identifyEvents('same-family',1,raw,two),next=named(2),update=identifyEvents('same-family',2,validateExtraction({events:[next.wire]},next.input).events,two);
 assert.notEqual(first[0].event_id,second[0].event_id);assert.deepEqual(resolveNamedLinks([...first,...second,...update])[2].targets,[second[0].event_id]);
});
test('A6 names: registry is identity-only, never retrieval/receipts/body material',()=>{
 const registry=new NameRegistry(),events=resolveNamedLinks([e(1),e(2)],{registry}),privateState=JSON.stringify(registry.audit());assert.ok(!privateState.includes('secretRoute')&&!privateState.includes('secretCause'));
 const aliases=sourceOrderAliases(events);
 for(const arm of ['T','U','O'])for(const r of materialize(arm,events,date(2),{linkedEvents:events}).current){const s=serializeRecord(r,aliases);assert.ok(!s.body.includes('name_diagnostics')&&!s.body.includes('identity_partition')&&!s.body.includes('definitions'));}
 for(const value of [{private_identity_registry:registry.audit()},{name_diagnostics:events[1].name_diagnostics}])assert.ok(findPrivateLabels(value).length);
});
