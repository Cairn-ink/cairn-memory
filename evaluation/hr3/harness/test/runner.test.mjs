import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {join} from 'node:path';
import {run,planFor} from '../runner.mjs';import {FakeTransport,GuardedTransport} from '../transport.mjs';import {Ledger} from '../ledger.mjs';
import {responseRequest,validateRequest,INPUT_CAPS,READER_INPUT_CAPS,OUTPUT_CAPS} from '../requests.mjs';
import {verifiedInputs} from '../inputs.mjs';import {writeBoundReport} from '../bounds.mjs';import {plan} from './fixtures.mjs';
function scratch(t){const d=mkdtempSync('evaluation/hr3/harness/artifacts/a61-runner-');t.after(()=>rmSync(d,{recursive:true,force:true}));return d;}
test('A6.1 real runner smoke completes 16 answers with a fixed 60-family pilot plan and simulated usage only',async t=>{
 const out=join(scratch(t),'smoke'),fake=new FakeTransport(),result=await run({inputs:'evaluation/hr3/generator/artifacts/pilot',out,transport:fake});assert.equal(result.observations.length,16);
 const summary=JSON.parse(readFileSync(join(out,'summary.json'))),record=JSON.parse(readFileSync(join(out,'run.json')));assert.equal(summary.complete,true);assert.equal(record.offline,true);assert.equal(record.transport,'FakeTransport');
 const events=readFileSync(join(out,'ledger.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.ok(events.filter(e=>e.type==='settle').every(e=>e.requestId.startsWith('fake-')));
 const full=planFor(verifiedInputs('evaluation/hr3/generator/artifacts/pilot').families);assert.deepEqual(full.slice(0,2).map(p=>p.maxDispatches),[480,960]);assert.equal(summary.ledger.unsettled.length,0);
});
test('A6.1 frozen extractor models fit approved inputs; oversized requests still fail before a reservation or dispatch',async t=>{
 const ledger=new Ledger(join(scratch(t),'ledger.jsonl'),{plan}),fake=new FakeTransport(),guard=new GuardedTransport(fake,ledger);
 for(const alternative of [false,true]){const body=responseRequest('extraction',{}, {alternative});assert.equal(validateRequest({operation:'extraction',body}).output,4352);const oversized=responseRequest('extraction',{text:'x'.repeat(INPUT_CAPS.extraction)}, {alternative});await assert.rejects(guard.send({id:'oversized-'+alternative,operation:'extraction',body:oversized}),/request_byte_bound/);}
 assert.equal(fake.calls.length,0);assert.equal(ledger.snapshot().reservations,0);assert.deepEqual(INPUT_CAPS,{reader:57344,extraction:40960});assert.deepEqual(READER_INPUT_CAPS,{T:57344,U:57344,O:49152,P:57344});assert.deepEqual(OUTPUT_CAPS,{reader:2176,extraction:4352});
});
test('A6.1 runtime model mismatch stops with the reservation retained and no imported cache',async t=>{
 const out=join(scratch(t),'smoke'),fake=new FakeTransport({modes:['model-mismatch']});await assert.rejects(run({inputs:'evaluation/hr3/generator/artifacts/pilot',out,transport:fake}),/model_mismatch/);assert.equal(fake.calls.length,1);const s=JSON.parse(readFileSync(join(out,'summary.json')));assert.equal(s.complete,false);assert.equal(s.attempted,0);assert.equal(s.ledger.unsettled.length,1);
});
test('A6.1 stopped-pilot bound report retains all 480 opportunities and publishes no uncertainty',async t=>{
 const d=scratch(t),out=join(d,'pilot');await assert.rejects(run({stage:'pilot',inputs:'evaluation/hr3/generator/artifacts/pilot',out,transport:new FakeTransport({modes:['model-mismatch']})}),/model_mismatch/);
 const before=readFileSync(join(out,'ledger.jsonl')),r=writeBoundReport({stageDirectory:out,inputs:'evaluation/hr3/generator/artifacts/pilot',out:join(d,'bounds.json')});assert.equal(r.denominators.attempted,0);assert.equal(r.denominators.unexecuted,480);assert.equal(r.continuationApproval,false);assert.deepEqual(readFileSync(join(out,'ledger.jsonl')),before);
 const keys=[];function visit(v){if(v&&typeof v==='object'){keys.push(...Object.keys(v));Object.values(v).forEach(visit);}}visit(r);assert.ok(!keys.some(k=>/confidence.?interval|bootstrap.?estimate|contrast.?uncertainty/i.test(k)));
});
