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
const request=(id='one')=>({id,operation:'reader',body:responseRequest('reader',{})});
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
  const {ledger}=fixture(t),fake=new FakeTransport(),guard=new GuardedTransport({async send(r){if(mode==='unknown')throw Error('unknown');const reply=await fake.send(r);if(mode==='model-mismatch')reply.model='different';if(mode==='overusage')reply.usage.outputTokens=4353;if(mode==='provider-id')reply.requestId='same';return reply;}},ledger);
  if(mode==='provider-id'){await guard.send(request('a'));await assert.rejects(guard.send(request('b')),/unexplained_usage/);}else await assert.rejects(guard.send(request()));assert.ok(ledger.snapshot().stopped);
 }
});
test('five-minute lack of progress and dispatch timeout are supervised',async t=>{
 const {ledger}=fixture(t);let now=0;const guard=new GuardedTransport(new FakeTransport(),ledger,{now:()=>now});now=300000;await assert.rejects(guard.send(request()),/five_minutes/);assert.equal(ledger.snapshot().reservations,0);
 const other=fixture(t),hung=new GuardedTransport({send:()=>new Promise(()=>{})},other.ledger,{timeoutMs:5});assert.equal((await hung.send(request())).status,'transport_exhausted');assert.equal(other.ledger.snapshot().unsettled.length,2);
});
test('strict body models, no tools/prior state, caps and byte/embed bounds',()=>{
 for(const change of [{tools:[]},{previous_response_id:'x'},{store:true},{temperature:1},{max_output_tokens:4353}])assert.throws(()=>validateRequest({...request(),body:{...request().body,...change}}),/request_shape/);
 const alt=responseRequest('extraction',{}, {alternative:true});assert.equal(alt.temperature,undefined);assert.deepEqual(alt.reasoning,{effort:'none'});assert.equal(alt.max_output_tokens,4352);
 assert.throws(()=>validateRequest({operation:'reader',body:responseRequest('reader',{text:'x'.repeat(60000)})}),/byte_bound/);
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
test('A-6.1 reserves and settles unchanged output ceilings at amended input bounds and unchanged prices',t=>{
 const {ledger}=fixture(t);
 for(const [operation,alternative,output,inputCeiling,inputRate,outputRate] of [['reader',false,2176,57344,400,1600],['extraction',false,4352,40960,400,1600],['extraction',true,4352,40960,750,4500]]){
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

test('A-1.1 supervisor checks actual progress each minute and stops while between dispatches',t=>{
 t.mock.timers.enable({apis:['setInterval']});const {ledger}=fixture(t);let now=0,checks=0;
 const guard=new GuardedTransport(new FakeTransport(),ledger,{now:()=>now});guard.startSupervision(()=>checks++);t.after(()=>guard.stopSupervision());
 for(let minute=1;minute<=4;minute++){now=minute*60000;t.mock.timers.tick(60000);assert.equal(checks,minute);assert.equal(ledger.snapshot().stopped,null);}
 now=300000;t.mock.timers.tick(60000);assert.equal(ledger.snapshot().stopped,'five_minutes_without_progress');
 assert.throws(()=>guard.checkProgress(),/five_minutes_without_progress/);
});
test('A-1.1 five-minute elapsed dispatch cannot reset progress or settle usage',async t=>{
 const {ledger}=fixture(t);let now=0;const fake=new FakeTransport();
 const guard=new GuardedTransport({async send(r){const reply=await fake.send(r);now=300000;return reply;}},ledger,{now:()=>now});
 await assert.rejects(guard.send(request()),/five_minutes_without_progress/);assert.equal(fake.calls.length,1);assert.equal(ledger.snapshot().unsettled.length,1);assert.equal(ledger.snapshot().stopped,'five_minutes_without_progress');
});
test('A-1.1 supervisor aborts a pending dispatch on the five-minute stop without retries',async t=>{
 t.mock.timers.enable({apis:['setInterval']});const {ledger}=fixture(t);let now=0,calls=0,signal;
 const guard=new GuardedTransport({send(r,o){calls++;signal=o.signal;return new Promise(()=>{});}},ledger,{now:()=>now});guard.startSupervision();t.after(()=>guard.stopSupervision());
 const pending=guard.send(request());now=300000;t.mock.timers.tick(60000);
 await assert.rejects(pending,/five_minutes_without_progress/);assert.equal(signal.aborted,true);assert.equal(calls,1);assert.equal(ledger.snapshot().unsettled.length,1);
});
test('A-1.1 accounting corruption stops before any dispatch and preserves evidence',async t=>{
 const {ledger,path}=fixture(t);appendFileSync(path,'{');const original=readFileSync(path);let calls=0;
 const guard=new GuardedTransport({async send(){calls++;}},ledger);await assert.rejects(guard.send(request()),/accounting_mismatch:ledger_incomplete/);
 assert.equal(calls,0);assert.deepEqual(readFileSync(path),original);
});
