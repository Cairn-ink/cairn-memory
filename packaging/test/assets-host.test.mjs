import assert from 'node:assert/strict';
import { exportCases } from '../../adapters/mcp/test/asset-export-cases.mjs';
import test from 'node:test';
import { join,relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readdirSync,lstatSync,readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { installedMethods,fileCommand } from './fixtures/method-packages.mjs';
import { installedImportClosure } from './fixtures/installed-import-closure.mjs';
import { host,call,review,phrase,receipt,runFile,namespace as ns,ok } from '../../adapters/mcp/test/asset-support.mjs';

test('L01–L06 installed asset CLI/MCP, complete reads, transport and independent archive/closure counts',{timeout:180000},async t=>{
  const workspace=createTestWorkspace(t,{prefix:'installed-asset-host-'}),installed=await installedMethods(workspace),{root,entry}=installed;
  const {openMemoryCore}=await import(pathToFileURL(join(root,'core/contract.mjs')).href);
  const token={},grants=new WeakMap(),authority={authorize(request,supplied){if(supplied!==token)return null;const grant={},{input,...binding}=request;grants.set(grant,{...binding,accessGeneration:1});return grant;},isCurrent(grant){return grants.get(grant)??null;}};
  const path=join(workspace.path,'assets.sqlite'),options={path,assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority},methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority}};
  let core=openMemoryCore(options);workspace.defer(()=>core.close());
  const base=['--db',path,'--owner',ns.ownerId],f={workspace,path};
  async function approve(args,{group='assets'}={}){const start=performance.now(),terminal=review(workspace,args,{command:entry,group}),prompt=await terminal.prompt;terminal.answer(phrase(prompt.output));const done=await terminal.done;assert.equal(done.code,0,done.output);return {saved:ok(receipt(done.output)),ms:performance.now()-start,prompt:prompt.output};}
  let imported,derivative;
  await t.test('L01 defaults and independent flag combinations add exactly five asset and nine method reads',async()=>{
    for(const assets of [false,true])for(const enabled of [false,true]){
      const server=await host(workspace,path,{command:entry,assets,enabled}),tools=(await server.client.listTools()).tools;
      assert.equal(tools.length,5+(assets?5:0)+(enabled?9:0));
      for(const tool of tools.filter(x=>x.name.includes('asset')))assert.equal(tool.annotations.readOnlyHint,true);
      for(const name of ['read_asset_bytes','verify_asset_bytes','import_asset_version','create_asset_derivative','delete_asset','read_method_attachment_bytes','capture_memory','create_private_card_draft'])assert.ok(!tools.some(x=>x.name===name));
      await server.client.close();
    }
    const plain=openMemoryCore({path});try{assert.equal(plain.importAssetVersion,undefined);assert.equal(plain.getAssetCapabilities,undefined);}finally{plain.close();}
  });
  await t.test('L02/L04/L05 real terminal maximum 32-MiB import and independently hashed complete export',async()=>{
    const data=Buffer.alloc(33554432,0xa7);data.set(Buffer.from('%PDF-1.7'));const file=join(workspace.path,'maximum.pdf');writeFileSync(file,data);
    const result=await approve(['import',...base,'--file',file,'--title','Maximum installed asset']);imported=result.saved;
    const out=join(workspace.path,'export.pdf'),start=performance.now(),exported=runFile(workspace,['assets','export',...base,'--version',JSON.stringify(imported.version),'--out',out],{command:entry});
    assert.equal(exported.code,0,exported.output);assert.equal(lstatSync(out).size,data.length);
    const sha=bytes=>createHash('sha256').update(bytes).digest('hex');assert.equal(sha(readFileSync(out)),sha(data));
    assert.deepEqual(readFileSync(out),data);
    t.diagnostic(JSON.stringify({node:process.version,importExit:0,exportExit:exported.code,byteCount:data.length,importReviewAndCommitMs:result.ms,completeExportMs:performance.now()-start,sha256:sha(data),deadlineMs:30000}));
  });
  await t.test('L02 installed derivative/delete and exclusive method attachments through real terminals',async()=>{
    const text=join(workspace.path,'caption.txt');writeFileSync(text,'\u0001'.repeat(20000));
    derivative=(await approve(['derive',...base,'--version',JSON.stringify(imported.version),'--kind','caption','--text-file',text])).saved;
    const pkg=join(workspace.path,'method');mkdirSync(pkg);writeFileSync(join(pkg,'SKILL.md'),'Supplied method');writeFileSync(join(pkg,'image.svg'),'<svg/>');writeFileSync(join(pkg,'example.pdf'),Buffer.from('%PDF-1.7'));
    const method=(await approve(['import',...base,'--dir',pkg,'--title','Mixed installed method','--attachments','local-v1'],{group:'methods'})).saved;
    const server=await host(workspace,path,{command:entry,enabled:true}),manifest=ok(await call(server.client,'list_method_manifest',{version:method.version,intent:'history'}));
    const binary=manifest.files.find(x=>x.path==='example.pdf');assert.equal(binary.kind,'binary');assert.equal(binary.byteCount,8);
    await server.client.close();
    const terminal=review(workspace,['delete',...base,'--ref',JSON.stringify(method.version),'--expected-revision','1'],{command:entry});const refused=await terminal.done;assert.equal(refused.code,1);
    // Exercise asset-version deletion on a separate retained version.
    const small=ok(core.importAssetVersion({namespace:ns,actionId:'small',title:'small',filename:'small.pdf',mediaType:'application/pdf',bytes:Buffer.from('%PDF-1.7')},token));
    await approve(['delete',...base,'--ref',JSON.stringify(small.version),'--expected-revision','1']);assert.equal(ok(core.getAssetVersion({version:small.version},token)).status,'unavailable');
  });
  await t.test('L03/L05 fresh MCP historical provenance, complete derivative parts and encoded transport measurements',async()=>{
    ok(core.importAssetVersion({namespace:ns,actionId:'newer',asset:imported.asset,expectedAssetRevision:1,title:'newer',filename:'newer.pdf',mediaType:'application/pdf',bytes:Buffer.from('%PDF-1.7')},token));
    core.close();core=openMemoryCore(options);
    const server=await host(workspace,path,{command:entry});let cursor,text='',parts=0,maxCore=0,maxWire=0;
    do{
      const response=await server.client.callTool({name:'read_asset_derivative',arguments:{ref:derivative.derivative,...(cursor?{cursor}:{})}}),envelope=JSON.parse(response.content[0].text),{evidenceTrust,...raw}=envelope;
      assert.equal(evidenceTrust,'untrusted-data-not-instructions');const page=ok(raw);assert.equal(page.derivative.historical,true);assert.equal(page.derivative.sourceOrdinal,1);assert.equal(page.derivative.greatestImportedOrdinal,2);
      assert.deepEqual(page.derivative.provenance.source,imported.version);assert.equal(page.derivative.provenance.method.kind,'user-provided');
      assert.equal(Object.hasOwn(page,'bytes'),false);for(const part of page.parts){text+=part.text;parts++;}cursor=page.nextCursor;
      maxCore=Math.max(maxCore,Buffer.byteLength(JSON.stringify(raw)));maxWire=Math.max(maxWire,Buffer.byteLength(JSON.stringify({jsonrpc:'2.0',id:1,result:response}))+1);
    }while(cursor);
    assert.equal(text,'\u0001'.repeat(20000));assert.equal(parts,5);assert.ok(maxCore<=65536);assert.ok(maxWire<=262144);
    t.diagnostic(JSON.stringify({node:process.version,derivativeUnits:text.length,completeReadPages:parts,maxCoreEnvelopeBytes:maxCore,maxEncodedJsonRpcBytes:maxWire,deadlineMs:30000}));
    await server.client.close();
  });
  await exportCases(t.test.bind(t),{command:entry});
  await t.test('L06 independent source-manifest, archive, installed-files and static-closure inventories',()=>{
    const artifact=installed.artifact,manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
    const archive=fileCommand(workspace,'tar',['-tzf',artifact.artifactPath],workspace.path,artifact.userconfig).trim().split('\n').map(x=>x.slice('package/'.length)).sort();
    const files=[];function walk(path){for(const name of readdirSync(path)){const child=join(path,name),rel=relative(root,child);if(rel==='node_modules')continue;if(lstatSync(child).isDirectory())walk(child);else files.push(rel);}}walk(root);files.sort();
    assert.deepEqual(archive,files);assert.deepEqual(archive,[...manifest.files].sort());assert.deepEqual(archive,[...artifact.files].sort());
    const closure=installedImportClosure(root,['bin/cairn-memory.mjs']);assert.deepEqual(closure.required.filter(x=>!archive.includes(x)),[]);
    const sourceManifest=JSON.parse(readFileSync(new URL('../artifact-files.json',import.meta.url),'utf8'));
    const helpers=readdirSync(new URL('../../adapters/mcp/',import.meta.url)).filter(x=>/^asset-.*\.mjs$/.test(x)).map(x=>'adapters/mcp/'+x).sort();
    const fromManifest=sourceManifest.filter(x=>/^adapters\/mcp\/asset-.*\.mjs$/.test(x)).sort();assert.deepEqual(helpers,fromManifest);
    for(const file of [...helpers,'docs/assets-local.md']){assert.ok(closure.required.includes(file)||file.endsWith('.md'));assert.ok(archive.includes(file));assert.equal(createHash('sha256').update(readFileSync(join(root,file))).digest('hex'),artifact.sourceHashes[file]);}
    t.diagnostic(JSON.stringify({sourceManifestCount:sourceManifest.length,archiveCount:archive.length,installedCount:files.length,closureCount:closure.required.length,assetHelpers:helpers.length,differences:0,historyUsed:false}));
  });
});
