import test from 'node:test';import assert from 'node:assert/strict';
import {validateExtraction} from '../schema.mjs';import {materialize,retrieve,serializeRecord} from '../research.mjs';
import {sourceOrderAliases,PrivacyGuard,findPrivateLabels} from '../privacy.mjs';
import {ProductAgent,formatEvent} from '../product.mjs';
import {responseRequest,validateRequest} from '../requests.mjs';
import {projectContract,familyContractContext} from '../contract-projection-a4.mjs';
import {extractionInput} from '../extraction.mjs';import {referenceEvents} from '../request-certification.mjs';
import {pilotReferenceBundles} from '../cap-certification.mjs';import {scope,date,plan} from './fixtures.mjs';
const anchor={turn_id:'t1',quote:'route = q; cap = 4 requests/hour. Context only.',occurrence:1};
const input={observed_at:date(1),turns:[{turn_id:'t1',text:anchor.quote}]};
function wire(){return {event_id:'x',source_turns:['t1'],observed_at:date(1),kind:'decision',commitment:'adopted',change_type:'initial',subject:'engineering example',predicate:'dispatch configuration',scope,effective_interval:{from:date(1),to:null},record_name:{name:'q',anchor:{turn_id:'t1',quote:'q',occurrence:1}},predecessor_refs:[],replacement_extent:'entire_predecessor',source_quotes:[anchor],reason_quotes:[],payload:{type:'slots',route:{value:{type:'Text',text:'q'},anchors:[anchor]},approval:null,cap:{value:{type:'Quantity',decimal:'4',unit:'requests/hour'},anchors:[anchor]}}};}
test('exact rational conversions and independent domain/anchor exclusions derive only admitted masks',()=>{
 const e=wire(),valid=validateExtraction({events:[e]},input);assert.deepEqual(valid.events[0].claims.map(c=>[c.field,c.value]),[['value',{type:'Text',text:'q'}],['cap',{type:'Quantity',decimal:'96',unit:'requests/day'}]]);
 e.payload.route.value={type:'Quantity',decimal:'3',unit:'requests/day'};e.reason_quotes=[{...anchor,quote:'absent'}];
 const partial=validateExtraction({events:[e]},input);assert.deepEqual(partial.events[0].field_mask,['cap']);assert.equal(partial.diagnostics.excludedAssignments,1);assert.equal(partial.diagnostics.excludedQuotations,1);
 e.payload.cap.value.unit='unknown/day';assert.equal(validateExtraction({events:[e]},input).events.length,0);
 const malformed=wire();delete malformed.payload.cap.value.decimal;assert.throws(()=>validateExtraction({events:[wire(),malformed]},input),/malformed_extraction/);
});
test('core metadata precedence, exact source-turn anchors and explicit expiry remain independent',()=>{
 const e=wire();e.scope={any:[{all:[{field:'country',values:['XX']}]}]};e.reason_quotes=[{...anchor,quote:'absent'}];
 const bad=validateExtraction({events:[wire(),e]},input);assert.equal(bad.events.length,0,'duplicate IDs exclude every colliding event');
 const expiry=wire();expiry.change_type='expiry';expiry.payload={type:'slots',route:null,approval:null,cap:null};assert.equal(validateExtraction({events:[expiry]},input).events.length,1);
 expiry.source_quotes=[];assert.equal(validateExtraction({events:[expiry]},input).events.length,0);
 const cross=wire();cross.payload.route.anchors=[{...anchor,turn_id:'elsewhere'}];assert.deepEqual(validateExtraction({events:[cross]},input).events[0].field_mask,['cap']);
});
test('non-slot context admits only anchored extracted text and never changes decision cells',async()=>{
 const original=wire(),context=wire();context.event_id='ctx';context.kind='context';context.predicate='note';context.payload={type:'context',text:anchor.quote,anchors:[anchor]};
 const admitted=validateExtraction({events:[original,context]},input).events,aliases=sourceOrderAliases(admitted);
 for(const arm of ['T','U','O']){const state=materialize(arm,admitted,date(1)),decision=state.current.find(r=>r.predicate==='dispatch configuration');assert.equal(decision.fields.length,2);assert.equal(state.current.find(r=>r.context).fields.length,0);
  const d=await retrieve(state,{query:'context',aliases,embedder:{embed:async texts=>texts.map(()=>[1,0])},counter:{countTokens:s=>Math.ceil(s.length/4)}});assert.ok(d.blocks.current.includes('Context only.'));
 }
 context.payload.text='manufactured missing text';assert.equal(validateExtraction({events:[context]},input).events.length,0);
});
test('research serializations retain source associations and deduplicate per record without O archives',()=>{
 const one=validateExtraction({events:[wire()]},input).events[0],two={...structuredClone(one),event_id:'two',observed_at:date(2),source_turns:['t2'],source_quotes:[{turn_id:'t2',quote:'q new',occurrence:1,start:0,end:5}],change_type:'correction',record_name:null,predecessor_refs:[{record_name:'q',anchor:{turn_id:'t2',quote:'q',occurrence:1,start:0,end:1}}],effective_interval:{from:date(2),to:null}};
 const aliases=sourceOrderAliases([one,two]),state=materialize('O',[one,two],date(2));assert.equal(state.history.length,0);assert.equal(state.events,undefined);
 const record=serializeRecord(state.current[0],aliases);assert.ok(!record.body.includes('reason_nodes'));assert.ok(!record.body.includes('field_mask'));assert.deepEqual(record.receipts.map(q=>q.origin),['t2']);
 assert.ok(!JSON.stringify(record).includes('Context only.'));
});
test('P context eligibility, absence/refusal logging, exact formatter quotations and current-event-only writes',async t=>{
 const p=await ProductAgent.open({namespace:{ownerId:'a4-context',scope:'personal',projectId:null},counter:{id:'synthetic',countTokens:s=>Math.ceil(s.length/4)},embedder:{id:'test',revision:'1',dimensions:1536,normalization:'l2',embed:async texts=>texts.map(()=>[1,...Array(1535).fill(0)])}});t.after(()=>p.close());
 const e=wire();e.kind='context';e.payload={type:'context',text:anchor.quote,anchors:[anchor]};const admitted=validateExtraction({events:[e]},input).events;
 await p.ingest(admitted,date(1));assert.equal(p.refs.size,1);assert.ok(formatEvent(admitted[0]).includes(anchor.quote));assert.equal(formatEvent(admitted[0]).split(anchor.quote).length-1,1);
 const skipped={...admitted[0],event_id:'proposal',commitment:'proposed'};await p.ingest([skipped],date(1));assert.equal(p.refs.size,1);assert.ok(p.log.some(l=>l.event==='proposal'&&l.reason==='commitment_filter'));
});
test('reader contracts are identical across arms; private contract extensions cannot evade the inventory',()=>{
 const f=pilotReferenceBundles()[0].family,cp=f.checkpoints[0],c=projectContract('reader',familyContractContext(f,cp.question));
 for(const arm of ['T','U','O','P']){const b=responseRequest('reader',{question:cp.question,public_contract:c,delivered:{current:'',history:''}});new PrivacyGuard(f).check('reader-request',b,{arm});assert.equal(validateRequest({operation:'reader',body:b,id:f.family_id+'/reader/'+arm+'/'+cp.batch}).output,2176);}
 const injected=structuredClone(c);injected.stage='private';assert.throws(()=>responseRequest('reader',{public_contract:injected}),/public_contract_projection/);assert.ok(findPrivateLabels({public_contract:injected}).length);
 assert.ok(findPrivateLabels({memory:{aliases:true}}).length,'The same key stays private outside the verified contract boundary');
});

