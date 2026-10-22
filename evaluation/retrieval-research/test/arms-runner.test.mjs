import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { scoreRankings } from '../lib/metrics.mjs';
import * as fixtureAPI from '../lib/fixture.mjs';
import { parseCLI, runRankings, loadSelection } from '../run.mjs';
import { measureLatency, percentile, shuffled, runLatency } from '../latency.mjs';
import { createArm } from '../lib/arms.mjs';
import { createOpenAIEmbedder } from '../lib/embed-openai.mjs';
import { toyFixture, toyDocuments, fakeEmbedder } from './fixtures-arms/toy.mjs';
const apiFor = fixture => ({ ...fixtureAPI, async loadFixture(){return fixture;} });
function options(workspace, overrides={}) {
  return { fixtureDir:join(workspace.path,'toy'),split:'dev',scale:'S300',arms:['A1'],models:['e5-small'],
    out:join(workspace.path,'rankings.json'),cacheDir:join(workspace.path,'cache'),storeDir:join(workspace.path,'stores'),threads:1,...overrides };
}
test('runner writes exact rankings envelope; selected lexical cannot change standalone A1',async t=>{
  const workspace=createTestWorkspace(t,{prefix:'hr1-run-'}), fixture=toyFixture();
  const opts=options(workspace,{arms:['A1','A1+','A1t','A0b','A2','A3','F-RRF60','F-RRF10','F-MM'],lexical:'A1+'});
  const result=await runRankings(opts,{fixtureAPI:apiFor(fixture),embedderFactory:()=>fakeEmbedder()});
  assert.equal(result.files.length,9);
  for (const file of result.files) {
    const output=JSON.parse(await readFile(file,'utf8'));
    assert.equal(output.format,'hr1-rankings-v1'); assert.equal(output.run.status,'complete');
    assert.deepEqual(output.run.fixtureHashes,fixture.hashes); assert.ok(output.run.env.node);
    assert.equal(output.run.store,null); assert.ok(output.costs.indexBuildMs>=0);
    for (const query of Object.values(output.queries)) {
      assert.ok(query.ranked.length<=24); assert.equal(new Set(query.ranked).size,query.ranked.length);
      assert.ok(query.ranked.every(id=>!id.startsWith('foreign')));
    }
  }
  const a=await createArm({arm:'A1',documents:toyDocuments,lexical:'A1+'});
  const b=await createArm({arm:'A1',documents:toyDocuments,lexical:'A1'});
  try {assert.deepEqual(await a.search({text:'runs running 中',intent:'current'}),await b.search({text:'runs running 中',intent:'current'}));}
  finally{a.close();b.close();}
});
test('five A0 variants share snapshots between default and paged rankings',async t=>{
  const workspace=createTestWorkspace(t,{prefix:'hr1-run-a0-'});
  const result=await runRankings(options(workspace,{arms:['A0-default','A0-paged']}),{fixtureAPI:apiFor(toyFixture())});
  assert.equal(result.outputs.length,10);
  for(let i=0;i<5;i++){
    const defaults=result.outputs[i],paged=result.outputs[i+5];
    assert.equal(defaults.run.store,i); assert.deepEqual(defaults.run.snapshot,paged.run.snapshot);
    assert.equal(defaults.queries['q-a'].recall24Available,false); assert.equal(paged.queries['q-a'].recall24Available,true);
  }
});
test('test fusion and A5 require selection; A5 uses nominated context and authorized spans only',async t=>{
  const workspace=createTestWorkspace(t,{prefix:'hr1-a5-run-'}),opts=options(workspace,{split:'test',arms:['A3']});
  await assert.rejects(loadSelection(opts),/frozen_selection/);
  const selectionPath=join(workspace.path,'selection.json');
  await writeFile(selectionPath,JSON.stringify({format:'hr1-selection-v1',sourceSplit:'dev',scale:'S1000',fixtureHashes:{toy:'synthetic'},
    comparator:{arm:'A1+'},status:'ready',easeCheck:{saturated:false},nominated:{local:{model:'e5-small',menu:'F-RRF10'}}}));
  const fake=fakeEmbedder();
  const result=await runRankings(options(workspace,{arms:['A5-spans','A5-both'],selectionPath}),
    {fixtureAPI:apiFor(toyFixture()),embedderFactory:()=>fake});
  assert.equal(result.outputs.length,2);
  assert.equal(result.outputs[0].run.config,'F-RRF10'); assert.equal(result.outputs[0].run.lexical,'A1+');
  assert.ok(fake.calls.filter(call=>call.kind==='document').every(call=>call.texts.every(text=>!text.includes('hidden-fact'))));
  assert.ok(fake.calls[0].texts.every(text=>text.startsWith('Synthetic source')));
  await assert.rejects(loadSelection({...opts,selectionPath,lexical:'A1'}),/override/);
});
test('model failure retains unavailable artifact and continues other models',async t=>{
  const workspace=createTestWorkspace(t,{prefix:'hr1-run-fail-'});
  const result=await runRankings(options(workspace,{arms:['A2'],models:['e5-small','bge-m3']}),{
    fixtureAPI:apiFor(toyFixture()),embedderFactory(model){if(model==='e5-small')throw new Error('synthetic unavailable');return fakeEmbedder();},
  });
  assert.equal(result.outputs[0].run.status,'unavailable'); assert.equal(result.outputs[0].run.error,'hr1_operation_failed');
  assert.equal(result.outputs[1].run.status,'complete'); assert.equal(result.files.length,2);
});
test('CLI strict arguments and dev-only grid',()=>{
  const args=['--fixture-dir','/tmp/toy','--split','dev','--scale','S300','--arms','grid,A1','--out','/tmp/out'];
  assert.equal(parseCLI(args).arms.length,38);
  assert.throws(()=>parseCLI(args.map(arg=>arg==='dev'?'test':arg)),/dev_only/);
  assert.throws(()=>parseCLI([...args,'--models','invented']),/unknown_model/);
  assert.throws(()=>parseCLI(args.slice(2)),/fixture-dir/);
});
test('latency records five randomized batch-one passes and bypasses each query cache',async()=>{
  const queries=Array.from({length:11},(_,i)=>({queryId:`q-${i}`,text:'toy',intent:'current'})),calls=[];
  const measured=await measureLatency({queries,search:async(query,opts)=>{calls.push([query.queryId,opts.bypassCache]);}});
  assert.equal(measured.samples.length,55); assert.equal(measured.failures,0); assert.ok(measured.p95>=measured.p50);
  assert.ok(calls.every(([,bypass])=>bypass));
  for(let pass=0;pass<5;pass++)assert.deepEqual(measured.samples.filter(s=>s.pass===pass).map(s=>s.queryId).sort(),queries.map(q=>q.queryId).sort());
  assert.notDeepEqual(shuffled(queries,50),shuffled(queries,51));assert.deepEqual(shuffled(queries,50),shuffled(queries,50));
  assert.equal(percentile([1,2,3,4,100],0.95),100);assert.equal(percentile([],0.5),null);
  const failures=await measureLatency({queries:queries.slice(0,1),search:async()=>{throw new Error('failed synthetic');}});
  assert.equal(failures.failures,5);assert.equal(failures.p95,null);
});
test('latency end-to-end fake local model includes metadata, costs and fresh timed requests',async t=>{
  const workspace=createTestWorkspace(t,{prefix:'hr1-latency-'}),fake=fakeEmbedder();
  const output=await runLatency(options(workspace,{arms:['A3']}),{fixtureAPI:apiFor(toyFixture()),embedderFactory:()=>fake});
  assert.equal(output.format,'hr1-latency-v1');assert.equal(output.runs[0].samples.length,10);
  assert.equal(fake.calls.filter(c=>c.kind==='query'&&c.bypassCache).length,12); // two warmups + ten samples
  assert.ok(output.runs[0].peakRssBytes>0);assert.equal(output.runs[0].device,'cpu');assert.equal(output.runs[0].failures,0);
});
test('hosted timing makes fresh fake HTTP requests and every warmup/sample is ledgered',async t=>{
  const workspace=createTestWorkspace(t,{prefix:'hr1-hosted-time-'});let requests=0;
  const server=createServer(async(request,response)=>{
    let body='';for await(const chunk of request)body+=chunk;const input=JSON.parse(body);requests++;
    response.end(JSON.stringify({model:input.model,usage:{total_tokens:1},data:input.input.map((_,index)=>({index,embedding:[1,...Array(1535).fill(0)]}))}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  workspace.defer(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const output=await runLatency(options(workspace,{arms:['A2'],models:['openai-3-small'],ledgerPath:join(workspace.path,'ledger.jsonl')}),{
    fixtureAPI:apiFor(toyFixture()),embedderFactory(model,opts,ledger){return createOpenAIEmbedder({model,apiKey:'synthetic',ledger,
      cacheDir:join(workspace.path,'cache'),baseURL:`http://127.0.0.1:${server.address().port}`});},
  });
  assert.equal(output.runs[0].failures,0);assert.equal(output.runs[0].samples.length,10);
  assert.equal(requests,14);assert.equal(output.runs[0].costs.apiTokens,requests);
  assert.equal(output.runs[0].costs.ledger.outstandingReservations,0);
});
test('actual rankings and latency CLI work with a synthetic on-disk fixture',async t=>{
  const workspace=createTestWorkspace(t,{prefix:'hr1-cli-'}),fixture=toyFixture(),dir=join(workspace.path,'fixture');
  await mkdir(dir);
  for(const [name,value]of Object.entries({facts:{version:'hr1-fixture-v2',facts:[]},corpus:fixture.corpus,queries:fixture.queries,
    split:fixture.split,labels:{queries:[]},'label-audit':{overrides:[]}}))await writeFile(join(dir,`hr1-${name}.json`),JSON.stringify(value));
  for(const script of ['run.mjs','latency.mjs']){
    const out=join(workspace.path,script+'.json');
    const child=spawnSync(process.execPath,[join(dirname(new URL(import.meta.url).pathname),'..',script),'--fixture-dir',dir,
      '--split','dev','--scale','S300','--arms','A1','--out',out],{encoding:'utf8'});
    assert.equal(child.status,0,child.stderr);assert.ok(JSON.parse(await readFile(out,'utf8')).format.startsWith('hr1-'));
  }
});

test('native scoring consumes successful rankings and latency files expose report fields',async t=>{
  const workspace=createTestWorkspace(t,{prefix:'hr1-wire-'}),fixture=toyFixture();
  fixture.labels={queries:fixture.queries.queries.map(query=>({id:query.id,family:query.family,category:'C3',lang:'en',intent:query.intent,
    split:'dev',groups:[{fact:'synthetic-fact',fidelity:'body-covered',members:[{memory:'m-a',where:'body',scale:'S300',namespace:'target',spanCount:1}]}],
    hardNegatives:[],overlap:[]}))};
  const result=await runRankings(options(workspace,{arms:['A3']}),{fixtureAPI:apiFor(fixture),embedderFactory:()=>fakeEmbedder()});
  const scored=scoreRankings(fixture,result.outputs[0]);assert.equal(scored.ok,true);assert.equal(scored.queries.length,2);
  const measured=await runLatency(options(workspace,{arms:['A3'],out:join(workspace.path,'latency.json')}),
    {fixtureAPI:apiFor(fixture),embedderFactory:()=>fakeEmbedder()});
  const record=JSON.parse(await readFile(measured.files[0],'utf8'));
  assert.equal(record.format,'hr1-latency-v1');assert.equal(record.run.arm,'A3');assert.equal(record.run.config,'A3');
  assert.equal(record.queryCacheEnabled,false);assert.equal(record.samples.length,10);assert.equal(new Set(record.samples.map(s=>s.pass)).size,5);
});
