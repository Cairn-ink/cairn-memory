import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openSync,closeSync,readFileSync,writeFileSync,unlinkSync,copyFileSync,readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createHash,randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { observeDatabaseFiles } from '../../core/testing/context-read-fixture.mjs';
import { createBM25 } from '../../core/context-read-bm25.mjs';
import { createFakeEmbedder,cosine } from '../../core/context-read-embedder.mjs';
import { fuseCandidates } from '../../core/context-read-fusion.mjs';
import { installedMethods } from './fixtures/method-packages.mjs';
import { installedImportClosure } from './fixtures/installed-import-closure.mjs';
import { contextHost,contextCall,contextNamespace as ns,contextProviderArgs } from '../../adapters/mcp/test/context-support.mjs';
import { embeddingServer } from '../../adapters/openai/test/embedding-support.mjs';

const ok=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
const root=fileURLToPath(new URL('../../',import.meta.url)),fixture=fileURLToPath(new URL('./fixtures/context-read-child.mjs',import.meta.url));
const roots=['core/index.mjs','core/contract.mjs','adapters/mcp/cli.mjs','adapters/local/cli.mjs','integrations/client/raw/local-host-cli.mjs'];
const samples=JSON.parse(readFileSync(new URL('../../core/test/fixtures/context-read/hr1-sample.json',import.meta.url)));
const texts=[...samples.documents.map(row=>row.text),'中','中文資料庫','𠀀𠀁𠀂','ＡＢＣ１２','car'];
function child(workspace,args,{preload,key=false}={}) {
  const stem=join(workspace.path,'context-child-'+randomUUID()),out=openSync(stem+'.out','wx',0o600),err=openSync(stem+'.err','wx',0o600);
  let processChild;
  try {processChild=spawn(process.execPath,[...(preload?['--import',preload]:[]),...args],{stdio:['ignore',out,err],env:{
    NODE_NO_WARNINGS:'1',NODE_DISABLE_COMPILE_CACHE:'1',...(key?{OPENAI_API_KEY:'synthetic-not-a-key'}:{})}});}
  finally {closeSync(out);closeSync(err);}
  let timer;
  const closed=new Promise((resolve,reject)=>{
    timer=setTimeout(()=>processChild.kill('SIGKILL'),20000);
    processChild.once('error',error=>{clearTimeout(timer);reject(error);});
    processChild.once('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,stdout:readFileSync(stem+'.out','utf8'),stderr:readFileSync(stem+'.err','utf8')});});
  });
  workspace.defer(async()=>{if(processChild.exitCode===null&&processChild.signalCode===null)processChild.kill('SIGKILL');await closed;});
  return closed;
}
async function run(workspace,args,options){const result=await child(workspace,args,options);assert.equal(result.signal,null,result.stderr);assert.equal(result.code,0,result.stderr+result.stdout);return JSON.parse(result.stdout);}

test('R01/R03/R12/R13 actual artifact: captured sources, fresh lexical MCP, opener matrix and independently derived shipped closure',{timeout:120000},async t=>{
  const workspace=createTestWorkspace(t,{prefix:'installed-context-'}),f=await installedMethods(workspace);
  const engine=await import(pathToFileURL(join(f.root,'core/index.mjs')));
  assert.equal(typeof engine.createContextReaderPool,'function','installed_mcp_runtime_exports_service_pool');
  const pool=engine.createContextReaderPool();
  try { await engine.createContextReadSupervisor({readerWorkerPool:pool}).close(); }
  finally { await pool.close(); }
  const captured=ok(await run(workspace,[fixture,f.root,f.path,JSON.stringify({mode:'capture',texts})]));
  assert.equal(captured.modelCalls,texts.length);assert.notEqual(captured.pid,process.pid);assert.equal(captured.memories.length,texts.length);
  const trace=join(workspace.path,'context-loaded.jsonl'),preload='data:text/javascript,'+encodeURIComponent(`
    import {registerHooks} from 'node:module';import {appendFileSync} from 'node:fs';
    registerHooks({load(url,context,next){const result=next(url,context);appendFileSync(${JSON.stringify(trace)},JSON.stringify(url)+'\\n');return result;}});
    globalThis.fetch=()=>{process.exit(91)};`);
  const plain=await contextHost(workspace,f.path,{entry:f.entry,enabled:false,key:true,preload}),host=await contextHost(workspace,f.path,{entry:f.entry,key:true});
  const baseline=(await plain.client.listTools()).tools,tools=(await host.client.listTools()).tools;
  assert.deepEqual(baseline.map(tool=>tool.name).sort(),['correct_memory','forget_memory','inspect_memory','recall_memory','remember_memory']);
  assert.deepEqual(tools.map(tool=>tool.name).sort(),['correct_memory','fetch_memory_candidate_evidence','find_memory_candidates','forget_memory','inspect_memory','read_memory_context','recall_memory','remember_memory']);
  assert.deepEqual(tools.filter(tool=>baseline.some(old=>old.name===tool.name)),baseline);
  for(const input of [{limit:50},{memoryId:captured.memories[0].id}])assert.deepEqual(
    await host.client.callTool({name:'inspect_memory',arguments:input}),await plain.client.callTool({name:'inspect_memory',arguments:input}));
  const docs=captured.memories.map(memory=>({ref:{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision},text:memory.content}));
  const mixedWidth=captured.memories.find(memory=>memory.content==='ABC12');assert.ok(mixedWidth,'capture stores the mixed-width fixture in canonical form');
  const reference=createBM25(docs);
  for(const query of ['SQLite','月報庫','資料庫','中','資料','𠀁𠀂','abc12','ABC12','ＡＢＣ１２']) {
    const value=ok(await contextCall(host.client,'find_memory_candidates',{query,types:['memory'],intent:'current',limit:24,deadlineMs:5000}));
    assert.equal(value.channels.semantic.state,'disabled');assert.deepEqual(value.items.map(row=>({ref:row.ref,score:row.channels.lexical.rawScore})),reference.search(query).map(row=>({ref:row.ref,score:row.score})));
    assert.ok(value.items.every(row=>row.fusionScore===null));
    if(query==='中')assert.deepEqual(value.items.map(row=>row.ref.memoryId),docs.filter(row=>row.text==='中').map(row=>row.ref.memoryId));
    if(['abc12','ABC12','ＡＢＣ１２'].includes(query))assert.deepEqual(value.items.map(row=>row.ref.memoryId),[mixedWidth.id]);
    if(value.items.length){
      const fetched=ok(await contextCall(host.client,'fetch_memory_candidate_evidence',{refs:value.items.map(row=>row.ref),intent:'current'}));
      if(['abc12','ABC12','ＡＢＣ１２'].includes(query))assert.equal(fetched.items[0].content,mixedWidth.content);
    }
  }
  await plain.client.close();await host.client.close();
  const missingCommand=join(workspace.path,'never-create','store.sqlite');
  const refusal=await child(workspace,[f.entry,'context','refresh','--db',missingCommand,'--owner',ns.ownerId,'--types','memory','--intent','current',
    '--max-items','1','--max-ms','100',...contextProviderArgs],{key:true,preload:'data:text/javascript,globalThis.fetch=()=>{process.exit(91)}'});
  assert.equal(refusal.signal,null);assert.equal(refusal.code,1,refusal.stderr);
  assert.deepEqual(JSON.parse(refusal.stdout),{ok:false,error:{code:'database_not_found',retryable:false}});
  assert.ok(!readdirSync(workspace.path).includes('never-create'));
  const minimal=join(workspace.path,'memory-only.sqlite');
  ok(await run(workspace,[fixture,f.root,minimal,JSON.stringify({mode:'capture',texts:['SQLite memory-only synthetic']})]));
  const minimalDb=new DatabaseSync(minimal,{readOnly:true});
  try {
    assert.equal(minimalDb.prepare('PRAGMA user_version').get().user_version,18);
    const ddl=minimalDb.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
    const absent=await observeDatabaseFiles({path:minimal,workspace},async()=>{
      assert.equal((await run(workspace,[fixture,f.root,minimal,JSON.stringify({mode:'read-only'})])).error.code,'index_unavailable');
    });assert.deepEqual(absent.events,[]);
    ok(await run(workspace,[fixture,f.root,minimal,JSON.stringify({mode:'ordinary'})]));
    const existing=await observeDatabaseFiles({path:minimal,workspace},async()=>{
      assert.equal(ok(await run(workspace,[fixture,f.root,minimal,JSON.stringify({mode:'read-only'})])).items.length,1);
    });assert.deepEqual(existing.events,[]);
    assert.deepEqual(minimalDb.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(),ddl);
  } finally {minimalDb.close();}
  const queries=['SQLite','月報庫','資料庫','中','資料','𠀁𠀂','abc12','ABC12','ＡＢＣ１２','automobile'];
  const fake=createFakeEmbedder({dimensions:256,aliases:{automobile:'car'}}),vectors=await fake.embed(docs.map(row=>row.text));
  for(const family of ['local','hosted']) {
    const results=ok(await run(workspace,[fixture,f.root,f.path,JSON.stringify({mode:'fused',family,queries})]));
    for(let i=0;i<queries.length;i++) {
      const vector=(await fake.embed([queries[i]]))[0],preset=family==='hosted'?'rrf-k10':'rrf-k60-d12';
      const expected=fuseCandidates(reference.search(queries[i]),docs.map((row,j)=>({ref:row.ref,score:cosine(vector,vectors[j])})),
        {preset,semanticState:'ready',coverageComplete:true});
      assert.equal(results[i].trace.preset,preset);assert.equal(results[i].trace.effective,'hybrid');
      assert.deepEqual(results[i].items,expected.rows.map((row,j)=>({ref:row.ref,rank:j+1,fusionScore:row.fusionScore,channels:row.channels})));
    }
  }
  const db=new DatabaseSync(f.path,{readOnly:true});
  try {
    const storeId=db.prepare('SELECT store_id FROM store_metadata').get().store_id;
    const before=db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
    for(const mode of ['ordinary','read-only','managed']) {
      const result=await run(workspace,[fixture,f.root,f.path,JSON.stringify({mode,storeId})]);ok(result);
      if(mode!=='ordinary') {
        const observed=await observeDatabaseFiles({path:f.path,workspace},async()=>{
          ok(await run(workspace,[fixture,f.root,f.path,JSON.stringify({mode,storeId})]));
          assert.equal((await run(workspace,[fixture,f.root,f.path,JSON.stringify({mode,storeId,refresh:true})])).error.code,'invalid_input');
        });assert.deepEqual(observed.events,[]);
        const missing=join(workspace.path,'missing-sidecar-'+mode+'.sqlite');copyFileSync(f.path,missing);
        const absent=await observeDatabaseFiles({path:missing,workspace},async()=>{
          assert.equal((await run(workspace,[fixture,f.root,missing,JSON.stringify({mode,storeId})])).error.code,'index_unavailable');
        });assert.deepEqual(absent.events,[]);
        for(const database of [f.path,f.path+'.context-read-v1.sqlite'])for(const suffix of ['-journal','-wal','-shm']) {
          writeFileSync(database+suffix,'synthetic unsupported auxiliary',{mode:0o600});
          try {const refused=await observeDatabaseFiles({path:f.path,workspace},async()=>{
            assert.equal((await run(workspace,[fixture,f.root,f.path,JSON.stringify({mode,storeId})])).error.code,'index_unavailable');
          });assert.deepEqual(refused.events,[]);}finally{unlinkSync(database+suffix);}
        }
      }
    }
    assert.deepEqual(db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(),before);
  } finally {db.close();}
  const source=installedImportClosure(root,roots),installed=installedImportClosure(f.root,roots),manifest=JSON.parse(readFileSync(join(root,'packaging/artifact-files.json'),'utf8'));
  assert.deepEqual(installed.required,source.required);assert.ok(source.required.every(path=>manifest.includes(path)));
  const runtime=[...readdirSync(join(root,'adapters/mcp')).filter(name=>name.startsWith('context-read-')&&name.endsWith('.mjs')).map(name=>'adapters/mcp/'+name),'adapters/openai/embedding.mjs'].sort();
  const graph=source.required.filter(path=>runtime.includes(path)).sort();assert.deepEqual(graph,runtime);
  const loaded=new Set(readFileSync(trace,'utf8').trim().split('\n').map(JSON.parse));
  for(const path of runtime){assert.ok(loaded.has(pathToFileURL(join(f.root,path)).href),path+' loaded by installed default process');
    assert.equal(createHash('sha256').update(readFileSync(join(f.root,path))).digest('hex'),f.artifact.sourceHashes[path]);}
  assert.ok(f.artifact.files.includes('docs/context-read-local.md'));
  const walk=(path,prefix='')=>readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(path,entry.name),prefix+entry.name+'/'):[prefix+entry.name]).sort();
  assert.deepEqual(walk(f.root),[...f.artifact.files].sort());
  t.diagnostic(JSON.stringify({sourceClosure:source.required.length,installedClosure:installed.required.length,manifest:manifest.length,
    newRuntimeGraph:graph.length,newRuntimeFilesystem:runtime.length,loadedNewRuntime:runtime.length,difference:0,
    archive:f.artifact.files.length,packAndInstallExit:0,paidCalls:0}));
});

