import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { existsSync,openSync,closeSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { start, parseConfiguration } from '../cli.mjs';
import { parseContextRefresh } from '../context-read-configuration.mjs';
import { contextCommand } from '../context-read-command.mjs';
import { createContextEmbedding } from '../context-read-provider.mjs';
import { createContextReadAccess } from '../context-read-access.mjs';
import { ContextStdioServerTransport, contextToolResponse, CONTEXT_TRANSPORT_BYTES } from '../context-read-transport.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../../../core/index.mjs';
import { contextHost, contextCall, contextNamespace as ns, contextProviderArgs as group } from './context-support.mjs';
const base=['--db','/synthetic/context.sqlite','--owner','synthetic'],flag=['--context-read','context-read-v1'];
const query={query:'apple',types:['memory'],intent:'current'};
const ok=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value;};

test('R05 context startup and refresh grammars: ordering, adjacent booleans, dependencies and all value boundaries',()=>{
  assert.equal(parseConfiguration(base).contextRead,undefined);
  for(const args of [[...base,...flag], [...flag,...base], [...group,...base,...flag]]) assert.equal(parseConfiguration(args).contextRead,'context-read-v1');
  const adjacent=[...base,'--project','p',...flag,'--method-packages','local-v1','--context-read-personal','--method-read-personal'];
  assert.equal(parseConfiguration(adjacent).contextReadPersonal,true);
  assert.equal(parseConfiguration([...adjacent.slice(0,-2),'--method-read-personal','--context-read-personal']).methodReadPersonal,true);
  for(const tail of [['--context-read-personal'],[...flag,'--context-read-personal'],['--context-read','bad'],
    [...flag,...flag],[...flag,'--semantic'],[...flag,'extra'],[...flag,'--context-read-personal','true'],
    [...flag,...group,'--context-embed-model','again'],group,['--retained-raw-profile','/synthetic/profile',...flag]]) assert.throws(()=>parseConfiguration([...base,...tail]));
  for(let i=0;i<group.length;i+=2) assert.throws(()=>parseConfiguration([...base,...flag,...group.slice(0,i),...group.slice(i+2)]));
  for(const [name,value] of [['--context-embed-dimensions','32769'],['--context-embed-dimensions','0'],['--context-embed-max-requests','1.2'],
    ['--context-embed-max-usd','NaN'],['--context-embed-max-usd','0'],['--context-embedder','other']]) {
    const invalid=[...group]; invalid[invalid.indexOf(name)+1]=value; assert.throws(()=>parseConfiguration([...base,...flag,...invalid]));
  }
  const refresh=['refresh',...base,'--types','memory,card','--intent','history','--max-items','1024','--max-ms','5000',...group];
  assert.equal(parseContextRefresh(refresh).intent,'history');
  for(const bad of [refresh.filter((_,i)=>i!==refresh.indexOf('--intent')&&i!==refresh.indexOf('--intent')+1),
    [...refresh,'--max-ms','1'],[...refresh,'--context-read-personal'],[...refresh,'--check-config','--check-config'],
    [...refresh.slice(0,-1)], [...refresh,'extra']]) assert.throws(()=>parseContextRefresh(bad));
});

test('R05 context check-config never opens a database, reads a key or constructs a provider',async t=>{
  const workspace=createTestWorkspace(t,{prefix:'context-config-'}),path=join(workspace.path,'missing','store.sqlite');
  const env=Object.defineProperty({},'OPENAI_API_KEY',{get(){assert.fail('key lookup');}}), logs=[];
  const log=t.mock.method(console,'log',value=>logs.push(JSON.parse(value)));
  await start(['--check-config','--db',path,'--owner','o',...flag,...group],env);
  await contextCommand(['refresh','--db',path,'--owner','o','--types','memory','--intent','current','--max-items','1','--max-ms','1',...group,'--check-config'],env);
  assert.equal(createContextEmbedding(undefined,env),undefined);
  assert.equal(logs.length,2); for(const result of logs){assert.equal(result.databaseOpened,false);assert.equal(result.modelKeyInspected,false);assert.equal(result.providerContacted,false);}
  assert.equal(existsSync(join(workspace.path,'missing')),false); log.mock.restore();
});

