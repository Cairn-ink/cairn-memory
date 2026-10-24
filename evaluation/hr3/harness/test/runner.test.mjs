import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync,mkdtempSync,rmSync,openSync,closeSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { emit } from '../../generator/deliver.mjs';
import { run } from '../runner.mjs';
import { FakeTransport } from '../transport.mjs';
import { writeBoundReport, LABEL } from '../bounds.mjs';
import { verifiedInputs } from '../inputs.mjs';
import { validateExtraction } from '../schema.mjs';
import { canonical } from '../common.mjs';
import { validate,answerSchema } from '../../scorer/schema.mjs';
test('full offline fake pilot: frozen inputs, 240 extractions, 480 stateless scored answers across four arms',async t=>{
 let root=globalThis.hr3PilotArtifacts;
 if(!root){const dir=mkdtempSync(join(tmpdir(),'hr3-full-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const input=join(dir,'inputs');await emit({split:'pilot',out:input});root=join(dir,'pilot');await run({stage:'pilot',inputs:input,out:root,progress:p=>t.diagnostic(`scored ${p.observations}/480`)});}
 const summary=JSON.parse(readFileSync(join(root,'summary.json')));assert.equal(summary.complete,true);assert.equal(summary.attempted,480);assert.deepEqual(summary.ledger.unsettled,[]);assert.equal(summary.ledger.stopped,null);
 for(const arm of ['U','T','O','P'])assert.deepEqual(summary.arms[arm],{attempted:120,valid:120});
 const scores=readFileSync(join(root,'scored.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(scores.length,480);assert.equal(readdirSync(join(root,'scores')).length,480);
 const journal=readFileSync(join(root,'ledger.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(journal.filter(e=>e.type==='reserve'&&e.operation==='extraction').length,240);assert.equal(journal.filter(e=>e.type==='reserve'&&e.operation==='reader').length,480);
 const manifest=JSON.parse(readFileSync(join(root,'manifest.json')));assert.equal(manifest.count,2225);assert.equal(Object.keys(manifest.files).length,2225);
 const extractions=readdirSync(join(root,'extractions'));assert.equal(extractions.length,240);
 for(const file of extractions){const e=JSON.parse(readFileSync(join(root,'extractions',file)));assert.equal(e.error,null);const input=JSON.parse(e.body.input[1].content);validateExtraction(e.value,input);assert.deepEqual(Object.keys(input).sort(),['observed_at','public_header','turns']);}
 for(const file of readdirSync(join(root,'answers'))){const a=JSON.parse(readFileSync(join(root,'answers',file)));assert.deepEqual(validate(answerSchema,a.answer),[]);assert.equal(a.body.input.length,2);assert.equal(a.body.max_output_tokens,2176);assert.equal(a.body.store,false);assert.equal(a.body.tools,undefined);assert.equal(a.body.previous_response_id,undefined);}
 const readerCounts=new Map();for(const e of journal.filter(e=>e.type==='reserve'&&e.operation==='reader'))readerCounts.set(e.logicalId,(readerCounts.get(e.logicalId)??0)+1);assert.ok([...readerCounts.values()].every(n=>n===1));
 const reportDir=mkdtempSync(join(tmpdir(),'hr3-pilot-bounds-'));t.after(()=>rmSync(reportDir,{recursive:true,force:true}));
 const reportInputs=join(reportDir,'inputs');await emit({split:'pilot',out:reportInputs});
 const report=writeBoundReport({stageDirectory:root,inputs:reportInputs,out:join(reportDir,'bounds.json')});
 assert.equal(report.label,LABEL);assert.equal(report.tables.length,48);assert.equal(report.perFamily.length,480);
 assert.deepEqual(report.denominators,{planned:480,attempted:480,validCompletion:480,failedAttempt:0,unexecuted:0,plannedFamilies:60,plannedLineages:30,representedFamilies:60,representedLineages:30});
 assert.equal(report.metadata.actualSpendUSD,0);assert.equal(report.metadata.scorer,'hr3-scorer-v1');
 for(const row of report.tables){assert.equal(row.denominators.attempted,row.denominators.planned);assert.equal(row.denominators.unexecuted,0);for(const c of ['C','O','R','J'])assert.equal(Object.values(row.rates[c].counts).reduce((a,b)=>a+b,0),row.denominators.attempted);}
 t.diagnostic(`pilot verified: 60 families, 240 extractions, 480 scored observations, ${summary.ledger.reservations} reservations`);
});
test('independent fake smoke runs have identical research artifacts and all-arm scores',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'hr3-determinism-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const input=join(dir,'inputs');await emit({split:'pilot',out:input});const data=verifiedInputs(input);assert.equal(data.verification.files,7);
 const a=await run({inputs:input,out:join(dir,'a')}),b=await run({inputs:input,out:join(dir,'b')});
 assert.equal(canonical(a.observations),canonical(b.observations));
 for(const file of readdirSync(join(dir,'a','states')).filter(f=>!f.includes('-P-')))assert.equal(readFileSync(join(dir,'a','states',file),'utf8'),readFileSync(join(dir,'b','states',file),'utf8'));
 for(const file of readdirSync(join(dir,'a','extractions')))assert.equal(readFileSync(join(dir,'a','extractions',file),'utf8'),readFileSync(join(dir,'b','extractions',file),'utf8'));
 // P retains real random product IDs, fences, clocks and latency diagnostics. Raw P bytes are audited, not rewritten.
});
test('a transport stop preserves and scores completed reader attempts without zero-filling unexecuted arms',async t=>{
 const {TransportError}=await import('../transport.mjs');const dir=mkdtempSync(join(tmpdir(),'hr3-stop-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const input=join(dir,'inputs');await emit({split:'pilot',out:input});let readers=0;
 class FailureTransport extends FakeTransport {async send(request,options){if(request.operation==='reader'&&++readers>1)throw new TransportError();return super.send(request,options);}}
 const out=join(dir,'out');await assert.rejects(run({stage:'pilot',inputs:input,out,transport:new FailureTransport()}),/three_transport_failures/);
 const summary=JSON.parse(readFileSync(join(out,'summary.json')));assert.equal(summary.complete,false);assert.equal(summary.attempted,2);assert.equal(summary.arms.U.attempted,1);assert.equal(summary.arms.T.attempted,1);assert.equal(summary.arms.O.attempted,0);assert.equal(summary.arms.P.attempted,0);assert.equal(summary.ledger.unsettled.length,3);assert.ok(readdirSync(join(out,'states')).some(f=>f.endsWith('-P-final.json')));
 const reportFile=join(dir,'partial.json'),stdoutFile=join(dir,'report.stdout'),stderrFile=join(dir,'report.stderr');
 const stdout=openSync(stdoutFile,'wx'),stderr=openSync(stderrFile,'wx');let result;
 const beforeLedger=readFileSync(join(out,'ledger.jsonl'),'utf8'),beforeManifest=readFileSync(join(out,'manifest.json'),'utf8');
 try {result=spawnSync(process.execPath,['evaluation/hr3/harness/cli.mjs','--bound-report',out,'--inputs',input,'--out',reportFile],{stdio:['ignore',stdout,stderr]});}finally{closeSync(stdout);closeSync(stderr);}
 assert.equal(result.error,undefined);assert.equal(result.status,0,readFileSync(stderrFile,'utf8'));
 const partial=JSON.parse(readFileSync(reportFile));assert.equal(partial.stageStatus.complete,false);assert.equal(partial.stageStatus.stopReason,'three_transport_failures');
 assert.equal(partial.denominators.attempted,2);assert.equal(partial.denominators.unexecuted,478);
 assert.equal(partial.metadata.outstandingReservations.count,3);assert.equal(partial.metadata.actualSpendUSD,0);
 assert.ok(partial.tables.every(row=>row.cohortLabel.startsWith('partial observed cohort')));
 assert.equal(partial.continuationApproval,false);
 assert.equal(readFileSync(join(out,'ledger.jsonl'),'utf8'),beforeLedger);assert.equal(readFileSync(join(out,'manifest.json'),'utf8'),beforeManifest);
 t.diagnostic('official CLI accepted actual interrupted pilot: 2 attempted, 478 unexecuted, 3 outstanding reservations; exit 0');

});
test('A-2 retains an incomplete reader reply as a scored failure without a quality retry',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'hr3-a2-incomplete-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const input=join(dir,'inputs');await emit({split:'pilot',out:input});
 class IncompleteReader extends FakeTransport {
  async send(request){const reply=await super.send(request);if(request.operation==='reader'&&!this.incompleteId){this.incompleteId=request.id;return {...reply,status:'incomplete'};}return reply;}
 }
 const transport=new IncompleteReader(),out=join(dir,'smoke');
 const result=await run({inputs:input,out,transport});
 assert.equal(result.observations.length,16);
 const failed=result.observations.filter(o=>!o.valid);assert.equal(failed.length,1);
 assert.deepEqual(failed[0].scores,{C:0,O:0,R:0,J:0});
 assert.equal(transport.calls.filter(c=>c.id===transport.incompleteId).length,1);
 assert.equal(transport.calls.filter(c=>c.id===transport.incompleteId.replace('/attempt-0','/attempt-1')).length,0);
 const answers=readdirSync(join(out,'answers')).map(name=>JSON.parse(readFileSync(join(out,'answers',name))));
 const incomplete=answers.filter(a=>a.reply.status==='incomplete');assert.equal(incomplete.length,1);assert.equal(incomplete[0].answer,null);
 assert.equal(JSON.parse(readFileSync(join(out,'summary.json'))).attempted,16);
});
