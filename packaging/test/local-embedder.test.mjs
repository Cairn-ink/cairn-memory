import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, openSync, closeSync } from 'node:fs';
import { readFile, cp } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { installedMethods } from './fixtures/method-packages.mjs';
import { installedImportClosure } from './fixtures/installed-import-closure.mjs';
import { fixture as packFixture } from '../../adapters/local-embedder/test/fixtures/pack.mjs';
const repo=fileURLToPath(new URL('../../',import.meta.url));
test('L01/L02/L12/L13 installed artifact: static imports/checks, status envelope and manifest closure',{timeout:120000},async t=>{
  const w=createTestWorkspace(t,{prefix:'installed-local-embedder-'}), f=await installedMethods(w);
  const manifest=JSON.parse(readFileSync(join(repo,'packaging/artifact-files.json'))), walk=(path,prefix='')=>readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(path,e.name),prefix+e.name+'/'):[prefix+e.name]).sort();
  assert.deepEqual(walk(f.root),[...f.artifact.files].sort());
  const source=installedImportClosure(repo,['adapters/mcp/cli.mjs']),installed=installedImportClosure(f.root,['adapters/mcp/cli.mjs']);
  assert.deepEqual(installed.required,source.required);assert.ok(source.required.every(p=>manifest.includes(p)));
  const pkg=JSON.parse(await readFile(join(f.root,'package.json'),'utf8'));assert.deepEqual(Object.keys(pkg.dependencies).sort(),['@modelcontextprotocol/server','tiktoken','zod']);
  const log=join(w.path,'import-trace.jsonl'), outPath=join(w.path,'check.out'),errPath=join(w.path,'check.err');
  const script=`
    import {registerHooks} from 'node:module';import {appendFileSync,writeFileSync} from 'node:fs';
    registerHooks({load(url,context,next){if(url==='node:sqlite'||url.includes('/runtime/node_modules/'))throw Error('forbidden import');appendFileSync(${JSON.stringify(log)},JSON.stringify(url)+'\\n');return next(url,context);}});
    let spawns=0,packReads=0,fetches=0;
    const cp=await import('node:child_process');cp.default.spawn=cp.default.spawnSync=()=>{spawns++;throw Error('SPAWN_FORBIDDEN');};
    const fsp=await import('node:fs/promises');for(const key of ['readFile','lstat','readdir','open']){const original=fsp.default[key];fsp.default[key]=function(path,...rest){if(String(path).startsWith('/nonexistent')){packReads++;throw Error('PACK_READ_FORBIDDEN');}return original.call(this,path,...rest);};}
    (await import('node:module')).syncBuiltinESMExports();
    globalThis.fetch=()=>{fetches++;throw Error('NETWORK_FORBIDDEN');};
    const {start}=await import(${JSON.stringify(pathToFileURL(join(f.root,'adapters/mcp/cli.mjs')).href)});
    const env=Object.defineProperty({},'OPENAI_API_KEY',{get(){throw Error('KEY_LOOKUP');}});
    const values=[],saved=console.log;console.log=text=>values.push(JSON.parse(text));
    await start(['--check-config','--db','/nonexistent/store','--owner','owner','--context-read','context-read-v1'],env);
    await start(['--check-config','--db','/nonexistent/store','--owner','owner','--context-read','context-read-v1','--context-embedder','openai','--context-embed-model','text-embedding-3-small','--context-embed-dimensions','1536','--context-embed-max-requests','5','--context-embed-max-usd','.1'],env);
    const localArgs=['--db','/nonexistent/store','--owner','owner','--context-read','context-read-v1','--context-embedder','local','--context-embed-model','bge-m3','--context-embed-dimensions','1024','--context-embed-pack','/nonexistent/pack','--context-embed-max-requests','5'];
    await start(['--check-config',...localArgs],env);
    await start(['model','verify','bge-m3','--dir','/nonexistent/pack','--check-config'],env);
    await start(['--check-config',...localArgs,'--context-read-sources','moc-v1'],env);
    await start(['context','refresh','--db','/nonexistent/store','--owner','owner','--types','memory','--intent','current','--max-items','1','--max-ms','100',...localArgs.slice(6),'--check-config'],env);
    if(spawns||packReads||fetches)throw Error('SIDE_EFFECT');console.log=saved;console.log(JSON.stringify(values));`;
  const out=openSync(outPath,'wx'),err=openSync(errPath,'wx');let result;
  try{result=spawnSync(process.execPath,['--input-type=module','-e',script],{stdio:['ignore',out,err],timeout:30000,env:{NODE_NO_WARNINGS:'1'}});}finally{closeSync(out);closeSync(err);}
  assert.equal(result.error,undefined);assert.equal(result.status,0,readFileSync(errPath,'utf8'));assert.equal(result.signal,null);
  const values=JSON.parse(readFileSync(outPath,'utf8'));
  const lexicalCheck={ok:true,mode:'configuration-check',contextRead:'context-read-v1',contextReadPersonal:false,scope:'personal',provider:null,preset:'rrf-k60-d12',modelKeyInspected:false,databaseOpened:false,providerContacted:false,automaticCapture:false};
  assert.equal(JSON.stringify(values[0]),JSON.stringify(lexicalCheck));
  assert.equal(JSON.stringify(values[1]),JSON.stringify({...lexicalCheck,provider:{provider:'openai',model:'text-embedding-3-small',dimensions:1536,maxRequests:5,maxUsd:.1},preset:'rrf-k10'}));
  assert.equal(values[2].preset,'rrf-k60-d12');assert.equal(values[2].packStatus,'not-inspected');assert.equal(values[2].provider.threads,4);assert.equal(values[3].packStatus,'not-inspected');assert.equal(values[4].preset,'rrf-k60-d12-moc-v1');assert.equal(values[5].preset,'rrf-k60-d12');assert.equal(values[5].packStatus,'not-inspected');
  const loaded=new Set(readFileSync(log,'utf8').trim().split('\n').map(JSON.parse));
  for(const path of source.required.filter(p=>(p.startsWith('adapters/local-embedder/')&&p.endsWith('.mjs'))||['adapters/mcp/model-command.mjs','core/context-read-local-status.mjs'].includes(p)))assert.ok(loaded.has(pathToFileURL(join(f.root,path)).href),path);
  const fixture=await packFixture(t),copied=join(w.path,'copied-pack');await cp(fixture.root,copied,{recursive:true});
  const {verifyPack}=await import(pathToFileURL(join(f.root,'adapters/local-embedder/pack.mjs')).href);assert.equal((await verifyPack(copied,{catalog:fixture.catalog})).manifestHash,fixture.catalog[0].manifestHash);
  const {createCairnServer}=await import(pathToFileURL(join(f.root,'adapters/mcp/server.mjs')).href);
  const {contextToolResponse}=await import(pathToFileURL(join(f.root,'adapters/mcp/context-read-transport.mjs')).href);
  const {prepareContextEmbedding,contextEmbeddingPort}=await import(pathToFileURL(join(f.root,'adapters/mcp/context-read-provider.mjs')).href);
  const owner=await prepareContextEmbedding({provider:'local',packPath:'/nonexistent/pack',threads:4,maxRequests:5},Object.defineProperty({},'OPENAI_API_KEY',{get(){assert.fail('key');}}));
  const base={path:f.path,namespace:{ownerId:'synthetic-local',scope:'personal',projectId:null},privateCards:'local-v1',contextRead:'context-read-v1',contextCounter:{id:'synthetic',countTokens:()=>1}};
  assert.equal(f.core.admit({namespace:base.namespace,memory:{content:'apple installed local',kind:'fact'},receipts:[{client:'synthetic',sessionId:'local',eventId:'installed-local',role:'user',excerpt:'apple installed local'}]}).ok,true);
  const server=createCairnServer({...base,contextEmbedding:contextEmbeddingPort(owner)}),legacy=createCairnServer(base);
  try{
    const handlers=server.server._requestHandlers, oldHandlers=legacy.server._requestHandlers;
    assert.deepEqual(await handlers.get('tools/list')({method:'tools/list',params:{}},{}),await oldHandlers.get('tools/list')({method:'tools/list',params:{}},{}));
    const call=(name,args)=>handlers.get('tools/call')({method:'tools/call',params:{name,arguments:args}},{signal:new AbortController().signal,requestId:'synthetic',mcpReq:{requestState:()=>undefined}});
    const found=await call('find_memory_candidates',{query:'apple',types:['memory'],intent:'current',semantic:true});
    assert.deepEqual(JSON.parse(found.content[0].text).value.trace.localEmbedder,owner.localStatus());
    const assembled=await call('read_memory_context',{query:'apple',types:['memory'],intent:'current'});
    assert.deepEqual(assembled._meta['ink.cairn/context-read-diagnostics'].candidates.trace.localEmbedder,owner.localStatus());
    assert.equal(assembled.content[0].text.includes('localEmbedder'),false);
    const error={ok:false,error:{code:'index_unavailable',retryable:false,details:{candidates:{trace:{localEmbedder:owner.localStatus()}}}}};
    const response=contextToolResponse(error,{assembly:true});assert.equal(response.content[0].text.includes('localEmbedder'),false);assert.deepEqual(response._meta['ink.cairn/context-read-diagnostics'].candidates.trace.localEmbedder,owner.localStatus());
  }finally{await server.close();await legacy.close();await owner.close();}
  const {contextCommand}=await import(pathToFileURL(join(f.root,'adapters/mcp/context-read-command.mjs')).href);
  const captured=[],savedLog=console.log;console.log=text=>captured.push(JSON.parse(text));
  try{await contextCommand(['refresh','--db',f.path,'--owner','synthetic-local','--types','memory','--intent','current','--max-items','10','--max-ms','5000','--context-embedder','local','--context-embed-model','bge-m3','--context-embed-dimensions','1024','--context-embed-pack','/nonexistent/pack','--context-embed-max-requests','5'],{});}finally{console.log=savedLog;}
  assert.equal(captured[0].ok,true);assert.equal(captured[0].value.status,'partial');assert.equal(captured[0].value.trace.localEmbedder.reason,'model_pack_unavailable');
  assert.throws(()=>createCairnServer({path:'/nonexistent/never-create',namespace:{ownerId:'owner',scope:'personal',projectId:null},contextRead:'context-read-v1',contextEmbedding:{...contextEmbeddingPort(owner),localStatus:async()=>({state:'ready',reason:null})}}),/invalid_mcp_configuration/);
  const {startOwnedStdio}=await import(pathToFileURL(join(f.root,'adapters/mcp/cli.mjs')).href);
  let closes=0,ownerCloses=0; const stdio={StdioServerTransport:class{},serveStdio(factory){factory();return{async close(){closes++;}};}};
  const handle=await startOwnedStdio(()=>({}),stdio,262144,{async close(){ownerCloses++;}});await handle.close();await handle.close();assert.equal(closes,1);assert.equal(ownerCloses,1);
  await assert.rejects(startOwnedStdio(()=>{throw Error('construction_failure');},stdio,262144,{async close(){ownerCloses++;}}),/construction_failure/);assert.equal(ownerCloses,2);
  for(const reason of ['eof','SIGTERM','SIGINT']){
    const input=new PassThrough({autoDestroy:false}),output=new PassThrough(),events=new EventEmitter();let release,entered;
    const gate=new Promise(resolve=>{release=resolve;}),ownerEntered=new Promise(resolve=>{entered=resolve;});
    const fake={input,output,events,StdioServerTransport:class{constructor(){input.resume();}},serveStdio(factory){factory();return{async close(){}};}};
    const closing=await startOwnedStdio(()=>({}),fake,262144,{async close(){entered();await gate;}});
    const closed=once(input,'close');if(reason==='eof')input.end();else events.emit(reason);
    await ownerEntered;assert.equal(input.destroyed,false);release();await closing.close();await closed;
    assert.equal(events.listenerCount('SIGTERM'),0);assert.equal(events.listenerCount('SIGINT'),0);
  }
  t.diagnostic(`source/installed closure ${source.required.length}; archive/filesystem ${f.artifact.files.length}; differences 0; build/install/check child exit 0`);
});
