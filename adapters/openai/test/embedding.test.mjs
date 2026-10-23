import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createOpenAIEmbedder, estimateEmbeddingUsd, DEFAULT_EMBEDDING_MODEL, DEFAULT_EMBEDDING_DIMENSIONS } from '../embedding.mjs';
import { contextOptions } from '../../../core/context-read-input.mjs';
import { contextBudget } from '../../../core/context-read-budget.mjs';
import { embeddingServer } from './embedding-support.mjs';

function client(server,{model=DEFAULT_EMBEDDING_MODEL,dimensions=8,maxRequests=20,maxUsd=.1}={}) {
  const embedder=createOpenAIEmbedder({apiKey:'synthetic-not-a-key',model,dimensions,endpoint:server.endpoint});
  const config=contextOptions({version:'context-read-v1',authority:{authorize(){},isCurrent(){}},embedder,
    policy:{family:'hosted',maxRequests,maxUsd,estimateUsd:texts=>estimateEmbeddingUsd(texts,{model})}});
  const dispatch=contextBudget(config);
  return {embedder,call:(texts=['synthetic'],{signal=new AbortController().signal,ms=5000,guard=()=>{}}={})=>
    dispatch(config.embedder,texts,{signal,deadlineAt:performance.now()+ms,guard})};
}

test('R04 OpenAI embedding metadata defaults and explicit pricing; construction makes no HTTP call',async()=>{
  const adapter=createOpenAIEmbedder({apiKey:'synthetic-not-a-key'});
  assert.equal(DEFAULT_EMBEDDING_MODEL,'text-embedding-3-small');assert.equal(DEFAULT_EMBEDDING_DIMENSIONS,1536);
  assert.equal(adapter.dimensions,1536);assert.equal(adapter.revision,'provider-unversioned');assert.equal(adapter.normalization,'l2');
  for(const patch of [{dimensions:32769},{dimensions:0},{apiKey:'private\nsecret'},{endpoint:'http://foreign.invalid/'},{model:'unpriced-model'}])
    assert.throws(()=>createOpenAIEmbedder({apiKey:'synthetic',...patch}),{code:'invalid_input'});
  assert.equal(createOpenAIEmbedder({apiKey:'synthetic',model:'reviewed-custom',usdPerMillionTokens:1}).revision,'provider-unversioned');
  let settled;
  await assert.rejects(adapter.embed(['中'.repeat(3000)],{beforeDispatch(){assert.fail('HTTP dispatch');},
    deadlineAt:performance.now()+1000,settleUsd(value){settled=value;}}),{code:'context_item_too_large'});
  assert.equal(settled,0);
});

test('R04/R10 actual fake HTTP embeddings: explicit wire, order restoration and reported-token settlement',async t=>{
  const server=await embeddingServer(t),c=client(server);server.state.mode='reverse';
  const vectors=await c.call(['car','automobile']);assert.equal(vectors.length,2);assert.deepEqual(vectors[0],vectors[1]);
  assert.deepEqual(server.state.requests[0].body,{model:'text-embedding-3-small',dimensions:8,encoding_format:'float',input:['car','automobile']});
  const cost=estimateEmbeddingUsd(['synthetic'],{model:'text-embedding-3-large'});
  const settled=client(server,{model:'text-embedding-3-large',maxRequests:2,maxUsd:cost*1.5});
  await settled.call();await settled.call(); // First reported token releases the unused reservation.
  await assert.rejects(settled.call(),{code:'budget_denied'});
});

test('R04/R05 provider failures, invalid vectors, byte limits and unknown usage preserve sanitized charges',async t=>{
  const server=await embeddingServer(t),c=client(server);
  for(const [mode,code] of [['rate_limited','rate_limited'],['provider_error','provider_error'],['redirect','provider_error'],
    ['oversized-header','provider_error'],['oversized-stream','provider_error'],['malformed-json','provider_error'],
    ['wrong-model','provider_error'],['bad-usage','provider_error'],['dimension_mismatch','dimension_mismatch'],
    ['float-overflow','provider_error'],['float-underflow','provider_error'],['duplicate-index','provider_error']]) {
    server.state.mode=mode;await assert.rejects(c.call(mode==='duplicate-index'?['a','b']:['a']),error=>{
      assert.equal(error.code,code);assert.equal(error.message,code);assert.equal(error.path,undefined);return true;});
  }
  server.state.mode='unknown-usage';
  const capped=client(server,{model:'text-embedding-ada-002',dimensions:1536,maxRequests:10,maxUsd:estimateEmbeddingUsd(['synthetic'],{model:'text-embedding-ada-002'})});
  await capped.call();const before=server.state.requests.length;
  await assert.rejects(capped.call(),{code:'budget_denied'});assert.equal(server.state.requests.length,before);
});

test('R05/R06/R10 no hidden retry; abort, deadline and post-reservation guard stop transmission',async t=>{
  const server=await embeddingServer(t),c=client(server,{maxRequests:2});server.state.mode='rate_limited';
  await assert.rejects(c.call(),{code:'rate_limited'});assert.equal(server.state.requests.length,1);
  await assert.rejects(c.call(),{code:'rate_limited'});assert.equal(server.state.requests.length,2);
  await assert.rejects(c.call(),{code:'budget_denied'});assert.equal(server.state.requests.length,2);
  const guarded=client(server,{model:'text-embedding-3-large'});let checks=0;
  await assert.rejects(guarded.call(['synthetic'],{guard(){if(++checks===3)throw Object.assign(Error('scope_changed'),{code:'scope_changed'});}}),{code:'scope_changed'});
  assert.equal(server.state.requests.length,2);
  server.state.mode='slow';await assert.rejects(guarded.call(['synthetic'],{ms:30}),{code:'timeout'});
  const controller=new AbortController();controller.abort();await assert.rejects(guarded.call(['synthetic'],{signal:controller.signal}),{code:'timeout'});
});

test('R04 oversized input and direct unbudgeted use refuse before fake HTTP',async t=>{
  const server=await embeddingServer(t),c=client(server);
  await assert.rejects(c.call(['x'.repeat(8193)]),{code:'context_item_too_large'});
  await assert.rejects(c.embedder.embed(['synthetic']),{code:'budget_denied'});assert.equal(server.state.requests.length,0);
});
