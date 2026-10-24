import test from 'node:test';
import assert from 'node:assert/strict';
import { materialize,resolveLinks,tokenizeT1,bm25,retrieve,literalQuery,serializeRecord } from '../research.mjs';
import { canonical,cells } from '../common.mjs';
import { event,scope,tw,text,date } from './fixtures.mjs';
const current=s=>s.current.filter(r=>r.status==='active');
const value=r=>Object.fromEntries(r.fields.map(f=>[f.field,f.value]));
test('typed correction is erroneous; U generic links retain uninterpreted labels; O removes history',()=>{
 const events=[event(1),event(2,{change_type:'correction'})];
 assert.equal(value(current(materialize('T',events,date(2)))[0]).value.text,'2');assert.equal(materialize('T',events,date(2)).history[0].status,'erroneous');
 assert.equal(materialize('U',events,date(2)).events[1].change_type,'correction');assert.equal(materialize('O',events,date(2)).history.length,0);
});
test('typed refinement inherits only unspecified fields; U/O do not merge',()=>{
 const a=event(1,{claims:[{field:'value',value:text('route')},{field:'cap',value:text('10')}],field_mask:['value','cap']}),b=event(2,{change_type:'refinement',replacement_extent:'partial',claims:[{field:'cap',value:text('20')}],field_mask:['cap']});
 const t=materialize('T',[a,b],date(2));assert.deepEqual(value(current(t)[0]),{cap:text('20'),value:text('route')});assert.deepEqual(current(t)[0].supporting_events,['e1','e2']);
 for(const arm of ['U','O'])assert.deepEqual(value(current(materialize(arm,[a,b],date(2)))[0]),{cap:text('20')});
});
test('overlapping scopes produce residual cells only in T; U/O expose exact scope heads',()=>{
 const a=event(1),b=event(2,{scope:tw,change_type:'scope_change',replacement_extent:'partial'});
 const t=current(materialize('T',[a,b],date(2)));assert.equal(t.length,2);assert.equal(t.find(r=>value(r).value.text==='1')&&cells(t.find(r=>value(r).value.text==='1').scope).length,8);
 for(const arm of ['U','O'])assert.equal(current(materialize(arm,[a,b],date(2))).length,2);
});
test('future updates stay pending; retroactive corrections use observed information only',()=>{
 const a=event(1),future=event(2,{effective_interval:{from:date(4),to:null}});
 for(const arm of ['T','U','O']){assert.equal(value(current(materialize(arm,[a,future],date(2)))[0]).value.text,'1');assert.equal(value(current(materialize(arm,[a,future],date(4)))[0]).value.text,'2');}
 const retro=event(3,{change_type:'correction',effective_interval:{from:date(2),to:null},predecessor_anchors:event(2).predecessor_anchors});assert.equal(value(current(materialize('T',[a,retro],date(2)))[0]).value.text,'1');assert.equal(value(current(materialize('T',[a,retro],date(3)))[0]).value.text,'3');
});
test('expiry never falls back, and explicit adoption can reactivate',()=>{
 const a=event(1),b=event(2,{effective_interval:{from:date(2),to:date(3)}});
 for(const arm of ['T','U','O'])assert.equal(current(materialize(arm,[a,b],date(3))).length,0);
 const c=event(4,{change_type:'initial',predecessor_anchors:[]});assert.equal(value(current(materialize('T',[a,b,c],date(4)))[0]).value.text,'4');
});
test('complete multiple predecessor sets validate atomically and resolve in source order',()=>{
 const a=event(1),b=event(2,{scope:tw,replacement_extent:'partial',change_type:'scope_change'}),c=event(3,{predecessor_anchors:[...event(3).predecessor_anchors,...event(2).predecessor_anchors]});
 const linked=resolveLinks([a,b,c]);assert.deepEqual(linked[2].targets,['e1','e2']);assert.equal(linked[2].unresolved,false);
 const bad={...c,predecessor_anchors:[...c.predecessor_anchors,{source_turn:'missing',record_name:'x',subject:'service',predicate:'route'}]};assert.equal(resolveLinks([a,b,bad])[2].unresolved,true);assert.equal(current(materialize('T',[a,b,bad],date(3))).length,2);
});
test('missing, nonunique, incompatible and historical anchors never enact; nonadopted never enacts',()=>{
 for(const patch of [{predecessor_anchors:[]},{predecessor_anchors:[{source_turn:'t1',record_name:'a',subject:'other',predicate:'route'}]},{replacement_extent:'unresolved'}]){const state=materialize('T',[event(1),event(2,patch)],date(2));assert.equal(value(current(state)[0]).value.text,'1');assert.ok(state.current.some(r=>r.status==='unresolved'));}
 const historical=event(3,{predecessor_anchors:event(2).predecessor_anchors});assert.equal(resolveLinks([event(1),event(2),historical])[2].unresolved,true);
 for(const commitment of ['proposed','quoted','rejected','unresolved'])assert.equal(value(current(materialize('T',[event(1),event(2,{commitment})],date(2)))[0]).value.text,'1');
});
test('literal queries and T1 Han bigrams/no English stopwords match frozen settings',()=>{
 assert.deepEqual(tokenizeT1('THE car 中文 中'),['car','中文','中']);assert.deepEqual(tokenizeT1('𠀀中文'),['𠀀中','中文']);
 const header={subject:'s',predicate:'p',scope_text:'scope'};assert.equal(literalQuery(header,'mixed'),'s p scope decision correction change reason\ns p scope 決定 修正 變更 原因');
 const scores=bm25([{id:'b',body:'car car'},{id:'a',body:'car car'},{id:'c',body:'unrelated'}],'car');assert.deepEqual(scores.map(r=>r.id),['a','b']);
});
test('reducer/serializer/retrieval determinism and whole-record assembly budget',async()=>{
 const raw=[event(1),event(2)],a=materialize('T',raw,date(2)),b=materialize('T',raw,date(2));assert.equal(canonical(a),canonical(b));assert.equal(canonical(serializeRecord(a.current[0])),canonical(serializeRecord(b.current[0])));
 const embedder={async embed(texts){return texts.map(()=>[1,0]);}},counter={countTokens:text=>text.length};
 const delivery=await retrieve(a,{query:'service',embedder,counter});assert.deepEqual(delivery,await retrieve(b,{query:'service',embedder,counter}));for(const d of Object.values(delivery.diagnostics))assert.ok(d.tokens<=2000);
 const huge=structuredClone(a);huge.current[0].fields[0].value=text('x'.repeat(5000));assert.equal((await retrieve(huge,{query:'service',embedder,counter})).diagnostics.current.selected,0);
});
test('hand-worked outputs and serializer bytes remain frozen for ten temporal/link cases',async()=>{
 const {readFileSync}=await import('node:fs'),{referenceCases}=await import('./fixtures.mjs'),{hash}=await import('../common.mjs');
 const expected=JSON.parse(readFileSync(new URL('./references.json',import.meta.url)));
 const actual=referenceCases().map(c=>({name:c.name,arms:Object.fromEntries(['U','T','O'].map(arm=>{const state=materialize(arm,c.events,c.at);return [arm,{state,serializer_sha256:hash(canonical([...state.current,...state.history].map(serializeRecord)))}];}))}));assert.equal(canonical(actual),canonical(expected));
});
test('hosted RRF uses normalized equal .5 channel weights and frozen k=10',async()=>{
 const result=await retrieve(materialize('U',[event(1)],date(1)),{query:'service',embedder:{embed:async texts=>texts.map(()=>[1,0])},counter:{countTokens:()=>1}});
 assert.equal(result.diagnostics.current.fused[0][1],1/11);
});
