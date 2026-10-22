import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { readFile, writeFile, mkdir, rmdir } from 'node:fs/promises';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createApiLedger } from '../lib/api-ledger.mjs';
import { createOpenAIEmbedder, embeddingBatches } from '../lib/embed-openai.mjs';

async function setup(t, { handler, model='openai-3-small', maxRetries=0, timeoutMs=1000, capUsd=1 } = {}) {
  const workspace = createTestWorkspace(t,{prefix:'hr1-api-'}), calls=[];
  const server = createServer(async (request,response) => {
    let body=''; for await (const chunk of request) body += chunk;
    calls.push({ url:request.url, method:request.method, headers:request.headers, body:JSON.parse(body) });
    if (handler) return handler({ request,response,calls });
    success(response,calls.at(-1).body);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  workspace.defer(async ()=>{server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));});
  const path=join(workspace.path,'ledger.jsonl'), ledger=createApiLedger(path,{capUsd});
  const options={model,apiKey:'synthetic-test-token',ledger,cacheDir:join(workspace.path,'cache'),
    baseURL:`http://127.0.0.1:${server.address().port}`,maxRetries,timeoutMs,retryDelayMs:0};
  return { workspace,calls,ledger,path,client:createOpenAIEmbedder(options),options };
}
function success(response, body, { tokens=1, duplicate=false } = {}) {
  const dimensions=body.model==='text-embedding-3-small'?1536:3072;
  const data=body.input.map((_,index)=>({index:duplicate?0:index,embedding:Array.from({length:dimensions},(_,d)=>d===0?3:d===1?4:0)})).reverse();
  response.writeHead(200,{'Content-Type':'application/json'});
  response.end(JSON.stringify({model:body.model,data,usage:{total_tokens:tokens}}));
}