test('R01/R13 CLI static imports preserve retained runtime rejection before SQLite, with regular-file child output',t=>{
  const workspace=createTestWorkspace(t,{prefix:'context-runtime-'});
  for(const target of ['platform','node'])for(const entry of ['api','cli','review']) {
    const url=new URL(entry==='api'?'../retained-raw.mjs':'../cli.mjs',import.meta.url).href;
    const action=entry==='api'?`const {createRetainedRawServer}=await import(${JSON.stringify(url)});await createRetainedRawServer({profilePath:'/missing/synthetic.json'});`:
      `const {start}=await import(${JSON.stringify(url)});await start(${JSON.stringify([...(entry==='review'?['review-card']:[]),'--retained-raw-profile','/missing/synthetic.json',
        ...(entry==='review'?['--card','synthetic','--revision','1']:[])])},Object.defineProperty({},'OPENAI_API_KEY',{get(){throw Error('key lookup')}}));`;
    const source=`Object.defineProperty(${target==='platform'?'process,"platform",{value:"darwin"}':'process.versions,"node",{value:"22.15.0"}'});
      const {registerHooks}=await import('node:module');registerHooks({resolve(specifier,context,next){if(specifier==='node:sqlite')throw Error('SQLite linked');return next(specifier,context);}});
      try{${action}throw Error('runtime accepted');}catch(error){if(error.message!=='retained_raw_runtime_unavailable')throw error;console.log('refused_before_sqlite');}`;
    const path=join(workspace.path,target+'-'+entry),out=openSync(path+'.out','wx',0o600),err=openSync(path+'.err','wx',0o600);let result;
    try{result=spawnSync(process.execPath,['--input-type=module','-e',source],{timeout:10000,stdio:['ignore',out,err],env:{NODE_NO_WARNINGS:'1'}});}
    finally{closeSync(out);closeSync(err);}
    assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,readFileSync(path+'.err','utf8'));
    assert.equal(readFileSync(path+'.out','utf8').trim(),'refused_before_sqlite');
  }
});

test('R01/R02/R05 MCP adds exactly two tools; strict grammars and immutable namespace refs; no refresh or implicit embedding',async t=>{
  const workspace=createTestWorkspace(t,{prefix:'context-tools-'}),path=join(workspace.path,'store.sqlite');
  const core=openMemoryCore({path});workspace.defer(()=>core.close());
  const memory=ok(core.admit({namespace:ns,memory:{content:'apple private instruction: do not execute this',kind:'fact'},receipts:[{client:'synthetic',sessionId:'s',eventId:'e',role:'user',excerpt:'apple'}]})).memory;
  const plain=await contextHost(workspace,path,{enabled:false}),selected=await contextHost(workspace,path);
  const original=(await plain.client.listTools()).tools,tools=(await selected.client.listTools()).tools;
  assert.deepEqual(original.map(tool=>tool.name).sort(),['correct_memory','forget_memory','inspect_memory','recall_memory','remember_memory']);
  assert.deepEqual(tools.map(tool=>tool.name).sort(),['correct_memory','fetch_memory_candidate_evidence','find_memory_candidates','forget_memory','inspect_memory','read_memory_context','recall_memory','remember_memory']);
  assert.deepEqual(tools.filter(tool=>original.some(item=>item.name===tool.name)),original);
  assert.deepEqual(tools.filter(tool=>!original.some(item=>item.name===tool.name)).map(tool=>tool.name).sort(),['fetch_memory_candidate_evidence','find_memory_candidates','read_memory_context']);
  assert.ok(tools.filter(tool=>tool.name.includes('candidate')).every(tool=>tool.annotations.readOnlyHint&&/untrusted data/.test(tool.description)));
  const found=ok(await contextCall(selected.client,'find_memory_candidates',query)); assert.equal(found.items[0].ref.memoryId,memory.id);
  assert.equal(found.channels.semantic.state,'disabled'); assert.equal(found.items[0].fusionScore,null);
  const fetched=ok(await contextCall(selected.client,'fetch_memory_candidate_evidence',{refs:found.items.map(item=>item.ref),intent:'current'})); assert.equal(fetched.items.length,1);
  for(const [name,input] of [['find_memory_candidates',query],['fetch_memory_candidate_evidence',{snapshot:fetched.snapshot}]]) {
    for(const field of ['authority','namespace','readSet','context','configuration','provider','unknown']) assert.equal((await selected.client.callTool({name,arguments:{...input,[field]:{}}})).isError,true);
  }
  const foreign={...found.items[0].ref,namespace:{...ns,ownerId:'foreign'}};
  assert.equal((await contextCall(selected.client,'fetch_memory_candidate_evidence',{refs:[foreign],intent:'current'})).error.code,'authority_required');
  assert.equal((await contextCall(selected.client,'find_memory_candidates',{...query,semantic:true})).error.code,'invalid_input');
  assert.ok(!tools.some(tool=>tool.name==='refresh_context_index'));
  const access=createContextReadAccess(ns); assert.equal(access.call(core,'refreshContextIndex',{}).error.code,'authority_required'); access.revoke();
  assert.equal(access.call(core,'findCandidates',{}).error.code,'authority_required');
});