test('identical product excerpts from different source turns never acquire a guessed provenance',async t=>{
 const p=await ProductAgent.open({namespace:{ownerId:'a4-repeated',scope:'personal',projectId:null},counter:{id:'synthetic',countTokens:s=>Math.ceil(s.length/4)},embedder:{id:'test',revision:'1',dimensions:1536,normalization:'l2',embed:async texts=>texts.map(()=>[1,...Array(1535).fill(0)])}});t.after(()=>p.close());
 const first={segments:[{origin:'t1',start:0,text:'same causal clause'}],normalize:true,truncate:800},second={segments:[{origin:'t2',start:0,text:'same causal clause'}],normalize:true,truncate:800};
 p.registerReceiptOrigin('same causal clause',first);p.registerReceiptOrigin('same causal clause',first);assert.deepEqual(p.receiptOrigin('same causal clause'),first);
 p.registerReceiptOrigin('same causal clause',second);assert.equal(p.receiptOrigin('same causal clause'),null);assert.ok(p.log.some(l=>l.method==='ambiguous_receipt_origin'));
});

test('valid admitted partial updates inherit, while entire replacement and expiry clear inherited predecessor fields',()=>{
 const initial=wire();initial.payload.approval={value:{type:'Boolean',value:false},anchors:[anchor]};
 const first=validateExtraction({events:[initial]},input).events[0];
 const patch=wire();patch.event_id='patch';patch.observed_at=date(2);patch.source_turns=['t2'];patch.source_quotes=[{turn_id:'t2',quote:'Record beta: refine q; adopt a partial cap-only update: 8 requests/hour.',occurrence:1}];patch.change_type='refinement';patch.replacement_extent='partial';patch.record_name={name:'beta',anchor:{turn_id:'t2',quote:'beta',occurrence:1}};patch.predecessor_refs=[{record_name:'q',anchor:{turn_id:'t2',quote:'q',occurrence:1}}];patch.effective_interval={from:date(2),to:null};patch.payload={type:'slots',route:null,approval:null,cap:{value:{type:'Quantity',decimal:'8',unit:'requests/hour'},anchors:patch.source_quotes}};
 const second=validateExtraction({events:[patch]},{observed_at:date(2),turns:[{turn_id:'t2',text:patch.source_quotes[0].quote}]}).events[0];
 const typed=materialize('T',[first,second],date(2));assert.deepEqual(typed.current[0].fields.map(x=>x.field).sort(),['approval','cap','value']);
 for(const arm of ['U','O'])assert.deepEqual(materialize(arm,[first,second],date(2)).current[0].fields.map(x=>x.field),['cap']);
 for(const expiry of [false,true]){
  const e=wire();e.event_id='end';e.observed_at=date(3);e.source_turns=['t3'];e.source_quotes=[{turn_id:'t3',quote:expiry?'Record end: beta explicit deadline passed and this decision expires.':'Record end: withdraw beta, the entire predecessor, and adopt route z alone.',occurrence:1}];e.change_type=expiry?'expiry':'reversal';e.record_name={name:'end',anchor:{turn_id:'t3',quote:'end',occurrence:1}};e.predecessor_refs=[{record_name:'beta',anchor:{turn_id:'t3',quote:'beta',occurrence:1}}];e.effective_interval={from:date(3),to:null};e.payload={type:'slots',route:expiry?null:{value:{type:'Text',text:'z'},anchors:e.source_quotes},approval:null,cap:null};
  const end=validateExtraction({events:[e]},{observed_at:date(3),turns:[{turn_id:'t3',text:e.source_quotes[0].quote}]}).events[0];
  const state=materialize('T',[first,second,end],date(3));assert.deepEqual(state.current[0].fields.map(x=>x.field),expiry?[]:['value']);
  const historical=state.history.find(r=>r.id==='patch');assert.equal(historical.fields.length,3);assert.equal(historical.status,expiry?'expired':'previously_adopted');
 }
});

