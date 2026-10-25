import test from 'node:test';
import assert from 'node:assert/strict';
import { useInstalledDependencies } from '../../harness/dependencies.mjs';
import { validateExtraction } from '../../harness/schema.mjs';
import { identifyEvents } from '../../harness/event-identity.mjs';
import { materialize, retrieve } from '../../harness/research.mjs';
import { sourceOrderAliases, findPrivateLabels } from '../../harness/privacy.mjs';
import { score } from '../../scorer/scorer.mjs';
import { adaptChallenge } from '../adapters.mjs';
import { a4Fixture } from './fixtures-a4.mjs';
useInstalledDependencies({mcp:'adapters/mcp/node_modules',tokenizer:'adapters/openai/node_modules'});
const scope={any:[{all:[]}]},at=n=>`2031-01-0${n}T00:00:00.000Z`;
const counter={id:'engineering-character-count',countTokens:s=>Math.ceil(s.length/4)};
const embedder={id:'engineering-unit-vector',revision:'1',dimensions:1536,normalization:'l2',embed:async texts=>texts.map(()=>[1,...Array(1535).fill(0)])};
function fixture(n,patch={}){
 const quote=n===1?'Record alpha: adopt route-a, approval true, cap 48 requests/day.':'Record beta: partial cap refinement to 96 requests/day. A causes B. B causes C.';
 const anchor={turn_id:'turn-'+n,quote,occurrence:1};
 const assignment=value=>({value,anchors:[anchor]});
 const wire={event_id:'wire-'+n,source_turns:[anchor.turn_id],observed_at:at(n),kind:'decision',commitment:'adopted',change_type:n===1?'initial':'refinement',subject:'engineering example',predicate:'dispatch configuration',scope,effective_interval:{from:at(n),to:null},predecessor_anchors:n===1?[]:[{source_turn:'turn-1',record_name:'alpha',subject:'engineering example',predicate:'dispatch configuration'}],replacement_extent:n===1?'entire_predecessor':'partial',source_quotes:[anchor],reason_quotes:[],payload:{type:'slots',route:n===1?assignment({type:'Text',text:'route-a'}):null,approval:n===1?assignment({type:'Boolean',value:true}):null,cap:assignment({type:'Quantity',decimal:n===1?'48':'96',unit:'requests/day'})},...patch};
 return {wire,input:{observed_at:at(n),turns:[{turn_id:anchor.turn_id,text:quote}]}};
}
function admitted(n,patch){const f=fixture(n,patch),r=validateExtraction({events:[f.wire]},f.input);return {...r,events:identifyEvents('independent-pipeline',n,r.events)};}
test('independent source admission, T/U/O updates and delivery preserve intended differences',async()=>{
 const a=admitted(1),f=fixture(2);f.wire.reason_quotes=[{turn_id:'turn-2',quote:'missing invented quote',occurrence:1}];
 const b=validateExtraction({events:[f.wire]},f.input),events=[...a.events,...identifyEvents('independent-pipeline',2,b.events)];
 assert.equal(b.diagnostics.excludedQuotations,1);assert.equal(b.events.length,1);assert.deepEqual(b.events[0].field_mask,['cap']);
 const aliases=sourceOrderAliases(events);
 for(const arm of ['T','U','O']){
  const state=materialize(arm,events,at(2));assert.deepEqual(state.current[0].fields.map(x=>x.field).sort(),arm==='T'?['approval','cap','value']:['cap']);
  assert.equal(state.history.length,arm==='O'?0:1);
  const delivered=await retrieve(state,{query:'engineering example dispatch configuration',aliases,embedder,counter});
  assert.ok(delivered.blocks.current.includes('96'));assert.deepEqual(findPrivateLabels(delivered.blocks),[]);
  assert.ok(!JSON.stringify(delivered.blocks).includes('missing invented quote'));
 }
 // The same A-4 adapter/scorer boundary preserves factual answers even when
 // actual extra delivery context leaves causal support for adjudication.
 const f2=a4Fixture(),adapted=adaptChallenge(f2.row,f2.world),r=score(adapted.gold,adapted.submission);
 assert.equal(r.scores.C,1);assert.equal(r.scores.O,1);assert.equal(r.reason.correctness,1);assert.equal(r.reason.support,null);
});
test('independent admitted input uses actual P public writes, logs missing anchors and has no fallback archive',async t=>{
 const {ProductAgent}=await import('../../harness/product.mjs');
 const p=await ProductAgent.open({namespace:{ownerId:'a4-integration-engineering',scope:'personal',projectId:null},embedder,counter});t.after(()=>p.close());
 const a=admitted(1).events,b=admitted(2).events;await p.ingest(a,at(1));await p.ingest(b,at(2));assert.equal(p.refs.size,2);
 const d=await p.retrieve('engineering example dispatch configuration');assert.ok(d.blocks.current.includes('96'));assert.deepEqual(findPrivateLabels(d.blocks),[]);
 const missing=admitted(3,{change_type:'correction',predecessor_anchors:[{source_turn:'never-observed',record_name:'missing',subject:'engineering example',predicate:'dispatch configuration'}]}).events;
 await p.ingest(missing,at(3));assert.ok(p.log.some(l=>l.method==='unresolved_mapping'||l.reason==='absent_product_target'));
 assert.ok(!Object.hasOwn(d,'archive'));assert.ok(p.log.some(l=>l.method==='admit'||l.method==='supersede'));
});
