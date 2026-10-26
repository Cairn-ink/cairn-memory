import assert from 'node:assert/strict';
import test from 'node:test';
import {createTestWorkspace} from '../../../tools/testing/workspace.mjs';
import {openMemoryCore} from '../../../core/contract.mjs';
import {fixture,ns,ok,input,file} from '../../../core/testing/method-package-fixtures.mjs';
import {host,call} from './method-support.mjs';
import {parseConfiguration} from '../cli.mjs';
import {PassThrough} from 'node:stream';
import {MethodStdioServerTransport,METHOD_TRANSPORT_BYTES} from '../method-package-transport.mjs';

test('H01/H05 opted-in stdio bounds actual encoded JSON-RPC messages at 262144 bytes before writing',async()=>{
  const incoming=new PassThrough(),outgoing=new PassThrough(),transport=new MethodStdioServerTransport(incoming,outgoing);
  const chunks=[];outgoing.on('data',chunk=>chunks.push(chunk));
  const empty={jsonrpc:'2.0',id:'synthetic',result:{text:''}},overhead=Buffer.byteLength(JSON.stringify(empty))+1;
  const maximum={...empty,result:{text:'x'.repeat(METHOD_TRANSPORT_BYTES-overhead)}};
  await transport.send(maximum);assert.equal(Buffer.concat(chunks).length,METHOD_TRANSPORT_BYTES);
  await assert.rejects(transport.send({...maximum,result:{text:maximum.result.text+'x'}}),/method_transport_response_too_large/);
  assert.equal(Buffer.concat(chunks).length,METHOD_TRANSPORT_BYTES,'oversized response writes no partial bytes');
  let failure;transport.onerror=error=>{failure=error;};
  const closed=new Promise(resolve=>{transport.onclose=resolve;});await transport.start();incoming.write('x'.repeat(METHOD_TRANSPORT_BYTES+1));await closed;
  assert.ok(failure);incoming.destroy();outgoing.destroy();
});

test('H01 host flags keep method access explicit and project personal reads separately selected',()=>{
  const args=['--db','/synthetic/store','--owner','synthetic'];
  assert.equal(parseConfiguration(args).methodPackages,undefined);
  assert.equal(parseConfiguration([...args,'--method-packages','local-v1']).methodPackages,'local-v1');
  for(const extra of [['--method-read-personal'],['--method-packages','bad'],['--method-packages','local-v1','--method-read-personal'],
    ['--project','p','--method-read-personal'],['--project','p','--method-packages','local-v1','--method-read-personal','--method-read-personal']])assert.throws(()=>parseConfiguration([...args,...extra]));
  assert.equal(parseConfiguration([...args,'--project','p','--method-packages','local-v1','--method-read-personal']).methodReadPersonal,true);
});
test('H01/H05 all nine tools inject only their own core grammar, reject supplied scope/authority and preserve opaque identities',async t=>{
  const f=fixture(t),v1=ok(f.call('importMethodVersion',input('v1',{files:[file('SKILL.md','"\\\u0001\n'.repeat(2000))]}))),
    v2=ok(f.call('importMethodVersion',input('v2',{package:v1.package,expectedPackageRevision:1,basedOn:v1.version})));
  ok(f.call('adoptMethodVersion',{bindingNamespace:ns,actionId:'adopt',package:v1.package,version:v1.version,roleId:'reviewer',expectedRevision:null,readSet:[ns]}));
  const server=await host(f.workspace,f.path),requests={
    resolve_method:{package:v1.package,roleId:'reviewer'},resolve_methods_for_role:{roleId:'reviewer'},
    get_method_version:{version:v1.version,intent:'history'},list_method_manifest:{version:v1.version,intent:'history'},
    read_method_file:{version:v1.version,path:'SKILL.md',intent:'history'},list_method_packages:{},
    list_method_versions:{package:v1.package},compare_method_versions:{from:v1.version,to:v2.version},list_method_binding_events:{},
  };
  for(const [name,args] of Object.entries(requests)){
    ok(await call(server.client,name,args));
    for(const field of ['namespace','readSet','context','bindingNamespace','authority','token','scope','unknown']){
      const result=await server.client.callTool({name,arguments:{...args,[field]:{approved:true}}});assert.equal(result.isError,true,name+' '+field);
    }
  }
  const resolved=ok(await call(server.client,'resolve_method',requests.resolve_method));assert.deepEqual(resolved.version,v1.version);
  assert.equal(ok(await call(server.client,'get_method_version',{version:v1.version,intent:'current',roleId:'reviewer',snapshot:resolved.snapshot})).version.adoptionStatus,'current');
  assert.equal(ok(await call(server.client,'get_method_version',requests.get_method_version)).version.adoptionStatus,'unassessed');
  const foreign={...v1.version,namespace:{...ns,ownerId:'foreign'}};
  assert.equal((await call(server.client,'get_method_version',{version:foreign,intent:'history'})).error.code,'authority_required');
  for(const name of ['get_method_version','list_method_manifest','read_method_file']){
    const args={...requests[name],intent:'current'};assert.equal((await server.client.callTool({name,arguments:args})).isError,true);
  }
  const page=await call(server.client,'read_method_file',requests.read_method_file);assert.ok(Buffer.byteLength(JSON.stringify(page))>11000);
  assert.equal(ok(page).parts[0].text,'"\\\u0001\n'.repeat(1000));
  await server.client.close();
});
test('H05 maximum-metadata role pages keep core and separately encoded MCP envelopes bounded',async t=>{
  const workspace=createTestWorkspace(t,{prefix:'method-transport-bound-'}),path=workspace.path+'/store.sqlite',owner='o'.repeat(200),namespace={ownerId:owner,scope:'personal',projectId:null},roleId='r'.repeat(200);
  const token={},grants=new WeakMap(),authority={authorize(request,supplied){if(supplied!==token)return null;const grant={}, {input,...binding}=request;grants.set(grant,{...binding,accessGeneration:1});return grant;},isCurrent(grant){return grants.get(grant)??null;}};
  const core=openMemoryCore({path,methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority}});workspace.defer(()=>core.close());
  for(let i=0;i<23;i++){
    const imported=ok(core.importMethodVersion(input('package-'+i,{namespace}),token));
    ok(core.adoptMethodVersion({bindingNamespace:namespace,actionId:'adopt-'+i,package:imported.package,version:imported.version,roleId,expectedRevision:null,readSet:[namespace]},token));
  }
  const server=await host(workspace,path,{owner}),result=await call(server.client,'resolve_methods_for_role',{roleId}),page=ok(result);
  assert.ok(Buffer.byteLength(JSON.stringify(result))>48000);assert.ok(page.nextCursor);assert.ok(page.methods.length<=20);
  const request={version:page.methods[0].version,path:'SKILL.md',intent:'current',roleId,snapshot:page.snapshot};
  assert.equal(ok(await call(server.client,'read_method_file',request)).adoptionStatus,'current');
  const wire=await server.client.callTool({name:'resolve_methods_for_role',arguments:{roleId}});
  const {evidenceTrust,...envelope}=JSON.parse(wire.content[0].text);
  t.diagnostic('Measured serialized core envelope '+Buffer.byteLength(JSON.stringify(envelope))+' bytes; encoded MCP result '+Buffer.byteLength(JSON.stringify(wire))+' bytes.');
  await server.client.close();
});
