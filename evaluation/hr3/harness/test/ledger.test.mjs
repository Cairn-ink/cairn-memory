import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync,appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../ledger.mjs';
import { responseRequest, embeddingRequest, validateRequest } from '../requests.mjs';
import { GuardedTransport,FakeTransport,TransportError } from '../transport.mjs';
import { extractionInput } from '../extraction.mjs';
import { plan,publicFamily } from './fixtures.mjs';
function fixture(t,options={}){const dir=mkdtempSync(join(tmpdir(),'hr3-ledger-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'ledger.jsonl');return {dir,path,ledger:new Ledger(path,{plan,...options})};}
const request=(id='one')=>({id,operation:'extraction',body:responseRequest('extraction',extractionInput(publicFamily(),1))});
test('reservation is durable before dispatch, settlement releases only known usage by request ID',async t=>{
 const {ledger,path}=fixture(t);const fake=new FakeTransport();const guarded=new GuardedTransport({async send(r,o){const rows=readFileSync(path,'utf8').trim().split('\n').map(JSON.parse);assert.equal(rows.at(-1).type,'reserve');assert.equal(rows.at(-1).id,r.id);return fake.send(r,o);}},ledger);
 await guarded.send(request());assert.equal(ledger.snapshot().unsettled.length,0);assert.equal(new Ledger(path,{plan}).snapshot().total,ledger.snapshot().total);
 assert.throws(()=>ledger.settle('one/attempt-0',{requestId:'duplicate',usage:{inputTokens:0,outputTokens:0}}),/invalid_settlement/);
 assert.throws(()=>ledger.reserve({...request(),id:'one/attempt-0'}),/already_reserved/);
});
test('stage, operational and unavailable authorization headroom deny before dispatch',async t=>{
 for(const limits of [{stages:{pilot:0}},{operational:0},{authorization:50}]){const {ledger}=fixture(t,{limits});let sent=0;const guard=new GuardedTransport({async send(){sent++;}},ledger);await assert.rejects(guard.send(request()),/cap_exceeded/);assert.equal(sent,0);assert.equal(ledger.snapshot().reservations,0);assert.equal(ledger.snapshot().stopped,'cap_exceeded');}
});
test('unsettled reservations survive restart and charge the full bound',t=>{
 const {ledger,path}=fixture(t);const r=ledger.reserve(request());const restarted=new Ledger(path,{plan});assert.equal(restarted.snapshot().total,r.reserved);assert.deepEqual(restarted.snapshot().unsettled,['one']);
 assert.throws(()=>new Ledger(path,{plan,limits:{operational:1}}),/configuration_mismatch/);
});
test('one transport retry, cumulative third failure stops, no quality retries',async t=>{
 const {ledger}=fixture(t),fake=new FakeTransport({modes:['failure','failure','failure']}),guard=new GuardedTransport(fake,ledger);
 assert.equal((await guard.send(request('a'))).status,'transport_exhausted');assert.equal(fake.calls.length,2);await assert.rejects(guard.send(request('b')),/three_transport_failures/);assert.equal(fake.calls.length,3);assert.equal(ledger.snapshot().unsettled.length,3);
 const other=fixture(t),bad=new FakeTransport({modes:['malformed']}),quality=new GuardedTransport(bad,other.ledger);assert.equal((await quality.send(request())).outputText,'{');assert.equal(bad.calls.length,1);
});
test('model mismatch, unexplained usage, duplicate provider IDs and unknown contract failures stop',async t=>{
 for(const mode of ['model-mismatch','overusage','provider-id','unknown']){
  const {ledger}=fixture(t),fake=new FakeTransport(),guard=new GuardedTransport({async send(r){if(mode==='unknown')throw Error('unknown');const reply=await fake.send(r);if(mode==='model-mismatch')reply.model='different';if(mode==='overusage')reply.usage.outputTokens=4097;if(mode==='provider-id')reply.requestId='same';return reply;}},ledger);
  if(mode==='provider-id'){await guard.send(request('a'));await assert.rejects(guard.send(request('b')),/unexplained_usage/);}else await assert.rejects(guard.send(request()));assert.ok(ledger.snapshot().stopped);
 }
});
test('five-minute lack of progress and dispatch timeout are supervised',async t=>{
 const {ledger}=fixture(t);let now=0;const guard=new GuardedTransport(new FakeTransport(),ledger,{now:()=>now});now=300000;await assert.rejects(guard.send(request()),/five_minutes/);assert.equal(ledger.snapshot().reservations,0);
 const other=fixture(t),hung=new GuardedTransport({send:()=>new Promise(()=>{})},other.ledger,{timeoutMs:5});assert.equal((await hung.send(request())).status,'transport_exhausted');assert.equal(other.ledger.snapshot().unsettled.length,2);
});
test('strict body models, no tools/prior state, caps and byte/embed bounds',()=>{
 for(const change of [{tools:[]},{previous_response_id:'x'},{store:true},{temperature:1},{max_output_tokens:4097}])assert.throws(()=>validateRequest({...request(),body:{...request().body,...change}}),/request_shape/);
 const alt=responseRequest('extraction',{}, {alternative:true});assert.equal(alt.temperature,undefined);assert.deepEqual(alt.reasoning,{effort:'none'});assert.equal(alt.max_output_tokens,4096);
 assert.throws(()=>validateRequest({operation:'reader',body:responseRequest('reader',{text:'x'.repeat(20000)})}),/byte_bound/);
 for(const input of [Array(65).fill('x'),['x'.repeat(8192)],Array(64).fill('x'.repeat(5000))])assert.throws(()=>validateRequest({operation:'product-embedding',body:embeddingRequest(input)}),/embedding_bound/);
});
test('unlisted calls, embedding unit allowances and corrupt journals fail closed',t=>{
 const f=fixture(t);assert.throws(()=>f.ledger.reserve({...request(),operation:'unlisted'}),/unlisted/);
 const e=fixture(t,{limits:{embeddingUnits:{research:1,product:1}}});assert.throws(()=>e.ledger.reserve({id:'embed',operation:'product-embedding',body:embeddingRequest(['hello'])}),/cap_exceeded/);
 appendFileSync(f.path,'{');assert.throws(()=>new Ledger(f.path,{plan}),/ledger_incomplete/);
});
test('stage transitions share one operational ledger and preserve stage totals',t=>{
 const {ledger,path}=fixture(t);const first=ledger.reserve(request('pilot-one'));
 const development=new Ledger(path,{stage:'development',plan});const second=development.reserve(request('dev-one'));
 assert.equal(development.snapshot().total,first.reserved+second.reserved);assert.equal(development.snapshot().byStage.pilot,first.reserved);assert.equal(development.snapshot().byStage.development,second.reserved);
});
test('A-2 reserves and settles the exact new output ceiling at unchanged input bounds and prices',t=>{
 const {ledger}=fixture(t);
 for(const [operation,alternative,output,inputCeiling,inputRate,outputRate] of [['reader',false,2048,20000,400,1600],['extraction',false,4096,16384,400,1600],['extraction',true,4096,16384,750,4500]]){
  const body=responseRequest(operation,{}, {alternative}),id=operation+'-'+alternative;
  const reservation=ledger.reserve({id,operation,body});
  assert.equal(reservation.bound.output,output);assert.ok(reservation.bound.input<=inputCeiling);
  assert.equal(reservation.bound.inputRate,inputRate);assert.equal(reservation.bound.outputRate,outputRate);
  assert.equal(reservation.reserved,reservation.bound.input*inputRate+output*outputRate);
  ledger.settle(id,{requestId:id,usage:{inputTokens:reservation.bound.input,outputTokens:output}});
  assert.throws(()=>validateRequest({operation,body:{...body,max_output_tokens:output+1}}),/request_shape/);
 }
 assert.equal(ledger.snapshot().unsettled.length,0);
});
