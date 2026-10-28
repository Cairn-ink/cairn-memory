import '../../../core/testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { createProductOpenAIEmbedder,hostedInputBound } from '../../openai/product-embedding.mjs';
const selection={provider:'openai',model:'text-embedding-3-small',dimensions:1536,normalization:'l2',requestTimeoutMs:3000,maxBatchDocuments:64};
const vector=()=>Array.from({length:1536},(_,i)=>i===0?1:0);
const response=(n=1,patch={})=>({object:'list',model:'text-embedding-3-small',data:Array.from({length:n},(_,index)=>({object:'embedding',index,embedding:vector()})),usage:{prompt_tokens:n,total_tokens:n},...patch});
const controls=()=>({deadlineAt:performance.now()+5000,beforeDispatch(){},settleInputTokens(){}});
function provider(fetchImpl,patch={}){return createProductOpenAIEmbedder({selection:{...selection,...patch},apiKey:'synthetic-'+randomUUID(),fetchImpl});}

test('P2e-13 guarded fixed endpoint, singleton query, bounded 64-document batch and actual usage',async()=>{
  const events=[],sent=[];const p=provider(async(url,options)=>{events.push('send');sent.push({url,options});return Response.json(response(JSON.parse(options.body).input.length));});
  const c={...controls(),beforeDispatch(){events.push('guard');},settleInputTokens(n){events.push('usage:'+n);}};
  assert.equal((await p.embed(['x'],c)).length,1);assert.deepEqual(events,['guard','send','usage:1']);
  assert.equal(sent[0].url,'https://api.openai.com/v1/embeddings');assert.equal(sent[0].options.redirect,'error');assert.deepEqual(JSON.parse(sent[0].options.body).input,['x']);
  assert.equal((await p.embed(Array(64).fill('x'),c)).length,64);
  await assert.rejects(p.embed(Array(65).fill('x'),controls()),{code:'invalid_input'});assert.equal(sent.length,2);
  assert.equal(hostedInputBound(['x'.repeat(8176)]),8192);
  assert.throws(()=>hostedInputBound(['x'.repeat(8177)]),{code:'context_item_too_large'});
  for(const texts of [[''],['\0'],['\ud800'],Array(64).fill('x'.repeat(5000))])assert.throws(()=>hostedInputBound(texts));
});

test('P2e-13/15 transport guard failure and aborted cutoff send nothing; errors are sanitized',async()=>{
  let sends=0;const p=provider(async()=>{sends++;throw Error('synthetic-secret-canary');});
  await assert.rejects(p.embed(['x'],{...controls(),beforeDispatch(){throw Object.assign(Error('private'),{code:'price_unavailable'});}}),{code:'price_unavailable'});
  const abort=new AbortController();abort.abort();await assert.rejects(p.embed(['x'],{...controls(),signal:abort.signal}),{code:'timeout'});
  await assert.rejects(p.embed(['x'],{...controls(),deadlineAt:-1}),{code:'timeout'});assert.equal(sends,0);
  await assert.rejects(p.embed(['x'],controls()),e=>e.code==='provider_error'&&e.message==='provider_error');assert.equal(sends,1);
});

for(const [name,json,code] of [
  ['wrong model',response(1,{model:'other'}),'provider_error'],
  ['duplicate index',response(2,{data:[{index:0,embedding:vector()},{index:0,embedding:vector()}]}),'provider_error'],
  ['wrong dimensions',response(1,{data:[{index:0,embedding:[1]}]}),'dimension_mismatch'],
  ['malformed usage',response(1,{usage:{prompt_tokens:-1,total_tokens:-1}}),'provider_error'],
  ['over-bound usage',response(1,{usage:{prompt_tokens:18,total_tokens:18}}),'provider_error'],
  ['wrong count',response(1,{data:[]}),'provider_error']
])test(`P2e-08/13 hosted response refuses ${name} without retry`,async()=>{
  let sends=0;const p=provider(async()=>{sends++;return Response.json(json);});
  await assert.rejects(p.embed(name==='duplicate index'?['x','y']:['x'],controls()),{code});assert.equal(sends,1);
});

test('P2e-08 usage survives invalid vectors; response bytes and redirects are bounded and cancelled',async()=>{
  let used;const p=provider(async()=>Response.json(response(1,{data:[{index:0,embedding:[1]}]})));
  await assert.rejects(p.embed(['x'],{...controls(),settleInputTokens:n=>{used=n;}}),{code:'dimension_mismatch'});assert.equal(used,1);
  let cancelled=0;const body=()=>new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(120000));},cancel(){cancelled++;}});
  await assert.rejects(provider(async()=>new Response(body())).embed(['x'],controls()),{code:'provider_error'});assert.equal(cancelled,1);
  await assert.rejects(provider(async()=>new Response(body(),{status:302,headers:{location:'https://invalid.example'}})).embed(['x'],controls()),{code:'provider_error'});assert.equal(cancelled,2);
  await assert.rejects(provider(async()=>new Response(body(),{status:429})).embed(['x'],controls()),{code:'rate_limited'});assert.equal(cancelled,3);
});