test('OpenAI POST float payload, reordered batched output, response cache and query bypass',async t=>{
  const {client,calls,ledger,path}=await setup(t);
  const vectors=await client.embed(['synthetic amber','synthetic cedar'],{kind:'document'});
  assert.equal(calls.length,1); assert.equal(vectors.length,2); assert.equal(vectors[0].length,1536);
  assert.ok(Math.abs(vectors[0][0]-0.6)<1e-6);
  assert.deepEqual(calls[0].body,{model:'text-embedding-3-small',input:['synthetic amber','synthetic cedar'],encoding_format:'float'});
  assert.equal(calls[0].url,'/v1/embeddings'); assert.equal(calls[0].method,'POST');
  assert.equal(calls[0].headers.authorization,'Bearer synthetic-test-token');
  assert.deepEqual(await client.embed(['synthetic amber']),[vectors[0]]); assert.equal(calls.length,1);
  await client.embed(['synthetic amber'],{bypassCache:true}); assert.equal(calls.length,2);
  const reopened=createApiLedger(path); assert.equal(reopened.summary().apiTokens,2);
  assert.equal(ledger.summary().apiSpendUsd,0.00000004); assert.equal(ledger.summary().outstandingReservations,0);
  const entries=(await readFile(path,'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(entries.map(e=>e.type),['reserve','settle','reserve','settle']);
  assert.equal(entries[0].tokens,Buffer.byteLength('synthetic ambersynthetic cedar'));
});
test('large@1024 derives from shared full response cache and re-normalizes',async t=>{
  const {client,calls,options}=await setup(t,{model:'openai-3-large'});
  const [large]=await client.embed(['synthetic text']);
  const shortClient=createOpenAIEmbedder({...options,model:'openai-3-large@1024'});
  const [short]=await shortClient.embed(['synthetic text']);
  assert.equal(large.length,3072); assert.equal(short.length,1024); assert.equal(calls.length,1);
  assert.ok(Math.abs(short.reduce((s,x)=>s+x*x,0)-1)<1e-6);
  assert.ok(!Object.hasOwn(calls[0].body,'dimensions'));
});
test('5xx retry is separately reserved; unknown first outcome stays charged',async t=>{
  const {client,calls,ledger}=await setup(t,{maxRetries:1,handler({response,calls}) {
    if(calls.length===1){response.writeHead(503);response.end('unavailable');}
    else success(response,calls.at(-1).body);
  }});
  await client.embed(['retry synthetic']);
  assert.equal(calls.length,2); const summary=ledger.summary();
  assert.equal(summary.apiTokens,1); assert.equal(summary.outstandingReservations,1);
  assert.equal(summary.committedUsd,(Buffer.byteLength('retry synthetic')*20+20)/1e9);
});
for(const status of [400,401,422,429,500]) test(`HTTP ${status} failure retains reservation and bounds retry`,async t=>{
  const {client,calls,ledger}=await setup(t,{maxRetries:1,handler({response}){response.writeHead(status);response.end('{}');}});
  await assert.rejects(client.embed(['synthetic error']),new RegExp(`embedding_http_${status}`));
  const expected=status===429||status>=500?2:1;
  assert.equal(calls.length,expected); assert.equal(ledger.summary().outstandingReservations,expected);
});
test('timeout aborts a registered fake attempt, retains its reservation, and retries once',async t=>{
  const workspace=createTestWorkspace(t,{prefix:'hr1-timeout-'}),attempts=[];
  const ledger=createApiLedger(join(workspace.path,'ledger.jsonl'));
  const client=createOpenAIEmbedder({model:'openai-3-small',apiKey:'synthetic',ledger,
    cacheDir:join(workspace.path,'cache'),timeoutMs:1,maxRetries:1,retryDelayMs:0,
    fetchImpl(_url,{signal}){
      attempts.push(signal);
      return new Promise((_resolve,reject)=>{
        const abort=()=>reject(new Error('synthetic transport aborted'));
        if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
      });
    },
  });
  await assert.rejects(client.embed(['timeout synthetic']),/^Error: embedding_timeout$/);
  assert.equal(attempts.length,2); assert.ok(attempts.every(signal=>signal.aborted));
  assert.equal(ledger.summary().outstandingReservations,2);
});
test('hard cap refuses before any dispatch, including after a retry reservation',async t=>{
  const {client,calls,ledger}=await setup(t,{capUsd:0.0000001});
  await assert.rejects(client.embed(['ten bytes!']),/cap_exceeded/);
  assert.equal(calls.length,0); assert.equal(ledger.summary().committedUsd,0);
  assert.throws(()=>createApiLedger('/tmp/unused-hr1-ledger',{capUsd:2}),/invalid/);
});
test('cap shared across client instances, reopening and retries',async t=>{
  const {client,options,calls,ledger}=await setup(t,{capUsd:0.0000003,maxRetries:2,handler({response}){response.writeHead(503);response.end('{}');}});
  await assert.rejects(client.embed(['1234567890']),/cap_exceeded/); // first hold $0.0000002; second cannot dispatch
  assert.equal(calls.length,1);
  const second=createOpenAIEmbedder(options);
  await assert.rejects(second.embed(['123456']),/cap_exceeded/); assert.equal(calls.length,1);
  assert.equal(ledger.summary().committedUsd,0.0000002);
});
test('invalid response settled by usage but not cached; missing usage stays reserved',async t=>{
  const {client,calls,ledger}=await setup(t,{handler({response,calls}){success(response,calls.at(-1).body,{duplicate:true});}});
  await assert.rejects(client.embed(['one synthetic','two synthetic']),/invalid_embedding_response/);
  assert.equal(ledger.summary().apiTokens,1);
  await assert.rejects(client.embed(['one synthetic','two synthetic']),/invalid_embedding_response/);
  assert.equal(calls.length,2);
  const other=await setup(t,{handler({response}){response.end(JSON.stringify({data:[]}));}});
  await assert.rejects(other.client.embed(['missing synthetic usage']),/usage_missing/);
  assert.equal(other.ledger.summary().outstandingReservations,1);
});
test('reservation is durable before network and uses UTF-8 byte bound',async t=>{
  let path;
  const context=await setup(t,{handler({response,calls}){
    const ledger=createApiLedger(path); assert.ok(ledger.summary().committedUsd>0);
    success(response,calls.at(-1).body);
  }}); path=context.path;
  await context.client.embed(['合成文字']);
  const reserve=JSON.parse((await readFile(path,'utf8')).split('\n')[0]); assert.equal(reserve.tokens,12);
});
test('ledger malformed/torn log and lock contention fail closed',async t=>{
  const {path,ledger}=await setup(t);
  const id=ledger.reserve('text-embedding-3-small',['abc']);
  assert.throws(()=>ledger.settle(id,4),/settlement/); ledger.settle(id,1);
  assert.throws(()=>ledger.settle(id,1),/settlement/);
  await mkdir(path+'.lock');
  assert.throws(()=>ledger.reserve('text-embedding-3-small',['x']),/EEXIST/); await rmdir(path+'.lock');
  await writeFile(path,'{"type":"reserve"}'); assert.throws(()=>ledger.reserve('text-embedding-3-small',['x']),/incomplete/);
});
test('batch bounds and invalid/oversize inputs fail before dispatch',async t=>{
  const {client,calls}=await setup(t);
  assert.equal(embeddingBatches(Array(2049).fill('x')).length,2);
  assert.equal(embeddingBatches(Array(40).fill('x'.repeat(8000))).length,2);
  await assert.rejects(client.embed(['a'.repeat(8193)]),/byte_bound/);
  await assert.rejects(client.embed(['']),/empty/); assert.equal(calls.length,0);
  assert.throws(()=>createOpenAIEmbedder({}),/configuration/);
});

test('the absolute one-dollar cap uses integer arithmetic at its boundary',t=>{
  const workspace=createTestWorkspace(t,{prefix:'hr1-dollar-'});
  const ledger=createApiLedger(join(workspace.path,'ledger.jsonl'));
  ledger.reserve('text-embedding-3-large',['x'.repeat(7692307)]);
  assert.equal(ledger.summary().committedUsd,0.99999991);
  assert.throws(()=>ledger.reserve('text-embedding-3-large',['x']),/cap_exceeded/);
  assert.equal(ledger.summary().outstandingReservations,1);
});