test('core enum and scope-domain defects exclude one event while malformed containers still fail the batch',()=>{
 for(const patch of [{kind:'unknown'},{commitment:'unknown'},{change_type:'unknown'},{replacement_extent:'unknown'},{scope:{any:[{all:[{field:'unknown',values:['x']}]}]}}]){
  const bad={...wire(),...patch,event_id:'bad'};const result=validateExtraction({events:[wire(),bad]},input);assert.equal(result.events.length,1);assert.equal(result.diagnostics.rejectedEvents,1);
 }
 const bad=wire();bad.commitment=42;assert.throws(()=>validateExtraction({events:[wire(),bad]},input),/malformed_extraction/);
});

test('paid accounting rejects a fake third-pilot source before preparing a supplemental manifest',async t=>{
 const {mkdtempSync,rmSync,writeFileSync,readFileSync,existsSync}=await import('node:fs');const {join}=await import('node:path');
 const {prepareA4Accounting,BASE_MANIFEST,A4_MANIFEST}=await import('../accounting-a4.mjs');const {Ledger}=await import('../ledger.mjs');const {hash}=await import('../common.mjs');
 const dir=mkdtempSync('evaluation/hr3/harness/artifacts/a4-accounting-test-');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const baseline=readFileSync(BASE_MANIFEST),outputBefore=existsSync(A4_MANIFEST)?readFileSync(A4_MANIFEST):null;
 const ledgerPath=join(dir,'ledger.jsonl'),ledger=new Ledger(ledgerPath,{plan,carryForward:BASE_MANIFEST});ledger.reserve({id:'simulated',operation:'reader',body:responseRequest('reader',{})});
 const save=(name,value)=>{const path=join(dir,name);writeFileSync(path,JSON.stringify(value)+'\n');return {path,sha256:hash(readFileSync(path))};};
 const run=save('run.json',{offline:true,stage:'pilot'}),summary=save('summary.json',{stage:'pilot',ledger:ledger.snapshot()});
 const sources=save('sources.json',{version:'hr3-a4-accounting-input-v1',baseManifest:{path:BASE_MANIFEST,sha256:hash(baseline)},thirdPilotLedger:{path:ledgerPath,sha256:hash(readFileSync(ledgerPath))},thirdPilotRun:run,thirdPilotSummary:summary,additionalPreparationReceipts:[],preparationComplete:true,attestation:'Test-only deliberately fake input; must be refused.'});
 assert.throws(()=>prepareA4Accounting(sources.path,{write:true}),/Fake accounting/);assert.equal(hash(readFileSync(BASE_MANIFEST)),hash(baseline));assert.deepEqual(existsSync(A4_MANIFEST)?readFileSync(A4_MANIFEST):null,outputBefore);
});


