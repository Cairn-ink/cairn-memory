import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { sampleLocalStatus } from '../context-read-local-status.mjs';
import { coreFixture, query, refresh, ok } from '../testing/context-read-core-fixture.mjs';
const policy = {family:'local',maxRequests:100,maxConcurrent:1,maxBatchDocuments:1};
function configured(f, observer, embed = () => { throw Error('unexpected embedding'); }) {
  return f.reopen({embedder:{id:'local-status-'+randomUUID(),revision:'1',dimensions:1,normalization:'none',embed},policy,localStatus:observer,
    counter:{id:'synthetic',countTokens:text=>Math.ceil(text.length/4)}});
}
test('L12 observer rejects throws/thenables/accessors/extra fields without leaking exceptions', () => {
  for (const fn of [()=>{throw Error('CANARY');},()=>({state:'ready',reason:null,extra:1}),()=>({get state(){throw Error('CANARY');},reason:null}),()=>({state:'closed',reason:null}),()=>({state:'unavailable',reason:'CANARY'}),()=>({then(){assert.fail('thenable invoked');}}),()=>Promise.reject(Error('CANARY'))]) assert.deepEqual(sampleLocalStatus(fn),{state:'unavailable',reason:'protocol_error'});
});
test('L12 zero-dispatch initialization status reaches search, assembly and every refresh success shape', async t => {
  const f = coreFixture(t,{cards:true}); f.admit('apple status one'); f.admit('apple status two');
  const active = new Set(), events = [], original = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function(sql) { const result = original.call(this,sql); if (/^\s*BEGIN\b/i.test(sql)) {active.add(this);events.push('begin');} if (/^\s*(?:COMMIT|ROLLBACK)\b/i.test(sql)) {active.delete(this);events.push('end');} return result; };
  t.after(()=>{DatabaseSync.prototype.exec=original;});
  let calls = 0, dispatches = 0;
  const state = {state:'unavailable',reason:'model_pack_unavailable'};
  configured(f,()=>{calls++;events.push('observe');assert.equal(active.size,0);return state;},()=>{dispatches++;throw Object.assign(Error('provider_error'),{code:'provider_error'});});
  const rebuilding = ok(await f.call('refreshContextIndex',refresh({budget:{maxItems:1,maxMs:5000}})));
  assert.equal(rebuilding.status,'rebuilding'); assert.deepEqual(rebuilding.trace.localEmbedder,state); assert.equal(calls,2); assert.equal(dispatches,0);
  calls=0;
  // Consume transformations without leaving an embedding allowance.
  let partial;
  for(let i=0;i<20;i++){partial=ok(await f.call('refreshContextIndex',refresh({budget:{maxItems:1,maxMs:5000}})));if(partial.status!=='rebuilding')break;}
  assert.equal(partial.status,'partial');assert.deepEqual(partial.trace.localEmbedder,state);
  const search=ok(await f.call('findCandidates',query({semantic:true})));assert.deepEqual(search.trace.localEmbedder,state);assert.equal(dispatches,0);
  events.length=0; calls=0;
  const assembled=ok(await f.call('contextRead',query({semantic:false,budget:{maxTokens:1500}})));
  assert.deepEqual(assembled.diagnostics.candidates.trace.localEmbedder,state);assert.equal(calls,3);
  assert.equal(JSON.stringify(assembled.metered).includes('localEmbedder'),false);
  assert.ok(events.lastIndexOf('observe')<events.lastIndexOf('begin'),'final sample precedes final authoritative transaction');
  state.reason='timeout';assert.equal(search.trace.localEmbedder.reason,'model_pack_unavailable');
  assert.equal(rebuilding.trace.localEmbedder.reason,'model_pack_unavailable');
  assert.equal(dispatches,0);
});
test('L12 ready/closed samples, complete refresh, authority suppression and assembly failure placement', async t => {
  const f=coreFixture(t,{cards:true}); f.admit('apple status'); let state={state:'ready',reason:null};
  configured(f,()=>state,async texts=>texts.map(()=>[1]));
  const complete=ok(await f.call('refreshContextIndex',refresh())); assert.equal(complete.status,'complete'); assert.deepEqual(complete.trace.localEmbedder,state);
  state={state:'closed',reason:'closed'};
  const value=ok(await f.call('findCandidates',query())); assert.deepEqual(value.trace.localEmbedder,state);
  f.trusted.state.enabled=false;
  const denied=await f.call('findCandidates',query());assert.equal(denied.error.details,undefined);
  f.trusted.state.enabled=true;
  // Missing/unusable lexical storage on an in-memory store keeps existing error
  // precedence; authorized candidate errors retain the nested assembly location.
  const {openMemoryCore}=await import('../contract.mjs');
  const c=openMemoryCore({path:':memory:',contextRead:{version:'context-read-v1',authority:f.trusted.authority,
    embedder:{id:'status-error',revision:'1',dimensions:1,normalization:'none',async embed(){return [[1]];}},policy,localStatus:()=>state,counter:{id:'synthetic',countTokens:()=>1}}});
  try{const result=await f.trusted.call(c,'contextRead',query());assert.equal(result.error.code,'index_unavailable');assert.equal(result.error.details.trace,undefined);assert.deepEqual(result.error.details.candidates.trace.localEmbedder,state);}finally{c.close();}
});
