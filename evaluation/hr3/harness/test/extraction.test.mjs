import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extract,extractionInput,decodeExtraction } from '../extraction.mjs';
import { FakeTransport,GuardedTransport } from '../transport.mjs';
import { Ledger } from '../ledger.mjs';
import { responseRequest } from '../requests.mjs';
import { validateExtraction } from '../schema.mjs';
import { hash,canonical } from '../common.mjs';
import { publicFamily,event,plan } from './fixtures.mjs';
function fixture(t,modes=[]) {const dir=mkdtempSync(join(tmpdir(),'hr3-extract-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const ledger=new Ledger(join(dir,'ledger.jsonl'),{plan}),fake=new FakeTransport({modes});return {dir,fake,ledger,transport:new GuardedTransport(fake,ledger),cache:join(dir,'cache'),family:publicFamily()};}
test('four source-only independent requests; strict caps, no private family fields or previous state',async t=>{
 const f=fixture(t);f.family.ast={secret:'private'};f.family.gold={secret:'private'};f.family.controls=[{secret:'private'}];
 const input=extractionInput(f.family,1);assert.deepEqual(Object.keys(input),['observed_at','public_header','turns']);const body=responseRequest('extraction',input);assert.equal(JSON.stringify(body).includes('private'),false);
 assert.equal(body.max_output_tokens,4352);assert.equal(body.store,false);assert.equal(body.temperature,0);assert.equal(body.text.format.strict,true);
});
test('cached valid replies replay with no dispatch; corrupted replay fails closed',async t=>{
 const f=fixture(t);const value={events:[rawEvent()]};
 const body=responseRequest('extraction',extractionInput(f.family,1));f.fake.replies[hash(body)]=value;
 const a=await extract({...f,batch:1});assert.equal(a.error,null);const b=await extract({...f,batch:1});assert.equal(canonical(a),canonical(b));assert.equal(f.fake.calls.length,1);assert.equal(f.ledger.snapshot().reservations,1);
 const file=join(f.cache,readdirSync(f.cache)[0]),corrupt=JSON.parse(readFileSync(file));corrupt.value.events=[];writeFileSync(file,canonical(corrupt));await assert.rejects(extract({...f,batch:1}),/cache_corrupt/);
});
test('malformed and truncated replies are cached failures, never quality retried',async t=>{
 for(const mode of ['malformed','truncated']){const f=fixture(t,[mode]);const a=await extract({...f,batch:1});assert.ok(a.error);await extract({...f,batch:1});assert.equal(f.fake.calls.length,1);}
});
test('event defects are excluded independently; schema defects still poison the batch',()=>{
 const input=extractionInput(publicFamily(),1),e=rawEvent();
 for(const patch of [{source_quotes:[{turn_id:'t1',quote:'invented',occurrence:1}]},{observed_at:'2032-01-01T00:00:00.000Z'},{payload:{type:'slots',route:null,approval:null,cap:null}},{effective_interval:{from:'invalid',to:null}}]) {
   const result=validateExtraction({events:[e,{...e,event_id:'bad',...patch}]},input);
   assert.equal(result.events.length,1);assert.equal(result.events[0].event_id,e.event_id);assert.equal(result.diagnostics.rejectedEvents,1);
   assert.equal(validateExtraction({events:[{...e,...patch}]},input).events.length,0);
 }
 for(const patch of [{extra:true},{source_quotes:[{turn_id:'t1',quote:'1'}]}])
   assert.throws(()=>validateExtraction({events:[e,{...e,event_id:'bad',...patch}]},input),/malformed_extraction/);
});
test('fake replies are deterministic, schema-valid and can be malformed on demand',async t=>{
 const a=fixture(t),b=fixture(t);const first=await extract({...a,batch:1}),second=await extract({...b,batch:1});assert.equal(canonical(first),canonical(second));assert.equal(first.error,null);
});

// Provider wire fixture is independent of legacy internal reducer fixtures.
function rawEvent(patch={}) {
 const {batch,ordinal,claims,field_mask,reason_nodes,reason_edges,...e}=event(1);
 const anchors=e.source_quotes.map(({turn_id,quote})=>({turn_id,quote,occurrence:1}));
 return {...e,source_quotes:anchors,payload:{type:'slots',route:{value:claims[0].value,anchors},approval:null,cap:null},reason_quotes:[],...patch};
}
test('provider quote fixtures stay separate from internal offset fixtures',()=>{
 const internal=event(1),before=structuredClone(internal),provider=rawEvent();
 assert.deepEqual(internal.source_quotes,[{turn_id:'t1',start:0,end:1,quote:'1'}]);
 assert.deepEqual(provider.source_quotes,[{turn_id:'t1',quote:'1',occurrence:1}]);
 assert.deepEqual(internal,before);assert.deepEqual(event(1),before);
});
test('exact quote anchoring counts overlapping occurrences and UTF-16; supplied offsets never affect validity',()=>{
 const input={...extractionInput(publicFamily(),1),turns:[{turn_id:'t1',text:'😀ababa café café'}]};
 const quote={turn_id:'t1',quote:'aba',occurrence:2,start:-999,end:'ignored'};
 const value={events:[rawEvent({source_quotes:[quote],payload:{type:'slots',route:{value:{type:'Text',text:'aba'},anchors:[quote]},approval:null,cap:null}})]},before=structuredClone(value);
 const result=validateExtraction(value,input);assert.deepEqual(value,before);
 assert.deepEqual(result.events[0].source_quotes[0],{turn_id:'t1',quote:'aba',occurrence:2,start:4,end:7});
 for(const q of [{...quote,occurrence:3},{...quote,quote:'CAFÉ'},{...quote,quote:'café',occurrence:2},{...quote,turn_id:'missing'},{...quote,quote:''}]) {
   const result=validateExtraction({events:[rawEvent({source_quotes:[q],payload:{type:'slots',route:{value:{type:'Text',text:'aba'},anchors:[q]},approval:null,cap:null}})]},input);
   assert.equal(result.events.length,0);assert.deepEqual(result.diagnostics.rejected[0].reasons,['invalid_event_anchor','no_admitted_assignment']);
 }
 for(const occurrence of [0,-1,1.5,'1',null])assert.throws(()=>validateExtraction({events:[rawEvent({source_quotes:[{...quote,occurrence}]})]},input),/malformed_extraction/);
});
test('independent assignment/quote admission keeps valid facts, derives masks and overlaps core reasons',()=>{
 const input=extractionInput(publicFamily(),1),e=rawEvent();
 e.payload.approval={value:{type:'Quantity',decimal:'2',unit:'requests/day'},anchors:e.source_quotes};
 e.reason_quotes=[{turn_id:'t1',quote:'invented',occurrence:1},...e.source_quotes];
 const result=validateExtraction({events:[e]},input),d=result.diagnostics;
 assert.equal(result.events.length,1);assert.deepEqual(result.events[0].field_mask,['value']);
 assert.equal(result.events[0].reason_quotes.length,1);
 assert.equal(d.rawAssignments,2);assert.equal(d.admittedAssignments,1);assert.equal(d.excludedAssignments,1);
 assert.equal(d.rawQuotations,2);assert.equal(d.admittedQuotations,1);assert.equal(d.excludedQuotations,1);
 const bad={...rawEvent(),event_id:'bad',observed_at:'bad',effective_interval:{from:'bad',to:null},scope:{any:[{all:[{field:'country',values:['XX']}]}]}};
 const mixed=validateExtraction({events:[rawEvent(),bad]},input);
 assert.equal(mixed.events.length,1);assert.ok(mixed.diagnostics.reasons.invalid_extraction_interval);assert.ok(mixed.diagnostics.reasons.invalid_extraction_scope);
 const duplicates=validateExtraction({events:[e,e]},input);assert.equal(duplicates.events.length,0);assert.equal(duplicates.diagnostics.reasons.invalid_extraction_provenance,2);
});
test('zero valid events is an empty extraction; schema/unparseable/status failures stay batch failures',()=>{
 const input=extractionInput(publicFamily(),1);
 const decode=value=>decodeExtraction({status:'completed',outputText:JSON.stringify(value)},input);
 for(const value of [{events:[]},{events:[rawEvent({payload:{type:'slots',route:null,approval:null,cap:null}})]}]) {
   const result=decode(value);assert.equal(result.error,null);assert.deepEqual(result.value,{events:[]});assert.equal(result.diagnostics.batchFailure,null);
 }
 for(const value of [null,{}, {events:[rawEvent(),{...rawEvent(),extra:true}]}])assert.equal(decode(value).error,'malformed_extraction');
 assert.equal(decodeExtraction({status:'completed',outputText:'{'},input).error,'malformed_extraction');
 assert.equal(decodeExtraction({status:'incomplete',outputText:'{"events":[]}'},input).error,'incomplete');
});
test('cached exclusions retain diagnostics and an empty batch never dispatches a quality retry',async t=>{
 const f=fixture(t),body=responseRequest('extraction',extractionInput(f.family,1));
 f.fake.replies[hash(body)]={events:[rawEvent({payload:{type:'slots',route:null,approval:null,cap:null}})]};
 const first=await extract({...f,batch:1}),cached=await extract({...f,batch:1});
 assert.equal(first.error,null);assert.deepEqual(first.value,{events:[]});assert.equal(first.diagnostics.reasons.no_admitted_assignment,1);
 assert.deepEqual(cached,first);assert.equal(f.fake.calls.length,1);
});