test('A6 runtime requires the fourth-pilot chain and a primary preparation completeness record',async t=>{
 const fs=await import('node:fs'),{join,isAbsolute}=await import('node:path'),{runInNewContext}=await import('node:vm');
 const {verifyA6RunAccounting}=await import('../runner.mjs');
 const {A6_CARRY,A6_ACCOUNTING_INPUT,accountingA6}=await import('../accounting-a6.mjs');
 const {loadCarryForward,auditLedger}=await import('../accounting.mjs');
 const {canonical,hash,fail}=await import('../common.mjs');
 const {INPUT_CAPS,OUTPUT_CAPS,READER_INPUT_CAPS}=await import('../requests.mjs');
 const originalInput=fs.readFileSync(A6_ACCOUNTING_INPUT),originalCarry=fs.readFileSync(A6_CARRY);
 const dir=fs.mkdtempSync('evaluation/hr3/harness/artifacts/a6-preparation-fixtures-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const accountingSource=fs.readFileSync(new URL('../accounting-a6.mjs',import.meta.url),'utf8').split('if(process.argv[1]')[0].replace(/^import .*\n/gm,'').replace(/^export /gm,'');
 const runnerSource=fs.readFileSync(new URL('../runner.mjs',import.meta.url),'utf8');
 const guardSource=runnerSource.slice(runnerSource.indexOf('export function verifyA6RunAccounting('),runnerSource.indexOf('// Historical import name only;')).replace(/^export /gm,'');
 for(const kind of ['missing','stale','test-only']){
  const fixtureDir=join(dir,kind);fs.mkdirSync(fixtureDir);
  const input=JSON.parse(originalInput),carry=JSON.parse(originalCarry);
  if(kind==='missing'){delete input.preparation;carry.preparation={complete:false,receipts:[]};}
  if(kind==='stale')carry.preparation.attestation+=' [STALE TEST FIXTURE]';
  if(kind==='test-only'){input.preparation.testOnly=true;carry.preparation.attestation='TEST ONLY: never primary preparation evidence.';}
  const inputPath=join(fixtureDir,'input.json'),carryPath=join(fixtureDir,'carry.json');
  fs.writeFileSync(inputPath,JSON.stringify(input)+'\n');fs.writeFileSync(carryPath,JSON.stringify(carry)+'\n');
  // Run the actual accounting and guard source, changing only filesystem inputs.
  // Real manifests are never mutated; no fixture can become a dispatch input.
  const mapPath=path=>path===A6_ACCOUNTING_INPUT?inputPath:path===A6_CARRY?carryPath:path;
  const context={assert,isAbsolute,canonical,hash,fail,auditLedger,INPUT_CAPS,OUTPUT_CAPS,READER_INPUT_CAPS,
   readFileSync:(path,...args)=>fs.readFileSync(mapPath(path),...args),
   writeFileSync:()=>assert.fail('Fixture must never write accounting records'),
   loadCarryForward:path=>loadCarryForward(mapPath(path))};
  runInNewContext(accountingSource+'\n'+guardSource+'\nglobalThis.verify=verifyA6RunAccounting;',context);
  if(kind==='missing')assert.throws(()=>context.verify(A6_CARRY),/a6_preparation_completeness_required/);
  else assert.throws(()=>context.verify(A6_CARRY),error=>error.code==='ERR_ASSERTION',kind+' record must fail actual accounting validation');
 }
 const verified=verifyA6RunAccounting(A6_CARRY);assert.equal(verified.preparationComplete,true);
 assert.equal(verified.exposure.total,4145077720);assert.deepEqual(verified,accountingA6().carry);
 for(const path of [null,'evaluation/hr3/harness/reports/a4-carry-forward.json'])assert.throws(()=>verifyA6RunAccounting(path),/a6_complete_accounting_required/);
 assert.deepEqual(fs.readFileSync(A6_ACCOUNTING_INPUT),originalInput);assert.deepEqual(fs.readFileSync(A6_CARRY),originalCarry);
});
