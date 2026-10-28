import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { generateSnapshot } from '../generate.mjs';
import { validate } from '../adapter.mjs';
import { errorSchema } from '../schemas.mjs';
import { inventory } from '../corpus.mjs';
import { createCounter,defaultDependencyRoot } from '../counter.mjs';
import { storage } from '../../../tools/testing/measure-context-read-product.mjs';
import { build } from '../../../tools/testing/fixtures/context-product/series.mjs';
import { configure,selectReadSet } from '../../../tools/testing/fixtures/context-product/engine.mjs';
import { rehearsalDecision,functionalEvidence,rehearsalSession } from '../../../tools/testing/fixtures/context-product/rehearsal-checks.mjs';
import { checkedSegments } from '../../../tools/testing/fixtures/context-product/v4-checkpoints.mjs';
import { validateFilled } from '../registration.mjs';
import template from '../registration.engine.template.json' with {type:'json'};
test('counter matches the exact offline adapter tokenizer including literal special tokens',async()=>{
  const dependencyRoot=process.env.QUAL_COUNTER_ROOT??defaultDependencyRoot;
  assert.ok(dependencyRoot,'set QUAL_COUNTER_ROOT to the offline dependency root');
  const require=createRequire(join(dependencyRoot,'package.json'));
  const {Tiktoken}=require('js-tiktoken/lite'),ranks=require('js-tiktoken/ranks/o200k_base'),reference=new Tiktoken(ranks);
  const c=await createCounter({dependencyRoot});
  for(const text of ['東京 海港 orchard','<|endoftext|> <|fim_prefix|>','', '😀\nカタカナ 中文 abc'])assert.equal(c.countTokens(text),reference.encode(text,[],[]).length);
  await assert.rejects(createCounter({dependencyRoot,counterId:'another-counter'}),/counter_identity/);
});
test('rehearsal can never qualify, retains failures, and strips timing observations',()=>{
  assert.equal(rehearsalDecision().decision,'inconclusive');assert.equal(rehearsalDecision(['actual_defect']).decision,'failed');
  assert.throws(()=>checkedSegments({mode:'rehearse'},[]),/rehearsal_cannot_qualify/);
  assert.throws(()=>validateFilled(template),/unfilled_registration/);
  assert.deepEqual(functionalEvidence({elapsedMs:4,hostLoop:{maxMs:1},nested:{readStartedAt:2,ok:true},expected:true}),{nested:{ok:true},expected:true});
  assert.deepEqual(functionalEvidence({items:[{at:1,ok:true}],operations:['capture'],elapsedMs:3}),{items:[{ok:true}],operations:['capture']});
  assert.equal(rehearsalSession({availability:[],targets:[{id:'missing',type:'memory'}]},{writerResult:null,availabilityRecords:[],records:[],targets:[]}).decision,'failed');
});
test('real format-2 sidecar verifier visits documents, postings and statistics for both intents',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'tiny.sqlite');
  generateSnapshot({schema:23,count:32,cards:4},path);
  // Fixture preparation has no performance assertion; allow the supported 5 s
  // operation budget on a shared host. Registered measurement quanta stay fixed.
  const config={path,...selectReadSet(inventory,'verify-v2'),types:['memory','card'],canonical:'DELETE',sidecar:'DELETE',functionalOnly:true,
    deadlines:{openMs:5000,requestMs:5000,readMs:5000},buildCeiling:1000,pump:{quantum:{maxItems:128,maxMs:5000}}};
  const request=await configure(config),service=await configure(config,true);
  assert.notEqual(request.options.host.moduleUrl,service.options.host.moduleUrl);
  await request.supervisor.close();await service.supervisor.close();
  await build(config);
  const verified=await storage('verify-sidecar',{path:path+'.context-read-product-v1.1.sqlite'});
  assert.equal(verified.exit.code,0);assert.equal(verified.value.publications,2);assert.ok(verified.value.verifiedRows>32);
});

test('normal read timeouts and cancellation remain functional failures at the registered deadline',()=>{
  const config={responseSchema:errorSchema};
  for(const code of ['read_timeout','read_cancelled'])assert.equal(validate({ok:false,error:{code,retryable:false}},config),false);
  for(const code of ['index_unavailable','storage_busy'])assert.equal(validate({ok:false,error:{code,retryable:false}},config),true);
});
