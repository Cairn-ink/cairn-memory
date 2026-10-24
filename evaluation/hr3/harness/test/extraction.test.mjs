import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extract,extractionInput } from '../extraction.mjs';
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
 assert.equal(body.max_output_tokens,4096);assert.equal(body.store,false);assert.equal(body.temperature,0);assert.equal(body.text.format.strict,true);
});
test('cached valid replies replay with no dispatch; corrupted replay fails closed',async t=>{
 const f=fixture(t);const value={events:[event(1)]};delete value.events[0].batch;delete value.events[0].ordinal;
 const body=responseRequest('extraction',extractionInput(f.family,1));f.fake.replies[hash(body)]=value;
 const a=await extract({...f,batch:1});assert.equal(a.error,null);const b=await extract({...f,batch:1});assert.equal(canonical(a),canonical(b));assert.equal(f.fake.calls.length,1);assert.equal(f.ledger.snapshot().reservations,1);
 const file=join(f.cache,readdirSync(f.cache)[0]),corrupt=JSON.parse(readFileSync(file));corrupt.value.events=[];writeFileSync(file,canonical(corrupt));await assert.rejects(extract({...f,batch:1}),/cache_corrupt/);
});
test('malformed and truncated replies are cached failures, never quality retried',async t=>{
 for(const mode of ['malformed','truncated']){const f=fixture(t,[mode]);const a=await extract({...f,batch:1});assert.ok(a.error);await extract({...f,batch:1});assert.equal(f.fake.calls.length,1);}
});
test('extraction validation rejects unsupported quotes, times, fields and empty scopes',()=>{
 const input=extractionInput(publicFamily(),1),e=event(1);delete e.batch;delete e.ordinal;assert.equal(validateExtraction({events:[e]},input).events.length,1);
 for(const patch of [{source_quotes:[{turn_id:'t1',start:0,end:1,quote:'invented'}]},{observed_at:'2032-01-01T00:00:00.000Z'},{scope:{any:[]}},{field_mask:[]},{effective_interval:{from:'invalid',to:null}},{extra:true}])assert.throws(()=>validateExtraction({events:[{...e,...patch}]},input));
});
test('fake replies are deterministic, schema-valid and can be malformed on demand',async t=>{
 const a=fixture(t),b=fixture(t);const first=await extract({...a,batch:1}),second=await extract({...b,batch:1});assert.equal(canonical(first),canonical(second));assert.equal(first.error,null);
});
