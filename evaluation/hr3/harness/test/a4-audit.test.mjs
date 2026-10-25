import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';import {join} from 'node:path';
import {useInstalledDependencies} from '../dependencies.mjs';
import {pilotReferenceBundles} from '../cap-certification.mjs';import {referenceEvents} from '../request-certification.mjs';
import {materialize,resolveLinks} from '../research.mjs';import {findPrivateLabels} from '../privacy.mjs';
import {resolveCitation,deliveredIndex} from '../../scorer/citations.mjs';import {assembleContext,meteredText} from '../../../../core/context-read-assembly.mjs';
import {extract} from '../extraction.mjs';
useInstalledDependencies({mcp:'adapters/mcp/node_modules',tokenizer:'adapters/openai/node_modules'});
function scratch(t){const p=mkdtempSync('evaluation/hr3/harness/artifacts/a4-audit-test-');t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
const bundles=pilotReferenceBundles();
for(const language of ['zh-Hant','mixed'])test('audit aliases: '+language+' predecessor names resolve through the public alias table',()=>{
 for(const {family:f}of bundles.filter(b=>b.family.language===language)){const events=f.batches.flatMap(b=>referenceEvents(f,b.ordinal));assert.equal(resolveLinks(events).filter(e=>e.predecessor_refs.length&&e.unresolved).length,0,f.family_id);}
});
function ambiguous(){const f=bundles.find(b=>b.family.language==='en').family;const first=referenceEvents(f,1).find(e=>e.commitment==='adopted'&&!e.context&&e.source_turns.includes('b1-focal'));
 const context={...structuredClone(first),event_id:'context-shared',kind:'context',claims:[],field_mask:[],context:{text:first.source_quotes[0].quote,anchors:first.source_quotes},payload:{type:'context',text:first.source_quotes[0].quote,anchors:first.source_quotes}};
 const next={...structuredClone(first),event_id:'replacement',observed_at:f.batches[1].observed_at,source_turns:['b2-focal'],change_type:'correction',record_name:null,predecessor_refs:[{record_name:first.record_name.name,anchor:{turn_id:'b2-focal',quote:first.record_name.name,occurrence:1,start:0,end:first.record_name.name.length}}]};return {events:[first,context,next],at:f.batches[1].observed_at};}
test('audit common links: shared-turn context ambiguity is identical in T/U/O and P diagnostics',async t=>{
 const {events,at}=ambiguous(),expected=resolveLinks(events).find(e=>e.event_id==='replacement');assert.ok(expected.unresolved);
 for(const arm of ['T','U','O']){const state=materialize(arm,events,at),row=state.current.find(r=>r.id==='replacement');assert.equal(row.status,'unresolved');assert.deepEqual(row.link_errors,expected.link_errors);assert.deepEqual(state.ingestionLosses.find(r=>r.event==='replacement').link_errors,row.link_errors);}
 const {ProductAgent}=await import('../product.mjs');const p=await ProductAgent.open({namespace:{ownerId:'audit-links',scope:'personal',projectId:null},counter:{id:'fake',countTokens:s=>s.length},embedder:{id:'fake',revision:'1',dimensions:1536,normalization:'l2',embed:async ts=>ts.map(()=>[1,...Array(1535).fill(0)])}});t.after(()=>p.close());await p.ingest(events,at);assert.deepEqual(p.log.find(l=>l.method==='unresolved_mapping'&&l.event==='replacement').errors,expected.link_errors);
});
test('audit context coverage: certificates exercise adopted, unresolved and shared-turn context branches',async()=>{
 const {contextConformance}=await import('../context-certification.mjs');const r=await contextConformance({measurementOnly:true});assert.equal(r.status,'MEASUREMENT_ONLY_NOT_CERTIFIED');assert.ok(r.adoptedContexts>0);assert.ok(r.unresolvedContexts>0);assert.ok(r.sharedTurnAmbiguities>0);assert.ok(r.productAdoptedWrites>0);
});
test('audit P addresses: omitted original receipt indices and sameAs aliases use delivered positions without changing blocks',async t=>{
 const {ProductAgent}=await import('../product.mjs');const p=await ProductAgent.open({namespace:{ownerId:'audit-address',scope:'personal',projectId:null},counter:{id:'fake',countTokens:s=>s.length},embedder:{id:'fake',revision:'1',dimensions:1536,normalization:'l2',embed:async ts=>ts.map(()=>[1,...Array(1535).fill(0)])}});t.after(()=>p.close());
 const prepared=[{type:'memory',ns:0,ref:{memoryId:'a',revision:1},fence:'f'.repeat(64),rank:1,text:'body A',metadata:{},sourceAccess:'available',sourcesComplete:true,sources:[{index:0,role:'user',excerpt:'oversized '.repeat(1000)},{index:1,role:'user',excerpt:'A causes B.'},{index:4,role:'user',excerpt:'body A'}]},{type:'memory',ns:0,ref:{memoryId:'b',revision:1},fence:'f'.repeat(64),rank:2,text:'body B',metadata:{},sourceAccess:'available',sourcesComplete:true,sources:[{index:9,role:'user',excerpt:'A causes B.'}]}];
 const assembled=assembleContext({prepared,counter:{id:'character-fixture',countTokens:s=>s.length},policy:{id:'rank-first-whole-record-v1'},budget:{maxTokens:2200,maxItems:12},snapshotOf:()=>null,deadlineAt:Infinity,now:()=>0});
 assert.equal(assembled.metered.items[0].sources[0].index,1);assert.equal(assembled.metered.items[0].sources[1].sameAsBody,true);assert.deepEqual(assembled.metered.items[1].sources[0].sameAs,{item:0,source:0});const raw=meteredText(assembled.metered);
 p.toolEnvelope=async()=>({ok:true,value:[]});p.tool=async()=>({content:[{type:'text',text:raw}]});const d=await p.retrieve('q');assert.equal(d.blocks.current,raw);assert.equal(d.blocks.history,raw);assert.deepEqual(d.diagnostics.current.sourceAddresses[0],{item:0,deliveredSource:0,originalReceiptIndex:1});
 for(const [item,source,quote]of [[0,0,'A causes B.'],[0,1,'body A'],[1,0,'A causes B.']])assert.equal(resolveCitation({intent:'current',item,unit:'receipt',source,quote,occurrence:1},deliveredIndex(d.delivered)).ok,true);
});
test('audit paid gate: missing preflight cannot open a journal or dispatch',async t=>{
 const {run}=await import('../runner.mjs');const out=join(scratch(t),'out');let calls=0;
 await assert.rejects(run({stage:'pilot',inputs:'evaluation/hr3/generator/artifacts/pilot',out,carryForward:'evaluation/hr3/harness/reports/a4-carry-forward.json',transport:{async send(){calls++;throw Error('must_not_dispatch');}}}),/paid_preflight/);assert.equal(calls,0);assert.equal(existsSync(join(out,'ledger.jsonl')),false);
});
test('audit freeze closure: graph and independent loader include scorer, real runner and pinned product dependencies',async()=>{
 const {runtimeClosure}=await import('../runtime-closure.mjs');const c=await runtimeClosure();assert.equal(c.status,'PASS');for(const p of ['evaluation/hr3/scorer/slots.mjs','evaluation/hr3/scorer/contract.mjs','evaluation/hr3/generator/slots.mjs','evaluation/hr3/runner/cli-real.mjs','evaluation/hr3/runner/openai-transport.mjs','core/context-read-assembly.mjs','adapters/mcp/server.mjs'])assert.ok(c.files[p],p);assert.deepEqual(c.staticFiles,c.loaderFiles);
});
const privateInjections=[{distractor:'unsupported_cause'},{actions:[{expected:{overwrittenBodyRecoverable:false}}]},{ast:{events:[{distractor:'subject_collision'}]}},{checkpoints:[{expected:{shouldRecoverOld:false}}]}];
for(const [i,body]of privateInjections.entries())test('audit recursive privacy: independent authoring injection '+i,()=>assert.ok(findPrivateLabels(body).length));
test('audit extractor privacy: complete body is scanned before cache or transport',async t=>{
 const f=structuredClone(bundles[0].family);f.header.distractor='unsupported_cause';let sent=0;await assert.rejects(extract({family:f,batch:1,cache:scratch(t),transport:{async send(){sent++;throw Error('must_not_dispatch');}}}),/private_label_leak:extraction-request/);assert.equal(sent,0);
});
test('audit freeze closure: external dependency bytes participate in every certificate binding',async()=>{
 const {runtimeClosure}=await import('../runtime-closure.mjs');const c=runtimeClosure();assert.ok(Object.keys(c.externalFiles).length>0);for(const [p,s]of Object.entries(c.externalFiles))assert.deepEqual(c.files[p],s,p);
});
test('audit research diagnostics: unresolved context and overwrite dispositions match materialized state',()=>{
 const {events,at}=ambiguous();events[1].commitment='unresolved';events[1].predicate='note';
 for(const arm of ['T','U','O']){const state=materialize(arm,events,at),context=state.ingestionLosses.find(r=>r.event==='context-shared');assert.equal(state.current.find(r=>r.id==='context-shared').status,'unresolved');assert.equal(context.outcome,'unresolved_record');assert.deepEqual(context.materializedViews,[{view:'current',status:'unresolved'}]);
  const first=state.ingestionLosses.find(r=>r.event===events[0].event_id);assert.equal(first.outcome,arm==='O'?'not_materialized':'retained');for(const row of state.ingestionLosses)assert.deepEqual(row.materializedViews,['current','history','pending'].flatMap(view=>state[view].filter(r=>r.id===row.event).map(r=>({view,status:r.status}))));
 }
});
