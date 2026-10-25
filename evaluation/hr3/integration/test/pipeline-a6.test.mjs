import {runInNewContext} from 'node:vm';
import * as common from '../../harness/common.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {adaptGenerator,adaptExtraction,restore} from '../adapters.mjs';import {fieldMapping} from '../field-map.mjs';
import {named} from '../../harness/test/name-fixtures-a6.mjs';
import {NameRegistry,resolveNamedLinks} from '../../harness/name-registry-a6.mjs';
import {materialize,serializeRecord,compactSlots} from '../../harness/research.mjs';import {sourceOrderAliases} from '../../harness/privacy.mjs';
import {CONTRACT_A6} from '../../harness/contract-projection-a6.mjs';
import {useInstalledDependencies} from '../../harness/dependencies.mjs';import {verifiedInputs} from '../../harness/inputs.mjs';
useInstalledDependencies({mcp:'adapters/mcp/node_modules',tokenizer:'adapters/openai/node_modules'});
const {ProductAgent}=await import('../../harness/product.mjs');
const counter={id:'independent-engineering',countTokens:s=>Math.ceil(s.length/4)},embedder={id:'independent-engineering',revision:'1',dimensions:1536,normalization:'l2',embed:async ts=>ts.map(()=>[1,...Array(1535).fill(0)])};
test('A6 integration: closed extraction/name fields restore losslessly with independent complete field inventories',()=>{
 const f=named(1),source={family:'independent',namespace:null,batch:1,wire:f.wire?{events:[f.wire]}:null,input:f.input,previous:[]},a=adaptExtraction(source);assert.deepEqual(restore(a),source);
 const recursive=[];function walk(v,p){recursive.push(p);if(v&&typeof v==='object')for(const [k,x]of Object.entries(v))walk(x,p+'/'+k);}walk(source,'$');
 const iterative=[],stack=[['$',source]];while(stack.length){const [p,v]=stack.pop();iterative.push(p);if(v&&typeof v==='object')for(const [k,x]of Object.entries(v))stack.push([p+'/'+k,x]);}
 assert.deepEqual(recursive.sort(),iterative.sort());for(const p of recursive)assert.ok(fieldMapping('extraction',p).destination);
 const e=a.events[0];assert.deepEqual(e.record_name.anchor,{...f.wire.record_name.anchor,start:7,end:9});assert.equal(e.predecessor_refs.length,0);
 assert.deepEqual(Object.keys(f.wire).sort(),Object.keys((awaitSchema()).properties.events.items.properties).sort());
});
function awaitSchema(){return JSON.parse(readFileSync('evaluation/hr3/harness/schemas/extraction-a6.schema.json'));}
test('A6 integration: private optional-trivia provenance is losslessly retained and authenticated against the independently pinned producer freeze',()=>{
 const data=verifiedInputs('evaluation/hr3/generator/artifacts/pilot'),family=data.families[0],g=data.gold[0],s=data.support[0],a=adaptGenerator(family,g,s,2);
 assert.deepEqual(restore(a),{family,goldRow:g,supportRow:s,batch:2});assert.equal(a.gold.supportVersion,'hr3-support-a6-v3');assert.equal(a.gold.supportTrivia.producer.rules_sha256,s.optional_trivia.rules_sha256);
 assert.equal(a.gold.supportTrivia.positions.length,s.optional_trivia.origins.reduce((n,o)=>n+o.positions.length,0));assert.equal(fieldMapping('generator','$/supportRow/optional_trivia/origins/*/positions/*').disposition,'mapped:private-trivia-provenance');
});
test('A6 integration: independently resolved equivalent streams preserve the previous reducers and serializer bytes',()=>{
 const a=named(1).event(),b=named(2).event(),linked=resolveNamedLinks([a,b]);
 // Independently authored old fully-resolved interface. No name lookup, gold,
 // graph or target inference is performed by either branch-specific reducer.
 const resolved=[{...a,targets:[],unresolved:false,link_errors:[]},{...b,targets:[a.event_id],unresolved:false,link_errors:[]}],aliases=sourceOrderAliases([a,b]);
 const source=readFileSync('evaluation/hr3/harness/test/fixtures/research-12355a8e.mjs.txt','utf8');assert.equal(common.hash(source),'3c665423b7e7a6b96730046e0fc6822ca51668fded92b24856554130664533de');
 const context={...common,sourceOrderAliases};runInNewContext(source.replace(/^import .*\n/gm,'').replace(/^export /gm,'')+';globalThis.oldReducer=materializeSlots;globalThis.oldSerializer=serializeRecord;',context);
 for(const arm of ['T','U','O']){const actual=materialize(arm,[a,b],b.observed_at,{linkedEvents:linked}),old=context.oldReducer(arm,resolved,b.observed_at);
  const content=s=>Object.fromEntries(['current','history','pending'].map(v=>[v,s[v].map(r=>serializeRecord(r,aliases))]));assert.deepEqual(content(actual),JSON.parse(JSON.stringify(content(old))));for(const view of ['current','history','pending'])assert.equal(common.canonical(actual[view].map(r=>serializeRecord(r,aliases))),common.canonical(old[view].map(r=>context.oldSerializer(r,aliases))));}
});
test('A6 integration: named identities cannot retrieve O/P correction loss; P receives actual correct_memory only',async t=>{
 const a=named(1).event(),b=named(2,{change_type:'correction',replacement_extent:'entire_predecessor'}).event(),registry=new NameRegistry(),linked=resolveNamedLinks([a,b],{registry}),aliases=sourceOrderAliases(linked);
 const o=materialize('O',[a,b],b.observed_at,{linkedEvents:linked});assert.equal(o.history.length,0);assert.ok(!JSON.stringify(o.current.map(r=>serializeRecord(r,aliases))).includes('secretRoute1'));
 assert.ok(JSON.stringify(registry.audit()).includes('n1'));assert.ok(!JSON.stringify(registry.audit()).includes('secretRoute1'));
 const p=await ProductAgent.open({namespace:{ownerId:'independent-a6-correction',scope:'personal',projectId:null},counter,embedder,aliases});t.after(()=>p.close());
 await p.ingest([a],a.observed_at,{linkedEvents:linked.slice(0,1)});await p.ingest([b],b.observed_at,{linkedEvents:linked});const d=await p.retrieve('lumiu dispatch configuration');
 assert.ok(p.log.some(l=>l.surface==='mcp'&&l.method==='correct_memory'));assert.ok(!d.blocks.history.includes('secretRoute1'));assert.ok(!d.blocks.current.includes('secretRoute1'));
 const c=named(3,{refs:['n1']}).event(),all=resolveNamedLinks([a,b,c]);await p.ingest([c],c.observed_at,{linkedEvents:all});assert.ok(!p.refs.has(c.event_id));assert.ok(p.log.some(l=>l.event===c.event_id&&l.method==='unresolved_mapping'));
});
test('A6 integration: forgotten product target cannot authorize another named write or resurrect its body',async t=>{
 const a=named(1).event(),b=named(2).event(),p=await ProductAgent.open({namespace:{ownerId:'independent-a6-forget',scope:'personal',projectId:null},counter,embedder});t.after(()=>p.close());await p.ingest([a],a.observed_at);const ref=p.refs.get(a.event_id),detail=p.inspect(ref.id);
 assert.equal(p.call('forget',{namespace:p.namespace,memoryId:ref.id,expectedRevision:detail.value.memory.revision}).ok,true);p.forgottenIds.add(ref.id);await p.ingest([b],b.observed_at);
 assert.ok(!p.refs.has(b.event_id));assert.ok(p.log.some(l=>l.event===b.event_id&&l.reason==='absent_product_target'));const d=await p.retrieve('lumiu dispatch configuration');assert.ok(!JSON.stringify(d.blocks).includes('secretRoute1'));
});
test('A6 integration: bilingual partial refinements with/without preservation have identical intended semantics in every arm',async t=>{
 for(const pair of CONTRACT_A6.worked_examples.inheritance_pairs){const variants=[];
  for(const variant of pair.variants){
   const template=CONTRACT_A6.worked_examples.extraction.find(e=>e.language===pair.language&&e.id.startsWith('demo-own-reference')).batches[0].expected[0];
   const make=(turn,ordinal,slots,name,refs)=>{const anchor=quote=>({turn_id:turn.turn_id,quote,occurrence:1}),wire={...structuredClone(template),event_id:'e'+ordinal,source_turns:[turn.turn_id],observed_at:`2034-07-${String(ordinal+8).padStart(2,'0')}T02:00:00.000Z`,change_type:ordinal===1?'initial':'refinement',replacement_extent:ordinal===1?'entire_predecessor':'partial',record_name:{name,anchor:anchor(name)},predecessor_refs:refs.map(record_name=>({record_name,anchor:anchor(record_name)})),source_quotes:[anchor(turn.text)],payload:{type:'slots',...Object.fromEntries(Object.entries(slots).map(([k,value])=>[k,value?{value,anchors:[anchor(turn.text)]}:null]))}};return adaptExtraction({family:'independent-inheritance',batch:ordinal,wire:{events:[wire]},input:{observed_at:wire.observed_at,turns:[turn]}}).events[0];};
   const a=make(pair.predecessor,1,{route:{type:'Text',text:'demoRoute9'},approval:{type:'Boolean',value:false},cap:{type:'Quantity',decimal:'17',unit:'requests/day'}},'demoLira',[]),b=make(variant.turn,2,variant.supplied_slots,'demoPico',['demoLira']),events=[a,b],linked=resolveNamedLinks(events),byArm={};assert.equal(linked[1].unresolved,false);
   for(const arm of ['T','U','O'])byArm[arm]=materialize(arm,events,b.observed_at,{linkedEvents:linked}).current.map(r=>compactSlots(r.fields));
   const p=await ProductAgent.open({namespace:{ownerId:'independent-inheritance',scope:'personal',projectId:null},counter,embedder});try{await p.ingest([a],a.observed_at);await p.ingest([b],b.observed_at);byArm.P=p.log.filter(l=>l.method==='admit'&&l.outcome==='operation_success').map(l=>JSON.parse(l.input.memory.content.split('\n')[0]).slots);}finally{await p.close();}
   assert.deepEqual(byArm.T,[{approval:false,cap:{decimal:'120',unit:'requests/day'},route:'demoRoute9'}]);variants.push(byArm);
  }
  assert.deepEqual(variants[0],variants[1],pair.language);assert.equal(pair.expected_current.rows[0].route.value,'demoRoute9');assert.equal(pair.expected_current.rows[0].approval.value,false);
 }
});