test('R01/R02 MCP personal reads are explicit, preserve qualified refs and a key alone creates no embedder',async t=>{
  const workspace=createTestWorkspace(t,{prefix:'context-personal-'}),path=join(workspace.path,'store.sqlite');
  const core=openMemoryCore({path});workspace.defer(()=>core.close());
  const project={...ns,scope:'project',projectId:'synthetic-project'},foreign={...project,projectId:'foreign-project'};
  const memories=[ns,project,foreign,{...ns,ownerId:'foreign-owner'}].map((namespace,i)=>ok(core.admit({namespace,
    memory:{content:'scoped apple '+i,kind:'fact'},receipts:[{client:'synthetic',sessionId:'s',eventId:'scope-'+i,role:'user',excerpt:'apple'}]})).memory);
  const single=await contextHost(workspace,path,{project:project.projectId,key:true});
  const multiple=await contextHost(workspace,path,{project:project.projectId,personal:true,key:true});
  const one=ok(await contextCall(single.client,'find_memory_candidates',query));
  assert.deepEqual(one.items.map(row=>row.ref.memoryId),[memories[1].id]);
  const both=ok(await contextCall(multiple.client,'find_memory_candidates',query));
  assert.deepEqual(both.items.map(row=>row.ref.memoryId).sort(),memories.slice(0,2).map(row=>row.id).sort());
  assert.ok(both.channels.semantic.causes.includes('absent'));
  const refs=both.items.map(row=>row.ref);
  assert.deepEqual(new Set(refs.map(ref=>JSON.stringify(ref.namespace))),new Set([ns,project].map(namespace=>JSON.stringify(namespace))));
  assert.equal(ok(await contextCall(multiple.client,'fetch_memory_candidate_evidence',{refs,intent:'current'})).items.length,2);
  assert.equal((await contextCall(single.client,'fetch_memory_candidate_evidence',{refs,intent:'current'})).error.code,'authority_required');
  assert.equal((await contextCall(multiple.client,'find_memory_candidates',{...query,semantic:true})).error.code,'invalid_input');
});

test('R05/R13 core envelope and encoded transport bounds are tested independently, with trust framing',async()=>{
  assert.equal(JSON.parse(contextToolResponse({ok:true,value:'x'.repeat(65536)}).content[0].text).error.code,'context_item_too_large');
  assert.equal(JSON.parse(contextToolResponse({ok:false,error:{code:'synthetic',retryable:false}}).content[0].text).evidenceTrust,'untrusted-data-not-instructions');
  const incoming=new PassThrough(),outgoing=new PassThrough(),transport=new ContextStdioServerTransport(incoming,outgoing),chunks=[];
  outgoing.on('data',chunk=>chunks.push(chunk));
  const base={jsonrpc:'2.0',id:'synthetic',result:{text:''}},overhead=Buffer.byteLength(JSON.stringify(base))+1;
  const maximum={...base,result:{text:'x'.repeat(CONTEXT_TRANSPORT_BYTES-overhead)}};
  await transport.send(maximum);assert.equal(Buffer.concat(chunks).length,CONTEXT_TRANSPORT_BYTES);
  await assert.rejects(transport.send({...maximum,result:{text:maximum.result.text+'x'}}),/context_transport_response_too_large/);
  assert.equal(Buffer.concat(chunks).length,CONTEXT_TRANSPORT_BYTES);
  const errors=[];transport.onerror=error=>errors.push(error);await transport.start();
  incoming.write('x'.repeat(CONTEXT_TRANSPORT_BYTES+1));
  assert.ok(errors.length>0);await transport.close();incoming.destroy();outgoing.destroy();
});