test('R04/R05 installed explicit refresh and fresh semantic MCP use an actual fake HTTP endpoint only',{timeout:120000},async t=>{
  const workspace=createTestWorkspace(t,{prefix:'installed-context-http-'}),f=await installedMethods(workspace),server=await embeddingServer(t);
  const captured=ok(await run(workspace,[fixture,f.root,f.path,JSON.stringify({mode:'capture',texts})]));
  ok(f.core.admit({namespace:{...ns,ownerId:'foreign-owner'},memory:{content:'foreign synthetic content must never reach HTTP',kind:'fact'},
    receipts:[{client:'synthetic',sessionId:'foreign',eventId:'foreign',role:'user',excerpt:'foreign'}]}));
  const before=await contextHost(workspace,f.path,{entry:f.entry,provider:true,preload:server.preload});
  const request={query:'automobile',types:['memory'],intent:'current',semantic:true,limit:24,deadlineMs:5000};
  const partial=ok(await contextCall(before.client,'find_memory_candidates',request));assert.equal(partial.channels.semantic.state,'partial_coverage');assert.equal(server.state.requests.length,0);await before.client.close();
  const command=['context','refresh','--db',f.path,'--owner',ns.ownerId,'--types','memory','--intent','current','--max-items','128','--max-ms','5000',...contextProviderArgs];
  assert.equal(ok(await run(workspace,[f.entry,...command],{preload:server.preload,key:true})).status,'complete');
  assert.equal(server.state.requests.length,1);
  assert.equal(server.state.responses[0].encoding,'brotli');assert.equal(server.state.responses[0].contentLength,null);
  for(let i=0;i<2;i++)assert.ok(Math.abs(server.state.responses[0].norms[i]-[1.000225,.99981][i])<1e-12);
  const canonicalTexts=captured.memories.map(memory=>memory.content).sort();
  assert.deepEqual([...server.state.requests[0].body.input].sort(),canonicalTexts);
  const fresh=await contextHost(workspace,f.path,{entry:f.entry,provider:true,preload:server.preload});
  const value=ok(await contextCall(fresh.client,'find_memory_candidates',request));assert.equal(value.channels.semantic.state,'ready');
  assert.equal(value.trace.preset,'rrf-k10');assert.equal(value.trace.effective,'hybrid');assert.equal(server.state.requests.length,2);
  assert.deepEqual(server.state.requests[1].body.input,['automobile']);
  ok(await contextCall(fresh.client,'find_memory_candidates',{...request,semantic:false}));assert.equal(server.state.requests.length,2);
  const car=captured.memories.find(memory=>memory.content==='car');assert.ok(value.items.some(row=>row.ref.memoryId===car.id&&Math.abs(row.channels.semantic.rawScore-1)<1e-5));
  const fetched=ok(await contextCall(fresh.client,'fetch_memory_candidate_evidence',{refs:value.items.map(row=>row.ref),intent:'current'}));
  assert.deepEqual(fetched.items.map(item=>item.content).sort(),canonicalTexts);
  server.state.mode='norm-too-large';
  const degraded=ok(await contextCall(fresh.client,'find_memory_candidates',{...request,query:'car'}));
  assert.deepEqual(degraded.channels.semantic,{state:'provider_error',causes:['provider_error']});
  assert.equal(degraded.trace.effective,'lexical');assert.ok(degraded.items.some(row=>row.ref.memoryId===car.id));
  server.state.mode='ready';server.state.encoding='chunked';
  assert.equal(ok(await contextCall(fresh.client,'find_memory_candidates',request)).channels.semantic.state,'ready');
  assert.equal(server.state.responses.at(-1).encoding,'chunked');assert.equal(server.state.responses.at(-1).contentLength,null);
  await fresh.client.close();
});
